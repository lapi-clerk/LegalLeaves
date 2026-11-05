# LegalLeaves（Python＋pywebview 版・v5）

v4 までの Electron 版を、処理だけ Python に移して作り直したもの。
画面のコードは v4 の `LegalLeaves/src/` をそのまま使い、呼び出し口（`window.api`）だけを差し替えている。
Electron 版のコード（main.js・pdf-engine.js 等）は、実機確認を終えて削除した（git の履歴には残る）。

作り直した理由: Electron 版のポータブル exe は起動のたびに約390MBを一時フォルダへ展開するため、
起動に約12秒かかり、配布ファイルも約100MBあった。この版は実測で **起動約1.7秒・インストーラ約21MB・
入る大きさ約43MB**（2026-10-28、このPCで計測）。

## 仕組み

| 部分 | 中身 |
| --- | --- |
| 窓 | pywebview（Windows 内蔵の Edge 部品 WebView2）。Chromium を同梱しないので軽い |
| 画面の配信 | 127.0.0.1 のみ（pywebview 内蔵の bottle）。`src/index.html` を配るときに `web/bridge.js` を差し込み、CSP に `connect-src 'self'` を足す |
| 画面 → Python | `web/bridge.js` が Electron 版 preload.js と同じ名前・同じ戻り値の `window.api` を用意し、`pywebview.api` を呼ぶ |
| PDF のバイト列 | 同じ 127.0.0.1 の `/bytes/preview`・`/bytes/source` から合言葉（`X-LL-Token`）つきで渡す（pywebview の呼び出しは JSON 経由で大きな値に向かない） |
| ドロップしたファイルの場所 | `bridge.js` がドロップの最中に WebView2 へファイルを渡し（`postMessageWithAdditionalObjects`）、pywebview の `_dnd_state` から場所を受け取る |

## ファイル

| ファイル | 役割 | v4（Electron 版）での対応 |
| --- | --- | --- |
| `legalleaves/app.py` | 起動・窓・画面の配信・`Api`（画面から呼ばれる窓口） | main.js の窓まわり |
| `legalleaves/service.py` | 読み込みの許可リスト・出力・プレビュー・Office 変換・プロンプト | main.js の処理 |
| `legalleaves/pdf_engine.py` | PDF 編集の唯一の境界（pypdf＋reportlab） | pdf-engine.js |
| `legalleaves/docx_engine.py` | 証拠説明書（テンプレートの差し込み） | docx-engine.js（docxtemplater） |
| `legalleaves/storage.py` | メモ・履歴・設定（`%APPDATA%\legal-leaves\data`。Electron 版と同じ場所） | main.js |
| `legalleaves/fileio.py` | 壊れた出力を残さない書き込み | file-io.js |
| `legalleaves/winutil.py` | クリップボード・確認ダイアログ・フォルダを開く | Electron の clipboard / dialog / shell |
| `legalleaves/selftest.py` | 開発用の自己点検（実際の窓で画面の関数を動かす） | — |
| `legalleaves/engine_cli.py` | テスト用の入口（`npm test` の JS のテストから Python の処理を呼ぶ） | — |
| `packaging/` | PyInstaller の設定・NSIS のインストーラ・作成手順（build.ps1）・ライセンス表示の作成（make_notices.py） | package.json の build |
| `tests/` | 実際の窓での通しの自己点検の手順（*.js）・インストーラの画面の操作試験（ui_installer.py） | — |

## 開発

```powershell
python -m venv py\.venv
py\.venv\Scripts\python -m pip install -r py\requirements.txt
cd py; .venv\Scripts\python -m legalleaves      # 開発起動（LegalLeaves\src を直接使う）
```

### テスト

```powershell
# 1) 自動テスト（v4 から引き継いだ判定基準のまま、Python の処理に当てる）
npm test
# 2) 実際の窓で、読み込み→照合→ページで分ける→プレビュー→出力 を通す
#    ほかの手順: tests\e2e_preview_images.js（写真の表示）・tests\e2e_rotate_image.js（プレビューで画像を回す）
#    LL_APPDATA_ROOT は必ず作業用の場所にする（本物のメモ・履歴を書き換えないため）
$env:LL_APPDATA_ROOT="<作業用>"; $env:LL_SELFTEST_OUT="<結果.json>"; $env:LL_SELFTEST_SCRIPT="tests\e2e_branch_split.js"
$env:LL_SELFTEST_FILES="<PDFのパスを | で区切る>"; $env:LL_SELFTEST_OUTDIR="<出力先>"
cd py; .venv\Scripts\python -m legalleaves
```

