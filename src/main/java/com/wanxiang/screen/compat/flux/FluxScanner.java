package com.wanxiang.screen.compat.flux;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.core.GlobalPos;

import sonar.fluxnetworks.api.device.FluxDeviceType;
import sonar.fluxnetworks.api.device.IFluxDevice;
import sonar.fluxnetworks.common.connection.FluxNetwork;
import sonar.fluxnetworks.common.connection.FluxNetworkData;
import sonar.fluxnetworks.common.connection.NetworkStatistics;

public final class FluxScanner
{
    private static final int MAX_DEVICES = 256;

    private FluxScanner() {}

    public static Map<String, Object> scan()
    {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> networks = new ArrayList<>();
        long storageBuffer = 0;
        long totalBuffer = 0;
        long input = 0;
        long output = 0;
        int devices = 0;
        int online = 0;

        try
        {
            Collection<FluxNetwork> all = FluxNetworkData.getAllNetworks();
            if (all != null)
            {
                for (FluxNetwork network : all)
                {
                    if (network == null || network == FluxNetwork.INVALID || network.getNetworkID() <= 0) continue;
                    try
                    {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("id", network.getNetworkID());
                        item.put("name", network.getNetworkName());
                        item.put("color", network.getNetworkColor());
                        item.put("owner", network.getOwnerUUID() == null ? "" : network.getOwnerUUID().toString());
                        item.put("security", network.getSecurityLevel() == null ? "" : network.getSecurityLevel().name());

                        List<Map<String, Object>> list = new ArrayList<>();
                        int nDevices = 0, nOnline = 0;
                        long nStorage = 0;
                        Collection<IFluxDevice> connections = network.getAllConnections();
                        if (connections != null)
                        {
                            for (IFluxDevice device : connections)
                            {
                                if (device == null) continue;
                                if (list.size() >= MAX_DEVICES) break;
                                Map<String, Object> dev = readDevice(device);
                                if (dev == null) continue;
                                list.add(dev);
                                nDevices++;
                                boolean loaded = Boolean.TRUE.equals(dev.get("loaded"));
                                if (loaded) nOnline++;
                                if ("STORAGE".equals(dev.get("type")))
                                {
                                    nStorage += asLong(dev.get("buffer"));
                                }
                            }
                        }
                        list.sort((a, b) -> Long.compare(asLong(b.get("buffer")), asLong(a.get("buffer"))));

                        NetworkStatistics stats = network.getStatistics();
                        Map<String, Object> stat = new LinkedHashMap<>();
                        if (stats != null)
                        {
                            stat.put("plug", stats.fluxPlugCount);
                            stat.put("point", stats.fluxPointCount);
                            stat.put("storage", stats.fluxStorageCount);
                            stat.put("controller", stats.fluxControllerCount);
                            stat.put("input", stats.energyInput);
                            stat.put("output", stats.energyOutput);
                            stat.put("totalBuffer", stats.totalBuffer);
                            stat.put("totalEnergy", stats.totalEnergy);
                            stat.put("avgTickMicro", stats.averageTickMicro);
                            List<Long> change = new ArrayList<>();
                            if (stats.energyChange != null)
                            {
                                for (int i = 0; i < stats.energyChange.size(); i++) change.add(stats.energyChange.getLong(i));
                            }
                            stat.put("change", change);
                            input += stats.energyInput;
                            output += stats.energyOutput;
                            totalBuffer += stats.totalBuffer;
                        }
                        item.put("stats", stat);
                        item.put("devices", list);
                        item.put("deviceCount", nDevices);
                        item.put("onlineDevices", nOnline);
                        item.put("storageBuffer", nStorage);
                        networks.add(item);

                        storageBuffer += nStorage;
                        devices += nDevices;
                        online += nOnline;
                    }
                    catch (Throwable t)
                    {
                        WanXiangScreen.LOGGER.warn("读取 Flux 网络 {} 失败", network.getNetworkID(), t);
                    }
                }
            }
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("读取 Flux 网络数据失败", t);
            out.put("error", String.valueOf(t.getMessage()));
        }

        out.put("installed", true);
        out.put("networks", networks);
        out.put("networkCount", networks.size());
        out.put("storageBuffer", storageBuffer);
        out.put("totalBuffer", totalBuffer);
        out.put("input", input);
        out.put("output", output);
        out.put("deviceCount", devices);
        out.put("onlineDevices", online);
        out.put("unit", "FE");
        out.put("message", networks.isEmpty()
                ? "已安装 Flux Networks，未检测到网络"
                : "已连接 " + networks.size() + " 个 Flux 网络 · 存储 " + storageBuffer + " FE");
        out.put("updatedAt", System.currentTimeMillis());
        return out;
    }

    private static Map<String, Object> readDevice(IFluxDevice device)
    {
        Map<String, Object> dev = new LinkedHashMap<>();
        try
        {
            FluxDeviceType type = device.getDeviceType();
            dev.put("type", type == null ? "UNKNOWN" : type.name());
            dev.put("loaded", device.isChunkLoaded());
            dev.put("buffer", device.getTransferBuffer());
            dev.put("change", device.getTransferChange());
            dev.put("limit", device.getMaxTransferLimit());
            dev.put("priority", device.getRawPriority());
            dev.put("name", device.getCustomName());
            dev.put("forced", device.isForcedLoading());
            dev.put("surge", device.getSurgeMode());
            GlobalPos pos = device.getGlobalPos();
            if (pos != null)
            {
                dev.put("pos", new long[] { pos.pos().getX(), pos.pos().getY(), pos.pos().getZ() });
                dev.put("dimension", pos.dimension().location().toString());
            }
            return dev;
        }
        catch (Throwable t)
        {
            return null;
        }
    }

    private static long asLong(Object value)
    {
        return value instanceof Number number ? number.longValue() : 0L;
    }
}
