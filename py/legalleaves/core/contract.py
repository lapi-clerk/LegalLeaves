# -*- coding: utf-8 -*-
"""
AI の整理データの検査（形式・上限）と、証拠説明書との突き合わせ・提出者側と記号の食い違い。

画面の src/app-state.js（validateAiJson・checkAiLimits）と src/app-evidence.js（computeConsistency・
computePartySymbolWarnings）と同じ判定。結果は test/tables/contract.json で画面と突き合わせている。

外部の AI の出力は「信頼できない入力」として扱う。JSON として読めても、件数・文字数・数値が極端だと
後の処理が固まるので、ここで弾く。
"""
import json
import math

from .js import trim, utf16_len
from .naming import list_for_message, pad_evidence, parse_evidence_number

AI_LIMITS = {
    "files": 1000,      # 1 回の提出のファイル数
    "stamps": 500,      # 1 ファイルあたりの押印・回転の指示
    "warnings": 200,    # 警告の件数
    "name": 1000,       # ファイル名・標目・証拠番号など
    "text": 4000,       # 立証趣旨・確認事項など
    "pageNo": 100000,   # ページ番号
}
MAX_TEXT_LENGTH = 10 * 1024 * 1024
MAX_EVIDENCE_RANGE_SCAN = 2000  # 号証番号の範囲を 1 つずつ調べる上限
AI_BROKEN_HINT = "AIの整理データが壊れている可能性があります。AIの出力をそのまま貼り付け直してください。"
_NAME_KEYS = ["original_file_name", "suggested_base_name", "title", "evidence_number", "branch_range", "author", "created_date"]
_TEXT_KEYS = ["proof_purpose", "confirmation_question", "capture_subject", "capture_location", "capture_by", "capture_datetime"]


def _reject_constant(name):
    raise ValueError(name)  # NaN・Infinity は JSON ではない（画面の JSON.parse も弾く）


def parse_json(text):
    return json.loads(text, parse_constant=_reject_constant)


def _overlong(obj, keys, cap):
    for k in keys:
        v = obj.get(k)
        if isinstance(v, str) and utf16_len(v) > cap:
            return k
    return None


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_ai_limits(parsed):
    """JS: checkAiLimits。上限を超えていれば知らせの文、問題なければ None"""
    files = parsed["files"]
    if len(files) > AI_LIMITS["files"]:
        return f"ファイルの件数が多すぎます（{len(files)}件・{AI_LIMITS['files']}件まで）。{AI_BROKEN_HINT}"
    warnings = parsed.get("warnings")
    if isinstance(warnings, list) and len(warnings) > AI_LIMITS["warnings"]:
        return f"警告の件数が多すぎます（{AI_LIMITS['warnings']}件まで）。{AI_BROKEN_HINT}"
    for i, f in enumerate(files):
        where = f"{i + 1}件目のファイル"
        if not isinstance(f, dict):
            return f"データの形式が正しくありません（{where}の情報が読み取れません）。{AI_BROKEN_HINT}"
        if _overlong(f, _NAME_KEYS, AI_LIMITS["name"]):
            return f"{where}の項目が長すぎます（{AI_LIMITS['name']}文字まで）。{AI_BROKEN_HINT}"
        if _overlong(f, _TEXT_KEYS, AI_LIMITS["text"]):
            return f"{where}の文章が長すぎます（{AI_LIMITS['text']}文字まで）。{AI_BROKEN_HINT}"
        stamps = f.get("stamps")
        if stamps is not None and not isinstance(stamps, list):
            return f"データの形式が正しくありません（{where}の押印指示が読み取れません）。{AI_BROKEN_HINT}"
        if isinstance(stamps, list):
            if len(stamps) > AI_LIMITS["stamps"]:
                return f"{where}の押印指示が多すぎます（{len(stamps)}件・{AI_LIMITS['stamps']}件まで）。{AI_BROKEN_HINT}"
            for s in stamps:
                if s is None:
                    continue  # 空の要素は後で無視する
                if not isinstance(s, dict):
                    return f"データの形式が正しくありません（{where}の押印指示が読み取れません）。{AI_BROKEN_HINT}"
                page = s.get("page")
                if page is not None and (not _is_number(page) or not math.isfinite(page)
                                         or page < 1 or page > AI_LIMITS["pageNo"]):
                    return f"{where}のページ番号が正しくありません。{AI_BROKEN_HINT}"
    return None


