import json, re, sys, zipfile, shutil, os

TSRG = r"C:/gradle-home/caches/forge_gradle/minecraft_user_repo/de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/srg_to_official_1.20.1.tsrg"

# srg 名 -> official 名
mapping = {}
with open(TSRG, encoding='utf-8') as f:
    for line in f:
        m = re.match(r'\s+([mf]_\d+_\S*)\s', line)
        if m:
            parts = line.split()
            # 行格式: srgName (desc) ret officialName 或 srgName -> officialName(字段)
            if '->' in line:
                mapping[parts[0]] = parts[2]
            else:
                mapping[parts[0]] = parts[-1]

print('映射条目:', len(mapping))
pat = re.compile(r'\b([mf]_\d+_)\b')

def patch_refmap(text):
    def rep(mo):
        name = mo.group(1)
        # refmap 里 srg 名带尾随描述符的情况：m_12345_ 后面直接跟描述符，去掉尾下划线查
        base = name.rstrip('_') + '_'
        for cand in (name, base):
            if cand in mapping:
                return mapping[cand]
        return name
    return pat.sub(rep, text)

def patch_jar(path):
    tmp = path + '.tmp'
    changed = 0
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith('refmap.json'):
                text = data.decode('utf-8')
                new = patch_refmap(text)
                if new != text:
                    data = new.encode('utf-8')
                    changed += 1
                    print('  patched', item.filename)
            zout.writestr(item, data)
    shutil.move(tmp, path)
    return changed

base = r"C:/gradle-home/caches/forge_gradle/deobf_dependencies/blank"
total = 0
for root, dirs, files in os.walk(base):
    for fn in files:
        if fn.endswith('_mapped_official_1.20.1.jar'):
            p = os.path.join(root, fn)
            n = patch_jar(p)
            total += n
            print(fn, '->', n, '个 refmap 已修正')
print('完成，共修正', total, '个 refmap')
