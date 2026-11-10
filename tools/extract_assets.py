import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard" / "assets"

JARS = sorted((ROOT / "libs").glob("appliedenergistics2-*.jar")) + sorted(
    (ROOT / "libs").glob("Mekanism-*.jar")
) + sorted(
    (ROOT / "build" / "moddev" / "artifacts").glob("*client-extra*.jar")
)


class Assets:
    def __init__(self, paths):
        self.zips = [zipfile.ZipFile(p) for p in paths]
        self.index = {}
        for z in self.zips:
            for name in z.namelist():
                if name.startswith("assets/") and not name.endswith("/"):
                    self.index.setdefault(name, z)

    def read(self, name):
        z = self.index.get(name)
        if z is None:
            return None
        try:
            return z.read(name)
        except KeyError:
            return None

    def names(self, prefix):
        return [n for n in self.index if n.startswith(prefix)]


def split_ref(ref, default_ns):
    ns, sep, path = ref.partition(":")
    return (ns, path) if sep else (default_ns, ref)


def texture_path(ref):
    ns, path = split_ref(ref, "minecraft")
    return f"assets/{ns}/textures/{path}.png"


def texture_candidates(assets, ns, path, inherited=None, depth=0):
    if depth > 14:
        return []
    raw = assets.read(f"assets/{ns}/models/{path}.json")
    if raw is None:
        return []
    try:
        model = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return []

    tex = dict(inherited or {})
    declarations = model.get("textures") or {}
    for key, value in declarations.items():
        if not isinstance(value, str):
            continue
        if value.startswith("#"):
            tex[key] = tex.get(value[1:], value)
        else:
            tex[key] = value

    candidates = []

    def add(value):
        if isinstance(value, str) and not value.startswith("#") and ("/" in value or ":" in value) and value not in candidates:
            candidates.append(value)

    for key in ("layer0", "front", "front_bright", "front_medium", "front_dark", "front_base",
                "base", "all", "top", "side", "particle", "texture", "cross", "crop"):
        add(tex.get(key))
    for value in tex.values():
        add(value)

    parent = model.get("parent")
    if isinstance(parent, str) and parent:
        pns, ppath = split_ref(parent, ns)
        for value in texture_candidates(assets, pns, ppath, tex, depth + 1):
            add(value)
    return candidates


def fallback_texture(texture_index, ns, item):
    keys = [item]
    for prefix in ("basic_", "advanced_", "elite_", "ultimate_", "creative_"):
        if item.startswith(prefix):
            keys.append(item[len(prefix):])
    for key in keys:
        for path in texture_index.get(key, []):
            if path.startswith(f"assets/{ns}/textures/") and "/textures/gui/" not in path:
                return path
    return None


def main():
    if not JARS:
        sys.exit("未找到 AE2 / Mekanism / Minecraft 客户端资源 jar")
    assets = Assets(JARS)
    OUT.mkdir(parents=True, exist_ok=True)

    texture_index = {}
    for name in assets.names("assets/"):
        if "/textures/" in name and name.endswith(".png"):
            texture_index.setdefault(Path(name).stem, []).append(name)

    icon_map = {}
    textures = set()
    models = [
        n for n in assets.names("assets/")
        if "/models/item/" in n and n.endswith(".json")
    ]
    for model_path in models:
        ns = model_path.split("/")[1]
        item = model_path.split("/models/item/", 1)[1][:-5]
        picked = None
        for ref in texture_candidates(assets, ns, f"item/{item}"):
            path = texture_path(ref)
            if assets.read(path) is not None:
                picked = path
                break
        exact = fallback_texture(texture_index, ns, item)
        generic = ("steel_casing", "/generics/", "casing.png", "particle")
        if exact and (picked is None or any(marker in picked for marker in generic)):
            picked = exact
        if picked:
            textures.add(picked)
            icon_map[f"{ns}:{item}"] = "assets/tex/" + picked[len("assets/"):]

    for path in textures:
        target = OUT / "tex" / path[len("assets/"):]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(assets.read(path))

    (OUT / "icon-map.json").write_text(
        json.dumps(icon_map, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    gui = OUT / "gui"
    gui.mkdir(parents=True, exist_ok=True)
    for name in ("background", "terminal", "drive", "states", "text_field", "networkstatus"):
        raw = assets.read(f"assets/ae2/textures/guis/{name}.png")
        if raw:
            (gui / f"{name}.png").write_bytes(raw)

    terminal_raw = assets.read("assets/ae2/textures/guis/terminal.png")
    if terminal_raw:
        terminal = Image.open(io.BytesIO(terminal_raw)).convert("RGBA")
        terminal.crop((7, 18, 25, 36)).save(gui / "slot.png")
        terminal.crop((179, 18, 187, 70)).save(gui / "scroll.png")

    unknown = Image.new("RGBA", (16, 16), (173, 176, 196, 255))
    d = ImageDraw.Draw(unknown)
    d.rectangle((2, 2, 13, 13), outline=(65, 63, 84, 255))
    d.text((5, 2), "?", fill=(65, 63, 84, 255))
    unknown.save(gui / "unknown.png")

    lang = {}
    for name in assets.names("assets/"):
        if not name.endswith("/lang/zh_cn.json"):
            continue
        raw = assets.read(name)
        if not raw:
            continue
        try:
            lang.update(json.loads(raw))
        except (ValueError, UnicodeDecodeError):
            pass
    if lang:
        (OUT / "lang-zh.json").write_text(
            json.dumps(lang, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    total = sum(p.stat().st_size for p in (OUT / "tex").rglob("*.png"))
    print(f"物品图标: {len(icon_map)} 项 / {len(textures)} 张贴图 / {total / 1024 / 1024:.2f} MB")
    print(f"GUI 资源: {len(list(gui.glob('*.png')))} 张")
    print(f"中文名: {len(lang)} 条")
    print(f"输出: {OUT}")


if __name__ == "__main__":
    main()
