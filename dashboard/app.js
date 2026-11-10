const params = new URLSearchParams(location.search);
const DEFAULT_PORTS = ['18765', '18766', '18767', '18768'];
const API = params.get('api') || (DEFAULT_PORTS.includes(location.port) ? location.origin : 'http://127.0.0.1:18765');

const el = (id) => document.getElementById(id);
const state = { status: null, query: '', activeGrid: null, activeCategory: 'all', prev: {}, first: true, ok: false, icons: {}, lang: {}, detail: null, craftAmount: 1, watch: [], menu: null, plan: null, ask: null, html: {}, fluids: {}, cancelArm: null };

try { state.watch = JSON.parse(localStorage.getItem('wx.watch') || '[]'); } catch (_) { state.watch = []; }

const CELL_STATE = {
  ABSENT: { label: '空槽位', color: '#6b6f80' },
  EMPTY: { label: '空元件', color: '#35a865' },
  NOT_EMPTY: { label: '已存物品', color: '#35a865' },
  TYPES_FULL: { label: '种类已满', color: '#dfa52b' },
  FULL: { label: '容量已满', color: '#d73e42' }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function num(value) {
  return Number(value ?? 0).toLocaleString('zh-CN');
}

function short(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return sign + String(Math.round(abs));
  for (const [base, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (abs >= base) {
      const scaled = abs / base;
      return sign + (scaled < 10 ? scaled.toFixed(1) : String(Math.round(scaled))).replace(/\.0$/, '') + suffix;
    }
  }
  return sign + String(Math.round(abs));
}

function timeOf(ms) {
  return new Date(ms || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
}

function iconUrl(id) {
  return state.icons[id] || 'assets/gui/unknown.png';
}

// 用背景图代替 <img>：轮询重建 DOM 时不会重新解码图片，也就不会闪一下
function icon(id, cls = '') {
  return `<i class="icon ${cls}" style="background-image:url('${esc(iconUrl(id))}')"></i>`;
}

function fluidStyle(item) {
  const info = state.fluids[item.id];
  if (!info || !info.tex) return '';
  let tint = info.tint;
  if (!tint || tint === '#ffffff') tint = WATER_TINT[item.id] || '';
  const color = tint ? `;--tint:${esc(tint)}` : '';
  return ` style="background-image:url('${esc(info.tex)}')${color}"`;
}

const WATER_TINT = { 'minecraft:water': '#3f76e4', 'minecraft:flowing_water': '#3f76e4' };

function zhName(id, fallback) {
  const [ns, ...rest] = String(id || '').split(':');
  const path = rest.join(':');
  if (!ns || !path) return fallback || id || '';
  return state.lang[`item.${ns}.${path}`] || state.lang[`block.${ns}.${path}`] || fallback || id;
}

function tipAttr(text) {
  return ` data-tip="${esc(text)}"`;
}

function gridPos(g) {
  return g.pos ? g.pos.join(', ') : '坐标未知';
}

async function loadAssets() {
  for (const [file, key] of [['assets/icon-map.json', 'icons'], ['assets/lang-zh.json', 'lang']]) {
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (res.ok) state[key] = await res.json();
    } catch (_) {}
  }
}

let statusEtag = null;

async function poll() {
  if (typeof document !== 'undefined' && document.hidden) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  let changed = true;
  try {
    const res = await fetch(`${API}/api/status`, {
      signal: controller.signal,
      headers: statusEtag ? { 'If-None-Match': statusEtag } : undefined
    });
    if (res.status === 304) {
      changed = false;
    } else {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tag = res.headers && res.headers.get ? res.headers.get('ETag') : null;
      statusEtag = tag || null;
      state.status = await res.json();
    }
    state.ok = true;
  } catch (_) {
    state.ok = false;
  } finally {
    clearTimeout(timer);
  }
  if (changed || !state.html.view) render();
}

function renderStatus() {
  const s = state.status;
  const modules = s?.modules || [];
  let color = '#d73e42';
  let label = '未连接';
  if (state.ok && modules.length) {
    const online = modules.filter((m) => m.state === 'online').length;
    const broken = modules.filter((m) => m.state === 'error' || m.state === 'missing').length;
    color = broken ? '#dfa52b' : (online === modules.length ? '#35a865' : '#dfa52b');
    label = online === modules.length && !broken ? `已接入 ${online}/${modules.length}` : `${online}/${modules.length} 已接入`;
  }
  return `<i class="led" style="--led:${color}"></i><span>${esc(label)}</span>` +
    `<span class="status-time">${esc(timeOf(s?.updatedAt))}</span>`;
}

// 只有内容真的变了才替换 DOM，顺带保住搜索框的焦点和光标
function setHTML(id, html) {
  if (state.html[id] === html) return false;
  state.html[id] = html;
  el(id).innerHTML = html;
  return true;
}

function render() {
  const active = document.activeElement;
  const keep = active && active.id === 'search' ? { start: active.selectionStart, end: active.selectionEnd } : null;

  el('status').innerHTML = renderStatus();
  setHTML('baseline', state.ok ? renderBaseline(state.status?.baseline) : '');
  setHTML('watch', state.ok ? renderWatch() : '');
  const banner = el('banner');
  banner.classList.toggle('hidden', state.ok);
  if (!state.ok) banner.textContent = `未连接游戏进程 · ${API}`;
  el('tip').classList.add('hidden');

  if (!state.ok || !state.status) {
    setHTML('view', `<div class="ae-panel"><div class="ae-head"><h2>ME 网络</h2></div><div class="ae-empty"><strong>${state.ok ? '等待数据' : '等待游戏'}</strong>${state.ok ? '进入世界后自动刷新' : '启动游戏客户端并进入世界'}</div></div>`);
    setHTML('detected', '');
    return;
  }

  const s = state.status;
  const modules = s.modules || [];
  ensureFluids();
  const scrolls = typeof document.querySelectorAll === 'function'
    ? [...document.querySelectorAll('.grid-slots')].map((n) => n.scrollTop)
    : [];
  setHTML('view', modules.map((m) => renderModule(m, (s.data || {})[m.id] || {})).join(''));
  setHTML('detected', renderDetected(s.detected || []));
  if (scrolls.length && typeof document.querySelectorAll === 'function') {
    [...document.querySelectorAll('.grid-slots')].forEach((node, i) => {
      if (scrolls[i]) node.scrollTop = scrolls[i];
    });
  }
  if (keep) {
    const next = el('search');
    if (next) {
      next.focus();
      try { next.setSelectionRange(keep.start, keep.end); } catch (_) {}
    }
  }
  refreshDetail();
}

function renderBaseline(b) {
  if (!b || !b.power) return '';
  const p = b.power;
  const d = b.draw || {};
  const it = b.items || {};
  const list = p.sources || [];
  const sources = list.map((s) => `${s.name} ${energyShort(s.value)}`).join(' · ');
  const sourcesFull = list.map((s) => `${s.name}：${num(s.value)} FE${s.note ? '（' + s.note + '）' : ''}`).join('\n');
  const draw = Math.abs(d.perTick || 0);
  const drawLabel = d.trend === 'drain' ? '净放电' : d.trend === 'charge' ? '净充电' : '待机';
  const drawClass = d.trend === 'drain' ? 'drain' : d.trend === 'charge' ? 'charge' : '';
  const gain = Number(it.gain) || 0;
  const loss = Number(it.loss) || 0;
  const source = it.source === 'ae2' ? 'ME 网络' : it.source === 'mekanism' ? '机器槽位' : '无数据';
  const powerTip = [`电网总量`, `${num(p.stored)} FE`, sourcesFull].filter(Boolean).join('\n');
  const drawTip = [`耗电速度`, `${num(draw)} FE/t`, drawLabel].join('\n');
  const gainTip = [`物品增加速率`, `${gain} 个/t`, `最近 ${Math.round(Number(b.sampleTicks) || 20)} tick 平均 · ${source}`, `库存合计 ${num(it.total)} 个`].join('\n');
  const lossTip = [`物品减少速率`, `${loss} 个/t`, `最近 ${Math.round(Number(b.sampleTicks) || 20)} tick 平均 · ${source}`, `库存合计 ${num(it.total)} 个`].join('\n');
  return `<div class="baseline-grid">
    <div class="bl-card"${tipAttr(powerTip)}>
      <span class="bl-label">电网总量</span>
      <b>${energyHTML(p.stored || 0)}<i>FE</i></b>
      <span class="bl-note">${esc(sources || '未检测到储能设备')}</span>
    </div>
    <div class="bl-card ${drawClass}"${tipAttr(drawTip)}>
      <span class="bl-label">耗电速度</span>
      <b>${draw ? energyHTML(draw) : '0'}<i>FE/t</i></b>
      <span class="bl-note">${drawLabel}${draw ? '' : ' · 无净变化'}</span>
    </div>
    <div class="bl-card gain"${tipAttr(gainTip)}>
      <span class="bl-label">物品增加</span>
      <b>${gain ? '+' + gain : '0'}<i>个/t</i></b>
      <span class="bl-note">${gain ? '最近采样内净增加' : '没有新增'}</span>
    </div>
    <div class="bl-card loss"${tipAttr(lossTip)}>
      <span class="bl-label">物品减少</span>
      <b>${loss ? '-' + loss : '0'}<i>个/t</i></b>
      <span class="bl-note">${loss ? '最近采样内净消耗' : '没有消耗'}</span>
    </div>
  </div>`;
}

function renderModule(m, data) {
  const head = `<div class="ae-head"><h2>${esc(m.name)}<span class="sub">${esc(m.id)}</span></h2></div>`;
  if (m.state === 'missing') {
    return `<div class="ae-panel">${head}<div class="ae-empty missing"><strong>${esc(m.message || (m.name + ' 未安装'))}</strong>安装 ${esc(m.name)} 后自动接入</div></div>`;
  }
  if (m.state === 'waiting' || m.state === 'error' || !m.installed) {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>${esc(m.message || '等待数据')}</strong>进入一个世界后开始读取</div></div>`;
  }
  if (m.view === 'machines') return renderMachines(m, data);
  if (m.view === 'flux') return renderFlux(m, data);
  if (m.view !== 'inventory') {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>${esc(m.message)}</strong>看板脚本版本过旧，刷新页面后重新加载</div></div>`;
  }

  const grids = data.grids || [];
  if (!grids.length) {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>未检测到 ME 网络</strong>搭建并通电 AE2 网络后显示库存与驱动器</div></div>`;
  }
  if (!state.activeGrid || !grids.some((g) => g.id === state.activeGrid)) state.activeGrid = grids[0].id;
  const grid = grids.find((g) => g.id === state.activeGrid) || grids[0];
  const tabs = grids.length > 1
    ? `<div class="tabs">${grids.map((g, i) => `<button class="tab ${g.id === grid.id ? 'active' : ''}" data-grid="${esc(g.id)}">#${i + 1} ${esc(g.dimension || '—')}</button>`).join('')}</div>`
    : '';
  return tabs + renderTerminal(grid) + renderDrives(grid);
}

function renderTerminal(grid) {
  const query = state.query.trim().toLowerCase();
  const rows = (grid.entries || []).filter((item) =>
    !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query) || String(item.mod).toLowerCase().includes(query));
  const shown = rows.slice(0, 270);

  const nextPrev = {};
  for (const g of (state.status?.data?.ae2?.grids || [])) {
    for (const item of (g.entries || [])) nextPrev[`${g.id}|${item.id}`] = item.amount;
  }

  const cells = shown.map((item) => {
    const key = `${grid.id}|${item.id}`;
    const changed = !state.first && state.watch.includes(key) && state.prev[key] != null && state.prev[key] !== item.amount;
    const name = zhName(item.id, item.name);
    const detail = `${name}\n${item.id}\n${amountLabel(item)}${item.craftable ? '\n可合成' : ''}`;
    return `<div class="slot ${changed ? 'flash' : ''}" data-slot-grid="${esc(grid.id)}" data-slot-item="${esc(item.id)}"${tipAttr(detail)}>${itemIcon(item)}<span class="count">${esc(amountLabel(item))}</span>${item.craftable ? '<i class="craft-dot"></i>' : ''}</div>`;
  }).join('');
  state.prev = nextPrev;
  state.first = false;

  const cpus = Array.isArray(grid.crafting?.cpus) ? grid.crafting.cpus : [];
  const parallel = cpus.reduce((sum, c) => sum + (Number(c.coprocessors) || 0), 0);
  const cpuStorage = cpus.reduce((sum, c) => sum + (Number(c.storage) || 0), 0);
  const busyCpus = cpus.filter((c) => c.busy).length;

  const stats = `<div class="ae-stats">
    <div><b>${num(grid.totalTypes)}</b><span>物品种类</span></div>
    <div><b>${num(grid.totalAmount)}</b><span>物品总量</span></div>
    <div><b>${num(grid.nodes || 0)}</b><span>网络节点</span></div>
    <div class="${grid.powered === false ? 'warn' : ''}"${tipAttr(grid.storedPower != null ? `AE 能量 ${num(grid.storedPower)} / ${num(grid.maxPower || 0)} AE` : '')}><b>${grid.storedPower != null ? short(grid.storedPower) : '—'}</b><span>AE 能量${grid.powered === false ? ' · 未通电' : ''}</span></div>
    <div${tipAttr(cpus.length
      ? `合成单元 ${cpus.length} 个\n并行处理 ${parallel} 路\n运行中 ${busyCpus} / ${cpus.length}`
      : '网络里没有合成 CPU：放置合成单元 + 合成存储器后才会出现并行数')}><b>${num(parallel)}</b><span>合成并行</span></div>
    <div${tipAttr(`所有合成 CPU 的可用存储合计\n${num(cpuStorage)} 字节${cpus.length ? '' : '\n当前网络没有合成 CPU'}`)}><b>${short(cpuStorage)}</b><span>并行存储</span></div>
  </div>`;

  const cpuStrip = cpus.length ? `<div class="cpu-strip">${cpus.map((c) => {
    const job = c.job;
    const tip = [
      `合成 CPU ${c.name || ''}`,
      `并行处理 ${c.coprocessors || 0} 路`,
      `可用存储 ${num(c.storage)} 字节`,
      job ? `任务：${zhName(job.id, job.name)} ${num(job.progress)}/${num(job.total)}` : '当前空闲'
    ].join('\n');
    return `<div class="cpu-item ${c.busy ? 'busy' : ''}"${tipAttr(tip)}>
      <i class="led" style="--led:${c.busy ? '#35a865' : '#6b6f80'}"></i>
      <span class="cpu-name">${esc(c.name || 'CPU')}</span>
      <span class="cpu-kv">并行 <b>${num(c.coprocessors || 0)}</b></span>
      <span class="cpu-kv">存储 <b>${short(c.storage)}</b></span>
      <span class="cpu-job ${job ? '' : 'idle'}">${job ? `${esc(zhName(job.id, job.name))} ${num(job.progress)}/${num(job.total)}` : '空闲'}</span>
    </div>`;
  }).join('')}</div>` : '';

  const empty = rows.length ? '' : `<div class="ae-note">没有匹配的物品</div>`;
  const more = rows.length > shown.length ? `<div class="ae-note">仅显示前 ${shown.length} / ${rows.length} 项</div>` : '';

  return `<div class="ae-panel">
    <div class="ae-head"><h2>ME 网络库存<span class="sub">${esc(grid.dimension || '')} · ${esc(gridPos(grid))}</span></h2>
      <input id="search" class="search" placeholder="搜索物品 / ID / 模组" value="${esc(state.query)}"></div>
    ${stats}${cpuStrip}
    <div class="grid-slots">${cells}</div>${empty}${more}
  </div>`;
}

function renderDrives(grid) {
  const drives = grid.drives || [];
  const counts = new Map();
  for (const drive of drives) {
    for (const cell of (drive.cells || [])) {
      if (!cell.id) continue;
      const entry = counts.get(cell.id) || { id: cell.id, name: cell.name, count: 0 };
      entry.count++;
      counts.set(cell.id, entry);
    }
  }
  const total = [...counts.values()].reduce((n, e) => n + e.count, 0);
  const summary = [...counts.values()].map((e) => {
    const name = zhName(e.id, e.name);
    return `<div class="cell-summary-item"${tipAttr(`${name}\n${e.id}`)}>${icon(e.id)}<span class="x">×${e.count}</span><span class="nm">${esc(name)}</span></div>`;
  }).join('');
  const cards = drives.length
    ? drives.map((d, i) => renderDriveCard(d, i)).join('')
    : `<div class="ae-empty">当前网络没有 ME 驱动器</div>`;

  return `<div class="ae-panel">
    <div class="ae-head"><h2>ME 驱动器<span class="sub">${drives.length} 台 · ${total} 个存储元件</span></h2></div>
    <div class="cell-summary">${summary || '<span class="none">未插入存储元件</span>'}</div>
    <div class="drive-layout">${cards}</div>
  </div>`;
}

function renderDriveCard(drive, index) {
  const cells = drive.cells || [];
  const slots = cells.map((cell) => {
    const status = CELL_STATE[cell.state] || CELL_STATE.ABSENT;
    const infinite = !!cell.infinite;
    const totalBytes = infinite ? 0 : (cell.totalBytes || 0);
    const pct = totalBytes > 0 ? Math.min(100, Math.round((cell.usedBytes || 0) / totalBytes * 100)) : 0;
    const capacity = infinite ? '容量：无限' : `${num(cell.usedBytes || 0)} / ${num(totalBytes)} B`;
    const detail = cell.id
      ? `${zhName(cell.id, cell.name)}\n${cell.id}\n${status.label} · ${num(cell.types || 0)} 种 / ${num(cell.count || 0)} 个\n${capacity}`
      : '空槽位';
    return `<div class="slot"${tipAttr(detail)}>
      ${cell.id ? icon(cell.id) : ''}
      <i class="cell-led" style="--led:${status.color}"></i>
      ${infinite ? '<i class="cell-bar"><i style="width:100%"></i></i>' : totalBytes > 0 ? `<i class="cell-bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></i>` : ''}
    </div>`;
  }).join('');

  const details = cells.filter((c) => c.id).map((cell) => {
    const infinite = !!cell.infinite;
    const totalBytes = infinite ? 0 : (cell.totalBytes || 0);
    const pct = totalBytes > 0 ? Math.min(100, Math.round((cell.usedBytes || 0) / totalBytes * 100)) : (infinite ? 100 : 0);
    const name = zhName(cell.id, cell.name);
    const nums = infinite ? `${num(cell.usedBytes || 0)} / ∞` : `${num(cell.usedBytes || 0)}/${num(totalBytes)} B`;
    return `<div class="detail-row"${tipAttr(`${name}\n${cell.id}`)}>${icon(cell.id)}
      <div class="detail-main"><div class="detail-name">${esc(name)}</div><div class="bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></div></div>
      <div class="detail-num">${nums}</div></div>`;
  }).join('');

  const driveName = zhName(drive.block, 'ME 驱动器');
  return `<div class="drive-card">
    <div class="drive-head">${icon(drive.block)}<span>${esc(driveName)} ${index + 1}</span><span class="drive-pos">${esc(gridPos(drive))}</span><i class="led" style="--led:${drive.powered ? '#35a865' : '#d73e42'}"></i></div>
    <div class="drive-body"><div class="drive-slots">${slots}</div><div class="drive-detail">${details || '<div class="detail-empty">未插入存储元件</div>'}</div></div>
  </div>`;
}

function energySum(list) {
  const sum = { stored: 0, max: 0, count: 0, ignored: 0 };
  for (const x of list) {
    const e = x.energy;
    if (!e) continue;
    if (e.infinite) { sum.ignored++; continue; }
    if (!(Number(e.max) > 0)) continue;
    sum.stored += Number(e.stored) || 0;
    sum.max += Number(e.max) || 0;
    sum.count++;
  }
  return sum;
}

function energyPct(sum) {
  if (!(sum.max > 0)) return 0;
  return Math.min(100, sum.stored / sum.max * 100);
}

function energyShort(value) {
  const parts = energyParts(value);
  return parts.num + parts.suffix;
}

// 拆出后缀，便于单独着色与拉开间距
function energyParts(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return { num: '—', suffix: '' };
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1e3) return { num: sign + String(Math.round(abs)), suffix: '' };
  for (const [base, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (abs >= base) {
      const scaled = abs / base;
      const shown = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled));
      return { num: sign + shown, suffix };
    }
  }
  return { num: sign + String(Math.round(abs)), suffix: '' };
}

function energyHTML(value) {
  const parts = energyParts(value);
  return parts.suffix ? `${parts.num}<span class="u">${parts.suffix}</span>` : parts.num;
}

function energyBar(sum, label) {
  if (!sum.count || !(sum.max > 0)) return '';
  const pct = energyPct(sum);
  const shown = pct >= 99.95 ? '满' : `${pct.toFixed(1).replace(/\.0$/, '')}%`;
  const ignored = sum.ignored ? ` · ${sum.ignored} 台创造设备未计入` : '';
  return `<div class="energy-total"${tipAttr(`${label}\n${num(sum.stored)} / ${num(sum.max)} J\n占比 ${pct.toFixed(1)}% · ${sum.count} 台设备${ignored}`)}>
    <span class="et-label">${esc(label)}</span>
    <div class="bar"><i class="energy" style="width:${pct.toFixed(1)}%"></i></div>
    <b>${energyHTML(sum.stored)} / ${energyHTML(sum.max)} J</b>
    <span class="et-note">${shown} · ${sum.count} 台${sum.ignored ? ` · +${sum.ignored} 创造` : ''}</span>
  </div>`;
}

function renderMachines(m, data) {
  const head = `<div class="ae-head"><h2>${esc(m.name)}<span class="sub">机器状态</span></h2></div>`;
  const machines = data.machines || [];
  if (!machines.length) {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>未发现机器</strong>机器需位于已加载区块，进入世界后自动扫描</div></div>`;
  }
  const categories = data.categories || [];
  if (state.activeCategory !== 'all' && !categories.some((c) => c.id === state.activeCategory)) state.activeCategory = 'all';
  const multiblock = machines.filter((x) => x.multiblock && x.multiblock.formed).length;
  const totalEnergy = energySum(machines);
  const stats = `<div class="ae-stats">
    <div><b>${num(data.total)}</b><span>机器总数</span></div>
    <div><b>${num(data.running)}</b><span>运行中</span></div>
    <div><b>${num(categories.length)}</b><span>设备分类</span></div>
    <div><b>${num(multiblock)}</b><span>多方块结构</span></div>
    ${totalEnergy.count ? `<div><b>${energyShort(totalEnergy.stored)}</b><span>总储电 ${energyPct(totalEnergy).toFixed(1).replace(/\.0$/, '')}%</span></div>` : ''}
  </div>`;
  const tabs = `<div class="cat-tabs">
    <button class="cat-tab ${state.activeCategory === 'all' ? 'active' : ''}" data-category="all">全部 <b>${machines.length}</b></button>
    ${categories.map((c) => `<button class="cat-tab ${state.activeCategory === c.id ? 'active' : ''}" data-category="${esc(c.id)}">${esc(c.name)} <b>${c.total}</b></button>`).join('')}
  </div>`;
  const groups = categories
    .filter((c) => state.activeCategory === 'all' || c.id === state.activeCategory)
    .map((c) => {
      const list = machines.filter((x) => x.category === c.id);
      const sum = energySum(list);
      return `<div class="ae-panel">
      <div class="ae-head"><h2>${esc(c.name)}<span class="sub">${c.total} 台 · ${c.running} 台运行中</span></h2></div>
      ${energyBar(sum, c.id === 'energy' ? '储电合计' : '储电')}
      <div class="machine-grid">${list.map(machineCard).join('')}</div>
    </div>`;
    }).join('');
  return `<div class="ae-panel">${head}${stats}<div class="cat-wrap">${tabs}</div></div>${groups}`;
}

function machineCard(m) {
  const name = zhName(m.id, m.name);
  const mb = m.multiblock;
  const unformed = mb && !mb.formed;
  const status = unformed ? '未成型' : (m.active ? '运行中' : '待机');
  const led = unformed ? '#d73e42' : (m.active ? '#35a865' : '#6b6f80');
  const progress = m.progress;
  const energy = m.energy;
  const infinite = !!(energy && energy.infinite);
  const energyPct = infinite ? 100 : (energy && energy.max ? Math.min(100, Math.round(energy.stored / energy.max * 100)) : 0);
  const pos = m.pos ? m.pos.join(', ') : '—';
  const tip = [
    name, m.id, `${m.dimension || '—'} · ${pos}`, `${status} · ${m.categoryName || ''}`,
    progress ? `加工 ${progress.ticks}/${progress.required} tick · ${progress.percent}%` : '',
    infinite ? '能量 无限（创造设备，不计入电网统计）' : energy ? `能量 ${num(energy.stored)} / ${num(energy.max)} J` : '',
    m.items ? `物品槽 ${m.items.used}/${m.items.slots} · ${num(m.items.types || 0)} 种 / ${num(m.items.count)} 个` : '',
    ...(m.items?.stacks || []).slice(0, 6).map((s) => `  ${zhName(s.id, s.name)} ×${num(s.count)}`),
    m.fluids ? `流体 ${num(m.fluids.amount)}/${num(m.fluids.capacity)}${m.fluids.first ? ' · ' + m.fluids.first : ''}` : '',
    m.chemicals ? `化学品 ${num(m.chemicals.amount)}/${num(m.chemicals.capacity)}${m.chemicals.first ? ' · ' + m.chemicals.first : ''}` : '',
    mb ? `多方块 ${mb.formed ? '已成型' : '未成型'} · ${num(mb.volume || 0)} 格` : '',
    ...Object.entries(mb || {}).filter(([k, v]) => typeof v === 'number' && k !== 'volume').map(([k, v]) => `${k}: ${num(v)}`)
  ].filter(Boolean).join('\n');
  return `<div class="machine-card ${m.active ? 'running' : ''}"${tipAttr(tip)}>
    <div class="mc-head">${icon(m.id, 'mc-icon')}
      <div class="mc-title"><div class="mc-name">${esc(name)}</div><div class="mc-id">${esc(m.id)}</div></div>
      <i class="led" style="--led:${led}"></i>
    </div>
    <div class="mc-state">${esc(status)} · ${esc(pos)}</div>
    ${progress ? `<div class="mc-line"><span>进度</span><div class="bar"><i style="width:${progress.percent}%"></i></div><b>${progress.percent}%</b></div>` : ''}
    ${energy ? (infinite
      ? `<div class="mc-line"><span>能量</span><div class="bar"><i class="energy infinite" style="width:100%"></i></div><b>无限</b></div>`
      : `<div class="mc-line"><span>能量</span><div class="bar"><i class="energy" style="width:${energyPct}%"></i></div><b>${short(energy.stored)}/${short(energy.max)}</b></div>`) : ''}
    ${machineItems(m)}${machineBadges(m)}
  </div>`;
}

function fluidIcon(id) {
  const buckets = { 'minecraft:water': 'minecraft:water_bucket', 'minecraft:lava': 'minecraft:lava_bucket' };
  return buckets[id] || (state.icons[id] ? id : 'mekanism:basic_fluid_tank');
}

// AE 的流体 / 气体等非物品条目没有物品贴图，走各自的图标映射
function itemIcon(item) {
  if (item.type === 'ae2:f' && state.fluids[item.id]?.tex) {
    return `<i class="icon fluid"${fluidStyle(item)}></i>`;
  }
  return icon(item.type === 'ae2:f' ? fluidIcon(item.id) : item.id);
}

// 流体贴图与染色由客户端资源包解析，最多尝试 3 次（专用服务器上会一直 404）
let fluidsState = 0;
let fluidsTries = 0;
function ensureFluids() {
  if (!state.ok || fluidsState !== 0 || fluidsTries >= 3) return;
  fluidsState = 1;
  fluidsTries++;
  fetch(`${API}/api/fluids`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.fluids) {
        state.fluids = data.fluids;
        fluidsState = 2;
        render();
      } else {
        fluidsState = 0;
      }
    })
    .catch(() => { fluidsState = 0; });
}

