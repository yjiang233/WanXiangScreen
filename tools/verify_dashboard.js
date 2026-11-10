const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const root = path.resolve(__dirname, '..', 'dashboard');
const api = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:18765/api/status';
const mockDrive = process.argv.includes('--mock-drive');
const mockGrid = process.argv.includes('--mock-grid');
const mockMissing = process.argv.includes('--mock-missing');
const mockMek = process.argv.includes('--mock-mek');
const mockFlux = process.argv.includes('--mock-flux');
const mockDetail = process.argv.includes('--mock-detail');
const mockMenu = process.argv.includes('--mock-menu');
const mockPlan = process.argv.includes('--mock-plan');
const mockPlanOk = process.argv.includes('--mock-plan-ok');
const mockAsk = process.argv.includes('--mock-ask');
const mockSubmit = process.argv.includes('--mock-submit');
const mockNoCpu = process.argv.includes('--mock-nocpu');
const mockFluid = process.argv.includes('--mock-fluid');
const liveFluid = process.argv.includes('--live-fluid');
const mockBigJob = process.argv.includes('--mock-bigjob');
const mockWatch = process.argv.includes('--mock-watch');

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

function sampleFlux() {
  return {
    installed: true, unit: 'FE', message: 'ok',
    networks: [{
      id: 1, name: '主网', color: 3447003, owner: 'uuid', security: 'PRIVATE',
      stats: { plug: 1, point: 2, storage: 2, controller: 0, input: 50000, output: 42000, totalBuffer: 1250000, totalEnergy: 9800000, avgTickMicro: 90, change: [] },
      devices: [
        { type: 'STORAGE', loaded: true, buffer: 900000, change: 0, limit: 0, priority: 0, name: '', pos: [10, 64, 10], dimension: 'minecraft:overworld' },
        { type: 'PLUG', loaded: true, buffer: 12000, change: 500, limit: 800000, priority: 0, name: '', pos: [12, 64, 10], dimension: 'minecraft:overworld' }
      ],
      deviceCount: 2, onlineDevices: 2, storageBuffer: 900000
    }],
    networkCount: 1, storageBuffer: 900000, totalBuffer: 1250000, input: 50000, output: 42000,
    deviceCount: 2, onlineDevices: 2
  };
}

