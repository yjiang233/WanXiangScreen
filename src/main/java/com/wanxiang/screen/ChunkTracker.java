package com.wanxiang.screen;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import net.minecraft.world.level.chunk.LevelChunk;

public final class ChunkTracker
{
    private static final Set<LevelChunk> CHUNKS = Collections.newSetFromMap(new ConcurrentHashMap<>());

    private ChunkTracker() {}

    public static void add(LevelChunk chunk) { CHUNKS.add(chunk); }

    public static void remove(LevelChunk chunk) { CHUNKS.remove(chunk); }

    public static void clear() { CHUNKS.clear(); }

    public static List<LevelChunk> copy() { return new ArrayList<>(CHUNKS); }
}
