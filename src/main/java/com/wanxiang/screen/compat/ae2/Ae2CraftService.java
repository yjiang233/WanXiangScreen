package com.wanxiang.screen.compat.ae2;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import appeng.api.networking.IGrid;
import appeng.api.networking.IGridNode;
import appeng.api.networking.crafting.CalculationStrategy;
import appeng.api.networking.crafting.CraftingSubmitErrorCode;
import appeng.api.networking.crafting.ICraftingCPU;
import appeng.api.networking.crafting.ICraftingPlan;
import appeng.api.networking.crafting.ICraftingService;
import appeng.api.networking.crafting.ICraftingSimulationRequester;
import appeng.api.networking.crafting.ICraftingSubmitResult;
import appeng.api.networking.security.IActionSource;
import appeng.api.stacks.AEItemKey;
import appeng.api.stacks.KeyCounter;

import com.wanxiang.screen.ServerThread;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

public final class Ae2CraftService
{
    private Ae2CraftService() {}

    public static Map<String, Object> craft(MinecraftServer server, String gridId, String itemId, long amount)
    {
        if (server == null) return fail("服务端未就绪");
        if (amount <= 0) return fail("数量必须大于 0");
        if (amount > 1_000_000) return fail("单次合成数量不能超过 1,000,000");

        try
        {
            Request request = ServerThread.call(() -> prepare(server, gridId, itemId, amount), 4000);
            if (request.error != null) return fail(request.error);

            ICraftingPlan plan;
            try
            {
                plan = request.future.get(6, TimeUnit.SECONDS);
            }
            catch (Exception e)
            {
                return fail("合成计划计算超时：可能缺料，或样板链无法满足该数量");
            }
            if (plan == null) return fail("无法生成合成计划");

            // 计划本身是模拟态说明一个都做不出来，AE2 会以 INCOMPLETE_PLAN 拒绝提交
            if (plan.simulation()) return missing(plan, amount);

            return ServerThread.call(() -> submit(request, plan), 4000);
        }
        catch (Throwable t)
        {
            return fail("合成请求失败：" + t.getMessage());
        }
    }

    // 只计算不提交：给看板的材料对话框用，口径与 AE 原生终端一致
    public static Map<String, Object> plan(MinecraftServer server, String gridId, String itemId, long amount)
    {
        if (server == null) return fail("服务端未就绪");
        if (amount <= 0) return fail("数量必须大于 0");
        if (amount > 1_000_000) return fail("单次合成数量不能超过 1,000,000");

        try
        {
            Request request = ServerThread.call(() -> prepare(server, gridId, itemId, amount), 4000);
            if (request.error != null) return fail(request.error);

            ICraftingPlan plan;
            try
            {
                plan = request.future.get(8, TimeUnit.SECONDS);
            }
            catch (Exception e)
            {
                return fail("合成计划计算超时：样板链较深或数量过大，稍后重试");
            }
            if (plan == null) return fail("无法生成合成计划");
            Map<String, Object> out = describePlan(request.grid, plan, amount);
            out.put("patterns", request.patterns);
            return out;
        }
        catch (Throwable t)
        {
            return fail("计算合成计划失败：" + t.getMessage());
        }
    }

    // 取消合成 CPU 上的任务：超大请求（如上限 21 亿）会一直占着 CPU，需要能从看板直接停掉
    public static Map<String, Object> cancel(MinecraftServer server, String gridId, int index)
    {
        if (server == null) return fail("服务端未就绪");
        try
        {
            return ServerThread.call(() ->
            {
                IGrid grid = Ae2GridScanner.findGrid(gridId);
                if (grid == null) return fail("找不到 ME 网络，刷新页面后重试");
                ICraftingService service = grid.getCraftingService();
                if (service == null) return fail("该网络没有合成服务");

                int i = 0;
                for (ICraftingCPU cpu : service.getCpus())
                {
                    if (i++ != index) continue;
                    if (!cpu.isBusy()) return fail("该 CPU 当前空闲，没有可取消的任务");
                    cpu.cancelJob();
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("ok", true);
                    out.put("message", "已取消合成任务");
                    return out;
                }
                return fail("找不到该合成 CPU（列表可能已变化，刷新后重试）");
            }, 4000);
        }
        catch (Throwable t)
        {
            return fail("取消合成任务失败：" + t.getMessage());
        }
    }

