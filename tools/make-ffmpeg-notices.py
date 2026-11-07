# -*- coding: utf-8 -*-
r"""
同梱の FFmpeg（BtbN/FFmpeg-Builds の Windows 64bit・LGPL・DLL 分割版）に組み込まれている部品の
許諾の文面を集めて、py/packaging/notices/ffmpeg-libs.md を作る（ライセンス表示 make_notices.py が取り込む）。

  py\.venv\Scripts\python tools\make-ffmpeg-notices.py

しくみ:
- FFmpeg の構成（vendor/ffmpeg/VERSION.txt の configuration: の --enable-…）と、ビルド手順（BtbN の scripts.d。
  BTBN_COMMIT の版）を「文字として」読み（手順のスクリプトは実行しない）、組み込まれた部品と、その依存をたどる。
  同じフォルダの部品（例: librsvg の glib・cairo・pango）は一組として含める。Linux 専用の部品は除く。
- 各部品の入手元（SCRIPT_REPO）の、ビルドに使った版（SCRIPT_COMMIT / SCRIPT_REV）から、LICENSE・COPYING・PATENTS などを取る。
- 同じ文面は2回目から「○○と同じ」とし、全文は1回だけ載せる。
- 取れなかった部品は一覧の最後に「入手元で確認してください」として残す（止めない）。

FFmpeg を取り直したら（tools/fetch-ffmpeg.py）、BTBN_COMMIT をそのビルドの版に合わせてから実行し直す。
ビルドの版は、配布元のリリース（autobuild-…）のタグが指す版。
"""
import base64
import concurrent.futures as cf
import hashlib
import io
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "py", "packaging", "notices", "ffmpeg-libs.md")
VERSION_TXT = os.path.join(ROOT, "vendor", "ffmpeg", "VERSION.txt")
BTBN_COMMIT = "c63bb308a1de656b425c132a8102f8fd5389afc5"  # autobuild-2026-11-06-12-50（ffmpeg n9.0.2-47-gb204e94e90）
UA = {"User-Agent": "LegalLeaves-build (license notices)"}

# 試す名前（見つかったものをすべて載せる。上から順）
MAIN = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.TXT", "LICENCE", "LICENCE.md", "COPYING", "COPYING.md",
        "COPYING.LIB", "COPYING.LGPL", "COPYING.LESSER", "COPYING.LESSERv3", "COPYING.LGPLv2.1", "Copyright", "license.txt"]
EXTRA = ["PATENTS", "PATENTS.md"]
# 部品ごとに足して見るもの（主な許諾が別の所にあるもの）
SPECIAL = {
    "freetype": ["docs/FTL.TXT", "LICENSE.TXT"],
    "cairo": ["COPYING-LGPL-2.1", "COPYING-MPL-1.1"],
    "mingw": ["COPYING", "mingw-w64-libraries/winpthreads/COPYING", "mingw-w64-crt/COPYING", "mingw-w64-headers/COPYING"],
    "glib": ["LICENSES/LGPL-2.1-or-later.txt"],
    "gmp": ["COPYING.LESSERv3", "COPYINGv2"],
    "openal": ["COPYING", "BSD-3Clause"],
    "zvbi": ["COPYING.md", "COPYING.LIB"],
    "vulkan-headers": ["LICENSE.md", "LICENSES/Apache-2.0.txt", "LICENSES/MIT.txt"],
}
# 許諾がファイルの冒頭の注記にだけ書かれている部品: (ファイル, 載せるときの名前)
HEADER_COMMENT = {
    "ffnvcodec": ("include/ffnvcodec/nvEncodeAPI.h", "include/ffnvcodec/nvEncodeAPI.h の冒頭の注記"),
}
# Linux 専用など、Windows の配布物に入らないもの（ffbuild_enabled の書き方で判定しきれない分）
SKIP_KEYS = {"base", "finalize", "enable", "rustdedup", "xorg-macros"}


