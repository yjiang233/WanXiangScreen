package com.wanxiang.screen;

import java.util.Map;

import net.minecraft.server.MinecraftServer;

public interface ScreenModule
{
    Map<String, Object> snapshot(MinecraftServer server);
}