// 非物品条目按 AE 原生单位显示（1000 mB = 1 B），物品仍用 K/M 缩写
function amountLabel(item) {
  const unit = item.unit || '';
  const amount = Number(item.amount) || 0;
  if (!unit) return short(amount);
  const perUnit = Number(item.perUnit) || 1;
  const scaled = amount / perUnit;
  if (Math.abs(scaled) < 1000) {
    const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(2).replace(/\.?0+$/, '');
    return text + unit;
  }
  return short(scaled) + unit;
}

function machineItems(m) {
  const items = m.items;
  if (!items || !items.slots) return '';
  const stacks = items.stacks || [];
  const cells = [];
  for (const stack of stacks) {
    const label = zhName(stack.id, stack.name);
    cells.push(`<div class="slot"${tipAttr(`${label}\n${stack.id}\n${num(stack.count)} 个 · ${num(stack.slots)} 槽`)}>${icon(stack.id)}<span class="count">${esc(short(stack.count))}</span></div>`);
  }
  if (!cells.length) cells.push('<div class="slot"></div>');
  return `<div class="mc-block">
    <div class="mc-label">物品 ${items.used}/${items.slots} · ${num(items.types || stacks.length)} 种</div>
    <div class="mc-slots">${cells.join('')}</div>
  </div>`;
}

