package com.wanxiang.screen.compat.ae2;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import appeng.api.networking.IGrid;
import appeng.api.networking.IGridNode;
import appeng.api.networking.security.IActionHost;
import appeng.api.stacks.AEKey;
import appeng.api.stacks.AmountFormat;
import appeng.api.stacks.KeyCounter;

import com.wanxiang.screen.ChunkTracker;

import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;

public final class Ae2GridScanner
{
    private static final int MAX_ENTRIES = 1000;

    private Ae2GridScanner() {}

    // 只允许在服务端主线程调用
    public static List<Map<String, Object>> scan(MinecraftServer server)
    {
        Map<IGrid, Boolean> grids = new IdentityHashMap<>();
        for (LevelChunk chunk : ChunkTracker.copy())
        {
            for (BlockEntity blockEntity : chunk.getBlockEntities().values())
            {
                if (!(blockEntity instanceof IActionHost host)) continue;
                IGridNode node = host.getActionableNode();
                if (node == null) continue;
                IGrid grid = node.getGrid();
                if (grid == null || grid.isEmpty()) continue;
                grids.putIfAbsent(grid, Boolean.TRUE);
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        int index = 0;
        for (IGrid grid : grids.keySet())
        {
            try { result.add(readGrid(grid, "grid-" + (++index))); }
            catch (Throwable t) { com.wanxiang.screen.WanXiangScreen.LOGGER.warn("读取单个 ME 网络失败", t); }
        }
        return result;
    }

    private static Map<String, Object> readGrid(IGrid grid, String id)
    {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("id", id);
        info.put("nodes", grid.size());

        IGridNode pivot = grid.getPivot();
        String dimension = "unknown";
        long[] position = null;
        if (pivot != null)
        {
            ServerLevel level = pivot.getLevel();
            if (level != null) dimension = level.dimension().location().toString();
            if (pivot.getOwner() instanceof BlockEntity blockEntity)
            {
                BlockPos pos = blockEntity.getBlockPos();
                position = new long[] { pos.getX(), pos.getY(), pos.getZ() };
            }
        }
        info.put("dimension", dimension);
        info.put("pos", position);

        try
        {
            var energy = grid.getEnergyService();
            if (energy != null)
            {
                info.put("powered", energy.isNetworkPowered());
                info.put("storedPower", Math.round(energy.getStoredPower() * 100) / 100.0);
                info.put("maxPower", Math.round(energy.getMaxStoredPower() * 100) / 100.0);
                info.put("avgUsage", Math.round(energy.getAvgPowerUsage() * 100) / 100.0);
            }
        }
        catch (Throwable ignored) {}

        var crafting = grid.getCraftingService();
        KeyCounter inventory = grid.getStorageService().getCachedInventory();

        List<Map<String, Object>> entries = new ArrayList<>();
        long totalAmount = 0;
        for (var entry : inventory)
        {
            AEKey key = entry.getKey();
            long amount = entry.getLongValue();
            if (key == null || amount <= 0) continue;

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", key.getId().toString());
            item.put("name", key.getDisplayName().getString());
            item.put("mod", key.getModId());
            item.put("type", key.getType().getId().toString());
            item.put("amount", amount);
            item.put("unit", key.getUnitSymbol() == null ? "" : key.getUnitSymbol());
            item.put("formatted", key.formatAmount(amount, AmountFormat.FULL));
            boolean craftable = false;
            try { craftable = crafting != null && crafting.isCraftable(key); } catch (Throwable ignored) {}
            item.put("craftable", craftable);
            entries.add(item);
            totalAmount += amount;
        }
        entries.sort((a, b) -> Long.compare((Long) b.get("amount"), (Long) a.get("amount")));

        info.put("totalTypes", entries.size());
        info.put("totalAmount", totalAmount);
        info.put("entries", entries.size() > MAX_ENTRIES ? entries.subList(0, MAX_ENTRIES) : entries);
        return info;
    }
}
