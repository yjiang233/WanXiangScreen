package com.wanxiang.screen.compat.mek;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.wanxiang.screen.ChunkTracker;
import com.wanxiang.screen.WanXiangScreen;

import mekanism.api.MekanismAPI;
import mekanism.api.chemical.ChemicalStack;
import mekanism.api.chemical.IChemicalTank;
import mekanism.api.energy.IEnergyContainer;
import mekanism.api.fluid.IExtendedFluidTank;
import mekanism.api.inventory.IInventorySlot;
import mekanism.api.recipes.MekanismRecipe;
import mekanism.common.lib.multiblock.IMultiblock;
import mekanism.common.lib.multiblock.MultiblockData;
import mekanism.common.recipe.lookup.IRecipeLookupHandler;
import mekanism.common.tile.base.TileEntityMekanism;
import mekanism.common.tile.prefab.TileEntityProgressMachine;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import net.neoforged.neoforge.fluids.FluidStack;

public final class MekScanner
{
    private static final int MAX_MACHINES = 500;

    // 超过这个量级（单位 J，约 4e15 FE）只可能来自创造模式能源，正常储能到不了
    private static final double INFINITE_ENERGY = 1.0e16;

    private static final String[][] CATEGORY_RULES = {
            {"factory", "工厂机器", "_factory"},
            {"reactor", "核反应堆", "reactor"},
            {"turbine", "工业涡轮", "turbine"},
            {"structure", "多方块结构", "dynamic_", "boiler", "evaporation", "sps_", "matrix",
                    "bounding_block", "structural_glass", "superheating", "heater", "valve",
                    "port", "casing", "teleporter", "entangloporter"},
            {"processing", "加工机器", "crusher", "crushing", "enriching", "smelter", "compressor",
                    "combiner", "infuser", "infusing", "injecting", "metallurgic", "purifying",
                    "sawing", "electrolytic", "separator", "chemical_", "washer", "washing",
                    "crystallizer", "dissolver", "centrifug", "rotary", "nucleosynthesizer",
                    "isotopic", "activator", "sawmill", "formulaic", "oredictionificator",
                    "painting", "assemblicator", "condensentrator", "oxidizer"},
            {"energy", "能源与电网", "energy_cube", "universal_cable", "thermodynamic_conductor",
                    "induction_", "chargepad", "battery", "generator", "solar_", "wind_", "energy_"},
            {"storage", "储罐与仓储", "bin", "tank", "personal_chest", "security_desk", "qio_"},
            {"logistics", "物流管道", "transporter", "logistical_", "restrictive_", "diversion_",
                    "pipe", "tube", "cable"},
            {"mining", "采矿设备", "miner", "harvester", "farm"},
            {"other", "其他设备"}
    };

    public static final List<String> CATEGORY_ORDER = List.of(
            "factory", "processing", "energy", "reactor", "turbine", "structure",
            "storage", "logistics", "mining", "other");

    private static final String[] MULTIBLOCK_METRICS = {
            "getBoilEfficiency", "getMaxBurnRate", "getDamagePercent", "getPlasmaTemp",
            "getCaseTemp", "getInjectionRate", "getProductionRate", "getMaxProduction",
            "getMaxFlowRate", "getEnergyCapacity", "getSteamCapacity"};

    private MekScanner() {}

    public static List<Map<String, Object>> scan(MinecraftServer server)
    {
        List<Map<String, Object>> machines = new ArrayList<>();
        for (LevelChunk chunk : ChunkTracker.copy())
        {
            for (BlockEntity blockEntity : chunk.getBlockEntities().values())
            {
                if (!(blockEntity instanceof TileEntityMekanism tile)) continue;
                try
                {
                    Map<String, Object> machine = readMachine(tile, blockEntity);
                    if (machine != null) machines.add(machine);
                }
                catch (Throwable t)
                {
                    WanXiangScreen.LOGGER.warn("读取 Mekanism 机器 {} 失败", blockEntity.getBlockPos(), t);
                }
                if (machines.size() >= MAX_MACHINES) break;
            }
            if (machines.size() >= MAX_MACHINES) break;
        }
        machines.sort(Comparator
                .comparingInt((Map<String, Object> m) -> CATEGORY_ORDER.indexOf(String.valueOf(m.get("category"))))
                .thenComparing(m -> String.valueOf(m.get("id"))));
        return machines;
    }

    public static String categoryName(String id)
    {
        for (String[] rule : CATEGORY_RULES)
            if (rule[0].equals(id)) return rule[1];
        return id;
    }