function machineBadges(m) {
  const badges = [];
  if (m.recipeOutput) {
    const label = zhName(m.recipeOutput, m.recipeName);
    badges.push(`<div class="mc-badge"${tipAttr(`当前产出\n${label}\n${m.recipeOutput}`)}>${icon(m.recipeOutput)}<span>${esc(label)}</span></div>`);
  }
  if (m.fluids) {
    const label = `${short(m.fluids.amount)}/${short(m.fluids.capacity)}`;
    badges.push(`<div class="mc-badge"${tipAttr(`流体 ${m.fluids.first || '空'}\n${num(m.fluids.amount)} / ${num(m.fluids.capacity)} mB`)}>${icon(fluidIcon(m.fluids.first))}<span>${esc(label)}</span></div>`);
  }
  if (m.chemicals) {
    const label = `${short(m.chemicals.amount)}/${short(m.chemicals.capacity)}`;
    badges.push(`<div class="mc-badge"${tipAttr(`化学品 ${m.chemicals.first || '空'}\n${num(m.chemicals.amount)} / ${num(m.chemicals.capacity)} mB`)}>${icon('mekanism:basic_chemical_tank')}<span>${esc(label)}</span></div>`);
  }
  const mb = m.multiblock;
  if (mb && mb.formed) {
    badges.push(`<div class="mc-badge"${tipAttr(`多方块已成型 · ${num(mb.volume)} 格`)}>${icon('mekanism:dynamic_tank')}<span>${num(mb.volume)} 格</span></div>`);
  }
  return badges.length ? `<div class="mc-badges">${badges.join('')}</div>` : '';
}

