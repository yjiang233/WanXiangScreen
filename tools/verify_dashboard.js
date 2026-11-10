const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const root = path.resolve(__dirname, '..', 'dashboard');
const api = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:18765/api/status';
const mockDrive = process.argv.includes('--mock-drive');
const mockMissing = process.argv.includes('--mock-missing');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', dataset: {}, style: {},
    offsetWidth: 160, offsetHeight: 60,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    focus() {}, setSelectionRange() {}
  };
}

function sampleDrive() {
  const cells = Array.from({ length: 10 }, (_, slot) => ({ slot, state: 'ABSENT', blinking: false }));
  cells[0] = { slot: 0, state: 'NOT_EMPTY', blinking: false, id: 'ae2:item_storage_cell_64k', name: '64k ME Item Storage Cell', usedBytes: 2048, totalBytes: 65536, types: 5, count: 320 };
  cells[1] = { slot: 1, state: 'TYPES_FULL', blinking: false, id: 'ae2:item_storage_cell_1k', name: '1k ME Item Storage Cell', usedBytes: 1024, totalBytes: 1024, types: 63, count: 512 };
  cells[2] = { slot: 2, state: 'EMPTY', blinking: false, id: 'ae2:fluid_storage_cell_16k', name: '16k ME Fluid Storage Cell', usedBytes: 0, totalBytes: 16384, types: 0, count: 0 };
  return { block: 'ae2:drive', pos: [12, 64, -8], dimension: 'minecraft:overworld', powered: true, priority: 0, cells };
}

function sampleGrid() {
  return {
    id: 'grid-1', nodes: 5, dimension: 'minecraft:overworld', pos: [12, 64, -8],
    powered: true, storedPower: 12800, maxPower: 25600, avgUsage: 3.2,
    totalTypes: 5, totalAmount: 194,
    entries: [
      { id: 'minecraft:iron_ingot', name: 'Iron Ingot', mod: 'minecraft', type: 'ae2:i', amount: 64, unit: '', formatted: '64', craftable: true },
      { id: 'ae2:drive', name: 'ME Drive', mod: 'ae2', type: 'ae2:i', amount: 64, unit: '', formatted: '64', craftable: false },
      { id: 'ae2:item_storage_cell_64k', name: '64k ME Item Storage Cell', mod: 'ae2', type: 'ae2:i', amount: 3, unit: '', formatted: '3', craftable: false },
      { id: 'ae2:controller', name: 'ME Controller', mod: 'ae2', type: 'ae2:i', amount: 2, unit: '', formatted: '2', craftable: false },
      { id: 'minecraft:stone', name: 'Stone', mod: 'minecraft', type: 'ae2:i', amount: 1536, unit: '', formatted: '1,536', craftable: false }
    ],
    drives: [sampleDrive()]
  };
}

async function main() {
  let status;
  try {
    status = JSON.parse(await get(api));
  } catch (e) {
    status = { modules: [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'mock' }], data: {}, detected: [] };
  }
  if (mockMissing) {
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'missing', installed: false, view: 'inventory', message: '未安装AE2' }];
    status.data = { ae2: { installed: false, message: '未安装AE2' } };
  }
  if (mockDrive) {
    const grids = status?.data?.ae2?.grids;
    if (!Array.isArray(grids) || !grids.length) {
      status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'mock' }];
      status.data = { ae2: { grids: [sampleGrid()], drives: 1, cellSummary: [] } };
    } else {
      grids[0].drives = [sampleDrive()];
    }
  }

  const elems = {};
  const document = {
    getElementById(id) { if (!elems[id]) elems[id] = makeEl(id); return elems[id]; },
    addEventListener() {}
  };
  const ctx = {
    document, console, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { search: '', port: '18765', origin: 'http://127.0.0.1:18765' },
    window: { innerWidth: 1280, innerHeight: 900 },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setInterval() {}
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const marker = '\nloadAssets().then(';
  const cut = code.indexOf(marker);
  const body = cut >= 0 ? code.slice(0, cut) : code;
  vm.runInContext(`${body}\n;globalThis.__state = state; globalThis.__render = render; globalThis.__iconUrl = iconUrl;`, ctx);
  ctx.__state.icons = JSON.parse(fs.readFileSync(path.join(root, 'assets/icon-map.json'), 'utf8'));
  ctx.__state.lang = JSON.parse(fs.readFileSync(path.join(root, 'assets/lang-zh.json'), 'utf8'));
  ctx.__state.status = status;
  ctx.__state.ok = true;
  ctx.__render();
  const iconProbe = ctx.__iconUrl('minecraft:iron_ingot');

  const html = elems.view.innerHTML;
  const result = {
    htmlBytes: html.length,
    slots: (html.match(/class="slot/g) || []).length,
    icons: (html.match(/<img class="icon"/g) || []).length,
    unknownIcons: (html.match(/src="assets\/gui\/unknown\.png"/g) || []).length,
    driveCards: (html.match(/class="drive-card"/g) || []).length,
    cellSummary: (html.match(/class="cell-summary-item"/g) || []).length,
    capacityBars: (html.match(/class="cell-bar"/g) || []).length,
    undefined: (html.match(/undefined/g) || []).length,
    nan: (html.match(/NaN/g) || []).length,
    drivePanel: html.includes('ME 驱动器'),
    missingPanel: html.includes('未安装AE2'),
    iconProbe
  };
  console.log(JSON.stringify(result, null, 2));
  if (!html.length || result.undefined || result.nan) process.exitCode = 1;
  if (mockDrive && (!result.driveCards || result.slots < 10 || result.capacityBars < 3 || result.unknownIcons)) process.exitCode = 1;
  if (mockMissing && !result.missingPanel) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