    private static String[] categoryOf(String id)
    {
        for (String[] rule : CATEGORY_RULES)
        {
            for (int i = 2; i < rule.length; i++)
            {
                if (id.contains(rule[i])) return new String[] {rule[0], rule[1]};
            }
        }
        String[] other = CATEGORY_RULES[CATEGORY_RULES.length - 1];
        return new String[] {other[0], other[1]};
    }

    private static Map<String, Object> readMachine(TileEntityMekanism tile, BlockEntity blockEntity)
    {
        String id = BuiltInRegistries.BLOCK.getKey(blockEntity.getBlockState().getBlock()).toString();
        Map<String, Object> machine = new LinkedHashMap<>();
        machine.put("id", id);
        machine.put("name", new ItemStack(blockEntity.getBlockState().getBlock()).getHoverName().getString());
        String[] category = categoryOf(id);
        machine.put("category", category[0]);
        machine.put("categoryName", category[1]);

        BlockPos pos = blockEntity.getBlockPos();
        machine.put("pos", new long[] {pos.getX(), pos.getY(), pos.getZ()});
        try { machine.put("dimension", blockEntity.getLevel().dimension().location().toString()); }
        catch (Throwable ignored) { machine.put("dimension", "unknown"); }

        machine.put("active", tile.getActive());

        if (tile instanceof TileEntityProgressMachine<?> progress)
        {
            int ticks = progress.getOperatingTicks();
            int required = progress.getTicksRequired();
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("ticks", ticks);
            value.put("required", required);
            value.put("percent", required > 0 ? Math.min(100, Math.round(ticks * 1000.0 / required) / 10.0) : 0);
            machine.put("progress", value);
        }

        readEnergy(tile, machine, id);
        readItems(tile, machine);
        readFluids(tile, machine);
        readChemicals(tile, machine);
        readRecipe(tile, blockEntity, machine);
        readMultiblock(tile, machine);
        return machine;
    }

    private static void readEnergy(TileEntityMekanism tile, Map<String, Object> machine, String id)
    {
        try
        {
            // 用 double 累加，避免创造设备的 Long.MAX_VALUE 直接相加溢出成负数
            double stored = 0, max = 0;
            for (IEnergyContainer container : tile.getEnergyContainers(null))
            {
                if (container == null) continue;
                stored += (double) container.getEnergy();
                max += (double) container.getMaxEnergy();
            }
            if (max <= 0) return;

            Map<String, Object> value = new LinkedHashMap<>();
            if (isInfiniteSource(id, stored, max))
            {
                // 创造能量立方等无上限能源不计入统计，只标记出来供界面显示「无限」
                value.put("stored", 0);
                value.put("max", 0);
                value.put("infinite", true);
            }
            else
            {
                value.put("stored", Math.round(stored));
                value.put("max", Math.round(max));
            }
            machine.put("energy", value);
        }
        catch (Throwable ignored) {}
    }

    // 名称带 creative_，或容量远超任何正常储能，都视为无限能源
    private static boolean isInfiniteSource(String id, double stored, double max)
    {
        return id != null && (id.contains("creative_") || id.contains(":creative"))
                || stored >= INFINITE_ENERGY || max >= INFINITE_ENERGY;
    }

    private static void readItems(TileEntityMekanism tile, Map<String, Object> machine)
    {
        try
        {
            List<IInventorySlot> slots = tile.getInventorySlots(null);
            Map<String, long[]> byId = new LinkedHashMap<>();
            Map<String, String> names = new LinkedHashMap<>();
            int used = 0;
            long count = 0;
            for (IInventorySlot slot : slots)
            {
                if (slot == null) continue;
                ItemStack stack = slot.getStack();
                if (stack == null || stack.isEmpty()) continue;
                used++;
                count += stack.getCount();
                String id = BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
                long[] aggregate = byId.computeIfAbsent(id, key -> new long[2]);
                aggregate[0] += stack.getCount();
                aggregate[1]++;
                names.putIfAbsent(id, stack.getHoverName().getString());
            }

            List<Map<String, Object>> stacks = new ArrayList<>();
            byId.entrySet().stream()
                    .sorted((a, b) -> Long.compare(b.getValue()[0], a.getValue()[0]))
                    .limit(8)
                    .forEach(entry -> {
                        Map<String, Object> stack = new LinkedHashMap<>();
                        stack.put("id", entry.getKey());
                        stack.put("name", names.get(entry.getKey()));
                        stack.put("count", entry.getValue()[0]);
                        stack.put("slots", entry.getValue()[1]);
                        stacks.add(stack);
                    });

            Map<String, Object> value = new LinkedHashMap<>();
            value.put("slots", slots == null ? 0 : slots.size());
            value.put("used", used);
            value.put("count", count);
            value.put("first", byId.isEmpty() ? null : byId.keySet().iterator().next());
            value.put("types", byId.size());
            value.put("stacks", stacks);
            machine.put("items", value);
        }
        catch (Throwable ignored) {}
    }

