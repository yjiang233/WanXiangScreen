# 第三方模组 jar

构建与运行所需（不纳入版本库，从 Modrinth / CurseForge 下载）：

## 1.21.1（NeoForge，main 分支）

- appliedenergistics2-19.2.19.jar
  https://cdn.modrinth.com/data/XxWD5pD3/versions/DxZ2waV0/appliedenergistics2-19.2.19.jar
- guideme-21.1.22.jar （AE2 的强制依赖）
  https://cdn.modrinth.com/data/Ck4E7v7R/versions/QeYKsstN/guideme-21.1.22.jar
- Mekanism-1.21.1-10.7.19.85.jar （无强制额外依赖）
  https://cdn.modrinth.com/data/Ce6I4WUE/versions/5KzzycBT/Mekanism-1.21.1-10.7.19.85.jar
- FluxNetworks-1.21.1-8.0.0.jar （CurseForge file 6089446，无强制额外依赖）
  https://mediafilez.forgecdn.net/files/6089/446/FluxNetworks-1.21.1-8.0.0.jar

## 1.20.1（Forge，1.20.1 分支）

均为生产 jar（SRG 映射），必须走 `fg.deobf(...)` 才能编译。**本分支构建需设置 `GRADLE_USER_HOME=C:\gradle-home`**（中文用户名下 ForgeGradle 6 的 worker argfile 编码问题，见 build.gradle 注释）。

- appliedenergistics2-1.20.1-forge-15.4.12.jar （Modrinth 项目 XxWD5pD3，forge 版）
- guideme-1.20.1-20.1.15.jar （AE2 的强制依赖）
  https://cdn.modrinth.com/data/Ck4E7v7R/versions/（forge 20.1.15）
- Mekanism-1.20.1-10.4.16.80.jar （Modrinth 项目 Ce6I4WUE）
- FluxNetworks-1.20.1-7.2.0.14.jar （CurseForge file 4651164）

注意：`fg.deobf` 不会重映射 mixin refmap，首次反混淆后需把 SRG 名按 `srg_to_official_1.20.1.tsrg` 写回各 jar 的 `*.refmap.json`，否则 AE2 等模组在开发运行时 mixin 注入失败（`tools/patch_refmaps.py`，随首次构建生成说明）。