function renderFlux(m, data) {
  const head = `<div class="ae-head"><h2>${esc(m.name)}<span class="sub">通量网络</span></h2></div>`;
  const networks = data.networks || [];
  if (!networks.length) {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>未检测到 Flux 网络</strong>放置 Flux 控制器 / 插头 / 点并建立网络后显示</div></div>`;
  }
  const stats = `<div class="ae-stats">
    <div><b>${num(networks.length)}</b><span>网络数</span></div>
    <div><b>${energyShort(data.storageBuffer || 0)}</b><span>储能 FE</span></div>
    <div><b>${num(data.deviceCount || 0)}</b><span>设备</span></div>
    <div><b>${num(data.onlineDevices || 0)}</b><span>在线</span></div>
  </div>`;
  const cards = networks.map((n) => {
    const st = n.stats || {};
    const color = `#${(((n.color || 0) >>> 0).toString(16)).padStart(6, '0')}`;
    const devices = (n.devices || []).slice(0, 12).map((d) => `<div class="flux-dev">
      <i class="led" style="--led:${d.loaded ? '#35a865' : '#8b8ea3'}"></i>
      <span class="fd-type">${esc(d.type)}</span>
      <b>${energyShort(d.buffer || 0)}</b>
      <span class="fd-pos">${esc(String(d.dimension || '').replace('minecraft:', ''))} ${d.pos ? d.pos.join(', ') : ''}</span>
    </div>`).join('');
    const more = (n.devices || []).length > 12 ? `<div class="detail-empty">另有 ${(n.devices || []).length - 12} 台设备未显示</div>` : '';
    return `<div class="ae-panel">
      <div class="ae-head"><h2><i class="net-dot" style="--c:${color}"></i>${esc(n.name)}<span class="sub">#${n.id} · ${esc(n.security || '')}</span></h2></div>
      <div class="flux-stats">
        <span>储能 <b>${energyShort(n.storageBuffer || 0)}</b> FE</span>
        <span>缓冲 <b>${energyShort(st.totalBuffer || 0)}</b></span>
        <span>输入 <b>${energyShort(st.input || 0)}</b></span>
        <span>输出 <b>${energyShort(st.output || 0)}</b></span>
        <span>设备 <b>${n.deviceCount || 0}</b></span>
      </div>
      <div class="flux-devices">${devices || '<div class="detail-empty">暂无设备</div>'}${more}</div>
    </div>`;
  }).join('');
  return `<div class="ae-panel">${head}${stats}</div>${cards}`;
}

