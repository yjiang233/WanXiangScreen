const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const root = path.resolve(__dirname, '..', 'dashboard');
const api = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:18765/api/status';
const mockDrive = process.argv.includes('--mock-drive');
const mockMissing = process.argv.includes('--mock-missing');
const mockMek = process.argv.includes('--mock-mek');

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

function sampleMek() {
  const machine = (id, category, categoryName, active, extra = {}) => ({
    id, name: id, category, categoryName, dimension: 'minecraft:overworld', pos: [12, 64, -8], active,
    progress: { ticks: 120, required: 400, percent: 30 },
    energy: { stored: 12000, max: 100000 },
    items: { slots: 8, used: 3, count: 45, first: 'minecraft:iron_ore', types: 2, stacks: [
      { id: 'minecraft:iron_ore', name: 'Iron Ore', count: 32, slots: 2 },
      { id: 'minecraft:coal', name: 'Coal', count: 13, slots: 1 }
    ] },
    fluids: { amount: 8000, capacity: 16000, first: 'minecraft:water' },
    chemicals: { amount: 1200, capacity: 8000, first: 'mekanism:oxygen' },
    recipeOutput: 'minecraft:iron_ingot', recipeName: 'Iron Ingot',
    ...extra
  });
  const machines = [
    machine('mekanism:crusher', 'processing', '加工机器', true),
    machine('mekanism:energized_smelter', 'processing', '加工机器', false),
    machine('mekanism:basic_crushing_factory', 'factory', '工厂机器', true),
    machine('mekanism:advanced_energy_cube', 'energy', '能源与电网', true, { multiblock: { formed: true, volume: 512, boilEfficiency: 0.86 } }),
    machine('mekanism:fission_reactor_casing', 'reactor', '核反应堆', false, { multiblock: { formed: false, volume: 0 } }),
    machine('mekanism:dynamic_tank', 'structure', '多方块结构', false),
    machine('mekanism:elite_fluid_tank', 'storage', '储罐与仓储', false),
    machine('mekanism:digital_miner', 'mining', '采矿设备', true)
  ];
  const map = new Map();
  for (const m of machines) {
    const entry = map.get(m.category) || { id: m.category, name: m.categoryName, total: 0, running: 0 };
    entry.total++;
    if (m.active) entry.running++;
    map.set(m.category, entry);
  }
  return { machines, categories: [...map.values()], total: machines.length, running: machines.filter((m) => m.active).length };
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
  if (mockMek) {
    status.modules = [
      { id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' },
      { id: 'mekanism', name: 'Mekanism', state: 'online', installed: true, view: 'machines', message: 'ok' }
    ];
    status.data = { ae2: { grids: [sampleGrid()], drives: 1, cellSummary: [] }, mekanism: sampleMek() };
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
    icons: (html.match(/<img class="icon/g) || []).length,
    unknownIcons: (html.match(/src="assets\/gui\/unknown\.png"/g) || []).length,
    driveCards: (html.match(/class="drive-card"/g) || []).length,
    cellSummary: (html.match(/class="cell-summary-item"/g) || []).length,
    capacityBars: (html.match(/class="cell-bar"/g) || []).length,
    machineCards: (html.match(/class="machine-card/g) || []).length,
    categoryTabs: (html.match(/class="cat-tab/g) || []).length,
    machineGroups: (html.match(/class="machine-grid"/g) || []).length,
    itemSlotBlocks: (html.match(/class="mc-slots"/g) || []).length,
    badges: (html.match(/class="mc-badge"/g) || []).length,
    undefined: (html.match(/undefined/g) || []).length,
    nan: (html.match(/NaN/g) || []).length,
    drivePanel: html.includes('ME 驱动器'),
    missingPanel: html.includes('class="ae-empty missing"'),
    iconProbe
  };
  console.log(JSON.stringify(result, null, 2));
  if (!html.length || result.undefined || result.nan) process.exitCode = 1;
  if (mockDrive && (!result.driveCards || result.slots < 10 || result.capacityBars < 3 || result.unknownIcons)) process.exitCode = 1;
  if (mockMissing && !result.missingPanel) process.exitCode = 1;
  if (mockMek && (!result.machineCards || !result.categoryTabs || !result.machineGroups || !result.itemSlotBlocks || !result.badges)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
