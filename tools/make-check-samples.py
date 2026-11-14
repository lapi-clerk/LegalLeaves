# -*- coding: utf-8 -*-
"""
確認の手順（docs/確認の手順.md）で使う見本ファイルを作る。

  py\\.venv\\Scripts\\python tools\\make-check-samples.py [出力先フォルダ] [--force]

  出力先を省くと、ドキュメントの中の「LegalLeaves確認用」に作る。
  すでにあるフォルダには上書きしない（作り直すときは --force を付ける）。

作るのは、手順書の確認ごとに分けた 4 つのフォルダ。フォルダ名・ファイル名は手順書と同じにしてある
（変えるときは、手順書も合わせて直すこと）。

  1_名前だけ整える      「リネーム＋メタデータ削除」で、番号が二重にならないことを見る
  2_AIを使わずに進む    アプリ自身が付けた形の枝番（甲002_1_…）を読めること・正しくない番号（甲0）の扱いを見る
  3_枝番の範囲          結合する名前の範囲が「1～3」になることを見る（枝番そのものが範囲「2～3」のファイルがある。
                        枝番は AI の整理データで付けるので、貼り付け用の「3_枝番の範囲_整理データ.txt」も作る）
  4_AIからつなぐ        AI に整理データを作ってもらう材料（名前に番号が無い 4 つの書類）

中身はすべて架空で、実在の事件・会社・人は含まない。どのページにも大きく「見本」と書く。
文字はそのまま読める PDF にする（AI が中身を読んで整理データを作れるように）。
使う部品は、アプリと同じ reportlab だけ。日本語のフォントは Windows 標準のものを使う
（アプリに同梱の番号用フォントは、番号に使う文字しか入っていないため）。
"""
import json
import os
import shutil
import sys

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_NAME = "SampleJP"
# 上から順に探し、最初に読めたものを使う（.ttc は中の 1 つ目の書体を使う）
FONT_CANDIDATES = [
    (r"C:\Windows\Fonts\yumin.ttf", None),
    (r"C:\Windows\Fonts\YuGothM.ttc", 0),
    (r"C:\Windows\Fonts\msgothic.ttc", 0),
    (r"C:\Windows\Fonts\meiryo.ttc", 0),
]

# フォルダ → [(ファイル名, 見出し, 本文の行)]
SAMPLES = {
    "1_名前だけ整える": [
        ("甲1_契約書.pdf", "売買契約書", ["売主　株式会社見本商事（架空）", "買主　見本工業株式会社（架空）", "代金　金１００万円", "令和６年４月１日"]),
        ("甲2_領収書.pdf", "領収書", ["見本工業株式会社（架空）　御中", "金１００万円", "上記のとおり領収しました。", "令和６年４月３０日　株式会社見本商事（架空）"]),
        ("甲3.pdf", "メモ", ["番号だけの名前のファイルです。"]),
    ],
    "2_AIを使わずに進む": [
        ("甲001_契約書.pdf", "売買契約書", ["売主　株式会社見本商事（架空）", "買主　見本工業株式会社（架空）", "代金　金１００万円", "令和６年４月１日"]),
        ("甲002_1_請求書.pdf", "請求書", ["見本工業株式会社（架空）　御中", "金１００万円", "令和６年４月１０日　株式会社見本商事（架空）"]),
        ("甲002_2_領収書.pdf", "領収書", ["見本工業株式会社（架空）　御中", "金１００万円", "令和６年４月３０日　株式会社見本商事（架空）"]),
    ],
    "3_枝番の範囲": [
        ("写真の1.pdf", "写真（１枚目）", ["架空の現場の写真の代わりのページです。"]),
        ("写真の2と3.pdf", "写真（２枚目と３枚目）", ["架空の現場の写真の代わりのページです。", "２枚目と３枚目を 1 つのファイルにまとめたもの、という想定です。"]),
    ],
    "4_AIからつなぐ": [
        ("契約書.pdf", "売買契約書", ["売主　株式会社見本商事（架空）", "買主　見本工業株式会社（架空）", "目的物　事務用の机　１０台", "代金　金１００万円", "支払期日　令和６年４月３０日", "契約日　令和６年４月１日"]),
        ("請求書.pdf", "請求書", ["見本工業株式会社（架空）　御中", "事務用の机　１０台の代金として", "金１００万円", "令和６年４月１０日", "株式会社見本商事（架空）"]),
        ("領収書.pdf", "領収書", ["見本工業株式会社（架空）　御中", "金５０万円", "ただし、事務用の机の代金の一部として", "令和６年４月３０日", "株式会社見本商事（架空）"]),
        ("催告書.pdf", "催告書", ["見本工業株式会社（架空）　御中", "残りの代金 金５０万円を、本書が届いてから７日以内にお支払いください。", "令和６年６月１日", "株式会社見本商事（架空）"]),
    ],
}

