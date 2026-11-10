package com.wanxiang.screen;

import java.util.Map;

// 客户端专属资源（流体贴图 / 染色），专用服务器上为 null
public interface AssetSource
{
    Map<String, Object> fluidInfo();

    byte[] texture(String namespace, String path);
}
