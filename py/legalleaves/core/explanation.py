# -*- coding: utf-8 -*-
"""
証拠説明書のデータの組み立て（名前と、表の 1 行ずつ）。

画面の src/app-explanation.js と同じ判定。号証欄の表記・全角半角の使い分けは公式のひな形に合わせている。
ここで作るのはデータだけで、Word のファイルは docx_engine が書く。
"""
from .js import jstr, s_, sym_sort_key, trim, truthy
from .naming import (branch_sort_key, explanation_evidence_label, is_valid_evidence_number, pad_evidence,
                     parse_evidence_number, to_full_width, to_half_width)

BLANK = "●●"  # 弁護士が埋める欄の印（Word で「●」を検索して見つけられる）
_CAPTURE_KINDS = ("写真", "スクリーンショット", "動画")


def branches_from_stamps(rf):
    """JS: branchesFromStamps。実際に押される枝番（ページごとに枝番が違う 1 ファイルを、枝番ごとの行に分けるため）"""
    stamps = rf.get("stamps")
    if not isinstance(stamps, list):
        return []
    found = []
    for s in stamps:
        b = trim(jstr(s["branch"])) if isinstance(s, dict) and s.get("branch") is not None else ""
        if b and b not in found:
            found.append(b)
    return sorted(found, key=branch_sort_key)


def evidence_range_label(st, rfs):
    """JS: evidenceRangeLabel。番号の範囲（甲001～甲002）。記号ごとに 1 つ"""
    parsed = [parse_evidence_number(rf.get("evidenceNumber")) for rf in rfs]
    parsed += [parse_evidence_number(ph.get("num")) for ph in st.placeholders]  # 空き枠も範囲に入れる
    by_sym = {}
    for p in parsed:
        if p and p["num"] >= 1:  # 番号として正しくないもの（「甲0」）は入れない
            by_sym.setdefault(p["sym"], []).append(p["num"])
    ranges = []
    for sym, nums in by_sym.items():
        lo, hi = min(nums), max(nums)
        ranges.append(pad_evidence(sym, lo) if lo == hi else f"{pad_evidence(sym, lo)}～{pad_evidence(sym, hi)}")
    return "・".join(ranges)


def explanation_base_name(st, rfs):
    """JS: explanationBaseName"""
    rng = evidence_range_label(st, rfs)
    return f"証拠説明書({rng})" if rng else "証拠説明書"


def explanation_file_name(st):
    """JS: explanationFileName"""
    return f"{explanation_base_name(st, st.review_files)}.docx"


def _mk(v):
    return v if truthy(v) and trim(jstr(v)) else BLANK


def _row(rf, branch):
    kind = rf.get("captureKind") or ""
    oc = trim(s_(rf.get("originalOrCopy")))
    if kind in _CAPTURE_KINDS:
        # 写真・スクリーンショット・動画: 標目＝種別（2 行目に撮影対象／撮影場所）、作成年月日＝撮影日時、作成者＝撮影者
        parts = []
        subject = trim(s_(rf.get("captureSubject")))
        location = trim(s_(rf.get("captureLocation")))
        if subject:
            parts.append(f"撮影対象：{to_full_width(subject)}")
        if kind in ("写真", "動画") and location:
            parts.append(f"撮影場所：{to_full_width(location)}")
        hyomoku = (to_full_width(rf.get("docName") or "") or kind) + (f"\n（{'／'.join(parts)}）" if parts else "")
        created = _mk(to_half_width(rf.get("captureDatetime") or rf.get("createdDate") or ""))
        author = _mk(to_full_width(rf.get("captureBy") or rf.get("author") or ""))
    else:
        hyomoku = _mk(to_full_width(rf.get("docName") or "")) + (f"\n（{to_full_width(oc)}）" if oc else "")
        created = _mk(to_half_width(rf.get("createdDate") or ""))  # 半角の和暦（R8.7.2）
        author = _mk(to_full_width(rf.get("author") or ""))
    return {
        "通常": True,
        "号証": explanation_evidence_label(rf.get("evidenceNumber"), branch or None),
        "標目": hyomoku,
        "作成年月日": created,
        "作成者": author,
        "立証趣旨": _mk(to_full_width(rf.get("proofPurpose") or "")),
        # 紙をスキャンして電磁的記録として出すもの（原本・写しの記載なし）は、備考に「紙を電子化」
        "備考": "紙を電子化" if not oc and truthy(rf.get("digitizedFromPaper")) else "",
    }


def build_explanation_data(st):
    """JS: buildExplanationData。証拠説明書のデータ。表は確認画面の一覧から作る（1 ファイル＝1 行、枝番ごとに 1 行）。
    頭書き（裁判所・事件番号・代理人）は、AI が主張書面から読めたときだけ入れ、無ければ ●● のままにする"""
    ci = st.case_info if isinstance(st.case_info, dict) else {}
    units = []
    for rf in st.review_files:
        if is_valid_evidence_number(rf.get("evidenceNumber")):  # 番号として正しくないものは行にしない
            units.append({"rf": rf, "p": parse_evidence_number(rf["evidenceNumber"]), "br": rf.get("branchRange")})
    for ph in st.placeholders:  # 空き枠（後で来る証拠のための空行）
        p = parse_evidence_number(ph.get("num"))
        if p and p["num"] >= 1:
            units.append({"ph": ph, "p": p, "br": ph.get("branch")})
    units.sort(key=lambda u: (sym_sort_key(u["p"]["sym"]), u["p"]["num"], branch_sort_key(u["br"])))

    rows = []
    symbol = ""
    for u in units:
        symbol = symbol or u["p"]["sym"]
        if "ph" in u:
            rows.append({"通常": True, "号証": explanation_evidence_label(u["ph"].get("num"), u["ph"].get("branch")),
                         "標目": BLANK, "作成年月日": BLANK, "作成者": BLANK, "立証趣旨": BLANK, "備考": ""})
            continue
        rf = u["rf"]
        stamp_branches = branches_from_stamps(rf)
        br = rf.get("branchRange")
        branches = stamp_branches if len(stamp_branches) >= 2 else [trim(jstr(br)) if truthy(br) else ""]
        rows.extend(_row(rf, b) for b in branches)

    side = "原告" if symbol.startswith("甲") else "被告" if symbol.startswith("乙") else ""
    lawyers = ci.get("lawyers")
    if isinstance(lawyers, list):
        lawyers = "　".join(to_full_width(x) for x in lawyers if truthy(x))
    else:
        lawyers = to_full_width(lawyers or "")
    party = ci.get("party") or side or ""  # 訴訟なら原告・被告、申立てなら申立人・相手方
    return {
        "事件番号": to_full_width(ci.get("case_number")) or "令和●年（●）第●号",
        "提出日": "令和●年●月●日",  # 提出日は弁護士が記入する
        "裁判所": to_full_width(ci.get("court")) or "●●裁判所",
        "提出者側": party or "●●",
        "代理人": lawyers or "●●　●●",
        "証拠": rows,
    }