    private static Request prepare(MinecraftServer server, String gridId, String itemId, long amount)
    {
        IGrid grid = Ae2GridScanner.findGrid(gridId);
        if (grid == null) return Request.error("找不到 ME 网络，刷新页面后重试");

        ResourceLocation location = ResourceLocation.tryParse(itemId);
        if (location == null) return Request.error("物品 ID 不合法");
        Item item = BuiltInRegistries.ITEM.get(location);
        if (item == null || item == Items.AIR) return Request.error("该物品不在注册表中");

        AEItemKey key = AEItemKey.of(new ItemStack(item));
        ICraftingService service = grid.getCraftingService();
        if (service == null) return Request.error("该网络没有合成服务");
        if (!service.isCraftable(key)) return Request.error("没有对应的合成样板");

        ServerLevel level = levelOf(grid);
        if (level == null) return Request.error("网络所在维度不可用");

        // 用真实玩家 + 网络节点作为请求者，避免空 source 让 AE2 判定为不可执行
        IGridNode node = grid.getPivot();
        IActionSource source = actionSource(server, node);
        ICraftingSimulationRequester requester = new ICraftingSimulationRequester()
        {
            @Override
            public IActionSource getActionSource() { return source; }

            @Override
            public IGridNode getGridNode() { return node; }
        };

        Future<ICraftingPlan> future = service.beginCraftingCalculation(
                level, requester, key, amount, CalculationStrategy.CRAFT_LESS);
        int patterns = service.getCraftingFor(key).size();
        return new Request(grid, future, null, patterns, source);
    }

    private static IActionSource actionSource(MinecraftServer server, IGridNode node)
    {
        try
        {
            if (server != null)
            {
                var players = server.getPlayerList().getPlayers();
                if (!players.isEmpty()) return IActionSource.ofPlayer(players.get(0));
            }
        }
        catch (Throwable ignored) {}
        if (node != null && node.getOwner() instanceof appeng.api.networking.security.IActionHost host)
            return IActionSource.ofMachine(host);
        return IActionSource.empty();
    }

