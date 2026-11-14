# -*- coding: utf-8 -*-
"""
判定に渡す「いまの状態」（画面の state のうち、判定が使う分）。

確認画面の一覧（review_files）の 1 件ずつは、画面と同じ項目名（evidenceNumber・branchRange・suggested など）の
辞書のまま持つ。画面と Python が同じデータをやり取りし、同じ表で比べるため、項目名は変えない。
"""
from .js import trim


class Session:
    def __init__(self, files=None, ai_text="", settings=None):
        s = settings or {}
        self.files = files or []                              # 読み込んだファイル [{path, name, ...}]
        self.ai_text = ai_text or ""                          # AI の整理データ（貼り付けた文字列）
        self.manual_matches = s.get("manualMatches") or {}    # 人が手で付けた対応 {ファイルの場所: AI 側の名前}
        self.no_ai = bool(s.get("noAi"))                      # 「AIを使わずに進む」
        self.rename_only = bool(s.get("renameOnly"))          # 「名前だけ整える」
        self.merge_disabled = set(s.get("mergeDisabled") or [])  # 「別々に出力」にした号証番号
        self.placeholders = s.get("placeholders") or []       # 空き枠 [{num, branch}]
        self.review_files = []                                # 確認画面の一覧
        self.case_info = None
        self.explanation_exists = False
        self.consistency = None
        self.ai_warnings = []
        self.ai_entries = []
        self.orphan_entries = []
        self.ai_json_error = ""

    def no_ai_data(self):
        """JS: noAiData。AI の整理データを使わずに進めているか"""
        return not trim(self.ai_text) and (self.rename_only or self.no_ai)
