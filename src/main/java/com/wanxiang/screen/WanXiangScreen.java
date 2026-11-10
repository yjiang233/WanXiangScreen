package com.wanxiang.screen;

import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.chunk.LevelChunk;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.fml.event.config.ModConfigEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.level.ChunkEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

@Mod(WanXiangScreen.MODID)
public class WanXiangScreen
{
    public static final String MODID = "wanxiangscreen";
    public static final Logger LOGGER = LogUtils.getLogger();

    public WanXiangScreen(IEventBus modEventBus, ModContainer container)
    {
        ErrorLog.install();
        container.registerConfig(ModConfig.Type.COMMON, ScreenConfig.SPEC);
        modEventBus.addListener((ModConfigEvent event) -> ScreenConfig.reload());
        NeoForge.EVENT_BUS.register(this);
        ScreenHttpServer.start();
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event)
    {
        ScreenState.attach(event.getServer());
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event)
    {
        ScreenState.detach();
        ChunkTracker.clear();
    }

    @SubscribeEvent
    public void onServerTick(ServerTickEvent.Post event)
    {
        ServerThread.drain();
        ScreenState.tick(event.getServer());
    }

    @SubscribeEvent
    public void onChunkLoad(ChunkEvent.Load event)
    {
        if (event.getLevel() instanceof ServerLevel && event.getChunk() instanceof LevelChunk chunk)
            ChunkTracker.add(chunk);
    }

    @SubscribeEvent
    public void onChunkUnload(ChunkEvent.Unload event)
    {
        if (event.getChunk() instanceof LevelChunk chunk)
            ChunkTracker.remove(chunk);
    }
}
