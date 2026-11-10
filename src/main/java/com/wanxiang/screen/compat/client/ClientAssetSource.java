package com.wanxiang.screen.compat.client;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;

import com.wanxiang.screen.AssetSource;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.material.Fluid;
import net.minecraft.world.level.material.Fluids;
import net.minecraftforge.client.extensions.common.IClientFluidTypeExtensions;
import net.minecraftforge.fluids.FluidStack;

// 只在客户端加载：把流体的原生 still 贴图和染色暴露给网页看板
public final class ClientAssetSource implements AssetSource
{
    private volatile Map<String, Object> fluidCache;

    @Override
    public Map<String, Object> fluidInfo()
    {
        Map<String, Object> cached = fluidCache;
        if (cached != null) return cached;

        Map<String, Object> out = new LinkedHashMap<>();
        try
        {
            for (Fluid fluid : BuiltInRegistries.FLUID)
            {
                if (fluid == Fluids.EMPTY) continue;
                ResourceLocation id = BuiltInRegistries.FLUID.getKey(fluid);
                if (id == null) continue;
                try
                {
                    IClientFluidTypeExtensions ext = IClientFluidTypeExtensions.of(fluid);
                    FluidStack stack = new FluidStack(fluid, 1000);
                    ResourceLocation still = ext.getStillTexture(stack);
                    Map<String, Object> info = new LinkedHashMap<>();
                    if (still != null && still.getPath() != null && !still.getPath().isBlank())
                    {
                        info.put("tex", "/api/tex/" + still.getNamespace() + "/" + still.getPath());
                    }
                    int argb = ext.getTintColor(stack);
                    if ((argb >>> 24) == 0) argb |= 0xFF000000;
                    info.put("tint", String.format("#%02x%02x%02x", (argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF));
                    if (!info.isEmpty()) out.put(id.toString(), info);
                }
                catch (Throwable ignored) {}
            }
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.debug("读取流体贴图信息失败", t);
        }
        fluidCache = out;
        return out;
    }

    @Override
    public byte[] texture(String namespace, String path)
    {
        try
        {
            ResourceLocation location = new ResourceLocation(namespace, "textures/" + path + ".png");
            var resource = Minecraft.getInstance().getResourceManager().getResource(location);
            if (resource.isEmpty()) return null;
            try (InputStream in = resource.get().open())
            {
                return in.readAllBytes();
            }
        }
        catch (Throwable t)
        {
            return null;
        }
    }
}
