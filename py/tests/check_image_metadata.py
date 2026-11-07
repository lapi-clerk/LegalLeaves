# -*- coding: utf-8 -*-
"""写真の撮影日時・撮影場所（GPS）・機種などの情報が、出力に残らないかを確かめる（5.4.6）。

使い方（py フォルダで）: .venv\\Scripts\\python -I tests\\check_image_metadata.py <作業フォルダ>
  作業フォルダに架空の見本（EXIF つきの JPEG・文字情報つきの PNG）を作り、
  1) PDF にしたとき（向きの情報 1・6・5）  2) 名前だけ整えて写すとき（リネーム＋メタデータ削除）
  の両方で、情報が残らず、画素が変わらないことを確かめる。失敗すると 1 で終わる。
"""
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import pypdf  # noqa: E402
from PIL import Image, PngImagePlugin  # noqa: E402

from legalleaves import pdf_engine, service  # noqa: E402

MARKS = (b"Exif", b"Apple", b"iPhone", b"Taro")


def exif_bytes(orientation):
    ex = Image.Exif()
    ex[0x0112] = orientation
    ex[0x010F] = "Apple"
    ex[0x0110] = "iPhone 15"
    ex[0x8769] = {0x9003: "2025:10:16 19:03:12"}
    ex[0x8825] = {1: "N", 2: (34.0, 20.0, 35.52), 3: "E", 4: (135.0, 13.0, 52.3)}
    return ex.tobytes()


def pixels(b):
    with Image.open(io.BytesIO(b)) as im:
        return im.convert("RGB").tobytes()


def pdf_payload(path):
    raw = open(path, "rb").read()
    for page in pypdf.PdfReader(path).pages:
        for _, v in (page["/Resources"].get("/XObject") or {}).items():
            raw += v.get_object().get_data()
    return raw


def main(work):
    os.makedirs(work, exist_ok=True)
    bad = []

    def check(label, ok):
        print(("OK  " if ok else "NG  ") + label)
        if not ok:
            bad.append(label)

    for o in (1, 6, 5):
        im = Image.new("RGB", (400, 300), (200, 120, 80))
        im.paste((10, 200, 30), (0, 0, 100, 60))
        src = os.path.join(work, f"o{o}.jpg")
        im.save(src, exif=exif_bytes(o), quality=90)
        dest = os.path.join(work, f"o{o}.pdf")
        pdf_engine.stamp_evidence({"srcPath": src, "destPath": dest, "evidenceNumber": "甲001", "stamps": [],
                                   "clearMetadataKeys": [], "normalize": True})
        payload = pdf_payload(dest)
        check(f"JPEG（向き {o}）→ PDF に情報が残らない", not any(m in payload for m in MARKS))

    png = os.path.join(work, "p.png")
    info = PngImagePlugin.PngInfo()
    info.add_text("Author", "Taro Yamada")
    Image.new("RGB", (50, 40), (1, 2, 3)).save(png, pnginfo=info, exif=exif_bytes(1))
    pdf_engine.stamp_evidence({"srcPath": png, "destPath": os.path.join(work, "p.pdf"), "evidenceNumber": "甲002",
                               "stamps": [], "clearMetadataKeys": [], "normalize": True})
    check("PNG → PDF に情報が残らない", not any(m in pdf_payload(os.path.join(work, "p.pdf")) for m in MARKS))

    # 名前だけ整えて写す（リネーム＋メタデータ削除）
    s = service.Session()
    out_dir = os.path.join(work, "rename")
    os.makedirs(out_dir, exist_ok=True)
    srcs = [os.path.join(work, "o1.jpg"), png, os.path.join(work, "o6.jpg")]
    s.register_paths(srcs)
    r = s.build_outputs_into([{"destName": f"甲00{i + 1}_写真", "sources": [{"srcPath": p}]} for i, p in enumerate(srcs)],
                             out_dir, rename_only=True)
    check("名前だけ整える: 書き出せた", not r["errors"] and len(r["written"]) == 3)
    for w, src in zip(r["written"], srcs):
        data = open(w["path"], "rb").read()
        with Image.open(io.BytesIO(data)) as im:
            ex = im.getexif()
            orient, gps, model = ex.get(0x0112, 1), ex.get_ifd(0x8825), ex.get(0x0110)
            when = ex.get_ifd(0x8769).get(0x9003)
        with Image.open(src) as im:
            orient_src = im.getexif().get(0x0112, 1)
        check(f"名前だけ整える: {w['name']} に撮影場所・機種・撮影日時・文字情報が残らない",
              not gps and not model and not when and not any(m in data for m in (b"Apple", b"iPhone", b"Taro")))
        check(f"名前だけ整える: {w['name']} の向きの情報は元のまま（{orient_src}）", orient == orient_src)
        check(f"名前だけ整える: {w['name']} の画素は元と同じ", pixels(data) == pixels(open(src, "rb").read()))

    print("NG: " + str(len(bad)) if bad else "すべて OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1]))
