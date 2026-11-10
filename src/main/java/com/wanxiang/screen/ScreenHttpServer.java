package com.wanxiang.screen;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.zip.GZIPOutputStream;

import com.google.gson.Gson;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import net.minecraftforge.fml.loading.FMLEnvironment;
import net.minecraftforge.fml.loading.FMLPaths;

public final class ScreenHttpServer
{
    private static final Gson GSON = new Gson();
    private static HttpServer server;
    private static volatile int boundPort;
    private static volatile Path dashboardDir;
    private static final AssetSource ASSETS = loadAssets();

    private ScreenHttpServer() {}

    // 客户端自动打开浏览器时要用
    public static int port() { return boundPort; }

    // 客户端资源（流体贴图）只在物理客户端加载，专用服务器上保持 null
    private static AssetSource loadAssets()
    {
        try
        {
            if (!FMLEnvironment.dist.isClient()) return null;
            Class<?> type = Class.forName("com.wanxiang.screen.compat.client.ClientAssetSource");
            return (AssetSource) type.getDeclaredConstructor().newInstance();
        }
        catch (Throwable t)
        {
            WanXiangScreen.LOGGER.debug("客户端贴图源不可用", t);
            return null;
        }
    }

    public static void start()
    {
        int preferred = Integer.getInteger("wanxiangscreen.port", 18765);
        int[] candidates = { preferred, 18765, 18766, 18767, 18768 };
        for (int port : candidates)
        {
            try
            {
                HttpServer candidate = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
                candidate.createContext("/", ScreenHttpServer::handle);
                candidate.setExecutor(Executors.newFixedThreadPool(4));
                candidate.start();
                server = candidate;
                boundPort = port;
                WanXiangScreen.LOGGER.info("万象屏 HTTP 已监听 http://127.0.0.1:{}/", port);
                writePortFile(port);
                return;
            }
            catch (java.net.BindException ignored)
            {
                // 端口被占用，尝试下一个
            }
            catch (Exception e)
            {
                WanXiangScreen.LOGGER.warn("万象屏 HTTP 启动失败", e);
                return;
            }
        }
        WanXiangScreen.LOGGER.warn("万象屏 HTTP 启动失败：候选端口均被占用");
    }

