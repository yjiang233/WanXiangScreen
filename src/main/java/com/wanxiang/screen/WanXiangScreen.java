package com.wanxiang.screen;

import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.config.ModConfig;
import net.minecraftforge.fml.event.config.ModConfigEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.level.ChunkEvent;
import net.minecraftforge.event.server.ServerStartingEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;

@Mod(WanXiangScreen.MODID)
public class WanXiangScreen
{
    public static final String MODID = "wanxiangscreen";
    public static final Logger LOGGER = LogUtils.getLogger();

    public WanXiangScreen()
    {
        ErrorLog.install();
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();
        ModLoadingContext.get().registerConfig(ModConfig.Type.COMMON, ScreenConfig.SPEC);
        modEventBus.addListener((ModConfigEvent event) -> ScreenConfig.reload());
        MinecraftForge.EVENT_BUS.register(this);
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
    public void onServerTick(TickEvent.ServerTickEvent event)
    {
        if (event.phase != TickEvent.Phase.END) return;
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
