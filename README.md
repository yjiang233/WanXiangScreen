# 万象屏 WanXiangScreen

把 Minecraft 里的科技网络搬到一个网页上——挂机时不用切回游戏窗口，也能随时看到 ME 库存、能量和机器状态。

万象屏是 NeoForge 1.21.1 的**游戏内数据看板模组**。模组在游戏里启动一个只监听 `127.0.0.1` 的 HTTP 服务，浏览器打开即可得到实时快照（每 1 秒刷新）；界面用游戏原始贴图还原 AE2 终端 GUI 的槽位风格，物品图标和数量角标与游戏内一致。

**可选依赖，按需联动。** 每个科技模组对应一个独立模块：装了才接入，没装就在看板上写明「未安装AE2」「未安装Mekanism」，不报错、不加载对方的类、也不影响存档。模块注册表是统一扩展点，后续接入更多科技模组沿用同一套流程。

| 能力 | 状态 |
| --- | --- |
| AE2 · ME 网络工作状态：库存（图标 + 数量角标）、能量、节点数、可合成标记 | 已实现 |
| AE2 · ME 驱动器 10 槽、存储元件类型 / 数量 / 容量 / 状态灯 | 已实现 |
| Mekanism · 机器状态按功能分类，含运行/待机/未成型、加工进度、能量、物品/流体/化学品储罐、配方产物、多方块指标 | 已实现 |
| 通用 FE 电量聚合、更多科技模组机器状态、历史趋势与阈值告警 | 规划中 |

NeoForge 1.21.1 · ModDevGradle 2.0.91 · JDK 21 · Gradle 8.14.2

## 启动

```bash
./gradlew runClient     # 客户端，已自动带上 AE2 + GuideME + Mekanism
./gradlew runServer     # 专用服务端（无 GUI）
./gradlew build         # 打包，产物 build/libs/wanxiangscreen-1.0.0.jar
```

`-PwithoutAe2` / `-PwithoutMek` 可分别启动缺少该依赖的环境，验证降级分支。

进入世界后打开 <http://127.0.0.1:18765/>；也可直接双击 `dashboard/index.html`。
页面加载 `app.js` / `style.css` 时自动附加时间戳版本号，改前端后刷新页面即生效，无需清缓存或重启游戏。
只监听 `127.0.0.1`；端口被占用时自动顺延到 18766~18768，实际端口写在
`<游戏目录>/wanxiangscreen.port`，看板可用 `?api=http://127.0.0.1:18766` 指定。
固定换端口用 JVM 参数 `-Dwanxiangscreen.port=9000`。

## 接口

| 路径 | 内容 |
| --- | --- |
| `/api/status` | 全量快照：模块状态 + 数据 + 已安装模组列表 |
| `/api/modules` | 联动模块清单 |
| `/api/mods` | 已安装模组清单 |
| `/api/module/{id}/data` | 单个模块数据，如 `/api/module/ae2/data`、`/api/module/mekanism/data` |
| `/api/ae2/inventory` | AE2 数据别名 |
| `/api/health` | 健康检查 |

`data.ae2` 含 `grids[]`（每格的 `entries[]` 库存与 `drives[]` 驱动器）、`drives` 总数、
`cellSummary` 元件汇总；`drives[].cells[]` 给出槽位状态、元件 ID、已用/总字节、种类数、物品数。

`data.mekanism` 含 `machines[]`（每台机器的 `category` / `active` / `progress` / `energy` /
`items` / `fluids` / `chemicals` / `recipeOutput` / `multiblock`）、`categories[]`（分类统计）、
`total`、`running`。分类规则集中在 `MekScanner.CATEGORY_RULES`，按机器 ID 关键词匹配。

配置在 `<游戏目录>/config/wanxiangscreen-common.toml`：`token`（鉴权，空=不校验）、
`watchedMods`（关注的模组 ID）、`simulateMissing`（模拟依赖未安装）、`refreshTicks`（快照间隔，默认 20 tick）。
配置文件改动会热更新，无需重启游戏。

## 测试步骤

新建创造模式世界，用下列命令搭一个最小 AE2 网络，通过 ME 终端往里放物品：

```
/give @s ae2:creative_energy_cell
/give @s ae2:drive
/give @s ae2:item_storage_cell_64k
/give @s ae2:fluix_smart_cable 16
/give @s ae2:terminal
```

把创造能源、驱动器用电缆连起来，存储元件放进驱动器，终端贴在电缆上即可。
看板按 AE2 终端 GUI 的槽位网格显示库存，图标取自游戏资源，右下角是数量角标；
ME 驱动器面板显示 10 个槽位、元件图标、状态灯与容量条，并在上方汇总「多少个什么元件」。
数量变化的格子会高亮，鼠标悬停可看完整名称、ID、容量与状态。

Mekanism 同样放几台带能量的机器即可：

```
/give @s mekanism:crusher
/give @s mekanism:energized_smelter
/give @s mekanism:advanced_energy_cube
/give @s mekanism:basic_crushing_factory
```

