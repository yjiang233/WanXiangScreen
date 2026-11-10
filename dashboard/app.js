const params = new URLSearchParams(location.search);
const DEFAULT_PORTS = ['18765', '18766', '18767', '18768'];
const API = params.get('api') || (DEFAULT_PORTS.includes(location.port) ? location.origin : 'http://127.0.0.1:18765');

const el = (id) => document.getElementById(id);
const state = { status: null, query: '', activeGrid: null, activeCategory: 'all', prev: {}, first: true, ok: false, icons: {}, lang: {} };

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
  if (n < 1000) return String(n);
  for (const [base, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (n >= base) {
      const scaled = n / base;
      return (scaled < 10 ? scaled.toFixed(1) : String(Math.round(scaled))).replace(/\.0$/, '') + suffix;
    }
  }
  return String(n);
}

function timeOf(ms) {
  return new Date(ms || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
}

function iconUrl(id) {
  return state.icons[id] || 'assets/gui/unknown.png';
}

function icon(id, cls = '') {
  return `<img class="icon ${cls}" src="${esc(iconUrl(id))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='assets/gui/unknown.png'">`;
}

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

async function poll() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${API}/api/status`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.status = await res.json();
    state.ok = true;
  } catch (_) {
    state.ok = false;
  } finally {
    clearTimeout(timer);
  }
  render();
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

function render() {
  el('status').innerHTML = renderStatus();
  const banner = el('banner');
  banner.classList.toggle('hidden', state.ok);
  if (!state.ok) banner.textContent = `未连接游戏进程 · ${API}`;
  el('tip').classList.add('hidden');

  if (!state.ok || !state.status) {
    el('view').innerHTML = `<div class="ae-panel"><div class="ae-head"><h2>ME 网络</h2></div><div class="ae-empty"><strong>${state.ok ? '等待数据' : '等待游戏'}</strong>${state.ok ? '进入世界后自动刷新' : '启动游戏客户端并进入世界'}</div></div>`;
    el('detected').innerHTML = '';
    return;
  }

  const s = state.status;
  const modules = s.modules || [];
  el('view').innerHTML = modules.map((m) => renderModule(m, (s.data || {})[m.id] || {})).join('');
  el('detected').innerHTML = renderDetected(s.detected || []);
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
    const changed = !state.first && state.prev[key] != null && state.prev[key] !== item.amount;
    const name = zhName(item.id, item.name);
    const detail = `${name}\n${item.id}\n${num(item.amount)}${item.unit ? ' ' + item.unit : ''}${item.craftable ? '\n可合成' : ''}`;
    return `<div class="slot ${changed ? 'flash' : ''}"${tipAttr(detail)}>${icon(item.id)}<span class="count">${esc(short(item.amount))}</span>${item.craftable ? '<i class="craft-dot"></i>' : ''}</div>`;
  }).join('');
  state.prev = nextPrev;
  state.first = false;

  const stats = `<div class="ae-stats">
    <div><b>${num(grid.totalTypes)}</b><span>物品种类</span></div>
    <div><b>${num(grid.totalAmount)}</b><span>物品总量</span></div>
    <div><b>${num(grid.nodes || 0)}</b><span>网络节点</span></div>
    <div class="${grid.powered === false ? 'warn' : ''}"><b>${grid.storedPower != null ? num(grid.storedPower) : '—'}</b><span>AE 能量${grid.powered === false ? ' · 未通电' : ''}</span></div>
  </div>`;

  const empty = rows.length ? '' : `<div class="ae-note">没有匹配的物品</div>`;
  const more = rows.length > shown.length ? `<div class="ae-note">仅显示前 ${shown.length} / ${rows.length} 项</div>` : '';

  return `<div class="ae-panel">
    <div class="ae-head"><h2>ME 网络库存<span class="sub">${esc(grid.dimension || '')} · ${esc(gridPos(grid))}</span></h2>
      <input id="search" class="search" placeholder="搜索物品 / ID / 模组" value="${esc(state.query)}"></div>
    ${stats}
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
    const pct = cell.totalBytes > 0 ? Math.min(100, Math.round(cell.usedBytes / cell.totalBytes * 100)) : 0;
    const detail = cell.id
      ? `${zhName(cell.id, cell.name)}\n${cell.id}\n${status.label} · ${num(cell.types || 0)} 种 / ${num(cell.count || 0)} 个\n${num(cell.usedBytes || 0)} / ${num(cell.totalBytes || 0)} B`
      : '空槽位';
    return `<div class="slot"${tipAttr(detail)}>
      ${cell.id ? icon(cell.id) : ''}
      <i class="cell-led" style="--led:${status.color}"></i>
      ${cell.totalBytes > 0 ? `<i class="cell-bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></i>` : ''}
    </div>`;
  }).join('');

  const details = cells.filter((c) => c.id).map((cell) => {
    const pct = cell.totalBytes > 0 ? Math.min(100, Math.round(cell.usedBytes / cell.totalBytes * 100)) : 0;
    const name = zhName(cell.id, cell.name);
    return `<div class="detail-row"${tipAttr(`${name}\n${cell.id}`)}>${icon(cell.id)}
      <div class="detail-main"><div class="detail-name">${esc(name)}</div><div class="bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></div></div>
      <div class="detail-num">${num(cell.usedBytes || 0)}/${num(cell.totalBytes || 0)} B</div></div>`;
  }).join('');

  return `<div class="drive-card">
    <div class="drive-head">${icon(drive.block)}<span>ME 驱动器 ${index + 1}</span><span class="drive-pos">${esc(gridPos(drive))}</span><i class="led" style="--led:${drive.powered ? '#35a865' : '#d73e42'}"></i></div>
    <div class="drive-body"><div class="drive-slots">${slots}</div><div class="drive-detail">${details || '<div class="detail-empty">未插入存储元件</div>'}</div></div>
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
  const stats = `<div class="ae-stats">
    <div><b>${num(data.total)}</b><span>机器总数</span></div>
    <div><b>${num(data.running)}</b><span>运行中</span></div>
    <div><b>${num(categories.length)}</b><span>设备分类</span></div>
    <div><b>${num(multiblock)}</b><span>多方块结构</span></div>
  </div>`;
  const tabs = `<div class="cat-tabs">
    <button class="cat-tab ${state.activeCategory === 'all' ? 'active' : ''}" data-category="all">全部 <b>${machines.length}</b></button>
    ${categories.map((c) => `<button class="cat-tab ${state.activeCategory === c.id ? 'active' : ''}" data-category="${esc(c.id)}">${esc(c.name)} <b>${c.total}</b></button>`).join('')}
  </div>`;
  const groups = categories
    .filter((c) => state.activeCategory === 'all' || c.id === state.activeCategory)
    .map((c) => `<div class="ae-panel">
      <div class="ae-head"><h2>${esc(c.name)}<span class="sub">${c.total} 台 · ${c.running} 台运行中</span></h2></div>
      <div class="machine-grid">${machines.filter((x) => x.category === c.id).map(machineCard).join('')}</div>
    </div>`).join('');
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
  const energyPct = energy && energy.max ? Math.min(100, Math.round(energy.stored / energy.max * 100)) : 0;
  const pos = m.pos ? m.pos.join(', ') : '—';
  const tip = [
    name, m.id, `${m.dimension || '—'} · ${pos}`, `${status} · ${m.categoryName || ''}`,
    progress ? `加工 ${progress.ticks}/${progress.required} tick · ${progress.percent}%` : '',
    energy ? `能量 ${num(energy.stored)} / ${num(energy.max)} J` : '',
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
    ${energy ? `<div class="mc-line"><span>能量</span><div class="bar"><i class="energy" style="width:${energyPct}%"></i></div><b>${short(energy.stored)}/${short(energy.max)}</b></div>` : ''}
    ${machineItems(m)}${machineBadges(m)}
  </div>`;
}

function fluidIcon(id) {
  const buckets = { 'minecraft:water': 'minecraft:water_bucket', 'minecraft:lava': 'minecraft:lava_bucket' };
  return buckets[id] || (state.icons[id] ? id : 'mekanism:basic_fluid_tank');
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
  if (e.target.id !== 'search') return;
  state.query = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const next = el('search');
  if (next) { next.focus(); next.setSelectionRange(pos, pos); }
});

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-grid]');
  if (tab) { state.activeGrid = tab.dataset.grid; render(); return; }
  const category = e.target.closest('[data-category]');
  if (category) { state.activeCategory = category.dataset.category; render(); }
});

loadAssets().then(() => {
  poll();
  setInterval(poll, 1500);
});