移行時の確認（記録）: v4 と v5 で同じ材料から出力し、ページを画像にして画素単位で比べた（8件中7件は差0、
回転した写真のふちだけ 0.036%）。証拠説明書の docx も v4（docxtemplater）と中身が同一だった。
比較に使った道具は v4 のコードを使うため、Electron 版の削除と一緒に外した。

インストーラの画面（最後の画面のチェック）は `py\tests\ui_installer.py <setup.exe> on|off|keep` で実際に操作して確かめられる
（インストールが実際に行われるので、試したあとの状態に注意）。

### 配布物を作る

```powershell
npm run dist        # 説明書PDF（Edge で印刷）→ インストーラ
```

`py\build\out\LegalLeaves-Setup-<版>.exe` と、ハッシュ値の控え（`.sha256.txt`）ができる。
ハッシュ値は配布物とは別の経路（メール本文など）で伝える。操作説明書の PDF（`dist\LegalLeaves 操作説明書.pdf`）は
`build\make-manual-pdf.js` が Windows 内蔵の Microsoft Edge で印刷して作り、インストーラに同梱する。
NSIS 3（makensis.exe）が必要（PATH・既定の場所・electron-builder のキャッシュの順に探す。
v4 のビルドで入ったキャッシュが無い PC では https://nsis.sourceforge.io/ から NSIS 3 を入れる）。

**部品の版を上げたら**、ライセンス表示を作り直す: `py\.venv\Scripts\python py\packaging\make_notices.py`
（`assets\THIRD-PARTY-NOTICES.md` を、同梱する部品のライセンスファイルから作る）。

インストーラの約束（利用者と合意済み）:
- 管理者権限なしで `%LOCALAPPDATA%\Programs\LegalLeaves` に入る。スタートメニューにアイコン
- デスクトップのショートカットは最後の画面で選べる（既定オン）。選択は `HKCU\Software\LegalLeaves\DesktopShortcut` に
  覚え、更新時も同じ状態で始まる（`/S` は前回の選択に従う。`/NODESKTOP` で作らない）
- アンインストールは Windows の「設定 → アプリ」から。メモ・履歴・設定も消すか確認する
  （はい＝`%APPDATA%\legal-leaves` ごと削除・いいえ＝`data` だけ残す。`/S` は全削除、`/S /KEEPDATA` は残す）
- ショートカット（デスクトップ・スタートメニュー・タスクバーのピン留め）・一時ファイル（`%TEMP%\legalleaves-*`）・
  旧名（`%APPDATA%\rakuraku-mints`）はどちらでも消す
- 上書きで入れ直す（更新する）ときは保存データに触れない

## 落とし穴（作り直しで踏んだもの）

- **js_api のオブジェクトに窓を公開の属性で持たせない**。pywebview が窓の内部まで辿り、終了時に固まる（`_window` のように `_` を付ける）
- **`text_select=True`** にしないと画面の文字を選べない（エラー文をコピーできない）
- **PyInstaller は onedir**。onefile は起動のたびに展開するので遅い（Electron ポータブル版と同じ問題）
- WebView2 の作業フォルダは終了時に部品自身が消すが、子プロセスの終了が遅いと消し残す。
  起動ごとに `%APPDATA%\legal-leaves\webview\s<pid>` を使い、終了時と次回起動時にこちらでも消している
- **pypdf の `DictionaryObject[...]` は参照を自動で解決する**。どの画像かを見分けるときは `raw_get` を使う
- **`bool(BooleanObject(False))` は True**。値は `.value` で見る
- 番号の配置はフォントの ascent に依存する。pdf-lib（fontkit）と同じく **hhea の ascent** を使う（reportlab の値は 880 で違う）
- PowerShell 5.1 と NSIS は、日本語を含むファイルを **BOM 付き UTF-8** でないと読めない
- 自動テストは Node（`npm test`）で動き、処理は `test/helpers/engine.js` → `engine_cli` 経由で Python を呼ぶ
  （v4 の判定基準を変えずに使うため。PDF の中身の読み取りに pdf.js、テスト用 PDF の作成に pdf-lib を使う）
- NSIS の `MUI_PAGE_CUSTOMFUNCTION_*` は**次に入れる画面**に付く。対象の画面の直前に置く
  （前に置いたら最初の画面に付き、最後の画面のチェックに前回の選択が反映されなかった）
- NSIS の最初の画面のボタンは、次が導入画面なら「次へ」ではなく「**インストール**」と表示される
- プレビューの「表示できませんでした」の判定（`src/app-preview.js` の pvPageImageBlank）は、文字の少ないページでも
  濃い画素が 0.1〜1% ある。描けなかったときの 0% と見分けるしきい値は 0.01%（0.5% では誤判定した）