    private static Map<String, Object> describePlan(IGrid grid, ICraftingPlan plan, long requested)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("requested", requested);
        out.put("feasible", !plan.simulation());
        out.put("simulation", plan.simulation());
        out.put("bytes", plan.bytes());
        out.put("multiplePaths", plan.multiplePaths());
        out.put("steps", plan.patternTimes().size());
        out.put("missing", listOf(plan.missingItems(), 40));
        out.put("used", listOf(plan.usedItems(), 60));
        out.put("emitted", listOf(plan.emittedItems(), 40));
        out.put("cpu", cpuStatus(grid, plan.bytes()));
        if (plan.simulation())
            out.put("reason", plan.missingItems().isEmpty()
                    ? "样板链不完整：中间产物没有对应样板，或需要的机器不在线"
                    : "缺少原料，网络中没有足够物品");
        return out;
    }

    private static List<Map<String, Object>> listOf(KeyCounter counter, int limit)
    {
        List<Map<String, Object>> list = new ArrayList<>();
        if (counter == null) return list;
        for (var entry : counter)
        {
            if (list.size() >= limit) break;
            var key = entry.getKey();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", key.getId().toString());
            item.put("name", key.getDisplayName().getString());
            item.put("amount", entry.getLongValue());
            item.put("unit", key.getUnitSymbol() == null ? "" : key.getUnitSymbol());
            item.put("perUnit", key.getAmountPerUnit());
            item.put("type", key.getType().getId().toString());
            list.add(item);
        }
        return list;
    }

    private static Map<String, Object> cpuStatus(IGrid grid, long bytes)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        int total = 0;
        int idle = 0;
        long best = 0;
        try
        {
            ICraftingService service = grid.getCraftingService();
            if (service != null)
            {
                for (ICraftingCPU cpu : service.getCpus())
                {
                    total++;
                    if (!cpu.isBusy())
                    {
                        idle++;
                        best = Math.max(best, cpu.getAvailableStorage());
                    }
                }
            }
        }
        catch (Throwable ignored) {}
        out.put("total", total);
        out.put("idle", idle);
        out.put("maxStorage", best);
        out.put("enough", best >= bytes);
        return out;
    }

    private static Map<String, Object> submit(Request request, ICraftingPlan plan)
    {
        try
        {
            ICraftingService service = request.grid.getCraftingService();
            if (service == null) return fail("该网络没有合成服务");
            ICraftingSubmitResult result = service.submitJob(plan, null, null, false,
                    request.source == null ? IActionSource.empty() : request.source);
            if (result == null || !result.successful())
            {
                if (result != null && result.errorCode() == CraftingSubmitErrorCode.INCOMPLETE_PLAN)
                    return missing(plan, -1);
                return fail(result == null ? "提交失败：未知错误" : describe(result));
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("message", "已提交合成任务");
            out.put("bytes", plan.bytes());
            return out;
        }
        catch (Throwable t)
        {
            return fail("提交合成任务失败：" + t.getMessage());
        }
    }

    // 把 AE2 的错误码翻译成能看懂的原因
    private static String describe(ICraftingSubmitResult result)
    {
        CraftingSubmitErrorCode code = result.errorCode();
        String text = switch (code)
        {
            case INCOMPLETE_PLAN -> "合成计划不完整：缺少原料，或样板链里的中间产物没有对应样板";
            case NO_CPU_FOUND -> "没有找到合成 CPU，请放置并通电";
            case NO_SUITABLE_CPU_FOUND -> "没有可用的合成 CPU（容量不足或被占用）";
            case CPU_BUSY -> "合成 CPU 正在执行其它任务";
            case CPU_OFFLINE -> "合成 CPU 未通电或离线";
            case CPU_TOO_SMALL -> "合成 CPU 的存储装不下这个任务";
            case MISSING_INGREDIENT -> "缺少原料";
            default -> "提交失败：" + code;
        };
        Object detail = result.errorDetail();
        if (detail instanceof appeng.api.stacks.GenericStack stack && stack.what() != null)
            text += "（" + stack.what().getDisplayName().getString() + " ×" + stack.amount() + "）";
        return text;
    }

    // 汇总缺口，便于前端直接告诉玩家差什么
    private static Map<String, Object> missing(ICraftingPlan plan, long requested)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        java.util.List<Map<String, Object>> items = new java.util.ArrayList<>();
        try
        {
            for (var entry : plan.missingItems())
            {
                if (items.size() >= 12) break;
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", entry.getKey().getId().toString());
                item.put("name", entry.getKey().getDisplayName().getString());
                item.put("amount", entry.getLongValue());
                items.add(item);
            }
        }
        catch (Throwable ignored) {}

        String message = items.isEmpty()
                ? "合成计划不完整：缺少原料，或样板链里的中间产物没有对应样板"
                : "合成计划不完整：缺少 " + items.size() + " 种原料";
        if (requested > 0) message += "，无法完成 " + requested + " 个";
        out.put("ok", false);
        out.put("error", message);
        out.put("missing", items);
        return out;
    }

    private static ServerLevel levelOf(IGrid grid)
    {
        IGridNode pivot = grid.getPivot();
        return pivot == null ? null : pivot.getLevel();
    }

    private static Map<String, Object> fail(String message)
    {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", false);
        out.put("error", message);
        return out;
    }

    private record Request(IGrid grid, Future<ICraftingPlan> future, String error, int patterns,
                           IActionSource source)
    {
        static Request error(String message)
        {
            return new Request(null, null, message, 0, IActionSource.empty());
        }
    }
}
