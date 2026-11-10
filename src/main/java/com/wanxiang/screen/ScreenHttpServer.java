package com.wanxiang.screen;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.Executors;

import com.google.gson.Gson;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import net.neoforged.fml.loading.FMLPaths;

public final class ScreenHttpServer
{
    private static final Gson GSON = new Gson();
    private static HttpServer server;
    private static volatile Path dashboardDir;

    private ScreenHttpServer() {}

    public static void start()
    {
        int port = Integer.getInteger("wanxiangscreen.port", 8765);
        try
        {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
            server.createContext("/", ScreenHttpServer::handle);
            server.setExecutor(Executors.newFixedThreadPool(4));
            server.start();
            WanXiangScreen.LOGGER.info("万象屏 HTTP 已监听 http://127.0.0.1:{}/", port);
        }
        catch (Exception e)
        {
            WanXiangScreen.LOGGER.warn("万象屏 HTTP 启动失败（端口可能被占用）", e);
        }
    }

    public static void stop()
    {
        if (server != null) server.stop(0);
    }

    private static void handle(HttpExchange exchange) throws IOException
    {
        cors(exchange);
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod()))
        {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            return;
        }
        if (!authorized(exchange))
        {
            sendJson(exchange, 401, Map.of("error", "未授权"));
            return;
        }

        String path = exchange.getRequestURI().getPath();
        try
        {
            if ("/api/health".equals(path))
            {
                sendJson(exchange, 200, Map.of("ok", true, "service", "wanxiangscreen"));
            }
            else if ("/api/status".equals(path))
            {
                sendJson(exchange, 200, ScreenState.get());
            }
            else if ("/api/modules".equals(path))
            {
                sendJson(exchange, 200, Map.of("modules", ScreenState.get().get("modules")));
            }
            else if ("/api/mods".equals(path))
            {
                sendJson(exchange, 200, Map.of("mods", ScreenState.get().get("mods")));
            }
            else if ("/api/ae2/inventory".equals(path))
            {
                sendJson(exchange, 200, ModuleRegistry.moduleData("ae2"));
            }
            else if (path.startsWith("/api/module/") && path.endsWith("/data"))
            {
                String id = path.substring("/api/module/".length(), path.length() - "/data".length());
                sendJson(exchange, 200, ModuleRegistry.moduleData(id));
            }
            else if (!path.startsWith("/api/"))
            {
                serveStatic(exchange, path);
            }
            else
            {
                sendJson(exchange, 404, Map.of("error", "未知接口"));
            }
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.error("处理 {} 失败", path, t);
            sendJson(exchange, 500, Map.of("error", String.valueOf(t.getMessage())));
        }
    }

    private static void serveStatic(HttpExchange exchange, String path) throws IOException
    {
        Path dir = dashboard();
        if (dir == null)
        {
            sendText(exchange, 404, "未找到 dashboard 目录");
            return;
        }
        String relative = path.equals("/") ? "index.html" : path.substring(1);
        Path file = dir.resolve(relative).normalize();
        if (!file.startsWith(dir) || !Files.isRegularFile(file))
        {
            sendText(exchange, 404, "文件不存在");
            return;
        }
        byte[] bytes = Files.readAllBytes(file);
        exchange.getResponseHeaders().set("Content-Type", mime(relative));
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) { out.write(bytes); }
    }

    // 依次向上找 <游戏目录>/dashboard、<游戏目录>/../dashboard ... 兼容 run、run/client 等布局
    private static Path dashboard()
    {
        if (dashboardDir != null) return dashboardDir;
        try
        {
            Path base = FMLPaths.GAMEDIR.get().toAbsolutePath();
            for (int up = 0; up <= 3; up++)
            {
                Path candidate = base;
                for (int i = 0; i < up && candidate.getParent() != null; i++) candidate = candidate.getParent();
                Path dir = candidate.resolve("dashboard");
                if (Files.isRegularFile(dir.resolve("index.html")))
                {
                    dashboardDir = dir;
                    return dir;
                }
            }
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.warn("定位 dashboard 目录失败", t);
        }
        return null;
    }

    private static boolean authorized(HttpExchange exchange)
    {
        String token = ScreenConfig.token;
        if (token == null || token.isBlank()) return true;
        return token.equals(exchange.getRequestHeaders().getFirst("X-WX-Token"));
    }

    private static void cors(HttpExchange exchange)
    {
        Headers headers = exchange.getResponseHeaders();
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "*");
        headers.set("Cache-Control", "no-store");
    }

    private static void sendJson(HttpExchange exchange, int code, Object body) throws IOException
    {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) { out.write(bytes); }
    }

    private static void sendText(HttpExchange exchange, int code, String text) throws IOException
    {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) { out.write(bytes); }
    }

    private static String mime(String name)
    {
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        if (name.endsWith(".json")) return "application/json; charset=utf-8";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }
}
