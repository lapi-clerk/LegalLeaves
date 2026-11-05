# -*- coding: utf-8 -*-
"""
出力ファイルを「壊れた状態で残さない」書き込み（Electron 版 file-io.js の移植・監査⑤ SEC-A4）。

  1) 同じフォルダ内の一時ファイルへ全部書く
  2) ディスクへ確実に書き出す（fsync）
  3) 完成してから最終的な名前へ改名する

途中で失敗したら一時ファイルを消すだけで、最終名は作られない。
"""
import itertools
import os
import shutil
import time

_seq = itertools.count(1)


def _temp_path_for(dest_path):
    d = os.path.dirname(dest_path)
    base = os.path.basename(dest_path)
    # ドット始まりにして、万一残っても目立たない／並行実行でも衝突しない名前にする
    return os.path.join(d, f".{base}.part-{os.getpid()}-{int(time.time() * 1000)}-{next(_seq)}")


def _remove_quietly(p):
    try:
        if p and os.path.exists(p):
            os.unlink(p)
    except OSError:
        pass  # 消せなくても本処理の失敗を上書きしない


def write_atomic(dest_path, data):
    """data（bytes / str）を dest_path へ壊れない形で書く。既存ファイルは置き換える。"""
    if isinstance(data, str):
        data = data.encode("utf-8")
    tmp = _temp_path_for(dest_path)
    try:
        with open(tmp, "xb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())  # 改名前に中身をディスクへ確定させる
        os.replace(tmp, dest_path)
        return dest_path
    except BaseException:
        _remove_quietly(tmp)
        raise


def copy_atomic(src_path, dest_path):
    """src_path を dest_path へ壊れない形でコピーする（音声・動画などの素通しコピー用）。"""
    tmp = _temp_path_for(dest_path)
    try:
        shutil.copyfile(src_path, tmp)
        with open(tmp, "r+b") as f:
            os.fsync(f.fileno())
        os.replace(tmp, dest_path)
        return dest_path
    except BaseException:
        _remove_quietly(tmp)
        raise
