package com.wanxiang.screen;

import java.util.Queue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/** HTTP 线程不能直接碰游戏对象，所有读写都投递到服务端主线程执行。 */
public final class ServerThread
{
    private static final Queue<Runnable> QUEUE = new ConcurrentLinkedQueue<>();

    private ServerThread() {}

    public static void submit(Runnable task)
    {
        QUEUE.add(task);
    }

    public static void drain()
    {
        Runnable task;
        while ((task = QUEUE.poll()) != null)
        {
            try { task.run(); }
            catch (Throwable t) { WanXiangScreen.LOGGER.error("主线程任务执行失败", t); }
        }
    }

    public static <T> T call(Supplier<T> supplier, long timeoutMillis)
    {
        CompletableFuture<T> future = new CompletableFuture<>();
        QUEUE.add(() -> {
            try { future.complete(supplier.get()); }
            catch (Throwable t) { future.completeExceptionally(t); }
        });
        try
        {
            return future.get(timeoutMillis, TimeUnit.MILLISECONDS);
        }
        catch (Exception e)
        {
            throw new IllegalStateException("主线程执行超时或失败", e);
        }
    }
}
