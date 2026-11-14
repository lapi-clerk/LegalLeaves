# -*- coding: utf-8 -*-
"""
読み込みから出力の計画までを通す: 形式チェック → 照合 → 確認画面の一覧 → 出力前チェック → 出力の計画 →
証拠説明書のデータ。

入力は 2 通り（test/tables/flow.json と同じ形）:
  {"files": [...], "ai": {...} または "aiText": "...", "settings": {...}}   読み込んだファイルと AI の整理データから
  {"reviewFiles": [...], "caseInfo": {...}, "settings": {...}}             確認画面で人が手直しした後の一覧から

ここは判定の結果を返すだけで、ファイルは書かない。
"""
import json

from . import checks, contract, explanation, matching, plan
from .session import Session


def run_flow(data):
    settings = data.get("settings") or {}
    out = {}
    if data.get("reviewFiles") is not None:
        st = Session(settings=settings)
        st.review_files = data["reviewFiles"]
        st.case_info = data.get("caseInfo") or None
        st.explanation_exists = bool(data.get("explanationExists"))
    else:
        ai_text = data.get("aiText")
        if ai_text is None:
            ai_text = json.dumps(data["ai"], ensure_ascii=False) if data.get("ai") is not None else ""
        st = Session(files=data.get("files") or [], ai_text=ai_text, settings=settings)
        st.ai_json_error = contract.validate_ai_json(st.ai_text)
        out["aiJsonError"] = st.ai_json_error
        if st.ai_json_error:
            return out
        matching.build_review_files(st)
        out["reviewFiles"] = st.review_files
        out["orphanEntries"] = [e.get("original_file_name") for e in st.orphan_entries]
        out["consistency"] = st.consistency
        out["aiWarnings"] = st.ai_warnings
        out["caseInfo"] = st.case_info
        out["explanationExists"] = st.explanation_exists
    out["mismatches"] = [checks.filename_number_mismatch(st, rf) for rf in st.review_files]
    out["outputIssues"] = checks.compute_output_issues(st)
    out["outputPlan"] = plan.build_output_plan(st)
    out["explanationFileName"] = explanation.explanation_file_name(st)
    out["explanationData"] = explanation.build_explanation_data(st)
    return out
