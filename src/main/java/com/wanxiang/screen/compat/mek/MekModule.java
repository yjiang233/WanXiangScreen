package com.wanxiang.screen.compat.mek;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.wanxiang.screen.ScreenModule;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.server.MinecraftServer;

public final class MekModule implements ScreenModule
{
    @Override
    public Map<String, Object> snapshot(MinecraftServer server)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("installed", true);
        try
        {
            List<Map<String, Object>> machines = MekScanner.scan(server);
            Map<String, Map<String, Object>> categories = new LinkedHashMap<>();
            int running = 0;
            for (Map<String, Object> machine : machines)
            {
                boolean active = Boolean.TRUE.equals(machine.get("active"));
                if (active) running++;
                String id = String.valueOf(machine.get("category"));
                Map<String, Object> category = categories.computeIfAbsent(id, key -> {
                    Map<String, Object> value = new LinkedHashMap<>();
                    value.put("id", key);
                    value.put("name", MekScanner.categoryName(key));
                    value.put("total", 0);
                    value.put("running", 0);
                    return value;
                });
                category.put("total", ((Number) category.get("total")).intValue() + 1);
                if (active) category.put("running", ((Number) category.get("running")).intValue() + 1);
            }
            List<Map<String, Object>> ordered = new ArrayList<>();
            for (String id : MekScanner.CATEGORY_ORDER)
            {
                Map<String, Object> category = categories.remove(id);
                if (category != null) ordered.add(category);
            }
            ordered.addAll(categories.values());

            out.put("machines", machines);
            out.put("categories", ordered);
            out.put("total", machines.size());
            out.put("running", running);
            out.put("message", machines.isEmpty()
                    ? "已安装Mekanism，未发现已加载区块内的机器"
                    : "已发现 " + machines.size() + " 台机器 · " + running + " 台运行中");
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("读取 Mekanism 机器失败", t);
            out.put("machines", List.of());
            out.put("categories", List.of());
            out.put("total", 0);
            out.put("running", 0);
            out.put("message", "Mekanism 数据读取失败：" + t.getMessage());
        }
        out.put("updatedAt", System.currentTimeMillis());
        return out;
    }
}