def validate_ai_json(ai_text):
    """JS: validateAiJson。AI の整理データ（貼り付けた文字列）の形式の誤り。問題なければ空の文字列"""
    text = trim(ai_text or "")
    if not text:
        return ""
    if utf16_len(text) > MAX_TEXT_LENGTH:
        return "貼り付けられたデータが大きすぎます（10MBまで）。AIの整理データ(JSON)だけを貼り付けてください。"
    try:
        parsed = parse_json(text)
    except (ValueError, RecursionError):
        return "JSONの形式が正しくありません。AIの出力をそのまま貼り付けてください。"
    if not isinstance(parsed, dict) or not isinstance(parsed.get("files"), list):
        return "データの形式が正しくありません(filesが見つかりません)。"
    return check_ai_limits(parsed) or ""


def compute_consistency(review_files, ee):
    """JS: computeConsistency。証拠説明書に書かれた番号の範囲と、実際にある証拠ファイルの突き合わせ"""
    if not isinstance(ee, dict) or not ee.get("exists"):
        return None
    first_text = ee.get("first_evidence_number")
    last_text = ee.get("last_evidence_number")
    first = parse_evidence_number(first_text)
    last = parse_evidence_number(last_text)
    present = {}  # ("甲", 1) → "甲001"
    for rf in review_files:
        p = parse_evidence_number(rf.get("evidenceNumber"))
        if p:
            present[(p["sym"], p["num"])] = rf.get("evidenceNumber")
    issues = []
    rng = None
    file_name = ee.get("file_name") or None
    if first and last and first["sym"] == last["sym"] and first["num"] <= last["num"]:
        rng = f"{first_text}〜{last_text}"
        if last["num"] - first["num"] + 1 > MAX_EVIDENCE_RANGE_SCAN:
            issues.append(f"証拠説明書の番号範囲（{rng}）が広すぎるため、不足・範囲外の突き合わせはスキップしました。番号の記載をご確認ください。")
            return {"fileName": file_name, "range": rng, "issues": issues}
        missing = [pad_evidence(first["sym"], n) for n in range(first["num"], last["num"] + 1)
                   if (first["sym"], n) not in present]
        if missing:
            issues.append(f"証拠説明書は {rng} を記載していますが、次の証拠ファイルが見当たりません: {list_for_message(missing)}")
        extra = []
        for (sym, n), label in present.items():
            if (sym != first["sym"] or n < first["num"] or n > last["num"]) and label not in extra:
                extra.append(label)
        if extra:
            issues.append(f"証拠説明書の範囲外の証拠ファイルがあります: {list_for_message(extra)}")
    elif first_text or last_text:
        issues.append("証拠説明書の番号範囲を読み取れなかったため、範囲の突き合わせはスキップしました。")
    return {"fileName": file_name, "range": rng, "issues": issues}


def compute_party_symbol_warnings(review_files, ci):
    """JS: computePartySymbolWarnings。原告・申立人は甲、被告・相手方は乙。記号が逆なら知らせる"""
    party = ci.get("party") if isinstance(ci, dict) else None
    expected = "甲" if party in ("原告", "申立人") else "乙" if party in ("被告", "相手方") else None
    if not expected:
        return []
    wrong = []
    for rf in review_files:
        num = rf.get("evidenceNumber")
        p = parse_evidence_number(num)
        if p and not p["sym"].startswith(expected) and num not in wrong:
            wrong.append(num)
    if not wrong:
        return []
    return [
        f"提出者側は「{party}」のため、証拠番号は通常「{expected}」号証です（甲A・甲Bなどの系列も同様）。"
        f"異なる記号の番号が含まれています: {'、'.join(wrong)} — 号証記号の指定間違い（言い間違い）でないかご確認ください。"
    ]