def get(url, binary=False, tries=3):
    """無ければ None。通信の失敗は数回やり直し、それでも駄目なら None（その部品は「取れなかった」に回す）。"""
    req = urllib.request.Request(url, headers=UA)
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                data = r.read()
            return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 400, 410, 403):
                return None
            if i == tries - 1:
                print(f"  取れませんでした（{e.code}）: {url}")
                return None
        except (OSError, TimeoutError) as e:
            if i == tries - 1:
                print(f"  取れませんでした（{type(e).__name__}）: {url}")
                return None
    return None


def raw_url(repo, ver, path):
    """入手元の種類ごとに、その版のファイルの生の中身の場所。"""
    repo = repo.rstrip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    u = urllib.parse.urlparse(repo)
    if u.netloc == "github.com":
        return f"https://raw.githubusercontent.com{u.path}/{ver}/{path}", None
    if u.netloc in ("gitlab.freedesktop.org", "gitlab.com", "code.videolan.org", "gitlab.gnome.org"):
        return f"{repo}/-/raw/{ver}/{path}", None
    if u.netloc.endswith("googlesource.com"):
        return f"{repo}/+/{ver}/{path}?format=TEXT", "base64"
    if u.netloc == "git.savannah.gnu.org":
        name = u.path.split("/")[-1]
        # git.savannah.gnu.org は直接つながらないことがあるので、同じ中身の cgit の窓口を使う
        return f"https://cgit.git.savannah.gnu.org/cgit/{name}.git/plain/{path}?id={ver}", None
    if u.netloc == "git.code.sf.net":  # /p/<project>/<repo>
        parts = u.path.strip("/").split("/")
        return f"https://sourceforge.net/p/{parts[1]}/{parts[2]}/ci/{ver}/tree/{path}?format=raw", None
    if u.netloc == "svn.code.sf.net":
        rev = ver[1:] if ver and ver.startswith("r") else ver
        return f"{repo}/{path}?p={rev}", None
    return None, None


def fetch_file(repo, ver, path):
    url, enc = raw_url(repo, ver, path)
    if not url:
        return None
    data = get(url, binary=True)
    if data is None:
        return None
    if enc == "base64":
        try:
            data = base64.b64decode(data)
        except Exception:
            return None
    text = data.decode("utf-8", "replace").replace("\r\n", "\n").strip()
    # 入手元がファイルの代わりに HTML（エラーの画面など）を返したときは捨てる
    if not text or text.lstrip().lower().startswith(("<!doctype", "<html")):
        return None
    return text


def func_body(text, name):
    m = re.search(name + r"\(\)\s*\{(.*?)\n\}", text, re.S)
    return m.group(1) if m else ""


def linux_only(enabled_body):
    b = " ".join(enabled_body.split())
    return ("$TARGET == linux* ]] ||" in b) or ("$TARGET != linux* ]] &&" in b)


