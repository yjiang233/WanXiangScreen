package com.wanxiang.screen;

import java.util.List;

import net.neoforged.neoforge.common.ModConfigSpec;

public final class ScreenConfig
{
    private static final List<String> DEFAULT_WATCHED = List.of(
            "mekanism", "refinedstorage", "create", "thermal", "botania",
            "functionalstorage", "sophisticatedstorage", "emi", "jade", "guideme");

    private static final ModConfigSpec.Builder BUILDER = new ModConfigSpec.Builder();

    private static final ModConfigSpec.ConfigValue<String> TOKEN_VALUE = BUILDER
            .comment("HTTP 鉴权令牌；留空表示仅限 127.0.0.1 且不校验")
            .define("token", "");

    private static final ModConfigSpec.ConfigValue<List<? extends String>> WATCHED_VALUE = BUILDER
            .comment("额外关注的模组 ID：已安装但尚未接入时会在看板中列出")
            .defineListAllowEmpty("watchedMods", DEFAULT_WATCHED, () -> "modid", obj -> obj instanceof String);

    private static final ModConfigSpec.ConfigValue<List<? extends String>> SIMULATE_VALUE = BUILDER
            .comment("填入模组 ID 可模拟该依赖未安装，用于验证降级界面，例如 [\"ae2\"]")
            .defineListAllowEmpty("simulateMissing", List.of(), () -> "modid", obj -> obj instanceof String);

    private static final ModConfigSpec.IntValue REFRESH_VALUE = BUILDER
            .comment("数据快照刷新间隔（tick），20 tick = 1 秒")
            .defineInRange("refreshTicks", 20, 5, 200);

    public static final ModConfigSpec SPEC = BUILDER.build();

    public static volatile String token = "";
    public static volatile List<String> watchedMods = DEFAULT_WATCHED;
    public static volatile List<String> simulateMissing = List.of();
    public static volatile int refreshTicks = 20;

    private ScreenConfig() {}

    public static void reload()
    {
        try { token = TOKEN_VALUE.get(); } catch (Throwable ignored) {}
        try { watchedMods = WATCHED_VALUE.get().stream().map(Object::toString).toList(); } catch (Throwable ignored) {}
        try { simulateMissing = SIMULATE_VALUE.get().stream().map(Object::toString).toList(); } catch (Throwable ignored) {}
        try { refreshTicks = REFRESH_VALUE.get(); } catch (Throwable ignored) {}
    }
}
