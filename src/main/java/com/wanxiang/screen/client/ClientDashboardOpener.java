package com.wanxiang.screen.client;

import com.wanxiang.screen.ScreenConfig;
import com.wanxiang.screen.ScreenHttpServer;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.Util;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;

// 进入世界就顺手把看板打开，省得每次翻书签
@EventBusSubscriber(modid = WanXiangScreen.MODID, value = Dist.CLIENT)
public final class ClientDashboardOpener
{
    private ClientDashboardOpener() {}

    @SubscribeEvent
    public static void onJoin(ClientPlayerNetworkEvent.LoggingIn event)
    {
        if (!ScreenConfig.openBrowserOnJoin) return;
        int port = ScreenHttpServer.port();
        if (port <= 0) return;
        try
        {
            Util.getPlatform().openUri("http://127.0.0.1:" + port + "/");
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.warn("自动打开看板失败", t);
        }
    }
}