# 「3_枝番の範囲」に貼り付ける AI の整理データ（docs/ai-contract.md の形）。2 つ目のファイルの枝番が範囲（2～3）。
# 「～」は全角チルダ（U+FF5E）。見た目が同じ波ダッシュ（U+301C）にしないこと
PLAN_FILE = "3_枝番の範囲_整理データ.txt"
PLAN = {
    "schema_version": "2.0",
    "evidence_explanation": {"exists": False, "file_name": None, "first_evidence_number": None, "last_evidence_number": None},
    "files": [
        {"original_file_name": "写真の1.pdf", "type": "証拠", "title": "写真", "suggested_base_name": "甲005_1_写真",
         "evidence_number": "甲005", "branch_range": "1", "needs_user_confirmation": False},
        {"original_file_name": "写真の2と3.pdf", "type": "証拠", "title": "写真", "suggested_base_name": "甲005_2～3_写真",
         "evidence_number": "甲005", "branch_range": "2～3", "needs_user_confirmation": False},
    ],
    "warnings": [],
}


def register_font():
    for path, index in FONT_CANDIDATES:
        if not os.path.isfile(path):
            continue
        try:
            font = TTFont(FONT_NAME, path) if index is None else TTFont(FONT_NAME, path, subfontIndex=index)
            pdfmetrics.registerFont(font)
            return path
        except Exception:
            continue
    raise SystemExit("日本語のフォントが見つかりませんでした（Windows の游明朝・游ゴシック・MS ゴシック・メイリオのどれかが必要です）。")


def make_pdf(path, heading, lines):
    w, h = A4
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle("見本")
    c.setFillColorRGB(0.82, 0.82, 0.82)  # 実物と間違えないよう、薄く大きく「見本」
    c.setFont(FONT_NAME, 120)
    c.drawCentredString(w / 2, h / 2 - 40, "見本")
    c.setFillColorRGB(0, 0, 0)
    c.setFont(FONT_NAME, 22)
    c.drawCentredString(w / 2, h - 110, heading)
    c.setFont(FONT_NAME, 12)
    y = h - 170
    for line in lines:
        c.drawString(90, y, line)
        y -= 24
    c.setFont(FONT_NAME, 9)
    c.drawCentredString(w / 2, 50, "これは LegalLeaves の確認用の見本です。内容はすべて架空です。")
    c.showPage()
    c.save()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]
    root = os.path.abspath(args[0]) if args else os.path.join(os.path.expanduser("~"), "Documents", "LegalLeaves確認用")
    if os.path.exists(root):
        if not force:
            print(f"すでにあります: {root}")
            print("作り直すときは、最後に --force を付けて実行してください（見本の 4 つのフォルダを作り直します）。")
            return 0
        # 見本のフォルダだけを消して作り直す（ほかに置かれたものには触らない）
        for name in SAMPLES:
            shutil.rmtree(os.path.join(root, name), ignore_errors=True)
    register_font()
    for folder, files in SAMPLES.items():
        d = os.path.join(root, folder)
        os.makedirs(d, exist_ok=True)
        for name, heading, lines in files:
            make_pdf(os.path.join(d, name), heading, lines)
    # メモ帳で開いて全部を写せるよう、Windows の改行（CRLF）で書く
    with open(os.path.join(root, PLAN_FILE), "w", encoding="utf-8", newline="\r\n") as f:
        f.write(json.dumps(PLAN, ensure_ascii=False, indent=2) + "\n")
    print(f"見本ファイルを作りました: {root}")
    for folder, files in SAMPLES.items():
        print(f"  {folder}")
        for name, _heading, _lines in files:
            print(f"    {name}")
    print(f"  {PLAN_FILE}（貼り付け用の整理データ）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
