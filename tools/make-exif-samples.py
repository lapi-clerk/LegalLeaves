# -*- coding: utf-8 -*-
"""
スマートフォンの写真の「向きの情報（EXIF の Orientation）」を試すためのサンプルを作る。

  python tools/make-exif-samples.py [出力先]   （既定: tmp/写真の向きサンプル）

どの写真も「エクスプローラーで見ると、上に赤い帯・左に青い帯・文字が正立」に見えるように、
画素はわざと回転・反転して保存し、向きの情報（1〜8）で正しい向きを指定してある。
（スマートフォンは、縦に持って撮っても画素は横向きのまま保存し、向きの情報で縦と記録することが多い）
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join("tmp", "写真の向きサンプル")
os.makedirs(out, exist_ok=True)

# 正しい向き（エクスプローラーでこう見えるべき姿）: 縦長 600x800、上に赤・左に青、真ん中に「上」
W, H = 600, 800
font = ImageFont.truetype(r"C:\Windows\Fonts\yumin.ttf", 160)
upright = Image.new("RGB", (W, H), (240, 240, 240))
g = ImageDraw.Draw(upright)
g.rectangle([0, 0, W, 90], fill=(200, 0, 0))        # 上: 赤
g.rectangle([0, 0, 70, H], fill=(0, 60, 200))       # 左: 青
g.text((W // 2 - 80, H // 2 - 100), "上", fill=(20, 20, 20), font=font)

# 向きの情報ごとに、表示するとき（exif_transpose）に行う変換の「逆」を画素に施して保存する
T = Image.Transpose
INVERSE = {
    1: None,
    2: T.FLIP_LEFT_RIGHT,
    3: T.ROTATE_180,
    4: T.FLIP_TOP_BOTTOM,
    5: T.TRANSPOSE,
    6: T.ROTATE_90,    # 表示時は ROTATE_270 → 逆は ROTATE_90
    7: T.TRANSVERSE,
    8: T.ROTATE_270,   # 表示時は ROTATE_90 → 逆は ROTATE_270
}
NOTE = {1: "そのまま", 2: "左右反転", 3: "180度", 4: "上下反転", 5: "反転＋回転", 6: "縦持ちでよくある（右に90度）",
        7: "反転＋回転", 8: "縦持ち（左に90度）"}
for o, inv in INVERSE.items():
    raw = upright.transpose(inv) if inv is not None else upright.copy()  # FLIP_LEFT_RIGHT は 0 なので is not None で判定
    exif = Image.Exif()
    exif[0x0112] = o
    name = f"甲{20 + o}_向き{o}_{NOTE[o]}.jpg"
    raw.save(os.path.join(out, name), "JPEG", quality=92, exif=exif.tobytes())
    print(name, raw.size)
