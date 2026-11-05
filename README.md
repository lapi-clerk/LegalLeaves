# LegalLeaves

**e裁判の書類を、軽っと整える。**

裁判所の電子提出システム（mints）へ出す**提出用ファイルづくり**を支援する Windows デスクトップアプリです。
弁護士が手作業で行っていた次の作業を、**5ステップ**（読み込み → 照合 → 確認 → 出力 → 完了）でまとめて行います。

- 提出用の名前に変える（`甲001_契約書.pdf` のように）
- PDF に残った作成者名・事務所名などの情報（メタデータ）を消す
- 証拠番号のスタンプを押す（裁判所のタイムスタンプ帯と重ならない位置に）
- 枝番に分かれた証拠を1つの PDF にまとめる・1つの PDF をページで枝番に分ける
- 証拠説明書の下書きを Word で作る（裁判所の公式ひな形に準拠）
- Word・Excel・画像などを提出できる PDF に変換する

> **出力の最終確認は必ず弁護士が行ってください。** 特に証拠説明書の立証趣旨は「下書き」です。

## 入手・使い方

- **インストーラ:** [ダウンロードページ（Releases）](https://github.com/lapi-clerk/LegalLeaves/releases) の最新版にある
  `LegalLeaves-Setup-○.○.○.exe`。各版の説明に SHA-256 を載せています。
- **使い方:** **[操作説明書](docs/操作説明書.md)**（インストーラには PDF 版が入っています）
- **変更の記録:** [変更履歴](docs/CHANGELOG.md)
- **ご意見・不具合:** [Issues](https://github.com/lapi-clerk/LegalLeaves/issues)。
  書いた内容は誰でも見られます。**依頼者のファイルや、依頼者名・事件番号が写った画面は載せないでください。**

動作環境: **Windows 10 / 11**（画面の表示に Windows の WebView2 を使います）。
Word・Excel 等を読み込むときと証拠説明書を PDF にするときは、Microsoft Office または LibreOffice が要ります。

## 仕組み（AI との役割分担）と、守秘義務の注意

ファイル一式とアプリが用意する定型の指示文（プロンプト）を**外部の AI**（Gemini・ChatGPT 等）へ渡し、
返ってきた整理データ（JSON）をアプリに貼り戻します。

| 担当 | すること |
| --- | --- |
| 外部の AI | どのファイルが何の証拠か、証拠番号、標目・作成者・立証趣旨の下書き、スタンプの位置・向き |
| LegalLeaves | ファイル名の照合、PDF の編集（スタンプ・回転・結合・A4/A3 への正規化）、メタデータ削除、証拠説明書の生成 |

- **LegalLeaves 自体は外部と一切通信しません。** 画面の配信もこのパソコンの中（127.0.0.1）だけです。
- AI にファイルを渡すのは**利用者の操作**です。添付したファイルは外部の AI サービスに送信されるので、
  **所属先で認められたサービス・アカウント**を使い、**入力が学習に使われない設定**になっているか確かめてください。
  AI を使わずに進むこともできます（ファイル名に号証番号を付けておく方法。操作説明書の第6章）。
- AI との約束（整理データの形）は [docs/ai-contract.md](docs/ai-contract.md)、指示文は [assets/ai-prompt.txt](assets/ai-prompt.txt) です。

## 開発

アプリは **Python＋pywebview**（WebView2 の専用の窓）で動きます。作り・テスト・配布物の作り方・落とし穴は
**[py/README.md](py/README.md)** にまとめてあります。要点だけ:

```powershell
python -m venv py\.venv; py\.venv\Scripts\python -m pip install -r py\requirements.txt
npm install          # テスト用の部品だけ（pdf-lib・pdf.js）
npm start            # 開発起動（src/ を直接使う）
npm test             # 自動テスト
npm run dist         # 説明書PDF（Edge で印刷）＋ インストーラ（py\build\out\）
```

- **依頼者の実データ・出力物はリポジトリに入れないでください。** `tmp/`・`出力テスト/`・`py/build/` は `.gitignore` 済みです。
- 試験用のサンプルは `tools/` の道具で作ります（すべて架空のデータです）。

| フォルダ | 役割 |
| --- | --- |
| `py/legalleaves/` | アプリ本体（Python）。窓・処理・PDF 編集・証拠説明書の生成 |
| `py/packaging/` | 配布物づくり（PyInstaller のフォルダ形式＋NSIS のユーザー単位インストーラ） |
| `src/` | 画面（HTML・CSS・スクリプト。`app-*.js` は書いた順に読み込むクラシックスクリプト） |
| `assets/` | 指示文・フォント・証拠説明書テンプレート・ライセンス |
| `build/` | 説明書 PDF を作る道具・PDF.js の取り込み・アイコン |
| `test/` | 自動テスト（`npm test`） |
| `tools/` | 試験用サンプルの生成・タイムスタンプ帯の計測 |

## 協力のお願い（タイムスタンプ帯の位置）

mints 提出後に付く裁判所のタイムスタンプ帯の位置は、**A4 縦だけ実測済み**です。A4 横・A3 の位置を測る手順を
[docs/timestamp-band-measurement.md](docs/timestamp-band-measurement.md) にまとめています（帯の中の文字＝事件番号や当事者名は不要です）。

## ライセンス

MIT（[LICENSE](LICENSE)）。無償・無保証です。同梱している部品のライセンスは
[assets/THIRD-PARTY-NOTICES.md](assets/THIRD-PARTY-NOTICES.md) を見てください。