def components():
    data = get(f"https://github.com/BtbN/FFmpeg-Builds/archive/{BTBN_COMMIT}.zip", binary=True)
    z = zipfile.ZipFile(io.BytesIO(data))
    flags = set(next(l for l in open(VERSION_TXT, encoding="utf-8").read().splitlines()
                     if l.startswith("configuration:")).split())
    scripts = {}
    for name in z.namelist():
        m = re.search(r"/scripts\.d/(.+\.sh)$", name)
        if not m:
            continue
        rel = m.group(1)
        t = z.read(name).decode("utf-8", "replace")
        repo = re.search(r'^SCRIPT_REPO="([^"]+)"', t, re.M)
        commit = re.search(r'^SCRIPT_COMMIT="([^"]+)"', t, re.M)
        rev = re.search(r'^SCRIPT_REV="([^"]+)"', t, re.M)
        folder = os.path.dirname(rel)
        scripts[rel] = {
            "key": re.sub(r"^\d+-", "", os.path.basename(rel)[:-3]), "folder": folder,
            "repo": repo and repo.group(1), "ver": (commit and commit.group(1)) or (rev and "r" + rev.group(1)),
            "conf": re.findall(r"echo\s+(--enable-[\w-]+)", func_body(t, "ffbuild_configure")),
            "deps": re.findall(r"echo\s+([\w.+-]+)", func_body(t, "ffbuild_depends")),
            "linux": linux_only(func_body(t, "ffbuild_enabled")),
        }
    by_key = {}
    for rel, s in scripts.items():
        by_key.setdefault(s["key"], []).append(rel)
        if s["folder"]:
            by_key.setdefault(re.sub(r"^\d+-", "", s["folder"]), []).append(rel)
    seen = set()

    def visit(rel):
        if rel in seen:
            return
        seen.add(rel)
        s = scripts[rel]
        for d in s["deps"]:
            for r2 in by_key.get(d, []):
                visit(r2)
        if s["folder"]:  # 同じフォルダの部品は一組
            for r2, s2 in scripts.items():
                if s2["folder"] == s["folder"]:
                    visit(r2)

    for rel, s in scripts.items():
        if any(c in flags for c in s["conf"]):
            visit(rel)
    out, seen_repo = [], set()
    for rel in sorted(seen):
        s = scripts[rel]
        if s["linux"] or s["key"] in SKIP_KEYS or not s["repo"] or (s["repo"], s["ver"]) in seen_repo:
            continue
        seen_repo.add((s["repo"], s["ver"]))
        out.append({"name": s["key"], "repo": s["repo"], "ver": s["ver"]})
    return out


def licenses_for(c):
    if c["name"] in HEADER_COMMENT:
        path, label = HEADER_COMMENT[c["name"]]
        t = fetch_file(c["repo"], c["ver"], path)
        m = t and re.match(r"\s*/\*(.*?)\*/", t, re.S)
        if m:
            body = "\n".join(line.strip().lstrip("*").rstrip() for line in m.group(1).splitlines()).strip()
            return [(label, body)]
        return []
    names = SPECIAL.get(c["name"], []) + MAIN + EXTRA
    found, seen = [], set()
    for n in names:
        if n in seen:
            continue
        seen.add(n)
        t = fetch_file(c["repo"], c["ver"], n)
        if t:
            found.append((n, t))
            # 主な許諾が1つ見つかったら、ほかの主な候補は探さない（PATENTS と部品ごとの追加は探す）
            if n in MAIN:
                names = [x for x in names if x not in MAIN or x == n]
    return found


def main():
    comps = components()
    print(f"部品: {len(comps)}")
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(licenses_for, comps))
    lines = ["<!-- tools/make-ffmpeg-notices.py が作ったもの。手で直さない -->", "",
             "### FFmpeg に組み込まれている部品", "",
             f"上の FFmpeg（DLL）には、次の部品が組み込まれています（BtbN/FFmpeg-Builds の版 `{BTBN_COMMIT[:12]}` の手順で作られたもの）。",
             "各部品の著作権表示と許諾の全文を、入手元のその版から写して載せます。", ""]
    first_of = {}
    missing = []
    for c, lic in zip(comps, results):
        lines += [f"#### {c['name']}", "", f"- 入手元: {c['repo']}", f"- 版: `{c['ver']}`", ""]
        if not lic:
            missing.append(c["name"])
            lines += ["（許諾の文面を自動では取れませんでした。入手元の上の版で確認してください）", ""]
            continue
        for fname, text in lic:
            h = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if h in first_of:
                lines += [f"`{fname}`: {first_of[h]} と同じ文面です。", ""]
                continue
            first_of[h] = f"{c['name']} の `{fname}`"
            lines += [f"`{fname}`:", "", "```", text.replace("```", "'''"), "```", ""]
    if missing:
        lines += ["#### 自動で取れなかった部品", "", "、".join(missing), ""]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    size = os.path.getsize(OUT)
    print(f"作成: {OUT}（{size / 1024:.0f}KB）")
    print("取れなかった部品:", missing or "なし")
    for c, lic in zip(comps, results):
        print(f"  {c['name']:<20} {', '.join(n for n, _ in lic) or '—'}")


if __name__ == "__main__":
    main()