    private static void readFluids(TileEntityMekanism tile, Map<String, Object> machine)
    {
        try
        {
            List<IExtendedFluidTank> tanks = tile.getFluidTanks(null);
            long amount = 0, capacity = 0;
            String first = null;
            for (IExtendedFluidTank tank : tanks)
            {
                if (tank == null) continue;
                amount += tank.getFluidAmount();
                capacity += tank.getCapacity();
                if (first == null && !tank.isEmpty())
                {
                    FluidStack fluid = tank.getFluid();
                    if (fluid != null && !fluid.isEmpty())
                        first = BuiltInRegistries.FLUID.getKey(fluid.getFluid()).toString();
                }
            }
            if (capacity > 0)
            {
                Map<String, Object> value = new LinkedHashMap<>();
                value.put("amount", amount);
                value.put("capacity", capacity);
                value.put("first", first);
                machine.put("fluids", value);
            }
        }
        catch (Throwable ignored) {}
    }

    private static void readChemicals(TileEntityMekanism tile, Map<String, Object> machine)
    {
        try
        {
            List<IChemicalTank> tanks = tile.getChemicalTanks(null);
            long amount = 0, capacity = 0;
            String first = null;
            for (IChemicalTank tank : tanks)
            {
                if (tank == null) continue;
                amount += tank.getStored();
                capacity += tank.getCapacity();
                if (first == null)
                {
                    ChemicalStack stack = tank.getStack();
                    if (stack != null && !stack.isEmpty())
                    {
                        var key = MekanismAPI.CHEMICAL_REGISTRY.getKey(stack.getChemical());
                        if (key != null) first = key.toString();
                    }
                }
            }
            if (capacity > 0)
            {
                Map<String, Object> value = new LinkedHashMap<>();
                value.put("amount", amount);
                value.put("capacity", capacity);
                value.put("first", first);
                machine.put("chemicals", value);
            }
        }
        catch (Throwable ignored) {}
    }

    private static void readRecipe(TileEntityMekanism tile, BlockEntity blockEntity, Map<String, Object> machine)
    {
        try
        {
            if (!(tile instanceof IRecipeLookupHandler<?> handler)) return;
            Object raw = handler.getRecipe(0);
            if (!(raw instanceof MekanismRecipe<?> recipe)) return;
            ItemStack output = recipe.getResultItem(blockEntity.getLevel().registryAccess());
            if (output != null && !output.isEmpty())
            {
                machine.put("recipeOutput", BuiltInRegistries.ITEM.getKey(output.getItem()).toString());
                machine.put("recipeName", output.getHoverName().getString());
            }
        }
        catch (Throwable ignored) {}
    }

    private static void readMultiblock(TileEntityMekanism tile, Map<String, Object> machine)
    {
        try
        {
            if (!(tile instanceof IMultiblock<?> multiblock)) return;
            Map<String, Object> value = new LinkedHashMap<>();
            MultiblockData data = multiblock.getMultiblock();
            value.put("formed", data != null && data.isFormed());
            if (data != null)
            {
                value.put("volume", data.getVolume());
                for (String name : MULTIBLOCK_METRICS)
                {
                    Number metric = numberMetric(data, name);
                    if (metric != null) value.put(name.substring(3, 4).toLowerCase() + name.substring(4), metric.doubleValue());
                }
                long stored = 0, max = 0;
                for (IEnergyContainer container : data.getEnergyContainers(null))
                {
                    if (container == null) continue;
                    stored += container.getEnergy();
                    max += container.getMaxEnergy();
                }
                if (max > 0)
                {
                    Map<String, Object> energy = new LinkedHashMap<>();
                    energy.put("stored", stored);
                    energy.put("max", max);
                    value.put("energy", energy);
                }
            }
            machine.put("multiblock", value);
        }
        catch (Throwable ignored) {}
    }

    private static Number numberMetric(Object target, String method)
    {
        try
        {
            Method m = target.getClass().getMethod(method);
            Object value = m.invoke(target);
            return value instanceof Number number ? number : null;
        }
        catch (Throwable ignored)
        {
            try
            {
                Method m = target.getClass().getDeclaredMethod(method);
                m.setAccessible(true);
                Object value = m.invoke(target);
                return value instanceof Number number ? number : null;
            }
            catch (Throwable ignored2) { return null; }
        }
    }
}