function findItem(gridId, itemId) {
  const grids = state.status?.data?.ae2?.grids || [];
  const grid = grids.find((g) => g.id === gridId);
  return grid?.entries?.find((item) => item.id === itemId);
}

function rateText(rate) {
  if (!rate) return '稳定';
  return `${rate > 0 ? '+' : ''}${rate} 个/t`;
}

// 弹窗层级：数量输入(ask) → 合成计划(plan) → 物品详情(detail)
function openDetail(gridId, itemId) {
  closeMenu();
  state.plan = null;
  state.ask = null;
  state.detail = { grid: gridId, item: itemId };
  state.craftAmount = 1;
  renderDetail();
}

function openAsk(gridId, itemId) {
  const item = findItem(gridId, itemId);
  closeMenu();
  if (!item) return;
  state.plan = null;
  state.ask = { grid: gridId, item: itemId, amount: state.craftAmount || 1 };
  state.detail = { grid: gridId, item: itemId };
  renderDetail();
}

function closeModal() {
  state.plan = null;
  state.ask = null;
  state.detail = null;
  const modal = el('modal');
  modal.classList.add('hidden');
  modal.innerHTML = '';
}

function planBack() {
  const plan = state.plan;
  if (!plan) return;
  state.plan = null;
  if (plan.from === 'ask') {
    state.ask = { grid: plan.grid, item: plan.item, amount: plan.amount };
    state.craftAmount = plan.amount;
  } else {
    state.ask = null;
  }
  renderDetail();
}

// 库存格子的右键菜单：查看 / 合成 / 收藏
function openMenu(x, y, gridId, itemId) {
  const item = findItem(gridId, itemId);
  const menu = el('menu');
  if (!item) return;
  const watched = state.watch.includes(`${gridId}|${itemId}`);
  const craftable = !!item.craftable;
  state.menu = { grid: gridId, item: itemId };
  menu.innerHTML = `
    <button class="ctx-item" data-menu="view"><span>查看详情</span><em>左键</em></button>
    <button class="ctx-item" data-menu="craft" ${craftable ? '' : 'disabled'}><span>合成</span><em>${craftable ? '' : '无样板'}</em></button>
    <button class="ctx-item" data-menu="watch"><span>${watched ? '取消收藏' : '收藏'}</span><em>${watched ? '★' : '☆'}</em></button>`;
  menu.classList.remove('hidden');
  const w = menu.offsetWidth || 168;
  const h = menu.offsetHeight || 108;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
}