    private static void writePortFile(int port)
    {
        try
        {
            Path file = FMLPaths.GAMEDIR.get().resolve("wanxiangscreen.port");
            Files.writeString(file, Integer.toString(port));
        }
        catch (Exception ignored) {}
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
                sendJson(exchange, 200, ScreenState.get(), true);
            }
            else if ("/api/fluids".equals(path))
            {
                if (ASSETS == null) sendJson(exchange, 404, Map.of("error", "流体贴图只在客户端可用"));
                else sendJson(exchange, 200, Map.of("fluids", ASSETS.fluidInfo()), true);
            }
            else if (path.startsWith("/api/tex/"))
            {
                String rest = path.substring("/api/tex/".length());
                int slash = rest.indexOf('/');
                byte[] bytes = slash <= 0 || ASSETS == null ? null : ASSETS.texture(rest.substring(0, slash), rest.substring(slash + 1));
                if (bytes == null) sendText(exchange, 404, "贴图不存在");
                else sendBytes(exchange, bytes, "image/png", "public, max-age=86400");
            }
            else if ("/api/modules".equals(path))
            {
                sendJson(exchange, 200, Map.of("modules", ScreenState.get().get("modules")), true);
            }
            else if ("/api/mods".equals(path))
            {
                sendJson(exchange, 200, Map.of("mods", ScreenState.get().get("mods")), true);
            }
            else if ("/api/ae2/inventory".equals(path))
            {
                sendJson(exchange, 200, ModuleRegistry.moduleData("ae2"), true);
            }
            else if (path.startsWith("/api/module/") && path.endsWith("/data"))
            {
                String id = path.substring("/api/module/".length(), path.length() - "/data".length());
                sendJson(exchange, 200, ModuleRegistry.moduleData(id), true);
            }
            else if ("/api/ae2/craft".equals(path) || "/api/ae2/plan".equals(path))
            {
                if (!"POST".equalsIgnoreCase(exchange.getRequestMethod()))
                {
                    sendJson(exchange, 405, Map.of("ok", false, "error", "请使用 POST"));
                    return;
                }
                boolean planOnly = path.endsWith("/plan");
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                try
                {
                    var json = com.google.gson.JsonParser.parseString(body).getAsJsonObject();
                    String grid = json.has("grid") ? json.get("grid").getAsString() : "";
                    String item = json.has("item") ? json.get("item").getAsString() : "";
                    long amount = json.has("amount") ? json.get("amount").getAsLong() : 0;
                    sendJson(exchange, 200, planOnly
                            ? ModuleRegistry.plan(grid, item, amount)
                            : ModuleRegistry.craft(grid, item, amount));
                }
                catch (Exception e)
                {
                    sendJson(exchange, 400, Map.of("ok", false, "error", "请求体不是合法 JSON"));
                }
            }
            else if ("/api/ae2/cancel".equals(path))
            {
                if (!"POST".equalsIgnoreCase(exchange.getRequestMethod()))
                {
                    sendJson(exchange, 405, Map.of("ok", false, "error", "请使用 POST"));
                    return;
                }
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                try
                {
                    var json = com.google.gson.JsonParser.parseString(body).getAsJsonObject();
                    String grid = json.has("grid") ? json.get("grid").getAsString() : "";
                    int cpu = json.has("cpu") ? json.get("cpu").getAsInt() : -1;
                    sendJson(exchange, 200, ModuleRegistry.cancelCraft(grid, cpu));
                }
                catch (Exception e)
                {
                    sendJson(exchange, 400, Map.of("ok", false, "error", "请求体不是合法 JSON"));
                }
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
        String relative = path.equals("/") ? "index.html" : path.substring(1);
        if (relative.contains("..") || relative.contains("\\"))
        {
            sendText(exchange, 404, "文件不存在");
            return;
        }
        byte[] bytes = readStatic(relative);
        if (bytes == null)
        {
            sendText(exchange, 404, "文件不存在");
            return;
        }
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", mime(relative));
        boolean asset = relative.startsWith("assets/") && !relative.endsWith(".json");
        headers.set("Cache-Control", asset ? "public, max-age=604800" : "no-store");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) { out.write(bytes); }
    }

    // 开发时优先读磁盘上的 dashboard 目录（改完刷新就生效），否则读打进 jar 的那份
    private static byte[] readStatic(String relative)
    {
        Path dir = dashboard();
        if (dir != null)
        {
            Path file = dir.resolve(relative).normalize();
            if (file.startsWith(dir) && Files.isRegularFile(file))
            {
                try { return Files.readAllBytes(file); }
                catch (IOException ignored) {}
            }
        }
        try (InputStream in = ScreenHttpServer.class.getResourceAsStream("/dashboard/" + relative))
        {
            return in == null ? null : in.readAllBytes();
        }
        catch (IOException | RuntimeException ignored)
        {
            return null;
        }
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

    // 内容哈希做 ETag：快照每 tick 都会重建，但只有内容真的变了才需要重新传输
    private static String contentTag(byte[] bytes)
    {
        try
        {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(bytes);
            StringBuilder sb = new StringBuilder(34).append('"');
            for (byte b : digest) sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            return sb.append('"').toString();
        }
        catch (Throwable t)
        {
            return "\"" + Integer.toHexString(java.util.Arrays.hashCode(bytes)) + "\"";
        }
    }

    private static boolean acceptsGzip(HttpExchange exchange)
    {
        String accept = exchange.getRequestHeaders().getFirst("Accept-Encoding");
        return accept != null && accept.toLowerCase().contains("gzip");
    }

    private static void sendJson(HttpExchange exchange, int code, Object body) throws IOException
    {
        sendJson(exchange, code, body, false);
    }

    private static void sendJson(HttpExchange exchange, int code, Object body, boolean cacheable) throws IOException
    {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        if (cacheable && code == 200)
        {
            String tag = contentTag(bytes);
            headers.set("ETag", tag);
            headers.set("Cache-Control", "no-cache");
            if (tag.equals(exchange.getRequestHeaders().getFirst("If-None-Match")))
            {
                exchange.sendResponseHeaders(304, -1);
                exchange.close();
                return;
            }
        }
        if (bytes.length > 1024 && acceptsGzip(exchange))
        {
            headers.set("Content-Encoding", "gzip");
            headers.set("Vary", "Accept-Encoding");
            exchange.sendResponseHeaders(code, 0);
            try (OutputStream out = new GZIPOutputStream(exchange.getResponseBody(), 8192)) { out.write(bytes); }
            return;
        }
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) { out.write(bytes); }
    }

    private static void sendBytes(HttpExchange exchange, byte[] bytes, String type, String cache) throws IOException
    {
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", type);
        headers.set("Cache-Control", cache == null ? "no-store" : cache);
        exchange.sendResponseHeaders(200, bytes.length);
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
