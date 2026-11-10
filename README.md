# 万象屏 WanXiangScreen

NeoForge 1.21.1 · ModDevGradle 2.0.91 · JDK 21 · Gradle 8.14.2

以**可选依赖**方式联动 AE2 等模组，把游戏内数据通过 HTTP 暴露给外部网页看板。
没装某个联动模组不会报错，看板直接显示「未安装AE2」。

## 启动

```bash
./gradlew runClient     # 客户端，已自动带上 AE2 + GuideME
./gradlew runServer     # 专用服务端（无 GUI）
./gradlew build         # 打包，产物 build/libs/wanxiangscreen-1.0.0.jar
```

进入世界后打开 <http://127.0.0.1:18765/>；也可直接双击 `dashboard/index.html`。
只监听 `127.0.0.1`；端口被占用时自动顺延到 18766~18768，实际端口写在
`<游戏目录>/wanxiangscreen.port`，看板可用 `?api=http://127.0.0.1:18766` 指定。
固定换端口用 JVM 参数 `-Dwanxiangscreen.port=9000`。

## 接口

| 路径 | 内容 |
| --- | --- |
| `/api/status` | 全量快照：模块状态 + 数据 + 已安装模组列表 |
| `/api/modules` | 联动模块清单 |
| `/api/mods` | 已安装模组清单 |
| `/api/module/{id}/data` | 单个模块数据，如 `/api/module/ae2/data` |
| `/api/ae2/inventory` | AE2 数据别名 |
| `/api/health` | 健康检查 |

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
看板会每秒刷新库存；数量变化的行会高亮。

验证「未安装AE2」有两种方式：

1. 在 `wanxiangscreen-common.toml` 里设 `simulateMissing = ["ae2"]`，保存后约 1 秒看板即显示「未安装AE2」；改回 `[]` 恢复。
2. `./gradlew runServer -PwithoutAe2` 启动一个真正不含 AE2 的服务端，验证类隔离与降级。

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/main/java/com/wanxiang/screen` | 模组主体，与具体联动模组无关 |
| `src/main/java/com/wanxiang/screen/compat/ae2` | AE2 联动实现，仅在检测到 AE2 时加载 |
| `dashboard/` | 网页看板，模组会从游戏目录向上自动定位并托管 |
| `libs/` | 第三方模组 jar，来源见 `libs/README.md` |
| `local-maven/` | 补齐官方镜像缺失的 POM，勿删 |

## 增加联动模组

1. 在 `ModuleRegistry.SPECS` 加一行 `Spec`（id / 名称 / 未安装提示 / 视图类型 / 实现类）。
2. 新建实现类实现 `ScreenModule#snapshot(MinecraftServer)`，放在 `compat/<id>/` 下。
3. 在 `neoforge.mods.toml` 模板里加一个 `type="optional"` 依赖声明。

实现类通过 `Class.forName` 按需加载，未安装时不会触碰对方任何类，也不会报 `NoClassDefFoundError`。
配置文件 `watchedMods` 里已安装但尚未接入的模组，看板会显示「已检测到，尚未接入」。

## 线程模型

所有 AE2 对象只在服务端主线程读取：每 `refreshTicks` tick 生成一份不可变快照写入 volatile 字段，
HTTP 线程只做 JSON 序列化，不接触 `IGrid`。库存读的是 `getCachedInventory()`，不走全量遍历。

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
