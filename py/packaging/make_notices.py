# -*- coding: utf-8 -*-
r"""
同梱物のライセンス表示（assets/THIRD-PARTY-NOTICES.md）を作る。

配布物（PyInstaller で固めたフォルダ）に入る部品の著作権表示とライセンス全文を、
各部品に付いているライセンスファイルから集めて1つにまとめる。部品の版を上げたら作り直すこと。

  py\.venv\Scripts\python py\packaging\make_notices.py

pdf.js（画面に同梱）とフォントの表示は、部品の情報からは作れないので notices/ の文面を使う。
"""
import importlib.metadata as md
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "assets", "THIRD-PARTY-NOTICES.md")

# 配布物に入る Python の部品（requirements.txt のうち実行時に使うものと、その依存）
PACKAGES = [
    ("pywebview", "画面の窓（WebView2）"),
    ("pythonnet", "pywebview が Windows の部品を使うため"),
    ("clr_loader", "pythonnet の依存"),
    ("cffi", "clr_loader の依存"),
    ("pycparser", "cffi の依存"),
    ("bottle", "画面の配信（127.0.0.1 のみ）"),
    ("proxy_tools", "pywebview の依存"),
    ("typing_extensions", "pywebview の依存"),
    ("pypdf", "PDF の読み書き"),
    ("reportlab", "証拠番号の文字・画像ページの描画"),
    ("pillow", "画像の読み込み・白黒スキャンのプレビュー用変換"),
    ("charset-normalizer", "依存部品"),
    ("setuptools", "依存部品（一部のみ）"),
]

HEADER = """# サードパーティライセンス表示（THIRD-PARTY NOTICES）

本ソフトウェア「LegalLeaves」は、以下のオープンソースソフトウェア等を利用しています。
各ソフトウェアの著作権表示とライセンス全文を以下に記載します。
（この文書は py/packaging/make_notices.py で、同梱する部品のライセンスファイルから作っています）

- 同梱フォント（Noto Sans JP 派生のスタンプ用サブセット、UIフォントの Noto Sans JP および
  Zen Kaku Gothic New = `assets/fonts/ui/`）はいずれも SIL Open Font License 1.1 です。
  全文は `assets/fonts/OFL.txt` を参照してください。
  - Noto Sans JP: Copyright 2014-2021 Adobe (http://www.adobe.com/)
  - Zen Kaku Gothic New: Copyright 2022 The Zen Project Authors (https://github.com/googlefonts/zen-kakugothic)
- 画面の表示には、Windows に入っている **Microsoft Edge WebView2 ランタイム**を使います（本ソフトウェアには含みません）。
  pywebview に含まれる WebView2 の接続部品（`Microsoft.Web.WebView2.Core.dll`・`Microsoft.Web.WebView2.WinForms.dll`）は
  Microsoft Corporation の著作物で、Microsoft.Web.WebView2 SDK のライセンスに基づき再配布しています
  （https://www.nuget.org/packages/Microsoft.Web.WebView2 ）。
- 実行ファイルの起動部分は PyInstaller のブートローダーです。PyInstaller は GPL 2.0 ですが、
  ブートローダーには「これを使って作った実行ファイルは任意のライセンスで配布してよい」という例外が付いています
  （https://pyinstaller.org/en/stable/license.html ）。
- 音声・動画の変換には **FFmpeg**（LGPL v3・DLL 分割）を同梱しています。版・入手元・ソースの辿り方・許諾の全文は
  「FFmpeg」の項にまとめています。
- Python 本体（`python313.dll` ほか）と、Python に同梱される部品（OpenSSL・libffi・zlib・bzip2・xz・expat など）の
  表示は、末尾の「Python」の項にまとめています。
"""


def license_text(dist):
    texts = []
    for f in dist.files or []:
        name = str(f)
        base = os.path.basename(name).upper()
        if "dist-info" in name and (base.startswith("LICEN") or base.startswith("COPYING") or base.startswith("NOTICE")):
            try:
                texts.append(f.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError):
                pass
    return "\n\n".join(t.strip() for t in texts if t and t.strip())


def section(name, role):
    d = md.distribution(name)
    meta = d.metadata
    lic = meta.get("License-Expression") or (meta.get("License") or "").split("\n")[0].strip() or "（ライセンスファイル参照）"
    home = meta.get("Home-page") or ""
    if not home:
        for v in meta.get_all("Project-URL") or []:
            home = v.split(",", 1)[-1].strip()
            break
    text = license_text(d)
    if not text and lic.upper().startswith("MIT"):
        author = meta.get("Author") or meta.get("Author-email") or "the authors"
        text = f"MIT License\n\nCopyright (c) {author}\n\n" + MIT_BODY
    out = [f"## {meta['Name']}@{d.version}", "", f"- 用途: {role}", f"- License: {lic}"]
    if home:
        out.append(f"- Homepage: {home}")
    out += ["", "```", text or "(ライセンス文は配布元を参照)", "```", ""]
    return "\n".join(out)


MIT_BODY = """Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""


def python_section():
    path = os.path.join(sys.base_prefix, "LICENSE.txt")
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read().strip()
    v = sys.version.split()[0]
    return "\n".join([f"## Python@{v}", "", "- 用途: アプリの実行環境（同梱）", "- License: PSF-2.0（同梱部品はそれぞれのライセンス。下記全文）",
                      "- Homepage: https://www.python.org/", "", "```", text, "```", ""])


def read(name):
    with open(os.path.join(HERE, "notices", name), encoding="utf-8") as f:
        return f.read().strip() + "\n"


def ffmpeg_section():
    """FFmpeg（vendor/ffmpeg・tools/fetch-ffmpeg.py で取得）の表示。版・構成・LGPL v3 の全文。"""
    d = os.path.join(ROOT, "vendor", "ffmpeg")
    ver_path = os.path.join(d, "VERSION.txt")
    lic_path = os.path.join(d, "LICENSE.txt")
    if not (os.path.isfile(ver_path) and os.path.isfile(lic_path)):
        raise SystemExit("vendor/ffmpeg がありません。先に tools/fetch-ffmpeg.py を実行してください。")
    ver = open(ver_path, encoding="utf-8").read().strip()
    lic = open(lic_path, encoding="utf-8", errors="replace").read().strip()
    # 組み込まれている部品（LAME・OpenH264 など）の許諾は tools/make-ffmpeg-notices.py が notices/ffmpeg-libs.md に集める
    if not os.path.isfile(os.path.join(HERE, "notices", "ffmpeg-libs.md")):
        raise SystemExit("notices/ffmpeg-libs.md がありません。先に tools/make-ffmpeg-notices.py を実行してください。")
    return "\n".join([read("ffmpeg-head.md").rstrip(), "", "### 版と構成（ffmpeg -version）", "", "```", ver, "```", "",
                      "### GNU Lesser General Public License version 3", "", "```", lic, "```", "",
                      read("ffmpeg-libs.md")])


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parts = [HEADER]
    for name, role in PACKAGES:
        parts += ["---", "", section(name, role)]
    parts += ["---", "", read("pdfjs.md"), "", "---", "", ffmpeg_section(), "---", "", python_section(), "---", "",
              read("fonts-tail.md")]
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(parts))
    print("作成:", OUT)


if __name__ == "__main__":
    main()
