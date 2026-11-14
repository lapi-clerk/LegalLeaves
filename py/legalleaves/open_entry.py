# -*- coding: utf-8 -*-
"""
確認画面から開く入口。

  LegalLeaves.exe --open <整理データ.json> --files <フォルダ> [--include-outputs]
  LegalLeaves.exe --open - --files <フォルダ>          （整理データを標準入力から渡す）

人が「ファイルを入れる → 整理データを貼り付ける → 照合して進む」をしたのと同じ状態で、窓を開く。
ここから先（確認・書き出し）は、今までどおり人が画面で行う。

決まり:
  - **書き出さない。** この入口がするのは、読み込みと貼り付けの代わりだけ
  - **貼り付けと同じ関門を通す。** 整理データは、画面が貼り付けのときと同じ検査（形式・上限）にかける。
    検査を通らなければ、読み込み画面で止まり、いつもの誤りの文が出る。別の読み込み経路は作らない
  - ファイルは、画面でフォルダを落としたときと同じ決まりで受け付ける（service.Session.register_paths）。
    前に書き出した「提出用ファイル」のフォルダは、点検（check.py）と同じく読まない。読まなかったことは画面に出す
  - 整理データをアプリの保存場所に残さない（メモリの中で画面へ渡すだけ）
  - 画面には「外から開いた」ことを出す（人が自分で入れたものと取り違えないように）
"""
import os
import sys

from . import check

USAGE = "使い方: LegalLeaves.exe --open <整理データ.json または -> --files <フォルダ>"


class OpenError(Exception):
    """開けない誤り（利用者向けの文）"""


def parse_args(argv):
    opts = {}
    i = 0
    while i < len(argv):
        key = argv[i]
        if key in ("--open", "--files") and i + 1 < len(argv):
            opts[key[2:]] = argv[i + 1]
            i += 2
        elif key == "--include-outputs":
            opts["include_outputs"] = True
            i += 1
        else:
            raise OpenError(f"引数を読めません: {key}。{USAGE}")
    missing = [k for k in ("open", "files") if not opts.get(k)]
    if missing:
        raise OpenError(f"引数が足りません（{'・'.join('--' + k for k in missing)}）。{USAGE}")
    return opts


def _read_stdin():
    stdin = getattr(sys.stdin, "buffer", None)
    if stdin is None:
        raise OpenError("整理データを受け取れません（標準入力がつながっていません）。")
    data = stdin.read(check.MAX_PLAN_BYTES + 1)
    if len(data) > check.MAX_PLAN_BYTES:
        raise OpenError("整理データが大きすぎます（10MBまで）。")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise OpenError("整理データの文字コードを読めません（UTF-8 で渡してください）。")


def prepare(argv):
    """窓を開く前に、引数・フォルダ・整理データを読む。誤りがあれば窓を出さずに終わる。
    返すもの: {"planText", "folder", "paths", "skipped"}（ファイルの受け付けは、窓を開いてから行う）"""
    opts = parse_args(argv)
    folder = os.path.abspath(opts["files"])
    if not os.path.isdir(folder):
        raise OpenError("開くフォルダがありません。")
    try:
        plan_text = _read_stdin() if opts["open"] == "-" else check.read_plan_text(opts["open"])
    except check.CheckError as e:
        raise OpenError(str(e))
    if not plan_text.strip():
        raise OpenError("整理データが空です。")
    paths, skipped = check.list_paths(folder, bool(opts.get("include_outputs")))
    if not paths:
        raise OpenError("フォルダにファイルがありません。")
    return {"planText": plan_text, "folder": folder, "paths": paths, "skipped": skipped}


def main(argv):
    """起動の引数に --open があるときに呼ばれる。誤りがあれば 1 を返す（窓は出さない）。
    読めたら、準備したものを返す（app.main が窓を開く）"""
    try:
        return prepare(argv)
    except OpenError as e:
        check._say(f"開けませんでした: {e}")
        return 1
    except Exception as e:
        check._say(f"開けませんでした: {type(e).__name__}: {e}")
        return 1
