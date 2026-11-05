# -*- coding: utf-8 -*-
"""
同梱物（画面・フォント・プロンプト・テンプレート）の場所。

開発時は LegalLeaves/ の src/・assets/ をそのまま使い（画面のコードは Electron 版と共有）、
配布用に固めたときは PyInstaller の展開先（_internal）に同じ並びで入れる。
"""
import os
import sys


def app_root():
    """src/ と assets/ が並んでいるフォルダ。"""
    frozen = getattr(sys, "_MEIPASS", None)
    if frozen:
        return frozen
    # py/legalleaves/paths.py → LegalLeaves/
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def resource_path(*parts):
    return os.path.join(app_root(), *parts)
