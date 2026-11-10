package com.wanxiang.screen.compat.ae2;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import appeng.api.implementations.blockentities.IChestOrDrive;
import appeng.api.networking.IGrid;
import appeng.api.networking.IGridNode;
import appeng.api.networking.crafting.CraftingJobStatus;
import appeng.api.networking.crafting.ICraftingCPU;
import appeng.api.networking.security.IActionHost;
import appeng.api.stacks.AEKey;
import appeng.api.stacks.AmountFormat;
import appeng.api.stacks.KeyCounter;

import com.wanxiang.screen.ChunkTracker;
import com.wanxiang.screen.WanXiangScreen;

import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;

public final class Ae2GridScanner
{
    private static final int MAX_ENTRIES = 1000;
    private static final long INFINITE_BYTES = 1_000_000_000_000_000L;
    // 最近一次扫描的网格引用，供合成接口按 id 找回对应网络（只在主线程读写）
    private static final Map<String, IGrid> GRIDS = new ConcurrentHashMap<>();

    private Ae2GridScanner() {}

    public static IGrid findGrid(String id)
    {
        return id == null ? null : GRIDS.get(id);
    }

    public static List<Map<String, Object>> scan(MinecraftServer server)
    {
        Map<IGrid, Boolean> grids = new IdentityHashMap<>();
        Map<IGrid, List<Map<String, Object>>> drives = new IdentityHashMap<>();
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
                if (blockEntity instanceof IChestOrDrive drive)
                {
                    drives.computeIfAbsent(grid, key -> new ArrayList<>()).add(readDrive(drive, blockEntity));
                }
            }
        }

        List<IGrid> ordered = new ArrayList<>(grids.keySet());
        ordered.sort(Comparator.comparing(Ae2GridScanner::sortKey));
        GRIDS.clear();
        List<Map<String, Object>> result = new ArrayList<>();
        int index = 0;
        for (IGrid grid : ordered)
        {
            String id = "grid-" + (++index);
            GRIDS.put(id, grid);
            try { result.add(readGrid(grid, id, drives.getOrDefault(grid, List.of()))); }
            catch (Throwable t) { WanXiangScreen.LOGGER.warn("读取单个 ME 网络失败", t); }
        }
        return result;
    }

    // 按枢轴坐标排序，保证多次扫描的 grid-N 编号稳定
    private static String sortKey(IGrid grid)
    {
        try
        {
            IGridNode pivot = grid.getPivot();
            if (pivot == null) return "~";
            ServerLevel level = pivot.getLevel();
            String dim = level == null ? "" : level.dimension().location().toString();
            if (pivot.getOwner() instanceof BlockEntity blockEntity)
            {
                BlockPos pos = blockEntity.getBlockPos();
                return String.format("%s|%09d|%09d|%09d", dim, pos.getX() + 30000000, pos.getY() + 30000000, pos.getZ() + 30000000);
            }
            return dim;
        }
        catch (Throwable t)
        {
            return "~";
        }
    }

    private static Map<String, Object> readDrive(IChestOrDrive drive, BlockEntity blockEntity)
    {
        Map<String, Object> info = new LinkedHashMap<>();
        try { info.put("block", BuiltInRegistries.BLOCK.getKey(blockEntity.getBlockState().getBlock()).toString()); }
        catch (Throwable ignored) { info.put("block", ""); }
        BlockPos pos = blockEntity.getBlockPos();
        info.put("pos", new long[] { pos.getX(), pos.getY(), pos.getZ() });
        try { info.put("dimension", blockEntity.getLevel().dimension().location().toString()); }
        catch (Throwable ignored) { info.put("dimension", "unknown"); }
        try { info.put("powered", drive.isPowered()); }
        catch (Throwable ignored) { info.put("powered", false); }
        long priority = longOf(blockEntity, "getPriority");
        if (priority >= 0) info.put("priority", priority);

        int slots = 10;
        try { slots = drive.getCellCount(); } catch (Throwable ignored) {}
        List<Map<String, Object>> cells = new ArrayList<>();
        for (int i = 0; i < slots; i++)
        {
            Map<String, Object> cell = new LinkedHashMap<>();
            cell.put("slot", i);
            try { cell.put("state", drive.getCellStatus(i).name()); }
            catch (Throwable ignored) { cell.put("state", "ABSENT"); }
            try { cell.put("blinking", drive.isCellBlinking(i)); }
            catch (Throwable ignored) { cell.put("blinking", false); }
            try
            {
                Item item = drive.getCellItem(i);
                if (item != null)
                {
                    cell.put("id", BuiltInRegistries.ITEM.getKey(item).toString());
                    cell.put("name", new ItemStack(item).getHoverName().getString());
                    Object inventory = drive.getOriginalCellInventory(i);
                    long used = longOf(inventory, "getUsedBytes");
                    long total = longOf(inventory, "getTotalBytes");
                    long types = longOf(inventory, "getStoredItemTypes");
                    long count = longOf(inventory, "getStoredItemCount");
                    if (used < 0 || count < 0)
                    {
                        try
                        {
                            KeyCounter stacks = drive.getCellInventory(i).getAvailableStacks();
                            long sum = 0, kinds = 0;
                            for (var entry : stacks)
                            {
                                if (entry.getKey() != null && entry.getLongValue() > 0)
                                {
                                    kinds++;
                                    sum += entry.getLongValue();
                                }
                            }
                            if (types < 0) types = kinds;
                            if (count < 0) count = sum;
                        }
                        catch (Throwable ignored) {}
                    }
                    if (used >= 0) cell.put("usedBytes", used);
                    // 无限元件（创造元件 / 附属模组的无限元件）容量是 Long.MAX_VALUE，避免前端算出天文数字
                    if (total >= 0)
                    {
                        if (total >= INFINITE_BYTES) cell.put("infinite", true);
                        else cell.put("totalBytes", total);
                    }
                    if (types >= 0) cell.put("types", types);
                    if (count >= 0) cell.put("count", count);
                }
            }
            catch (Throwable t) { WanXiangScreen.LOGGER.warn("读取驱动器槽位 {} 失败", i, t); }
            cells.add(cell);
        }
        info.put("cells", cells);
        return info;
    }

    private static long longOf(Object target, String method)
    {
        if (target == null) return -1;
        try
        {
            Method m = target.getClass().getMethod(method);
            Object value = m.invoke(target);
            return value instanceof Number number ? number.longValue() : -1;
        }
        catch (Throwable ignored)
        {
            try
            {
                Method m = target.getClass().getDeclaredMethod(method);
                m.setAccessible(true);
                Object value = m.invoke(target);
                return value instanceof Number number ? number.longValue() : -1;
            }
            catch (Throwable ignored2) { return -1; }
        }
    }

    private static Map<String, Object> readGrid(IGrid grid, String id, List<Map<String, Object>> drives)
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
            item.put("perUnit", key.getAmountPerUnit());
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
        info.put("drives", drives);
        info.put("crafting", readCrafting(crafting));
        return info;
    }

    // 合成逻辑藏在 ICraftingCPU 的实现里，走反射拿真实进度（公开 API 的数字是坏的）
    private static Object craftingLogic(ICraftingCPU cpu)
    {
        try
        {
            Class<?> type = cpu.getClass();
            while (type != null)
            {
                for (String name : new String[] { "craftingLogic", "logic" })
                {
                    try
                    {
                        var field = type.getDeclaredField(name);
                        field.setAccessible(true);
                        Object value = field.get(cpu);
                        if (value != null) return value;
                    }
                    catch (NoSuchFieldException ignored) {}
                }
                type = type.getSuperclass();
            }
        }
        catch (Throwable ignored) {}
        return null;
    }

    private static Float jobProgress(ICraftingCPU cpu)
    {
        try
        {
            Object logic = craftingLogic(cpu);
            if (logic == null) return null;
            Object tracker = logic.getClass().getMethod("getElapsedTimeTracker").invoke(logic);
            if (tracker == null) return null;
            Object value = tracker.getClass().getMethod("getProgress").invoke(tracker);
            if (value instanceof Number number)
            {
                float ratio = number.floatValue();
                return Float.isFinite(ratio) ? ratio : null;
            }
        }
        catch (Throwable ignored) {}
        return null;
    }

    private static Long jobRemaining(ICraftingCPU cpu, AEKey what)
    {
        try
        {
            Object logic = craftingLogic(cpu);
            if (logic == null || what == null) return null;
            Object value = logic.getClass().getMethod("getWaitingFor", AEKey.class).invoke(logic, what);
            return value instanceof Number number ? number.longValue() : null;
        }
        catch (Throwable ignored) {}
        return null;
    }

    // 合成 CPU 的当前任务，供看板「关注」栏显示进度
    private static Map<String, Object> readCrafting(appeng.api.networking.crafting.ICraftingService crafting)
    {
        Map<String, Object> summary = new LinkedHashMap<>();
        List<Map<String, Object>> cpus = new ArrayList<>();
        int busy = 0;
        try
        {
            if (crafting != null)
            {
                int index = 0;
                for (ICraftingCPU cpu : crafting.getCpus())
                {
                    index++;
                    // 单个 CPU 读失败不能影响整张列表，未命名 CPU 的 getName() 会返回 null
                    try
                    {
                        Map<String, Object> entry = new LinkedHashMap<>();
                        entry.put("index", index - 1);
                        Component name = cpu.getName();
                        entry.put("name", name == null || name.getString().isBlank() ? "CPU #" + index : name.getString());
                        entry.put("busy", cpu.isBusy());
                        entry.put("coprocessors", cpu.getCoProcessors());
                        entry.put("storage", cpu.getAvailableStorage());
                        if (cpu.isBusy())
                        {
                            busy++;
                            CraftingJobStatus status = cpu.getJobStatus();
                            if (status != null && status.crafting() != null)
                            {
                                AEKey what = status.crafting().what();
                                Map<String, Object> job = new LinkedHashMap<>();
                                job.put("id", what.getId().toString());
                                job.put("name", what.getDisplayName().getString());
                                // AE2 1.21 的 getStartItemCount() 是硬编码 2147483647，
                                // 所以 totalItems/progress 两个数字全是假的，真实进度只有 getProgress() 的 float
                                Float ratio = jobProgress(cpu);
                                if (ratio != null) job.put("percent", Math.round(Math.max(0f, Math.min(1f, ratio)) * 100));
                                Long remaining = jobRemaining(cpu, what);
                                if (remaining != null && remaining >= 0) job.put("remaining", remaining);
                                job.put("elapsedMs", status.elapsedTimeNanos() / 1_000_000);
                                entry.put("job", job);
                            }
                        }
                        cpus.add(entry);
                    }
                    catch (Throwable ignored)
                    {
                        cpus.add(Map.of("name", "CPU #" + index, "busy", false, "coprocessors", 0, "storage", 0));
                    }
                }
            }
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.debug("读取合成 CPU 状态失败", t);
        }
        summary.put("cpus", cpus);
        summary.put("busy", busy);
        summary.put("total", cpus.size());
        return summary;
    }
}
