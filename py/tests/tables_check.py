# -*- coding: utf-8 -*-
"""
判定の「答えの表」（test/tables/*.json）を、Python の判定（legalleaves/core）に通す。

同じ表を画面の判定にも通している（test/tables.test.js）。両方が同じ表に合えば、画面と Python の判定は
表にある範囲で同じ結果になる。表の形は test/tables/README.md を参照。

    py\\.venv\\Scripts\\python py\\tests\\tables_check.py        （npm test にも入っている）

表の期待値（expect）は画面側の --write で書く。こちらは比べるだけで、書き込まない。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "py"))

from legalleaves.core import contract, explanation, matching, naming, plan  # noqa: E402
from legalleaves.core.flow import run_flow  # noqa: E402
from legalleaves.core.session import Session  # noqa: E402

# 引数でフォルダを渡すと、そのフォルダの表を使う（test/compare-random.js が使う）
TABLE_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "test", "tables")
WAVE_DASH = "〜"  # 禁止の波ダッシュ（見た目は全角チルダ U+FF5E と同じ）


def _plain(fn):
    return lambda st, *a: fn(*a)


# 表の関数名（画面側の名前）→ Python の関数。st は画面の state に当たるもの
FUNCS = {
    "toFullWidth": _plain(naming.to_full_width),
    "fixWaveDash": _plain(naming.fix_wave_dash),
    "toHalfWidth": _plain(naming.to_half_width),
    "toHalfWidthFilenamePart": _plain(naming.to_half_width_filename_part),
    "parseEvidenceNumber": _plain(naming.parse_evidence_number),
    "padEvidence": _plain(naming.pad_evidence),
    "isValidEvidenceNumber": _plain(naming.is_valid_evidence_number),
    "shortNumberLabel": _plain(naming.short_number_label),
    "isCriminalEvidenceNum": _plain(naming.is_criminal_evidence_num),
    "parseEvidenceInput": _plain(naming.parse_evidence_input),
    "parseEvidenceFromFilename": _plain(naming.parse_evidence_from_filename),
    "titleFromFilename": _plain(naming.title_from_filename),
    "numberFromSuggested": _plain(naming.number_from_suggested),
    "numberPrefix": _plain(naming.number_prefix),
    "deriveStampLabel": _plain(naming.derive_stamp_label),
    "explanationEvidenceLabel": _plain(naming.explanation_evidence_label),
    "branchSortKey": _plain(naming.branch_sort_key),
    "normKey": _plain(naming.norm_key),
    "normKeyNoExt": _plain(naming.norm_key_no_ext),
    "toWarekiShort": _plain(naming.to_wareki_short),
    "outputExtFor": _plain(naming.output_ext_for),
    "isAvName": _plain(naming.is_av_name),
    "needsAvConversion": _plain(naming.needs_av_conversion),
    "isPhotoName": _plain(naming.is_photo_name),
    "isSubmittableName": _plain(naming.is_submittable_name),
    "parsePageRanges": _plain(naming.parse_page_ranges),
    "listForMessage": _plain(naming.list_for_message),
    "submitExtFor": lambda st, name: naming.submit_ext_for(name, st.rename_only),
    "suggestedForTitle": plan.suggested_for_title,
    "mergeDestName": _plain(plan.merge_dest_name),
    "outputDestName": _plain(plan.output_dest_name),
    "explanationBaseName": explanation.explanation_base_name,
    "isMeaningfulStamp": _plain(matching.is_meaningful_stamp),
    "cleanConfirmText": _plain(matching.clean_confirm_text),
    "checkAiLimits": _plain(contract.check_ai_limits),
    "computeConsistency": _plain(contract.compute_consistency),
    "computePartySymbolWarnings": _plain(contract.compute_party_symbol_warnings),
}


def expand(v):
    """表の省略の書き方を広げる（{"$repeat": ["あ", 1001]}・{"$array": [値, 300]}）"""
    if isinstance(v, list):
        return [expand(x) for x in v]
    if isinstance(v, dict):
        if isinstance(v.get("$repeat"), list):
            return str(v["$repeat"][0]) * v["$repeat"][1]
        if isinstance(v.get("$array"), list):
            return [expand(v["$array"][0]) for _i in range(v["$array"][1])]
        return {k: expand(x) for k, x in v.items()}
    return v


def plain(v):
    """結果を JSON の形にそろえる（画面側と同じ形で比べるため、いったん JSON にして読み直す）"""
    return json.loads(json.dumps(v, ensure_ascii=False))


def strings(v, out):
    if isinstance(v, str):
        out.append(v)
    elif isinstance(v, list):
        for x in v:
            strings(x, out)
    elif isinstance(v, dict):
        for x in v.values():
            strings(x, out)
    return out


def short(v):
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= 300 else s[:300] + "…"


def first_difference(a, b, where=""):
    """期待と実際の、最初に違う場所（どこが違うかを探しやすくする）"""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a) + [k for k in b if k not in a]:
            if k not in a or k not in b:
                return f"{where}.{k}: 期待 {short(a.get(k, '（項目なし）'))} / 実際 {short(b.get(k, '（項目なし）'))}"
            d = first_difference(a[k], b[k], f"{where}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{where}: 件数が違う（期待 {len(a)} / 実際 {len(b)}）期待 {short(a)} / 実際 {short(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{where}[{i}]")
            if d:
                return d
        return None
    if a != b or type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float))
                                                 and not isinstance(a, bool) and not isinstance(b, bool)):
        return f"{where}: 期待 {short(a)} / 実際 {short(b)}"
    return None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    passed = failed = 0
    failures = []

    def check(label, ok, extra=""):
        nonlocal passed, failed
        if ok:
            passed += 1
        else:
            failed += 1
            failures.append(label)
            print(f"  FAIL {label}" + (f" -> {extra}" if extra else ""))

    for file in sorted(f for f in os.listdir(TABLE_DIR) if f.endswith(".json")):
        with open(os.path.join(TABLE_DIR, file), encoding="utf-8") as fp:
            table = json.load(fp)
        print(f"\n=== {file} — {table.get('title', '')} ===")
        before = passed
        no_wave = table.get("no_wave_dash") or []
        for c in table["cases"]:
            label = c.get("name") or f"{c.get('fn')}({short(c.get('args'))})"
            try:
                if table.get("kind") == "flow":
                    actual = plain(run_flow(expand(c.get("input") or {})))
                    target = [actual.get(k) for k in no_wave]
                else:
                    st = Session(settings=expand(c.get("state") or {}))
                    actual = plain(FUNCS[c["fn"]](st, *expand(c.get("args") or [])))
                    target = actual if c["fn"] in no_wave else None
            except Exception as e:  # 1 件の例外で止めず、どの件かを知らせる
                check(label, False, f"例外: {type(e).__name__}: {e}")
                continue
            diff = first_difference(c.get("expect"), actual)
            check(label, diff is None, diff or "")
            leaked = any(WAVE_DASH in s for s in strings(target, []))
            if c.get("known_wave_dash"):
                check(f"{label}: 禁止の波ダッシュが入る（既知・未修正）", leaked, "入らなくなりました。画面側と結果が違います")
            elif leaked:
                check(f"{label}: 禁止の波ダッシュ（U+301C）が結果に入っている", False, short(target))
        print(f"  {passed - before} 件 OK")

    print(f"\n===== {passed} PASS / {failed} FAIL =====")
    if failed:
        print("失敗: " + " / ".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
