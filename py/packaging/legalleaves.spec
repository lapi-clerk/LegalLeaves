# -*- mode: python ; coding: utf-8 -*-
# PyInstaller の設定（py/packaging/build.ps1 から使う）。
# フォルダ形式（onedir）で固める。1ファイル形式（onefile）は起動のたびに一時フォルダへ展開するので遅い
# （Electron 版のポータブル exe が約12秒かかっていたのと同じ理由）。
import os

PY = os.path.abspath(os.path.join(SPECPATH, ".."))          # LegalLeaves/py
ROOT = os.path.abspath(os.path.join(PY, ".."))               # LegalLeaves

# 画面（Electron 版と共通の src/）と、実行時に読む assets だけを同梱する。
# 展開先（_internal）でも src/・assets/ が並ぶので、legalleaves/paths.py の resource_path がそのまま使える。
datas = [
    (os.path.join(ROOT, "src"), "src"),
    (os.path.join(ROOT, "assets", "fonts"), os.path.join("assets", "fonts")),
    (os.path.join(ROOT, "assets", "templates"), os.path.join("assets", "templates")),
    (os.path.join(ROOT, "assets", "brand-logo.png"), "assets"),
    (os.path.join(ROOT, "assets", "ai-prompt.md"), "assets"),
    (os.path.join(ROOT, "assets", "ai-prompt-rename-only.md"), "assets"),
    (os.path.join(ROOT, "assets", "LICENSE.txt"), "assets"),
    (os.path.join(ROOT, "assets", "THIRD-PARTY-NOTICES.md"), "assets"),
    (os.path.join(PY, "legalleaves", "web"), os.path.join("legalleaves", "web")),
    # v5.4.0: 音声・動画の変換の部品（ffmpeg・LGPL 版・DLL 分割）。tools/fetch-ffmpeg.py で vendor/ffmpeg に取得しておく
    (os.path.join(ROOT, "vendor", "ffmpeg"), os.path.join("vendor", "ffmpeg")),
]
if not os.path.isfile(os.path.join(ROOT, "vendor", "ffmpeg", "ffmpeg.exe")):
    raise SystemExit("vendor/ffmpeg がありません。先に tools/fetch-ffmpeg.py を実行してください（py/README.md を参照）。")

a = Analysis(
    [os.path.join(PY, "launcher.py")],
    pathex=[PY],
    datas=datas,
    hiddenimports=[],
    excludes=[
        # 使わない標準ライブラリ・部品（容量を減らす）
        "tkinter", "unittest", "pydoc", "test", "lib2to3", "xmlrpc",
        "webview.platforms.cef", "webview.platforms.qt", "webview.platforms.gtk",
        "webview.platforms.cocoa", "webview.platforms.android",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LegalLeaves",
    icon=os.path.join(ROOT, "build", "icon.ico"),
    version=os.path.join(SPECPATH, "version_info.txt"),
    console=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="LegalLeaves", upx=False)
