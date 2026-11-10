package com.wanxiang.screen;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.server.MinecraftServer;
import net.neoforged.fml.ModList;
import net.neoforged.neoforgespi.language.IModInfo;

public final class ModuleRegistry
{
    public record Spec(String id, String name, String description, String missingMessage, String view, String impl) {}

    // 新增联动只需在此加一行 Spec，并提供一个实现 ScreenModule 的类
    private static final List<Spec> SPECS = List.of(
            new Spec("ae2", "Applied Energistics 2", "ME 网络库存 / 能量 / 可合成",
                    "未安装AE2", "inventory", "com.wanxiang.screen.compat.ae2.Ae2Module")
    );

    private static final Map<String, ScreenModule> INSTANCES = new LinkedHashMap<>();
    private static volatile List<Map<String, Object>> installedMods = List.of();

    private ModuleRegistry() {}

    public static Map<String, Object> build(MinecraftServer server)
    {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("service", "wanxiangscreen");
        root.put("updatedAt", System.currentTimeMillis());
        root.put("serverOnline", server != null);

        List<Map<String, Object>> modules = new ArrayList<>();
        Map<String, Object> data = new LinkedHashMap<>();

        for (Spec spec : SPECS)
        {
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("id", spec.id);
            info.put("name", spec.name);
            info.put("description", spec.description);
            info.put("view", spec.view);
            info.put("endpoint", "/api/module/" + spec.id + "/data");

            boolean installed = isLoaded(spec.id);
            info.put("installed", installed);

            if (!installed)
            {
                info.put("state", "missing");
                info.put("message", spec.missingMessage);
                data.put(spec.id, Map.of("installed", false, "message", spec.missingMessage));
            }
            else if (server == null)
            {
                info.put("state", "waiting");
                info.put("message", "等待进入世界");
                data.put(spec.id, Map.of("installed", true, "message", "等待进入世界"));
            }
            else
            {
                try
                {
                    ScreenModule module = INSTANCES.computeIfAbsent(spec.id, key -> create(spec.impl));
                    Map<String, Object> snapshot = module.snapshot(server);
                    data.put(spec.id, snapshot);
                    info.put("state", "online");
                    info.put("message", String.valueOf(snapshot.getOrDefault("message", "已连接")));
                }
                catch (Throwable t)
                {
                    WanXiangScreen.LOGGER.error("模块 {} 快照失败", spec.id, t);
                    info.put("state", "error");
                    info.put("message", "模块读取失败：" + t.getMessage());
                    data.put(spec.id, Map.of("installed", true, "message", "模块读取失败"));
                }
            }
            modules.add(info);
        }

        root.put("modules", modules);
        root.put("data", data);
        root.put("detected", detectExtras());
        root.put("mods", installedMods());
        return root;
    }

    public static Map<String, Object> moduleData(String id)
    {
        Object raw = ScreenState.get().get("data");
        if (raw instanceof Map<?, ?> map && map.get(id) != null)
            return Map.of("id", id, "data", map.get(id));
        return Map.of("installed", false, "message", "未安装该模块");
    }

    private static ScreenModule create(String className)
    {
        try
        {
            return (ScreenModule) Class.forName(className).getDeclaredConstructor().newInstance();
        }
        catch (Exception e)
        {
            throw new IllegalStateException("无法加载联动模块 " + className, e);
        }
    }

    // 智能识别：列出已安装但尚未接入的关注模组
    private static List<Map<String, Object>> detectExtras()
    {
        List<Map<String, Object>> extras = new ArrayList<>();
        for (String id : ScreenConfig.watchedMods)
        {
            if (SPECS.stream().anyMatch(s -> s.id.equals(id)) || !isLoaded(id)) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", id);
            item.put("name", modName(id));
            item.put("state", "detected");
            item.put("message", "已检测到，尚未接入");
            extras.add(item);
        }
        return extras;
    }

    private static List<Map<String, Object>> installedMods()
    {
        if (!installedMods.isEmpty()) return installedMods;
        List<Map<String, Object>> list = new ArrayList<>();
        try
        {
            for (IModInfo info : ModList.get().getMods())
            {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", info.getModId());
                item.put("name", info.getDisplayName());
                item.put("version", info.getVersion().toString());
                list.add(item);
            }
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.warn("读取模组列表失败", t);
        }
        installedMods = List.copyOf(list);
        return installedMods;
    }

    private static boolean isLoaded(String id)
    {
        if (ScreenConfig.simulateMissing.contains(id)) return false;
        try { return ModList.get().isLoaded(id); }
        catch (Throwable t) { return false; }
    }

    private static String modName(String id)
    {
        for (Map<String, Object> mod : installedMods())
            if (id.equals(mod.get("id"))) return String.valueOf(mod.get("name"));
        return id;
    }
}