function closeMenu() {
  state.menu = null;
  el('menu').classList.add('hidden');
}

function focusCraftAmount() {
  const input = el('craft-amount');
  if (input) { input.focus(); if (input.select) input.select(); }
}

function renderDetail() {
  const modal = el('modal');
  if (state.plan) return renderPlan();
  if (state.ask) return renderAsk();
  if (!state.detail) {
    modal.classList.add('hidden');
    modal.innerHTML = '';
    return;
  }
  const item = findItem(state.detail.grid, state.detail.item);
  if (!item) {
    closeModal();
    return;
  }
  const craftable = !!item.craftable;
  const rate = item.rate || 0;
  const watchKey = `${state.detail.grid}|${item.id}`;
  const watched = state.watch.includes(watchKey);
  modal.innerHTML = `<div class="modal-panel">
    <div class="modal-head">
      <div class="modal-icon">${itemIcon(item)}</div>
      <div class="modal-title"><b>${esc(zhName(item.id, item.name))}</b><span>${esc(item.id)}</span></div>
      <button class="modal-close" data-modal-close>×</button>
    </div>
    <div class="modal-grid">
      <div><span>数量</span><b data-detail-amount>${esc(amountLabel(item))}</b></div>
      <div><span>每 tick</span><b data-detail-rate class="${rate > 0 ? 'gain' : rate < 0 ? 'loss' : ''}">${rateText(rate)}</b></div>
      <div><span>类型</span><b>${esc(String(item.type || '').replace('ae2:', ''))}</b></div>
      <div><span>模组</span><b>${esc(item.mod || '')}</b></div>
    </div>
    <div class="modal-actions row-actions">
      <button class="watch-btn ${watched ? 'on' : ''}" data-watch="${esc(watchKey)}">${watched ? '★ 已收藏' : '☆ 收藏'}</button>
      <button class="craft-btn" data-ask data-slot-grid="${esc(state.detail.grid)}" data-ask-item="${esc(item.id)}" ${craftable ? '' : 'disabled'}>${craftable ? '合成…' : '无样板'}</button>
    </div>
  </div>`;
  modal.classList.remove('hidden');
}

// 数量输入：对齐 AE 原生「合成数量」窗口，确认后才计算材料
function renderAsk() {
  const modal = el('modal');
  const ask = state.ask;
  const item = findItem(ask.grid, ask.item);
  if (!item) {
    closeModal();
    return;
  }
  const craftable = !!item.craftable;
  const quick = [1, 16, 64, 1000].map((n) => `<button class="ask-chip" data-ask-set="${n}">${n}</button>`).join('');
  modal.innerHTML = `<div class="modal-panel">
    <div class="modal-head">
      <div class="modal-icon">${itemIcon(item)}</div>
      <div class="modal-title"><b>合成数量</b><span>${esc(zhName(item.id, item.name))}</span></div>
      <button class="modal-close" data-modal-close>×</button>
    </div>
    <div class="ask-body">
      <input id="craft-amount" type="number" min="1" max="1000000" step="1" value="${esc(String(ask.amount || 1))}" ${craftable ? '' : 'disabled'}>
      <div class="ask-quick">${quick}</div>
    </div>
    <div class="modal-actions row-actions">
      <button class="ghost-btn" data-modal-close>取消</button>
      <button class="craft-btn" data-ask-go ${craftable ? '' : 'disabled'}>计算材料</button>
    </div>
  </div>`;
  modal.classList.remove('hidden');
  focusCraftAmount();
}

// ---- 合成计划（对齐 AE 原生材料对话框）----

