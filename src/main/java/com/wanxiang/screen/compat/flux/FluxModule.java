package com.wanxiang.screen.compat.flux;

import java.util.Map;

import com.wanxiang.screen.ScreenModule;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.server.MinecraftServer;

public final class FluxModule implements ScreenModule
{
    @Override
    public Map<String, Object> snapshot(MinecraftServer server)
    {
        try
        {
            return FluxScanner.scan();
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("Flux 模块快照失败", t);
            return Map.of("installed", true, "networks", java.util.List.of(),
                    "message", "Flux 数据读取失败：" + t.getMessage(), "storageBuffer", 0);
        }
    }
}
