package com.wanxiang.screen.compat.ae2;

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
            out.put("message", grids.isEmpty() ? "已安装AE2，未检测到 ME 网络" : "已连接 " + grids.size() + " 个 ME 网络");
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("读取 AE2 网络失败", t);
            out.put("grids", List.of());
            out.put("message", "AE2 数据读取失败：" + t.getMessage());
        }
        out.put("updatedAt", System.currentTimeMillis());
        return out;
    }
}