async function openPlan(gridId, itemId, amount, from) {
  state.plan = { loading: true, grid: gridId, item: itemId, amount, from: from || 'detail', data: null };
  const ref = state.plan;
  renderDetail();
  try {
    const res = await fetch(`${API}/api/ae2/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: gridId, item: itemId, amount })
    });
    const data = await res.json();
    if (state.plan !== ref) return;
    state.plan = { ...ref, loading: false, data };
  } catch (err) {
    if (state.plan !== ref) return;
    state.plan = { ...ref, loading: false, data: { ok: false, error: '请求失败：' + err.message } };
  }
  renderDetail();
}

function planRows(data) {
  const map = new Map();
  for (const used of data.used || []) {
    map.set(used.id, { ...used, need: Number(used.amount) || 0, miss: 0 });
  }
  for (const missing of data.missing || []) {
    const entry = map.get(missing.id) || { ...missing, need: Number(missing.amount) || 0, miss: 0 };
    entry.miss = Number(missing.amount) || 0;
    entry.need = Math.max(entry.need, entry.miss);
    map.set(missing.id, entry);
  }
  return [...map.values()].sort((a, b) => (b.miss - a.miss) || (b.need - a.need));
}

function unitText(entry, amount) {
  const unit = entry.unit || '';
  const value = Number(amount) || 0;
  if (!unit) return num(value);
  const perUnit = Number(entry.perUnit) || 1;
  const scaled = value / perUnit;
  const text = Number.isInteger(scaled) ? num(scaled) : scaled.toFixed(2).replace(/\.?0+$/, '');
  return text + unit;
}

function renderPlan() {
  const modal = el('modal');
  const plan = state.plan;
  const target = findItem(plan.grid, plan.item);
  const targetName = zhName(plan.item, target?.name || plan.item);
  const head = `<div class="modal-head">
      <div class="modal-icon">${target ? itemIcon(target) : icon(plan.item)}</div>
      <div class="modal-title"><b>合成计划</b><span>${esc(targetName)} × ${num(plan.amount)}</span></div>
      <button class="modal-close" data-modal-close>×</button>
    </div>`;

  if (plan.loading) {
    modal.innerHTML = `<div class="modal-panel">${head}<div class="plan-note">正在计算合成计划…</div>
      <div class="modal-actions row-actions"><button class="ghost-btn" data-plan-back>返回</button></div></div>`;
    modal.classList.remove('hidden');
    return;
  }

  const data = plan.data || {};
  if (!data.ok) {
    modal.innerHTML = `<div class="modal-panel">${head}
      <div class="plan-note bad">${esc(data.error || '计算失败')}</div>
      <div class="modal-actions row-actions"><button class="ghost-btn" data-plan-back>返回</button></div>
    </div>`;
    modal.classList.remove('hidden');
    return;
  }

  const rows = planRows(data);
  const feasible = !!data.feasible;
  const cpu = data.cpu || {};
  const cpuOk = (cpu.total || 0) > 0 && cpu.enough !== false;
  const canSubmit = feasible && cpuOk;
  const reason = !feasible
    ? (data.reason || '合成计划不完整')
    : (cpu.total || 0) === 0
      ? '网络里没有合成 CPU'
      : cpu.enough === false
        ? `CPU 存储不足：需要 ${short(data.bytes)} 字节，最大可用 ${short(cpu.maxStorage)}`
        : '材料齐全，可以提交到合成 CPU';

  const list = rows.length
    ? rows.map((row) => `<div class="plan-row ${row.miss ? 'miss' : ''}">
        <div class="plan-item">${row.type === 'ae2:f' ? icon(fluidIcon(row.id)) : icon(row.id)}<span>${esc(zhName(row.id, row.name))}</span></div>
        <span class="plan-need">${unitText(row, row.need)}</span>
        <span class="plan-miss">${row.miss ? '缺 ' + unitText(row, row.miss) : '—'}</span>
      </div>`).join('')
    : '<div class="plan-note">该物品直接取用库存即可，无需额外材料</div>';

  modal.innerHTML = `<div class="modal-panel">
    ${head}
    <div class="plan-stats">
      <div><span>可完成</span><b class="${feasible ? 'ok' : 'bad'}">${feasible ? '是' : '否'}</b></div>
      <div><span>合成步骤</span><b>${num(data.steps || 0)}</b></div>
      <div><span>所需存储</span><b>${short(data.bytes)}</b></div>
      <div><span>空闲 CPU</span><b>${num(cpu.idle || 0)} / ${num(cpu.total || 0)}</b></div>
    </div>
    <div class="plan-list">
      <div class="plan-row plan-head"><span>材料</span><span>需要</span><span>缺少</span></div>
      ${list}
    </div>
    <div class="modal-note ${feasible && cpuOk ? 'ok' : 'bad'}" id="craft-note">${esc(reason)}</div>
    <div class="modal-actions row-actions">
      <button class="ghost-btn" data-plan-back>返回</button>
      <button class="craft-btn" data-plan-submit ${canSubmit ? '' : 'disabled'}>${canSubmit ? '提交合成' : '无法提交'}</button>
    </div>
  </div>`;
  modal.classList.remove('hidden');
}

function refreshDetail() {
  if (!state.detail) return;
  const item = findItem(state.detail.grid, state.detail.item);
  if (!item) return;
  const amountNode = document.querySelector('[data-detail-amount]');
  if (amountNode) amountNode.textContent = amountLabel(item);
  const rateNode = document.querySelector('[data-detail-rate]');
  if (rateNode) {
    const rate = item.rate || 0;
    rateNode.textContent = rateText(rate);
    rateNode.className = rate > 0 ? 'gain' : rate < 0 ? 'loss' : '';
  }
}

async function submitCraft(gridId, itemId, amount) {
  const btn = document.querySelector('[data-plan-submit]');
  const note = el('craft-note');
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  if (note) {
    note.textContent = '提交中…';
    note.className = 'modal-note';
  }
  try {
    const res = await fetch(`${API}/api/ae2/craft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: gridId, item: itemId, amount })
    });
    const data = await res.json();
    if (data.ok) {
      const item = findItem(gridId, itemId);
      const name = zhName(itemId, item?.name || itemId);
      closeModal();
      toast(`已提交合成：${name} × ${num(amount)}`);
      setTimeout(poll, 300);
      return;
    }
    if (note) {
      const missing = (data.missing || []).map((m) => `${zhName(m.id, m.name)} ×${num(m.amount)}`);
      note.textContent = [data.error || '提交失败', ...(missing.length ? ['缺：' + missing.join('、')] : [])].join('\n');
      note.className = 'modal-note bad';
    }
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = '提交合成'; }
  } catch (err) {
    if (note) {
      note.textContent = '请求失败：' + err.message;
      note.className = 'modal-note bad';
    }
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = '提交合成'; }
  }
}

