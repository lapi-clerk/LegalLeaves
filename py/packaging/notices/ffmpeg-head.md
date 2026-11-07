## FFmpeg（音声・動画の変換）

- 用途: 音声を .mp3、動画を .mp4 にする変換と、撮影場所などの情報（メタデータ）の削除（v5.4.0 から）
- License: GNU Lesser General Public License version 3（LGPL v3）。全文は下にあります。
- 同梱物: `vendor/ffmpeg/`（`ffmpeg.exe`・`ffprobe.exe`・`avcodec-*.dll` ほかの DLL）。
  DLL 分割の形で同梱しているので、利用者は同じ版の DLL を自分で作ったものに差し替えられます。
- 入手元（この版を作った手順）: BtbN/FFmpeg-Builds（https://github.com/BtbN/FFmpeg-Builds ）の
  Windows 64bit・LGPL・DLL 分割版。GPL の部品（libx264・libx265 など）は含みません。
- ソースコード: FFmpeg（https://ffmpeg.org/ ・ https://github.com/FFmpeg/FFmpeg ）。
  下の「版」にある `g` に続く英数字が、元にしたソースの版（コミット）です。
  FFmpeg に組み込まれている各部品（下の構成の `--enable-…`）の入手元・版・許諾の全文は、この項の最後
  「FFmpeg に組み込まれている部品」に載せています（上のビルド手順の `scripts.d/` から辿ったもの）。
  ソースコードの写しが必要な方は、GitHub の Issues でお知らせください。
- 動画の符号化には、主に Windows に入っている Media Foundation の H.264・AAC の符号化器を使います
  （Windows の部品で、本ソフトウェアには含みません）。
