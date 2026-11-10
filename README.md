# 万象屏 WanXiangScreen

游戏开着，人不想一直盯着。万象屏把 AE2、通用机械、Flux Networks 的数据推到一个网页上，挂机的时候切过去扫一眼就行。

模组在游戏里跑了个只监听 `127.0.0.1` 的 HTTP 服务，浏览器打开就是实时快照，默认一秒一刷。界面照着 AE2 终端的样式画的，物品图标、数量角标都和游戏里一致。

![看板全貌](docs/dashboard.png)

## 能干什么

**AE2**

- 库存格子带真实物品图标和数量角标，左键看详情，右键直接合成或收藏
- 合成走 AE 原生那套流程：先弹数量框，再算材料、列出缺口，材料齐了才提交到 CPU
- 合成 CPU 的并行数、并行存储、每个任务的实时进度和预计剩余时间
- 任务卡住了？点旁边的 ✕ 直接取消
- ME 驱动器逐槽展示：元件类型、状态灯、容量条；第三方扩展驱动器（比如 ExtendedAE）走同一套接口，装了就能读
- 流体按 AE 原生渲染：水就是水的贴图，不是水桶

**通用机械（Mekanism）**

- 机器按用途分类：工厂、加工、能源电网、反应堆、多方块结构、储罐、采矿……标签页切换
- 每台机器有状态灯、进度条、能量条、物品槽位、储罐读数，多方块没成型也会标出来

**Flux Networks**

- 网络储能并进顶部「电网总量」，输入输出吞吐单独看

**顶部四张卡**

电网总量、耗电速度、物品增加、物品减少。创造能源不计入，不然统计直接溢出成负数。

**关注栏**

把在意的物品收藏起来盯走势，每 tick 增减一目了然；合成任务也在这一栏实时滚动。

## 安装

NeoForge 1.21.1，jar 丢进 `mods` 就完事。网页已经打包在 jar 里，不依赖外网。

AE2、Mekanism、Flux Networks 都是可选依赖：装了哪个就接哪个，没装的在看板上写「未安装」，不会报错，也不碰存档。其他模组（ExtendedAE 之类）只要走 AE2 标准接口，数据自动能读。

进世界时会自动用系统浏览器打开看板（`config/wanxiangscreen-common.toml` 里 `openBrowserOnJoin = false` 可关掉）。地址是 `http://127.0.0.1:18765`，端口被占就顺延，实际端口写在游戏目录的 `wanxiangscreen.port` 文件里。

## 配置

都在 `config/wanxiangscreen-common.toml`：

| 项 | 说明 |
| --- | --- |
| `token` | HTTP 鉴权令牌，留空=只允许本机访问 |
| `openBrowserOnJoin` | 进世界自动开看板 |
| `refreshTicks` | 快照刷新间隔，默认 20 tick |
| `simulateMissing` | 手动模拟某个模组未安装，测降级界面用 |

## 排错

模组自己的 WARN / ERROR 会单独抄一份到 `logs/wanxiangscreen-errors.log`，出问题把这个文件整个发过来就行，不用翻一万行的 latest.log。

## 自己打包

```bash
./gradlew build        # 产物在 build/libs/
./gradlew runClient    # 开发跑客户端，自动带齐三个联动模组
./gradlew runClient -PwithoutAe2   # 验证没装 AE2 时的降级
```

## 协议

模板部分见 `TEMPLATE_LICENSE.txt`，模组代码与资源遵循 `neoforge.mods.toml` 里声明的协议。
