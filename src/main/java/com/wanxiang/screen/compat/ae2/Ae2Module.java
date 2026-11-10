package com.wanxiang.screen.compat.ae2;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.wanxiang.screen.ScreenModule;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.server.MinecraftServer;

public final class Ae2Module implements ScreenModule
{
    private long lastTick = -1;
    private Map<String, Long> lastAmounts = Map.of();

    @Override
    public Map<String, Object> snapshot(MinecraftServer server)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("installed", true);
        try
        {
            List<Map<String, Object>> grids = Ae2GridScanner.scan(server);
            applyRates(grids, server);
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

    // 按采样周期做差分，得到每种物品每 tick 的净变化，用于详情面板的吞吐量
    private void applyRates(List<Map<String, Object>> grids, MinecraftServer server)
    {
        Map<String, Long> now = new HashMap<>();
        for (Map<String, Object> grid : grids)
        {
            if (!(grid.get("entries") instanceof List<?> entries)) continue;
            for (Object raw : entries)
            {
                if (!(raw instanceof Map<?, ?> entry)) continue;
                Object id = entry.get("id");
                if (id == null || !(entry.get("amount") instanceof Number amount)) continue;
                now.merge(id.toString(), amount.longValue(), Long::sum);
            }
        }

        long tick = server == null ? 0 : server.getTickCount();
        double delta = tick - lastTick;
        boolean comparable = lastTick >= 0 && delta > 0;

        for (Map<String, Object> grid : grids)
        {
            if (!(grid.get("entries") instanceof List<?> entries)) continue;
            for (Object raw : entries)
            {
                if (!(raw instanceof Map)) continue;
                @SuppressWarnings("unchecked")
                Map<String, Object> entry = (Map<String, Object>) raw;
                Object id = entry.get("id");
                if (id == null || !(entry.get("amount") instanceof Number amount)) continue;
                Long previous = lastAmounts.get(id.toString());
                double rate = 0;
                if (comparable && previous != null) rate = (amount.longValue() - previous) / delta;
                entry.put("rate", Math.round(rate * 100) / 100.0);
            }
        }

        lastTick = tick;
        lastAmounts = now;
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
