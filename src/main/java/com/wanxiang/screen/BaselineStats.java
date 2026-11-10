package com.wanxiang.screen;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.server.MinecraftServer;

/**
 * 顶部基础数据看板：电网存量、每 tick 耗电、物品每 tick 净吞吐。
 * 口径：电网只统计 Flux Networks 储能 + Mekanism「能源与电网」类设备，不读 AE 能量，也不读机器内置缓冲。
 */
public final class BaselineStats
{
    private static final double EMA = 0.5;
    private static final double IDLE = 5;

    // 安全上限，正常储能远低于此值（1e15 FE 已是天文数字）
    private static final long MAX_ENERGY = 1_000_000_000_000_000L;

    private static long lastTick = -1;
    private static long lastStored;
    private static long lastItems;
    private static double drawPerTick;
    private static double gainPerTick;
    private static double lossPerTick;
    private static Double forgeRate;

    private BaselineStats() {}

    public static Map<String, Object> compute(MinecraftServer server, Map<String, Object> data)
    {
        long fluxFe = clamp(asLong(map(data.get("fluxnetworks")).get("storageBuffer")));
        int fluxNetworks = (int) asLong(map(data.get("fluxnetworks")).get("networkCount"));
        int fluxDevices = (int) asLong(map(data.get("fluxnetworks")).get("deviceCount"));

        long mekJ = 0;
        long mekCapJ = 0;
        int mekDevices = 0;
        int infiniteDevices = 0;
        Map<String, Object> mek = map(data.get("mekanism"));
        if (mek.get("machines") instanceof List<?> machines)
        {
            for (Object raw : machines)
            {
                Map<String, Object> machine = map(raw);
                if (!"energy".equals(String.valueOf(machine.get("category")))) continue;
                long stored = 0;
                long max = 0;
                Map<String, Object> energy = map(machine.get("energy"));
                if (energy.isEmpty()) energy = map(map(machine.get("multiblock")).get("energy"));
                if (!energy.isEmpty())
                {
                    // 创造能量立方这类无限能源不计入电网总量，否则会撑爆数值
                    if (Boolean.TRUE.equals(energy.get("infinite")))
                    {
                        infiniteDevices++;
                        continue;
                    }
                    stored = clamp(asLong(energy.get("stored")));
                    max = clamp(asLong(energy.get("max")));
                }
                if (max <= 0 && stored <= 0) continue;
                mekJ = safeAdd(mekJ, stored);
                mekCapJ = safeAdd(mekCapJ, max);
                mekDevices++;
            }
        }

        double rate = forgeRate();
        long mekFe = clamp(Math.round(mekJ / rate));
        long mekCapFe = clamp(Math.round(mekCapJ / rate));
        long stored = safeAdd(fluxFe, mekFe);

        long items = 0;
        String itemSource = "none";
        Map<String, Object> ae2 = map(data.get("ae2"));
        if (ae2.get("grids") instanceof List<?> grids && !grids.isEmpty())
        {
            long sum = 0;
            for (Object raw : grids) sum += asLong(map(raw).get("totalAmount"));
            items = sum;
            itemSource = "ae2";
        }
        else if (mek.get("machines") instanceof List<?> machines)
        {
            long sum = 0;
            for (Object raw : machines)
            {
                Map<String, Object> item = map(map(raw).get("items"));
                sum += asLong(item.get("count"));
            }
            items = sum;
            if (sum > 0) itemSource = "mekanism";
        }

        long tick = server == null ? 0 : server.getTickCount();
        if (lastTick >= 0 && tick > lastTick)
        {
            double delta = tick - lastTick;
            drawPerTick = drawPerTick * (1 - EMA) + (lastStored - stored) / delta * EMA;

            // 物品分成「增加」和「减少」两条曲线，不再只给净变化
            long diff = items - lastItems;
            double gain = diff > 0 ? diff / delta : 0;
            double loss = diff < 0 ? -diff / delta : 0;
            gainPerTick = gainPerTick * (1 - EMA) + gain * EMA;
            lossPerTick = lossPerTick * (1 - EMA) + loss * EMA;
        }
        lastTick = tick;
        lastStored = stored;
        lastItems = items;

        if (Math.abs(drawPerTick) < IDLE) drawPerTick = 0;
        if (gainPerTick < 0.05) gainPerTick = 0;
        if (lossPerTick < 0.05) lossPerTick = 0;

        List<Map<String, Object>> sources = new ArrayList<>();
        if (fluxFe > 0 || fluxDevices > 0)
            sources.add(source("flux", "通量网络", fluxFe, fluxDevices > 0 ? fluxNetworks + " 网 · " + fluxDevices + " 台" : "未检测到设备"));
        if (mekFe > 0 || mekDevices > 0)
        {
            String note = mekDevices > 0 ? mekDevices + " 台储能设备" : "未检测到设备";
            if (infiniteDevices > 0) note += " · " + infiniteDevices + " 台创造设备未计入";
            sources.add(source("mekanism", "Mekanism 电网", mekFe, note));
        }
        if (sources.isEmpty())
        {
            sources.add(source("none", "未检测到储能设备", 0,
                    infiniteDevices > 0 ? infiniteDevices + " 台创造设备未计入统计" : "放置能量立方、感应矩阵或 Flux 储能"));
        }

        Map<String, Object> power = new LinkedHashMap<>();
        power.put("stored", stored);
        power.put("unit", "FE");
        power.put("flow", fluxFe);
        power.put("mek", mekFe);
        power.put("mekCapacity", mekCapFe);
        power.put("mekDevices", mekDevices);
        power.put("infiniteDevices", infiniteDevices);
        power.put("fluxDevices", fluxDevices);
        power.put("fluxNetworks", fluxNetworks);
        power.put("sources", sources);

        Map<String, Object> draw = new LinkedHashMap<>();
        draw.put("perTick", Math.round(drawPerTick));
        draw.put("unit", "FE/t");
        draw.put("trend", drawPerTick > 0 ? "drain" : drawPerTick < 0 ? "charge" : "idle");

        Map<String, Object> itemFlow = new LinkedHashMap<>();
        itemFlow.put("gain", Math.round(gainPerTick * 10) / 10.0);
        itemFlow.put("loss", Math.round(lossPerTick * 10) / 10.0);
        itemFlow.put("unit", "个/t");
        itemFlow.put("source", itemSource);
        itemFlow.put("total", items);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("power", power);
        out.put("draw", draw);
        out.put("items", itemFlow);
        out.put("sampleTicks", lastTick >= 0 ? 20 : 0);
        out.put("updatedAt", System.currentTimeMillis());
        return out;
    }

