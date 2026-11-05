# Bundled font — NotoSansJP-stamp.ttf

証拠番号スタンプ（`pdf-engine.js`）が使う日本語フォントです。

## 出所とライセンス
- **元フォント**: Noto Sans JP（Google, SIL Open Font License 1.1）
- システム同梱の可変フォント `C:\Windows\Fonts\NotoSansJP-VF.ttf` を元に生成。
- OFL 1.1 のため改変・再配布可。ライセンス全文＋著作権表記は同梱の [`OFL.txt`](OFL.txt)（`assets/**` で配布物に含まれる）。

## なぜ「事前サブセット＋丸ごと埋め込み」なのか
pdf-lib のサブセッタは Noto CJK のグリフを壊す（可変・静的いずれも）。
そのため pdf-lib では再サブセットせず（`embedFont(..., { subset: false })`）、
事前に fonttools で必要文字だけに絞ったフォントを丸ごと埋め込む。

## 再生成手順
文字セットを増やす場合（例: 新しい漢字をラベルに使う）:

```bash
# 1) 可変フォント → 静的フォント（ウェイト400）
python -m fontTools.varLib.instancer "C:/Windows/Fonts/NotoSansJP-VF.ttf" \
  wght=400 -o assets/fonts/NotoSansJP-Regular.ttf

# 2) 証拠ラベル用の文字だけにサブセット
python -m fontTools.subset assets/fonts/NotoSansJP-Regular.ttf \
  --unicodes="U+0020-007E,U+3000-303F,U+3040-30FF,U+FF00-FFEF,U+25B2" \
  --text="甲乙丙丁戊己庚辛壬癸弁検第号証之枝番本文用紙上領域〇一二三四五六七八九十百千" \
  --output-file=assets/fonts/NotoSansJP-stamp.ttf \
  --no-hinting --desubroutinize

# 3) 中間生成物は破棄してよい
rm assets/fonts/NotoSansJP-Regular.ttf
```

含まれる文字: ASCII / CJK記号 / ひらがな・カタカナ / 全角英数記号 / ▲ / 十干（甲乙丙…）/
弁・検（刑事の弁号証・検号証用）/ 第・号・証・枝・番 / 漢数字（〇一二…十百千）ほか。
スタンプ表記「甲第◯号証（の◯）」「弁第◯号証」等を網羅。
