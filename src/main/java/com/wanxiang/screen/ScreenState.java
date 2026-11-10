package com.wanxiang.screen;

import java.util.Map;

import net.minecraft.server.MinecraftServer;

public final class ScreenState
{
    private static volatile Map<String, Object> snapshot = ModuleRegistry.build(null);
    private static volatile MinecraftServer server = null;
    private static int ticks = 0;

    private ScreenState() {}

    public static void attach(MinecraftServer value)
    {
        server = value;
        ticks = ScreenConfig.refreshTicks;
    }

    public static void detach()
    {
        server = null;
        snapshot = ModuleRegistry.build(null);
    }

    public static void tick(MinecraftServer value)
    {
        if (server == null) return;
        if (ticks++ % Math.max(5, ScreenConfig.refreshTicks) != 0) return;
        try
        {
            snapshot = ModuleRegistry.build(value);
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("万象屏快照生成失败", t);
        }
    }

    public static Map<String, Object> get() { return snapshot; }

    public static MinecraftServer server() { return server; }
}