    private static Map<String, Object> source(String id, String name, long value, String note)
    {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id);
        item.put("name", name);
        item.put("value", value);
        item.put("note", note);
        return item;
    }

    // Mekanism 内部单位是 J，1 FE = forgeConversionRate J，运行时读配置，读不到按 2.5
    private static double forgeRate()
    {
        if (forgeRate != null) return forgeRate;
        try
        {
            Class<?> config = Class.forName("mekanism.common.config.MekanismConfig");
            Object general = config.getField("general").get(null);
            Object value = general.getClass().getField("forgeConversionRate").get(general);
            Object number = value.getClass().getMethod("get").invoke(value);
            double parsed = ((Number) number).doubleValue();
            if (parsed > 0) forgeRate = parsed;
        }
        catch (Throwable ignored) {}
        if (forgeRate == null) forgeRate = 2.5;
        return forgeRate;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value)
    {
        return value instanceof Map<?, ?> raw ? (Map<String, Object>) raw : Map.of();
    }

    private static long asLong(Object value)
    {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    // 单台设备的异常巨大值先截断，避免后续换算与累加溢出
    private static long clamp(long value)
    {
        if (value > MAX_ENERGY) return MAX_ENERGY;
        if (value < -MAX_ENERGY) return -MAX_ENERGY;
        return value;
    }

    private static long safeAdd(long a, long b)
    {
        long result = a + b;
        if (((a ^ result) & (b ^ result)) < 0) return a > 0 ? MAX_ENERGY : -MAX_ENERGY;
        return result;
    }
}