async function cancelCraft(gridId, cpu) {
  try {
    const res = await fetch(`${API}/api/ae2/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: gridId, cpu })
    });
    const data = await res.json();
    toast(data.ok ? (data.message || '已取消合成任务') : (data.error || '取消失败'));
    setTimeout(poll, 300);
  } catch (err) {
    toast('取消失败：' + err.message);
  }
}

let toastTimer = 0;
function toast(text) {
  const node = el('toast');
  if (!node) return;
  node.textContent = text;
  node.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 3200);
}

function confirmAsk() {
  const ask = state.ask;
  if (!ask) return;
  const item = findItem(ask.grid, ask.item);
  if (!item || !item.craftable) return;
  const raw = parseInt(el('craft-amount')?.value || '', 10);
  const amount = Math.max(1, Math.min(1000000, Number.isFinite(raw) ? raw : 1));
  state.craftAmount = amount;
  openPlan(ask.grid, ask.item, amount, 'ask');
}

function watchEntries() {
  const grids = state.status?.data?.ae2?.grids || [];
  return state.watch.map((key) => {
    const [gridId, itemId] = key.split('|');
    const grid = grids.find((g) => g.id === gridId);
    const item = grid?.entries?.find((e) => e.id === itemId);
    return { key, itemId, item };
  });
}

function watchJobs() {
  const grids = state.status?.data?.ae2?.grids || [];
  const jobs = [];
  for (const grid of grids) {
    for (const cpu of grid.crafting?.cpus || []) {
      if (cpu.busy && cpu.job) jobs.push({ ...cpu, grid: grid.id });
    }
  }
  return jobs;
}

function renderWatch() {
  const entries = watchEntries();
  const jobs = watchJobs();
  const itemRows = entries.map(({ key, itemId, item }) => {
    if (!item) {
      return `<div class="watch-item">
        <div class="wi-icon">${icon(itemId)}</div>
        <div class="wi-main"><b>${esc(zhName(itemId, itemId))}</b><span>当前网络未找到</span></div>
        <button class="wi-remove" data-unwatch="${esc(key)}" title="取消收藏">×</button>
      </div>`;
    }
    const rate = item.rate || 0;
    return `<div class="watch-item">
      <div class="wi-icon">${icon(itemId)}</div>
      <div class="wi-main"><b>${esc(zhName(itemId, item.name))}</b><span>${num(item.amount)}${item.unit ? ' ' + esc(item.unit) : ' 个'}</span></div>
      <div class="wi-rate ${rate > 0 ? 'gain' : rate < 0 ? 'loss' : ''}">${rateText(rate)}</div>
      <button class="wi-remove" data-unwatch="${esc(key)}" title="取消收藏">×</button>
    </div>`;
  }).join('');

  const jobRows = jobs.map((cpu) => {
    const job = cpu.job;
    const pct = Number.isFinite(Number(job.percent)) ? Math.max(0, Math.min(100, Number(job.percent))) : 0;
    const seconds = Math.round((job.elapsedMs || 0) / 1000);
    const eta = pct > 0 && pct < 100 ? Math.round(seconds * (100 - pct) / pct) : null;
    const tip = [
      'ME 合成 CPU 正在执行的任务',
      `${zhName(job.id, job.name)}：已完成 ${pct}%`,
      `已运行 ${seconds} 秒${eta != null ? `，按当前速度还需约 ${eta} 秒` : ''}`,
      `${num(cpu.coprocessors || 0)} 个协处理器 · 可用存储 ${num(cpu.storage || 0)} 字节`
    ].filter(Boolean).join('\n');
    const cpuIndex = Number.isFinite(cpu.index) ? cpu.index : 0;
    const armed = state.cancelArm && state.cancelArm.grid === cpu.grid && state.cancelArm.cpu === cpuIndex && state.cancelArm.until > Date.now();
    return `<div class="watch-job">
      <div class="wj-top"${tipAttr(tip)}>
        ${icon(job.id)}
        <b>${esc(zhName(job.id, job.name))}</b>
        <span class="wj-count">${pct}%</span>
        <button class="wj-cancel ${armed ? 'armed' : ''}" data-cancel-grid="${esc(cpu.grid)}" data-cancel-cpu="${cpuIndex}" title="取消这个合成任务">${armed ? '确认' : '✕'}</button>
      </div>
      <div class="bar"><i class="craft" style="width:${pct}%"></i></div>
      <div class="wj-note">${esc(cpu.name)} · 已跑 ${seconds}s${eta != null ? ` · 约剩 ${short(eta)}s` : ''}</div>
    </div>`;
  }).join('');

  return `<div class="watch-panel ae-panel">
    <div class="ae-head"><h2>关注<span class="sub">${entries.length} 个收藏 · ${jobs.length} 个合成任务</span></h2></div>
    <div class="watch-body">
      <div class="watch-col">
        <div class="watch-title">收藏物品</div>
        ${itemRows || '<div class="watch-empty">右键库存物品，在详情里点「收藏」</div>'}
      </div>
      <div class="watch-col">
        <div class="watch-title">合成任务</div>
        ${jobRows || '<div class="watch-empty">暂无进行中的合成</div>'}
      </div>
    </div>
  </div>`;
}

function saveWatch() {
  try { localStorage.setItem('wx.watch', JSON.stringify(state.watch)); } catch (_) {}
}

function toggleWatch(key) {
  const index = state.watch.indexOf(key);
  if (index >= 0) state.watch.splice(index, 1);
  else state.watch.push(key);
  saveWatch();
  el('watch').innerHTML = state.ok ? renderWatch() : '';
  updateWatchButton();
}

function updateWatchButton() {
  const button = document.querySelector('.watch-btn');
  if (!button || !state.detail) return;
  const key = `${state.detail.grid}|${state.detail.item}`;
  const on = state.watch.includes(key);
  button.textContent = on ? '★ 已收藏' : '☆ 收藏';
  button.classList.toggle('on', on);
}

function renderDetected(list) {
  if (!list.length) return '';
  return `<span>已检测，尚未接入</span>` + list.map((d) => `<span class="chip">${esc(d.name)}</span>`).join('');
}

function positionTip(event, tip) {
  const x = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 10);
  const y = Math.min(event.clientY + 16, window.innerHeight - tip.offsetHeight - 10);
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}

document.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-tip]');
  if (!target) return;
  const tip = el('tip');
  tip.textContent = target.dataset.tip;
  tip.classList.remove('hidden');
  positionTip(e, tip);
});

document.addEventListener('mousemove', (e) => {
  const tip = el('tip');
  if (!tip.classList.contains('hidden')) positionTip(e, tip);
});

document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget?.closest?.('[data-tip]')) el('tip').classList.add('hidden');
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'craft-amount') {
    state.craftAmount = e.target.value;
    return;
  }
  if (e.target.id !== 'search') return;
  state.query = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const next = el('search');
  if (next) { next.focus(); next.setSelectionRange(pos, pos); }
});

document.addEventListener('contextmenu', (e) => {
  const slot = e.target.closest('[data-slot-item]');
  if (!slot) { closeMenu(); return; }
  e.preventDefault();
  openMenu(e.clientX, e.clientY, slot.dataset.slotGrid, slot.dataset.slotItem);
});

document.addEventListener('click', (e) => {
  const menuItem = e.target.closest('[data-menu]');
  if (menuItem) {
    const target = state.menu;
    const action = menuItem.dataset.menu;
    closeMenu();
    if (!target) return;
    if (action === 'view') openDetail(target.grid, target.item);
    else if (action === 'craft') openAsk(target.grid, target.item);
    else if (action === 'watch') toggleWatch(`${target.grid}|${target.item}`);
    return;
  }
  if (state.menu) closeMenu();

  const planBackBtn = e.target.closest('[data-plan-back]');
  if (planBackBtn) {
    planBack();
    return;
  }
  const planSubmit = e.target.closest('[data-plan-submit]');
  if (planSubmit && !planSubmit.disabled) {
    submitCraft(state.plan.grid, state.plan.item, state.plan.amount);
    return;
  }
  if (e.target.closest('[data-modal-close]') || e.target.id === 'modal') {
    closeModal();
    return;
  }
  const askSet = e.target.closest('[data-ask-set]');
  if (askSet) {
    const input = el('craft-amount');
    if (input) {
      input.value = askSet.dataset.askSet;
      state.craftAmount = Number(askSet.dataset.askSet);
      focusCraftAmount();
    }
    return;
  }
  const askGo = e.target.closest('[data-ask-go]');
  if (askGo && !askGo.disabled) {
    confirmAsk();
    return;
  }
  const askBtn = e.target.closest('[data-ask]');
  if (askBtn && !askBtn.disabled) {
    openAsk(askBtn.dataset.slotGrid, askBtn.dataset.askItem);
    return;
  }
  const slot = e.target.closest('[data-slot-item]');
  if (slot && !e.target.closest('.machine-card')) {
    openDetail(slot.dataset.slotGrid, slot.dataset.slotItem);
    return;
  }
  const unwatch = e.target.closest('[data-unwatch]');
  if (unwatch) {
    toggleWatch(unwatch.dataset.unwatch);
    return;
  }
  const cancelBtn = e.target.closest('[data-cancel-grid]');
  if (cancelBtn) {
    const grid = cancelBtn.dataset.cancelGrid;
    const cpu = Number(cancelBtn.dataset.cancelCpu) || 0;
    const armed = state.cancelArm && state.cancelArm.grid === grid && state.cancelArm.cpu === cpu && state.cancelArm.until > Date.now();
    if (!armed) {
      state.cancelArm = { grid, cpu, until: Date.now() + 4000 };
      render();
      setTimeout(() => {
        if (state.cancelArm && state.cancelArm.until <= Date.now()) { state.cancelArm = null; render(); }
      }, 4100);
      return;
    }
    state.cancelArm = null;
    cancelCraft(grid, cpu);
    return;
  }
  const watchBtn = e.target.closest('.watch-btn');
  if (watchBtn) {
    toggleWatch(watchBtn.dataset.watch);
    return;
  }
  const tab = e.target.closest('[data-grid]');
  if (tab) { state.activeGrid = tab.dataset.grid; render(); return; }
  const category = e.target.closest('[data-category]');
  if (category) { state.activeCategory = category.dataset.category; render(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target?.id === 'craft-amount') {
    if (state.ask) {
      e.preventDefault();
      confirmAsk();
    }
    return;
  }
  if (e.key !== 'Escape') return;
  if (state.menu) closeMenu();
  else if (state.plan) planBack();
  else if (state.ask || state.detail) closeModal();
});

window.addEventListener('scroll', () => closeMenu(), true);
window.addEventListener('resize', () => closeMenu());
document.addEventListener('visibilitychange', () => {
  if (typeof document !== 'undefined' && !document.hidden) poll();
});

loadAssets().then(() => {
  poll();
  setInterval(poll, 1500);
});
