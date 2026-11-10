package com.wanxiang.screen.compat.ae2;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.wanxiang.screen.ScreenModule;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.server.MinecraftServer;

public final class Ae2Module implements ScreenModule
{
    @Override
    public Map<String, Object> snapshot(MinecraftServer server)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("installed", true);
        try
        {
            List<Map<String, Object>> grids = Ae2GridScanner.scan(server);
            out.put("grids", grids);
            out.put("drives", countDrives(grids));
            out.put("cellSummary", summarizeCells(grids));
            out.put("message", grids.isEmpty() ? "已安装AE2，未检测到 ME 网络" : "已连接 " + grids.size() + " 个 ME 网络");
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("读取 AE2 网络失败", t);
            out.put("grids", List.of());
            out.put("drives", 0);
            out.put("cellSummary", List.of());
            out.put("message", "AE2 数据读取失败：" + t.getMessage());
        }
        out.put("updatedAt", System.currentTimeMillis());
        return out;
    }

    private static int countDrives(List<Map<String, Object>> grids)
    {
        int count = 0;
        for (Map<String, Object> grid : grids)
        {
            if (grid.get("drives") instanceof List<?> list) count += list.size();
        }
        return count;
    }

    private static List<Map<String, Object>> summarizeCells(List<Map<String, Object>> grids)
    {
        Map<String, Map<String, Object>> summary = new LinkedHashMap<>();
        for (Map<String, Object> grid : grids)
        {
            if (!(grid.get("drives") instanceof List<?> drives)) continue;
            for (Object drive : drives)
            {
                if (!(drive instanceof Map<?, ?> driveMap) || !(driveMap.get("cells") instanceof List<?> cells)) continue;
                for (Object cell : cells)
                {
                    if (!(cell instanceof Map<?, ?> cellMap)) continue;
                    Object id = cellMap.get("id");
                    if (id == null) continue;
                    Map<String, Object> entry = summary.computeIfAbsent(id.toString(), key -> {
                        Map<String, Object> value = new LinkedHashMap<>();
                        value.put("id", key);
                        value.put("name", cellMap.get("name"));
                        value.put("count", 0);
                        return value;
                    });
                    entry.put("count", ((Number) entry.get("count")).intValue() + 1);
                }
            }
        }
        return new ArrayList<>(summary.values());
    }
}
