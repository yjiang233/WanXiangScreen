# Minecraft 模组开发环境

NeoForge 1.21.1 · ModDevGradle · JDK 21 · Gradle 8.14.2

## 常用命令

```bash
./gradlew runClient     # 启动带模组的客户端
./gradlew runServer     # 启动专用服务端
./gradlew runData       # 数据生成，输出到 src/generated/resources
./gradlew build         # 打包，产物在 build/libs
```

首次构建会自动反编译 Minecraft，约 2 分钟，之后走缓存。

## 目录

| 路径 | 用途 |
| --- | --- |
| `gradle.properties` | 模组 ID、名称、版本、依赖版本 |
| `src/main/java` | 模组代码 |
| `src/main/resources` | 贴图、语言文件等静态资源 |
| `src/main/templates` | `neoforge.mods.toml` 模板，构建时注入变量 |
| `src/generated/resources` | 数据生成产物，勿手改 |
| `local-maven` | 补齐官方镜像缺失的 POM，勿删 |

## 仓库镜像

官方 `maven.neoforged.net` 国内不可直连，已改用官方 CDN 镜像 `neoforged.forgecdn.net`。
`settings.gradle` 会把任何指向 `maven.neoforged.net` 的仓库自动重写到该镜像，新增依赖时无需逐处修改。

## 改模组名

改 `gradle.properties` 的 `mod_id` / `mod_group_id` / `mod_name`，并同步：
`ExampleMod.MODID` 常量、Java 包目录、`assets/` 下的命名空间文件夹。

## 协议

模板部分遵循 `TEMPLATE_LICENSE.txt`；模组代码与资源为 `mod_license` 所声明的协议。
