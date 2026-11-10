const params = new URLSearchParams(location.search);
const API = params.get('api') || (location.port === '8765' ? location.origin : 'http://127.0.0.1:8765');

const el = (id) => document.getElementById(id);
const state = { status: null, query: '', activeGrid: null, prev: {}, first: true, ok: false };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function num(value) {
  return Number(value ?? 0).toLocaleString('zh-CN');
}

function timeOf(ms) {
  return new Date(ms || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
}

async function poll() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${API}/api/status`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.status = await res.json();
    state.ok = true;
  } catch (e) {
    state.ok = false;
  } finally {
    clearTimeout(timer);
  }
  render();
}

function render() {
  const conn = el('conn');
  conn.className = `conn ${state.ok ? 'online' : 'offline'}`;
  conn.querySelector('span').textContent = state.ok ? '已连接' : '未连接';

  const banner = el('banner');
  banner.classList.toggle('hidden', state.ok);
  if (!state.ok) {
    banner.textContent = `未连接游戏进程。请启动游戏并进入世界，万象屏服务地址：${API}`;
  }

  el('endpoint').textContent = API;

  if (!state.status) {
    el('modules').innerHTML = '';
    el('content').innerHTML = `<div class="panel"><div class="empty"><strong>等待数据</strong>启动游戏后自动刷新</div></div>`;
    return;
  }

  const s = state.status;
  el('updated').textContent = `更新 ${timeOf(s.updatedAt)}`;
  el('modcount').textContent = `已加载 ${(s.mods || []).length} 个模组`;

  const modules = s.modules || [];
  el('modules').innerHTML = modules.map(moduleCard).join('');
  el('content').innerHTML = modules.map((m) => modulePanel(m, (s.data || {})[m.id] || {})).join('');
  el('detected').innerHTML = renderDetected(s.detected || []);
}

function moduleCard(m) {
  const label = { online: '已接入', waiting: '等待世界', missing: '未安装', error: '异常', detected: '已检测' }[m.state] || m.state;
  const data = (state.status.data || {})[m.id] || {};
  let metric = '';
  if (m.state === 'online' && m.view === 'inventory') {
    const grids = data.grids || [];
    const types = grids.reduce((sum, g) => sum + (g.totalTypes || 0), 0);
    const nets = grids.length;
    metric = `<div class="metric"><div><b>${num(nets)}</b><span>ME 网络</span></div><div><b>${num(types)}</b><span>物品种类</span></div></div>`;
  }
  return `<div class="card ${esc(m.state)}">
    <div class="card-head"><h2>${esc(m.name)}</h2><span class="badge ${esc(m.state)}">${esc(label)}</span></div>
    <div class="desc">${esc(m.description)}</div>
    <div class="msg">${esc(m.message || (m.state === 'missing' ? m.name + ' 未安装' : ''))}</div>
    ${metric}
  </div>`;
}

function modulePanel(m, data) {
  const head = `<div class="panel-head"><h2>${esc(m.name)}<span class="sub">${esc(m.id)}</span></h2></div>`;

  if (m.state === 'missing') {
    return `<div class="panel">${head}<div class="empty missing"><strong>未安装AE2</strong>万象屏仍可正常运行。安装 Applied Energistics 2 后会自动接入，无需改配置。</div></div>`;
  }
  if (m.state === 'waiting' || !m.installed) {
    return `<div class="panel">${head}<div class="empty"><strong>${esc(m.message || '等待数据')}</strong>进入一个世界后开始读取</div></div>`;
  }
  if (m.state === 'error') {
    return `<div class="panel">${head}<div class="empty"><strong>${esc(m.message)}</strong>查看游戏日志获取详情</div></div>`;
  }
  if (m.view !== 'inventory') {
    return `<div class="panel">${head}<div class="empty"><strong>已接入</strong>${esc(m.message)}</div></div>`;
  }

  const grids = data.grids || [];
  if (!grids.length) {
    return `<div class="panel">${head}<div class="empty"><strong>未检测到 ME 网络</strong>在游戏中搭建并通电 AE2 网络，放入物品后这里会实时显示</div></div>`;
  }
  if (!state.activeGrid || !grids.some((g) => g.id === state.activeGrid)) state.activeGrid = grids[0].id;
  const grid = grids.find((g) => g.id === state.activeGrid) || grids[0];

  const tabs = grids.length > 1
    ? `<div class="tabs">${grids.map((g) => `<button class="tab ${g.id === grid.id ? 'active' : ''}" data-grid="${esc(g.id)}">${esc(g.dimension)} · ${gridLabel(g)}</button>`).join('')}</div>`
    : '';

  const stats = `<div class="stats">
    <div class="stat"><b>${num(grid.totalTypes)}</b><span>物品种类</span></div>
    <div class="stat"><b>${num(grid.totalAmount)}</b><span>物品总量</span></div>
    <div class="stat"><b>${num(grid.nodes || 0)}</b><span>网络节点</span></div>
    <div class="stat ${grid.powered === false ? 'warn' : ''}"><b>${grid.storedPower != null ? num(grid.storedPower) : '—'}</b><span>AE 能量${grid.powered === false ? ' · 未通电' : ''}</span></div>
  </div>`;

  const query = state.query.trim().toLowerCase();
  const rows = (grid.entries || []).filter((item) =>
    !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query) || String(item.mod).toLowerCase().includes(query));

  const nextPrev = {};
  const body = rows.map((item) => {
    const key = `${grid.id}|${item.id}`;
    nextPrev[key] = item.amount;
    const changed = !state.first && state.prev[key] != null && state.prev[key] !== item.amount;
    return `<tr class="${changed ? 'flash' : ''}">
      <td class="name">${esc(item.name)}</td>
      <td class="id">${esc(item.id)}</td>
      <td class="amount">${esc(item.formatted || num(item.amount))}${item.unit ? ' ' + esc(item.unit) : ''}</td>
      <td class="craft">${item.craftable ? '<span class="pill">可合成</span>' : ''}</td>
    </tr>`;
  }).join('');

  for (const g of grids) {
    for (const item of (g.entries || [])) {
      const key = `${g.id}|${item.id}`;
      if (!(key in nextPrev)) nextPrev[key] = item.amount;
    }
  }
  state.prev = nextPrev;
  state.first = false;

  const table = rows.length
    ? `<div class="tablewrap"><table><thead><tr><th>物品</th><th>资源标识</th><th class="amount">数量</th><th class="craft">可合成</th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<div class="empty">没有匹配的物品</div>`;

  return `<div class="panel">
    <div class="panel-head"><h2>ME 网络库存<span class="sub">${esc(grid.dimension)} · ${gridLabel(grid)}</span></h2>
      <input id="search" class="search" placeholder="搜索物品、ID 或模组" value="${esc(state.query)}"></div>
    ${tabs}${stats}${table}
  </div>`;
}

function gridLabel(g) {
  return g.pos ? `${g.pos[0]}, ${g.pos[1]}, ${g.pos[2]}` : '坐标未知';
}

function renderDetected(list) {
  if (!list.length) return '';
  return `<span class="label">已检测，尚未接入</span>` + list.map((d) =>
    `<span class="chip"><b>${esc(d.name)}</b> · ${esc(d.id)}</span>`).join('');
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    state.query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const next = el('search');
    if (next) { next.focus(); next.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-grid]');
  if (tab) { state.activeGrid = tab.dataset.grid; render(); }
});

poll();
setInterval(poll, 1500);
