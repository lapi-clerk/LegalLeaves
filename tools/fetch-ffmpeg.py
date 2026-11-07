# -*- coding: utf-8 -*-
r"""
音声・動画の変換に使う ffmpeg（LGPL 版・DLL 分割）を取ってきて vendor/ffmpeg/ に置く（開発・配布物づくり用）。

  py\.venv\Scripts\python tools\fetch-ffmpeg.py            （配布元から取得）
  py\.venv\Scripts\python tools\fetch-ffmpeg.py 手元のzip   （取得済みの zip を使う）

- 配布元: BtbN/FFmpeg-Builds（https://github.com/BtbN/FFmpeg-Builds）の「latest」にある
  ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip。同じ所の checksums.sha256 と照らして、一致しなければ止める。
- GPL の部品（libx264・libx265）を含まない LGPL 版。DLL 分割なので、利用者が DLL を差し替えられる（LGPL の条件）。
- 使う分だけ（ffmpeg.exe・ffprobe.exe・DLL・LICENSE.txt）を写し、取得した版を VERSION.txt に書く。
- vendor/ はリポジトリに入れない（.gitignore）。大きいため（約150MB）。
"""
import hashlib
import io
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEST = os.path.join(ROOT, "vendor", "ffmpeg")
ZIP_NAME = "ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip"
BASE = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
KEEP_EXE = {"ffmpeg.exe", "ffprobe.exe"}  # ffplay.exe（再生用）は使わない


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "LegalLeaves-build"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def main():
    if len(sys.argv) > 1:
        data = open(sys.argv[1], "rb").read()
        sums = None
        print("手元の zip を使います:", sys.argv[1])
    else:
        print("取得します:", BASE + ZIP_NAME)
        data = fetch(BASE + ZIP_NAME)
        sums = fetch(BASE + "checksums.sha256").decode("utf-8", "replace")
    digest = hashlib.sha256(data).hexdigest()
    if sums is not None:
        expected = next((ln.split()[0] for ln in sums.splitlines() if ln.strip().endswith(ZIP_NAME)), None)
        if expected != digest:
            raise SystemExit(f"SHA-256 が配布元の値と一致しません（配布元 {expected} / 取得 {digest}）。止めます。")
        print("SHA-256 が配布元の値と一致しました:", digest)

    z = zipfile.ZipFile(io.BytesIO(data))
    if os.path.isdir(DEST):
        shutil.rmtree(DEST)
    os.makedirs(DEST)
    kept = []
    for info in z.infolist():
        parts = info.filename.split("/")
        name = parts[-1]
        if info.is_dir() or not name:
            continue
        in_bin = len(parts) >= 2 and parts[-2] == "bin"
        if (in_bin and (name.lower().endswith(".dll") or name.lower() in KEEP_EXE)) or name == "LICENSE.txt":
            with z.open(info) as s, open(os.path.join(DEST, name), "wb") as d:
                shutil.copyfileobj(s, d)
            kept.append(name)
    ver = subprocess.run([os.path.join(DEST, "ffmpeg.exe"), "-hide_banner", "-version"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    first = ver.splitlines()[0] if ver else "(版を読めませんでした)"
    with open(os.path.join(DEST, "VERSION.txt"), "w", encoding="utf-8") as f:
        f.write(f"{first}\n配布元: {BASE}{ZIP_NAME}\nSHA-256: {digest}\n\n{ver}")
    size = sum(os.path.getsize(os.path.join(DEST, n)) for n in os.listdir(DEST))
    print(first)
    print(f"写しました: {DEST}（{len(kept)} ファイル・{size / 1048576:.0f}MB）")


if __name__ == "__main__":
    main()
