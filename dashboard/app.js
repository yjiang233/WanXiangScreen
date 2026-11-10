const params = new URLSearchParams(location.search);
const DEFAULT_PORTS = ['18765', '18766', '18767', '18768'];
const API = params.get('api') || (DEFAULT_PORTS.includes(location.port) ? location.origin : 'http://127.0.0.1:18765');

const el = (id) => document.getElementById(id);
const state = { status: null, query: '', activeGrid: null, prev: {}, first: true, ok: false, icons: {}, lang: {} };

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

function icon(id) {
  return `<img class="icon" src="${esc(iconUrl(id))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='assets/gui/unknown.png'">`;
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
  const module = (s?.modules || []).find((m) => m.id === 'ae2');
  const status = module?.state;
  let color = '#d73e42';
  let label = '未连接';
  if (state.ok) {
    const map = { online: ['#35a865', '已接入'], missing: ['#d73e42', '未安装AE2'], waiting: ['#dfa52b', '等待世界'], error: ['#d73e42', '读取异常'] };
    [color, label] = map[status] || ['#dfa52b', '未接入'];
  }
  const grids = s?.data?.ae2?.grids || [];
  const active = state.ok && status === 'online';
  return `<i class="led" style="--led:${color}"></i><span>${esc(label)}</span>` +
    (active && grids.length ? `<span class="status-sep"></span><b>${grids.length}</b><span>ME 网络</span>` : '') +
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
    return `<div class="ae-panel">${head}<div class="ae-empty missing"><strong>未安装AE2</strong>安装 Applied Energistics 2 后自动接入</div></div>`;
  }
  if (m.state === 'waiting' || m.state === 'error' || !m.installed) {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>${esc(m.message || '等待数据')}</strong>进入一个世界后开始读取</div></div>`;
  }
  if (m.view !== 'inventory') {
    return `<div class="ae-panel">${head}<div class="ae-empty"><strong>已接入</strong>${esc(m.message)}</div></div>`;
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
  if (tab) { state.activeGrid = tab.dataset.grid; render(); }
});

loadAssets().then(() => {
  poll();
  setInterval(poll, 1500);
});