function sampleBaseline() {
  return {
    power: {
      stored: 254080000, unit: 'FE',
      sources: [
        { id: 'flux', name: '通量网络', value: 900000 },
        { id: 'mekanism', name: 'Mekanism 电网', value: 253180000 }
      ]
    },
    draw: { perTick: 12400, unit: 'FE/t', trend: 'drain' },
    items: { gain: 5.4, loss: 2.2, unit: '个/t', source: 'ae2', total: 194 }
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
      { id: 'minecraft:iron_ingot', name: 'Iron Ingot', mod: 'minecraft', type: 'ae2:i', amount: 64, unit: '', formatted: '64', craftable: true, rate: 1.5 },
      { id: 'ae2:drive', name: 'ME Drive', mod: 'ae2', type: 'ae2:i', amount: 64, unit: '', formatted: '64', craftable: false },
      { id: 'ae2:item_storage_cell_64k', name: '64k ME Item Storage Cell', mod: 'ae2', type: 'ae2:i', amount: 3, unit: '', formatted: '3', craftable: false },
      { id: 'ae2:controller', name: 'ME Controller', mod: 'ae2', type: 'ae2:i', amount: 2, unit: '', formatted: '2', craftable: false },
      { id: 'minecraft:stone', name: 'Stone', mod: 'minecraft', type: 'ae2:i', amount: 1536, unit: '', formatted: '1,536', craftable: false },
      { id: 'minecraft:water', name: 'Water', mod: 'minecraft', type: 'ae2:f', amount: 500, unit: 'B', perUnit: 1000, formatted: '0.5 B', craftable: false }
    ],
    drives: [sampleDrive()],
    crafting: {
      cpus: [{ name: 'CPU #1', busy: true, coprocessors: 4, storage: 1024, job: { id: 'minecraft:iron_ingot', name: 'Iron Ingot', percent: 25, remaining: 48, elapsedMs: 5000 } }],
      busy: 1, total: 1
    }
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
    machine('mekanism:creative_energy_cube', 'energy', '能源与电网', false, { energy: { stored: 0, max: 0, infinite: true } }),
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
  if (mockFlux) {
    status.modules = [
      { id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' },
      { id: 'fluxnetworks', name: 'Flux Networks', state: 'online', installed: true, view: 'flux', message: 'ok' }
    ];
    status.data = { ae2: { grids: [sampleGrid()], drives: 0, cellSummary: [] }, fluxnetworks: sampleFlux() };
  }
  if (mockDetail || mockAsk || mockSubmit || mockMenu) {
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' }];
    status.data = { ae2: { grids: [sampleGrid()], drives: 0, cellSummary: [] } };
  }
  if (mockBigJob) {
    const grid = sampleGrid();
    grid.crafting.cpus[0].job = { id: 'minecraft:redstone_torch', name: 'Redstone Torch', percent: 41, remaining: 1260068415, elapsedMs: 128000 };
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' }];
    status.data = { ae2: { grids: [grid], drives: 0, cellSummary: [] } };
  }

  if (mockNoCpu) {
    const grid = sampleGrid();
    grid.crafting = { cpus: [], busy: 0, total: 0 };
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' }];
    status.data = { ae2: { grids: [grid], drives: 0, cellSummary: [] } };
  }
  if (mockWatch) {
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' }];
    status.data = { ae2: { grids: [sampleGrid()], drives: 0, cellSummary: [] } };
  }
  let mockGridUsed = false;
  if (mockGrid) {
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'mock' }];
    status.data = { ...(status.data || {}), ae2: { grids: [sampleGrid()], drives: 1, cellSummary: [] } };
    mockGridUsed = true;
  }

  if (mockFluid) {
    status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'ok' }];
    status.data = { ae2: { grids: [sampleGrid()], drives: 0, cellSummary: [] } };
  }

  if (mockDrive) {
    const grids = status?.data?.ae2?.grids;
    if (!Array.isArray(grids) || !grids.length) {
      status.modules = [{ id: 'ae2', name: 'Applied Energistics 2', state: 'online', installed: true, view: 'inventory', message: 'mock' }];
      status.data = { ae2: { grids: [sampleGrid()], drives: 1, cellSummary: [] } };
      mockGridUsed = true;
    } else {
      grids[0].drives = [sampleDrive()];
    }
  }

  if (!status.baseline) status.baseline = sampleBaseline();
  const elems = {};
  const document = {
    getElementById(id) { if (!elems[id]) elems[id] = makeEl(id); return elems[id]; },
    querySelector() { return null; },
    addEventListener() {}
  };
  const ctx = {
    document, console, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { search: '', port: '18765', origin: 'http://127.0.0.1:18765' },
    window: { innerWidth: 1280, innerHeight: 900, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setInterval() {}
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const marker = '\nloadAssets().then(';
  const cut = code.indexOf(marker);
  const body = cut >= 0 ? code.slice(0, cut) : code;
  vm.runInContext(`${body}\n;globalThis.__state = state; globalThis.__render = render; globalThis.__iconUrl = iconUrl; globalThis.__openDetail = openDetail; globalThis.__openMenu = openMenu; globalThis.__openAsk = openAsk; globalThis.__renderDetail = renderDetail; globalThis.__planBack = planBack; globalThis.__closeModal = closeModal; globalThis.__confirmAsk = confirmAsk; globalThis.__submitCraft = submitCraft; globalThis.__amountLabel = amountLabel;`, ctx);
  ctx.__state.icons = JSON.parse(fs.readFileSync(path.join(root, 'assets/icon-map.json'), 'utf8'));
  ctx.__state.lang = JSON.parse(fs.readFileSync(path.join(root, 'assets/lang-zh.json'), 'utf8'));
  ctx.__state.status = status;
  ctx.__state.ok = true;
  if (mockWatch || mockBigJob) ctx.__state.watch = ['grid-1|minecraft:iron_ingot'];
  if (mockFluid) ctx.__state.fluids = { 'minecraft:water': { tex: '/api/tex/minecraft/block/water_still', tint: '#3f76e4' } };
  if (liveFluid) {
    try { ctx.__state.fluids = JSON.parse(await get('http://127.0.0.1:18765/api/fluids')).fluids || {}; } catch (_) {}
  }
  ctx.__render();
  const iconProbe = ctx.__iconUrl('minecraft:iron_ingot');

  let detailHtml = '';
  if (mockDetail) {
    ctx.__openDetail('grid-1', 'minecraft:iron_ingot');
    detailHtml = elems.modal.innerHTML;
  }

  let menuHtml = '';
  if (mockMenu) {
    ctx.__openMenu(120, 160, 'grid-1', 'minecraft:iron_ingot');
    menuHtml = elems.menu.innerHTML;
  }

  let planHtml = '';
  if (mockPlan || mockPlanOk) {
    const missing = mockPlanOk ? [] : [{ id: 'minecraft:iron_ore', name: 'Iron Ore', amount: 32, unit: '', perUnit: 1, type: 'ae2:i' }];
    ctx.__state.detail = { grid: 'grid-1', item: 'minecraft:iron_ingot' };
    ctx.__state.plan = {
      loading: false, grid: 'grid-1', item: 'minecraft:iron_ingot', amount: 64,
      data: {
        ok: true, feasible: mockPlanOk, simulation: !mockPlanOk, requested: 64, bytes: 2048, steps: 3,
        used: [
          { id: 'minecraft:iron_ore', name: 'Iron Ore', amount: 128, unit: '', perUnit: 1, type: 'ae2:i' },
          { id: 'minecraft:water', name: 'Water', amount: 500, unit: 'B', perUnit: 1000, type: 'ae2:f' }
        ],
        missing,
        cpu: { total: 1, idle: 1, maxStorage: 8192, enough: true },
        reason: '缺少原料，网络中没有足够物品'
      }
    };
    ctx.__renderDetail();
    planHtml = elems.modal.innerHTML;
  }

  const baselineHtml = elems.baseline.innerHTML;
  const watchHtml = elems.watch.innerHTML;
  const html = elems.view.innerHTML;
  let askHtml = '';
  let askBackHtml = '';
  let submitClosed = false;
  let toastText = '';
  if (mockAsk) {
    ctx.__openAsk('grid-1', 'minecraft:iron_ingot');
    askHtml = elems.modal.innerHTML;
    ctx.__state.plan = { loading: false, grid: 'grid-1', item: 'minecraft:iron_ingot', amount: 7, from: 'ask', data: { ok: false, error: '计算失败' } };
    ctx.__renderDetail();
    ctx.__planBack();
    askBackHtml = elems.modal.innerHTML;
  }
  if (mockSubmit) {
    ctx.__state.detail = { grid: 'grid-1', item: 'minecraft:iron_ingot' };
    ctx.__state.ask = { grid: 'grid-1', item: 'minecraft:iron_ingot', amount: 5 };
    ctx.__state.plan = {
      loading: false, grid: 'grid-1', item: 'minecraft:iron_ingot', amount: 5, from: 'ask',
      data: { ok: true, feasible: true, bytes: 1024, steps: 1, used: [], missing: [], cpu: { total: 1, idle: 1, maxStorage: 8192, enough: true }, reason: 'ok' }
    };
    ctx.__renderDetail();
    const origFetch = ctx.fetch;
    ctx.fetch = async (url) => (String(url).includes('/api/ae2/craft')
      ? { ok: true, json: async () => ({ ok: true, message: '已提交合成任务' }) }
      : origFetch(url));
    await ctx.__submitCraft('grid-1', 'minecraft:iron_ingot', 5);
    submitClosed = ctx.__state.plan === null && ctx.__state.detail === null && elems.modal.innerHTML === '';
    toastText = String(elems.toast.textContent || '');
  }
  const result = {
    htmlBytes: html.length,
    baselineCards: (baselineHtml.match(/class="bl-card/g) || []).length,
    baselineShort: [...baselineHtml.matchAll(/<b>([\s\S]*?)<i>([^<]*)<\/i><\/b>/g)].map((x) => `${x[1].replace(/<[^>]*>/g, '')} ${x[2]}`).join(' | '),
    baselineText: (baselineHtml.match(/电网总量[^<]*/g) || [])[0] || '',
    watchItems: (watchHtml.match(/class="watch-item"/g) || []).length,
    menuItems: (menuHtml.match(/class="ctx-item"/g) || []).length,
    menuDisabled: (menuHtml.match(/disabled/g) || []).length,
    menuLabels: [...menuHtml.matchAll(/<span>([^<]*)<\/span>/g)].map((x) => x[1]).join('/'),
    planRows: (planHtml.match(/class="plan-row(?! plan-head)/g) || []).length,
    planMissRows: (planHtml.match(/class="plan-row miss"/g) || []).length,
    planSubmitDisabled: /data-plan-submit disabled/.test(planHtml),
    planFluidUnit: planHtml.includes('0.5B'),
    planNote: (planHtml.match(/id="craft-note">([^<]*)</) || [])[1] || '',
    watchJobs: (watchHtml.match(/class="watch-job"/g) || []).length,
    watchCount: (watchHtml.match(/class="wj-count">([\s\S]*?)<\/span>/) || [])[1] || '',
    cancelButton: (watchHtml.match(/class="wj-cancel/g) || []).length,
    watchRates: (watchHtml.match(/个\/t/g) || []).length,
    fluxCards: (html.match(/class="flux-devices"/g) || []).length,
    detailCraftable: detailHtml.includes('data-ask') && !detailHtml.includes('disabled'),
    askInput: /id="craft-amount"/.test(askHtml),
    askChips: (askHtml.match(/class="ask-chip"/g) || []).length,
    askNoPlan: !askHtml.includes('data-plan-submit'),
    askBackOk: /id="craft-amount"/.test(askBackHtml),
    submitClosed,
    toastText,
    slots: (html.match(/class="slot/g) || []).length,
    fluidAmount: (html.match(/>0\.5B</g) || []).length,
    fluidProbe: ctx.__amountLabel ? ctx.__amountLabel({ unit: 'B', perUnit: 1000, amount: 1000 }) : '',
    fluidProbe10: ctx.__amountLabel ? ctx.__amountLabel({ unit: 'B', perUnit: 1000, amount: 100 }) : '',
    fluidIcon: (html.match(/textures\/item\/water_bucket\.png/g) || []).length,
    fluidNative: (html.match(/class="icon fluid"/g) || []).length,
    icons: (html.match(/class="icon/g) || []).length,
    unknownIcons: (html.match(/assets\/gui\/unknown\.png/g) || []).length,
    driveCards: (html.match(/class="drive-card"/g) || []).length,
    cellSummary: (html.match(/class="cell-summary-item"/g) || []).length,
    capacityBars: (html.match(/class="cell-bar"/g) || []).length,
    machineCards: (html.match(/class="machine-card/g) || []).length,
    categoryTabs: (html.match(/class="cat-tab/g) || []).length,
    machineGroups: (html.match(/class="machine-grid"/g) || []).length,
    itemSlotBlocks: (html.match(/class="mc-slots"/g) || []).length,
    badges: (html.match(/class="mc-badge"/g) || []).length,
    energyBars: (html.match(/class="energy-total"/g) || []).length,
    infiniteLabels: (html.match(/>无限</g) || []).length,
    cpuItems: (html.match(/class="cpu-item/g) || []).length,
    parallelStat: (html.match(/<b>(\d+)<\/b><span>合成并行<\/span>/) || [])[1] || '',
    cpuStorageStat: (html.match(/<b>([^<]*)<\/b><span>并行存储<\/span>/) || [])[1] || '',
    cpuZeroShown: /<b>0<\/b><span>合成并行<\/span>/.test(html) && /<b>0<\/b><span>并行存储<\/span>/.test(html),
    energyTotalText: (html.match(/总储电 [^<]*/g) || [])[0] || '',
    energyLines: html.split('class="energy-total"').slice(1).map((chunk) => {
      const label = (chunk.match(/class="et-label">([^<]*)</) || [])[1] || '';
      const value = ((chunk.match(/<b>([\s\S]*?)<\/b>/) || [])[1] || '').replace(/<[^>]*>/g, '');
      const note = (chunk.match(/class="et-note">([^<]*)</) || [])[1] || '';
      return `${label}: ${value} ${note}`;
    }),
    undefined: (html.match(/undefined/g) || []).length,
    nan: (html.match(/NaN/g) || []).length,
    drivePanel: html.includes('ME 驱动器'),
    missingPanel: html.includes('class="ae-empty missing"'),
    iconProbe
  };
  console.log(JSON.stringify(result, null, 2));
  if (!html.length || result.undefined || result.nan) process.exitCode = 1;
  if (result.fluidProbe !== '1B' || result.fluidProbe10 !== '0.1B') process.exitCode = 1;
  if (mockDrive && (!result.driveCards || result.slots < 10 || result.capacityBars < 3 || result.unknownIcons)) process.exitCode = 1;
  if (mockDrive && mockGridUsed && (!result.cpuItems || result.parallelStat !== '4')) process.exitCode = 1;
  if (mockDrive && mockGridUsed && (!result.fluidAmount || !result.fluidIcon)) process.exitCode = 1;
  if (mockMissing && !result.missingPanel) process.exitCode = 1;
  if (mockMek && (!result.machineCards || !result.categoryTabs || !result.machineGroups || !result.itemSlotBlocks || !result.badges)) process.exitCode = 1;
  if (mockMek && (!result.energyBars || !result.energyLines.some((l) => l.includes('创造')))) process.exitCode = 1;
  if (mockMek && !result.infiniteLabels) process.exitCode = 1;
  if (mockFlux && (!result.fluxCards || !result.baselineCards)) process.exitCode = 1;
  if (mockDetail && !result.detailCraftable) process.exitCode = 1;
  if (mockMenu && (result.menuItems !== 3 || !result.menuLabels.includes('查看详情'))) process.exitCode = 1;
  if (mockPlan && (result.planRows < 2 || !result.planMissRows || !result.planSubmitDisabled)) process.exitCode = 1;
  if (mockPlan && !result.planFluidUnit) process.exitCode = 1;
  if (mockPlanOk && (result.planMissRows || result.planSubmitDisabled)) process.exitCode = 1;
  if (mockAsk && (!result.askInput || result.askChips !== 4 || !result.askNoPlan || !result.askBackOk)) process.exitCode = 1;
  if (mockSubmit && (!result.submitClosed || !result.toastText.includes('已提交'))) process.exitCode = 1;
  if (mockNoCpu && !result.cpuZeroShown) process.exitCode = 1;
  if (mockFluid && (!result.fluidNative || !html.includes('/api/tex/minecraft/block/water_still') || result.fluidIcon)) process.exitCode = 1;
  if (mockWatch && (!result.watchItems || !result.watchJobs || !result.watchRates)) process.exitCode = 1;
  if (mockBigJob && (!result.cancelButton || !/^41%$/.test(result.watchCount))) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