给机器通电并投入原料后，看板按「工厂机器 / 加工机器 / 能源与电网 / 核反应堆 / 多方块结构 / 储罐与仓储 / 物流管道 / 采矿设备」分组，每台显示状态灯、进度条、能量条与容器概要；点击分类标签可筛选。

验证「未安装」有两种方式：

1. 在 `wanxiangscreen-common.toml` 里设 `simulateMissing = ["ae2"]` 或 `["mekanism"]`，保存后约 1 秒看板即显示对应提示；改回 `[]` 恢复。
2. `./gradlew runServer -PwithoutAe2 -PwithoutMek` 启动真正不含联动模组的服务端，验证类隔离与降级。

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/main/java/com/wanxiang/screen` | 模组主体，与具体联动模组无关 |
| `src/main/java/com/wanxiang/screen/compat/ae2` | AE2 联动实现，仅在检测到 AE2 时加载 |
| `src/main/java/com/wanxiang/screen/compat/mek` | Mekanism 联动实现与机器分类规则，仅在检测到 Mekanism 时加载 |
| `dashboard/` | 网页看板，模组会从游戏目录向上自动定位并托管 |
| `dashboard/assets/` | AE2 GUI 贴图、AE2 / Mekanism / MC 物品图标、中文名映射 |
| `tools/extract_assets.py` | 从 AE2 / Mekanism / MC 资源 jar 重新生成上述资源 |
| `tools/verify_dashboard.js` | 看板渲染自检，可模拟驱动器、机器数据与未安装分支 |
| `libs/` | 第三方模组 jar，来源见 `libs/README.md` |
| `local-maven/` | 补齐官方镜像缺失的 POM，勿删 |

## 图标与 GUI 资源

`dashboard/assets/` 全部提取自本地官方 jar，看板运行时不依赖外网：

- `gui/` — AE2 的 `terminal.png`、`drive.png`、`states.png` 等；`slot.png` 是从终端 GUI 精确裁出的 18×18 槽位底图
- `tex/` — Minecraft / AE2 / Mekanism 的物品、方块、部件贴图，按模型 JSON 的 parent 链解析（兼容 `front` / `base` 等自定义键，并对 `builtin/entity` 模型做同名贴图兜底），共 2483 项映射
- `icon-map.json` — 物品 ID → 贴图路径；`lang-zh.json` — 合并 AE2 与 Mekanism 的简体中文名，共 4256 条

升级联动模组或 Minecraft 版本后重新生成：

```bash
python tools/extract_assets.py
```

看板渲染自检（无需进入游戏）：

```bash
node tools/verify_dashboard.js --mock-drive
node tools/verify_dashboard.js --mock-mek
node tools/verify_dashboard.js --mock-missing
```

## 增加联动模组

1. 在 `ModuleRegistry.SPECS` 加一行 `Spec`（id / 名称 / 未安装提示 / 视图类型 / 实现类）。
2. 新建实现类实现 `ScreenModule#snapshot(MinecraftServer)`，放在 `compat/<id>/` 下。
3. 在 `neoforge.mods.toml` 模板里加一个 `type="optional"` 依赖声明。

实现类通过 `Class.forName` 按需加载，未安装时不会触碰对方任何类，也不会报 `NoClassDefFoundError`。
配置文件 `watchedMods` 里已安装但尚未接入的模组，看板会显示「已检测到，尚未接入」。

## 线程模型

所有联动模组对象只在服务端主线程读取：每 `refreshTicks` tick 生成一份不可变快照写入 volatile 字段，
HTTP 线程只做 JSON 序列化。AE2 库存读 `getCachedInventory()`，不走全量遍历；
Mekanism 无订阅回调，按同一周期扫描 `ChunkTracker` 中已加载区块的 `TileEntityMekanism`（上限 500 台），
多方块 `getMultiblock()` 会判空后读取，结构未成型返回 `formed:false`。

## 非 ASCII 用户目录

本机用户名含中文，开发启动时早期加载窗口无法从 Gradle 缓存解析 LWJGL 原生库
（PATH 里部分条目被编码成 U+FFFD，Java 转 GBK 后产生非法字符 `?`）。
`prepareNatives` 任务会把 natives jar 解到纯 ASCII 的 `build/natives`，
运行配置自动注入 `org.lwjgl.librarypath`，因此 `./gradlew runClient` 可直接用。
若从 Agent 的非交互终端启动失败，检查 PATH 中是否含 U+FFFD 条目并剔除。

## 仓库镜像

官方 `maven.neoforged.net` 国内不可直连，已改用官方 CDN 镜像 `neoforged.forgecdn.net`。
`settings.gradle` 会把任何指向 `maven.neoforged.net` 的仓库自动重写到该镜像。

## 协议

模板部分遵循 `TEMPLATE_LICENSE.txt`；模组代码与资源为 `mod_license` 所声明的协议。
