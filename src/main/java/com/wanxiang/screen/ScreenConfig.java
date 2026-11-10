package com.wanxiang.screen;

import java.util.List;

import net.minecraftforge.common.ForgeConfigSpec;

public final class ScreenConfig
{
    private static final List<String> DEFAULT_WATCHED = List.of(
            "mekanism", "refinedstorage", "create", "thermal", "botania",
            "functionalstorage", "sophisticatedstorage", "emi", "jade", "guideme");

    private static final ForgeConfigSpec.Builder BUILDER = new ForgeConfigSpec.Builder();

    private static final ForgeConfigSpec.ConfigValue<String> TOKEN_VALUE = BUILDER
            .comment("HTTP 鉴权令牌；留空表示仅限 127.0.0.1 且不校验")
            .define("token", "");

    private static final ForgeConfigSpec.ConfigValue<List<? extends String>> WATCHED_VALUE = BUILDER
            .comment("额外关注的模组 ID：已安装但尚未接入时会在看板中列出")
            .defineListAllowEmpty("watchedMods", DEFAULT_WATCHED, obj -> obj instanceof String);

    private static final ForgeConfigSpec.ConfigValue<List<? extends String>> SIMULATE_VALUE = BUILDER
            .comment("填入模组 ID 可模拟该依赖未安装，用于验证降级界面，例如 [\"ae2\"]")
            .defineListAllowEmpty("simulateMissing", List.of(), obj -> obj instanceof String);

    private static final ForgeConfigSpec.IntValue REFRESH_VALUE = BUILDER
            .comment("数据快照刷新间隔（tick），20 tick = 1 秒")
            .defineInRange("refreshTicks", 20, 5, 200);

    private static final ForgeConfigSpec.BooleanValue OPEN_BROWSER_VALUE = BUILDER
            .comment("进入单人/多人世界时自动用系统浏览器打开看板")
            .define("openBrowserOnJoin", true);

    public static final ForgeConfigSpec SPEC = BUILDER.build();

    public static volatile String token = "";
    public static volatile List<String> watchedMods = DEFAULT_WATCHED;
    public static volatile List<String> simulateMissing = List.of();
    public static volatile int refreshTicks = 20;
    public static volatile boolean openBrowserOnJoin = true;

    private ScreenConfig() {}

    public static void reload()
    {
        try { token = TOKEN_VALUE.get(); } catch (Throwable ignored) {}
        try { watchedMods = WATCHED_VALUE.get().stream().map(Object::toString).toList(); } catch (Throwable ignored) {}
        try { simulateMissing = SIMULATE_VALUE.get().stream().map(Object::toString).toList(); } catch (Throwable ignored) {}
        try { refreshTicks = REFRESH_VALUE.get(); } catch (Throwable ignored) {}
        try { openBrowserOnJoin = OPEN_BROWSER_VALUE.get(); } catch (Throwable ignored) {}
    }
}
