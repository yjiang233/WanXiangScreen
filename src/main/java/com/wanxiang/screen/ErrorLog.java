package com.wanxiang.screen;

import java.nio.file.Files;
import java.nio.file.Path;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.Filter;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.appender.FileAppender;
import org.apache.logging.log4j.core.config.Configuration;
import org.apache.logging.log4j.core.filter.AbstractFilter;
import org.apache.logging.log4j.core.layout.PatternLayout;

import net.minecraftforge.fml.loading.FMLPaths;

/**
 * 把本模组自己的 WARN / ERROR 单独抄一份到 logs/wanxiangscreen-errors.log。
 * 排查问题时不用在一万多行 latest.log 里翻。
 */
public final class ErrorLog
{
    private static final String LOGGER_PREFIX = "com.wanxiang.screen";
    private static final long MAX_BYTES = 4L * 1024 * 1024;
    private static boolean installed;

    private ErrorLog() {}

    public static synchronized void install()
    {
        if (installed) return;
        installed = true;
        Path file = null;
        try
        {
            file = FMLPaths.GAMEDIR.get().resolve("logs").resolve("wanxiangscreen-errors.log");
            Files.createDirectories(file.getParent());
            // 别让它无限长
            if (Files.isRegularFile(file) && Files.size(file) > MAX_BYTES)
            {
                Files.deleteIfExists(file.resolveSibling("wanxiangscreen-errors.log.1"));
                Files.move(file, file.resolveSibling("wanxiangscreen-errors.log.1"));
            }

            Filter onlyOurWarnings = new AbstractFilter()
            {
                @Override
                public Result filter(LogEvent event)
                {
                    if (event == null || event.getLoggerName() == null) return Result.DENY;
                    if (!event.getLoggerName().startsWith(LOGGER_PREFIX)) return Result.DENY;
                    return event.getLevel().isMoreSpecificThan(Level.WARN) ? Result.ACCEPT : Result.DENY;
                }
            };

            FileAppender appender = FileAppender.newBuilder()
                    .setName("WanXiangErrorLog")
                    .withFileName(file.toString())
                    .withAppend(true)
                    .setIgnoreExceptions(true)
                    .setFilter(onlyOurWarnings)
                    .setLayout(PatternLayout.newBuilder()
                            .withPattern("[%d{yyyy-MM-dd HH:mm:ss.SSS}] [%level] %msg%n%throwable")
                            .build())
                    .build();
            appender.start();

            LoggerContext context = (LoggerContext) LogManager.getContext(false);
            Configuration config = context.getConfiguration();
            config.addAppender(appender);
            config.getRootLogger().addAppender(appender, Level.WARN, null);
            context.updateLoggers();

            WanXiangScreen.LOGGER.info("报错日志：{}", file);
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.warn("初始化报错日志失败{}", file == null ? "" : "（" + file + "）", t);
        }
    }
}
