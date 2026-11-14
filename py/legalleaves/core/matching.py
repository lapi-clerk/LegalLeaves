# -*- coding: utf-8 -*-
"""
照合: 読み込んだファイルと AI の整理データを突き合わせ、確認画面の一覧を作る。

画面の src/app-evidence.js（buildReviewFiles）と同じ判定。AI の値は下書きで、確定するのは確認画面の人。
"""
import json
import math
import re

from . import contract
from .explanation import branches_from_stamps, explanation_base_name
from .js import js_round, jstr, num_str, oor, s_, to_number, trim, truthy
from .naming import (KIND_OPTIONS, fix_wave_dash, is_av_name, is_criminal_evidence_num, is_photo_name, is_submittable_name,
                     norm_key, norm_key_no_ext, number_prefix, parse_evidence_from_filename, strip_ext,
                     submit_ext_for, title_from_filename, to_half_width_filename_part, to_wareki_short)
from .plan import default_stamp, suggested_for_title

_NO_ENTRY_TEXT = "AIの整理データに対応する項目が見つかりませんでした。内容をご確認のうえ手動で入力してください。"
_NO_NUMBER_TEXT = ("ファイル名に号証番号がありません。証拠なら「証拠番号」に番号を入れてください（例: 甲1-2）。"
                   "証拠でなければ種類を選び、確認済みにしてください。")
_I = re.ASCII | re.IGNORECASE


def is_meaningful_stamp(s):
    """JS: isMeaningfulStamp。番号を押すか回転する指示だけを残す（何もしない指示は捨てる）"""
    if not isinstance(s, (dict, list)):
        return False
    get = s.get if isinstance(s, dict) else (lambda k: None)
    draws = get("draw_label") is not False
    deg = to_number(oor(get("rotate_degrees"), 0))
    if not math.isfinite(deg):
        return True  # 数として読めない回転は、画面と同じく「指示あり」として残す
    return draws or (js_round(deg / 90) * 90) % 360 != 0


def clean_confirm_text(t):
    """JS: cleanConfirmText。確認の文に混じった項目名（draw_label）を取り除く"""
    out = s_(t)
    out = re.sub(r"[（(][^（()）]*draw_label[^（()）]*[）)]", "", out, flags=_I)
    out = re.sub(r"[^。\n]*draw_label[^。\n]*。", "", out, flags=_I)
    out = re.sub(r"[^。\n]*draw_label[^。\n]*", "", out, flags=_I)
    return trim(re.sub("[ 　]{2,}", " ", out))


def set_stamp_branch(rf, branch):
    """JS: setStampBranch。ファイルの枝番を押印の指示にもそろえる（ページごとに枝番が違うファイルは触らない）"""
    stamps = rf.get("stamps")
    if not isinstance(stamps, list) or not stamps or len(branches_from_stamps(rf)) > 1:
        return
    for s in stamps:
        if truthy(s):
            s["branch"] = branch


def explanation_date_key(rf):
    """JS: explanationFieldKeys(rf).date。作成年月日を書く先（撮影の区分があれば撮影日時の欄）"""
    return "captureDatetime" if trim(s_(rf.get("captureKind"))) else "createdDate"


def _matched(st, f, entry, forced, common, default_stamped):
    name = f.get("name")
    base_name = entry.get("suggested_base_name") or entry.get("title") or strip_ext(name)
    raw_stamps = entry["stamps"] if isinstance(entry.get("stamps"), list) else []
    ai_stamps = [s for s in raw_stamps if is_meaningful_stamp(s)]
    # 押印の指示: 意味のある指示があればそれを使う／指示が全部「何もしない」なら押さない（既に番号がある）／
    # 番号のある証拠に指示が 1 つも無ければ既定の位置に押す
    num = entry.get("evidence_number")
    stamps = ai_stamps or ([default_stamp()] if not raw_stamps and num else [])
    if not ai_stamps and stamps:  # アプリが既定の位置を入れたファイル（後で、枝番を押す番号にも入れる）
        default_stamped.add(f.get("path"))
    for s in stamps:  # 押す番号の枝番も、波ダッシュを全角チルダにそろえる
        if isinstance(s, dict) and isinstance(s.get("branch"), str):
            s["branch"] = fix_wave_dash(s["branch"])
    has_drawing = any(truthy(s) and (not isinstance(s, dict) or s.get("draw_label") is not False) for s in stamps)
    title_from_file = entry.get("title_from_file")
    author_alt = entry.get("author_alt")
    return {
        "path": f.get("path"), "name": name,
        "matched": True, "manualMatch": forced,
        "needsConfirmation": truthy(entry.get("needs_user_confirmation")),
        "confirmText": clean_confirm_text(entry.get("confirmation_question")),
        "kind": entry.get("type") if entry.get("type") in KIND_OPTIONS else "その他",
        "docName": entry.get("title") or base_name,
        "suggested": f"{to_half_width_filename_part(base_name)}{submit_ext_for(name, st.rename_only)}",
        **common,
        "evidenceNumber": num or None,
        # AI が波ダッシュで書いた範囲（1〜2）は、全角チルダにそろえる
        "branchRange": (fix_wave_dash(entry["branch_range"]) if isinstance(entry.get("branch_range"), str)
                        else entry.get("branch_range")) or None,
        "stamps": stamps,
        # 番号のある証拠で、要確認なのに押す指示が無い＝「既にページに番号があるか」を人に聞く
        "stampAsk": truthy(num) and truthy(entry.get("needs_user_confirmation")) and not has_drawing,
        "stampDecided": False, "userConfirmed": False,
        # 証拠説明書の標目とファイルの中身が食い違うときは両方を持つ（確認画面で選ぶ）
        "titleExplanation": entry.get("title") or base_name,
        "titleFromFile": (trim(title_from_file) if title_from_file else None) or None,
        "titleSource": "explanation", "authorDecided": False,
        "author": entry.get("author") or "", "authorPrimary": entry.get("author") or "",
        "authorAlt": (trim(author_alt) if author_alt else None) or None,
        "authorSource": "primary",
        "createdDate": entry.get("created_date") or "",
        "proofPurpose": entry.get("proof_purpose") or "",
        "originalOrCopy": entry.get("original_or_copy") or "",
        "digitizedFromPaper": entry.get("digitized_from_paper") is True,
        "captureKind": entry.get("capture_kind") or "",
        "captureSubject": entry.get("capture_subject") or "",
        "captureDatetime": entry.get("capture_datetime") or "",
        "captureLocation": entry.get("capture_location") or "",
        "captureBy": entry.get("capture_by") or "",
    }


def _unmatched(st, f, common):
    name = f.get("name")
    no_ai = st.no_ai_data()  # AI を使わないのは正常な使い方なので、要確認にしない
    return {
        "path": f.get("path"), "name": name,
        "matched": False, "needsConfirmation": not no_ai,
        "confirmText": "" if no_ai else _NO_ENTRY_TEXT,
        "kind": "その他",
        # 「AIを使わずに進む」では、ファイル名の号証番号の後ろを標目にする
        "docName": title_from_filename(name) if no_ai and not st.rename_only else strip_ext(name),
        "suggested": f"{strip_ext(name)}{submit_ext_for(name, st.rename_only)}",
        **common,
        "evidenceNumber": None, "branchRange": None, "stamps": [], "userConfirmed": False,
    }


def _load_ai(st):
    """AI の整理データを読む（形式の検査は contract.validate_ai_json。ここは読めた分だけ使う）"""
    try:
        parsed = contract.parse_json(st.ai_text)
    except (ValueError, RecursionError):
        return [], [], None, None
    if not isinstance(parsed, dict):
        return [], [], None, None
    files = parsed.get("files")
    warnings = parsed.get("warnings")
    return ([x for x in files if isinstance(x, dict)] if isinstance(files, list) else [],
            warnings if isinstance(warnings, list) else [],
            oor(parsed.get("evidence_explanation"), None), oor(parsed.get("case"), None))


def build_review_files(st):
    """JS: buildReviewFiles。確認画面の一覧を作り、st に入れる"""
    ai_files, ai_warnings, ee, case_info = _load_ai(st)
    st.case_info = case_info
    st.explanation_exists = truthy(ee) and truthy(ee.get("exists") if isinstance(ee, dict) else None)

    by_name, by_norm, by_no_ext = {}, {}, {}
    for e in ai_files:
        n = e.get("original_file_name")
        by_name[n] = e
        by_norm[norm_key(n)] = e
        by_no_ext[norm_key_no_ext(n)] = e
    matched_names = set()
    default_stamped = set()  # 押印の指示が無く、既定の位置を入れたファイル（path）

    review_files = []
    for f in st.files:
        name = f.get("name")
        common = {
            "metadata": [{**({"key": m["key"]} if "key" in m else {}), **({"val": m["value"]} if "value" in m else {}),
                          "action": "delete"} for m in (f.get("metaFields") or [])],
            "officeMeta": f.get("officeMeta") or None,        # Word の個人情報の検査結果
            "activeContent": f.get("activeContent") or None,  # PDF の動く中身（検出のみ）
            "overA3": f.get("overA3") or None,                # A3 を超えるページの寸法
            "pageCount": f.get("pageCount") or None,
        }
        # 人が手で付けた対応 → 同じ名前 → 空白・全角半角のゆれを無視 → 拡張子も無視、の順に探す
        forced_name = st.manual_matches.get(f.get("path"))
        forced = by_name.get(forced_name) if forced_name else None
        entry = forced
        for table, key in ((by_name, name), (by_norm, norm_key(name)), (by_no_ext, norm_key_no_ext(name))):
            if entry is None:
                entry = table.get(key)
        if entry is not None:
            matched_names.add(entry.get("original_file_name"))
            review_files.append(_matched(st, f, entry, bool(forced), common, default_stamped))
        else:
            review_files.append(_unmatched(st, f, common))

    # ファイル名の先頭に号証番号があれば、それを正とする（AI が元の名前を受け取れず番号を振り直すことがある）。
    # 証拠説明書があるときは、説明書が番号の正なので触らない
    if not st.explanation_exists:
        for rf in review_files:
            from_name = parse_evidence_from_filename(rf["name"])
            if not from_name:
                continue
            rf["evidenceNumber"] = from_name["num"]
            rf["branchRange"] = from_name["branch"]
            if not rf["kind"] or rf["kind"] == "その他":
                rf["kind"] = "証拠"
            if not isinstance(rf["stamps"], list) or not rf["stamps"]:
                rf["stamps"] = [default_stamp()]
            if rf["branchRange"] is not None:
                set_stamp_branch(rf, rf["branchRange"])
            # AI の項目が無いファイルは、標目が元のファイル名のままのことがある。番号が二重にならないよう、
            # 番号の後ろだけを使う。番号しか無い名前（甲1.pdf）は、番号だけの名前にする
            if rf["matched"]:
                rf["suggested"] = suggested_for_title(st, rf, rf["docName"])
            else:
                rest = title_from_filename(rf["name"])
                if rest == trim(strip_ext(rf["name"])):
                    rf["suggested"] = (number_prefix(rf["evidenceNumber"], rf["branchRange"])
                                       + submit_ext_for(rf["name"], st.rename_only))
                else:
                    rf["suggested"] = suggested_for_title(st, rf, rest)

    # AI が枝番を書いたのに押印の指示を書かなかったファイルは、ファイルの枝番を、押す番号にも入れる
    # （入れないと、枝番の違うファイルがどれも「甲第5号証」と押される）。枝番を決め終えてから行う
    for rf in review_files:
        if rf["matched"] and rf["path"] in default_stamped and rf["branchRange"] is not None:
            set_stamp_branch(rf, rf["branchRange"])

    # 「AIを使わずに進む」: ファイル名に号証番号が無いものだけ要確認にして、種類・番号を手で入れてもらう
    if st.no_ai_data() and not st.rename_only:
        for rf in review_files:
            if rf["matched"]:
                continue
            rf["needsConfirmation"] = not rf["evidenceNumber"]
            rf["confirmText"] = "" if rf["evidenceNumber"] else _NO_NUMBER_TEXT

    # 刑事の号証（弁・検）は枝番を使わない。AI が付けてきても落とす
    for rf in review_files:
        if is_criminal_evidence_num(rf["evidenceNumber"]):
            rf["branchRange"] = None
            if isinstance(rf["stamps"], list):
                for s in rf["stamps"]:
                    if truthy(s):
                        s["branch"] = None

    # A3 を超える証拠は出力時に A3 へ縮小される。確認画面でも要確認にする（名前だけ整えるときは対象外）
    if not st.rename_only:
        for rf in review_files:
            a3 = rf["overA3"]
            if not a3:
                continue
            note = (f"このファイルはA3を超えています（約{_n(a3.get('wmm'))}×{_n(a3.get('hmm'))}mm）。"
                    "mintsの提出物はA4・A3のみのため、出力時はA3に縮小して収めます。"
                    "図面など縮小すると読み取りに支障がある場合は、紙での提出、または「記録外」としての"
                    "アップロード（サイズ制限なし）をご検討ください。")
            rf["needsConfirmation"] = True
            rf["confirmText"] = f"{note}\n\n{rf['confirmText']}" if rf["confirmText"] else note

    # 既にある証拠説明書のファイルは、番号の範囲から名前を作る（証拠説明書(甲001～甲002).pdf）
    exp_base = explanation_base_name(st, review_files)
    for rf in review_files:
        if rf["kind"] == "証拠説明書":
            rf["suggested"] = f"{exp_base}{submit_ext_for(rf['name'], st.rename_only)}"

    # 照合直後の AI の値（確認画面で「AIの値に戻す」ために持つ）と、開いたときの番号・名前
    for rf in review_files:
        if rf["matched"]:
            rf["aiOriginal"] = {k: rf[k] for k in ("kind", "docName", "suggested", "evidenceNumber")}
    st.ai_entries = ai_files
    # 読み込み忘れ: AI の項目にあるのに、対応するファイルが無いもの
    st.orphan_entries = [e for e in ai_files if e.get("original_file_name") not in matched_names
                         and is_submittable_name(e.get("original_file_name"))]
    meta_errors = [f"「{jstr(f.get('name'))}」のPDF情報を読み取れませんでした: {jstr(f['metaError'])}"
                   for f in st.files if truthy(f.get("metaError"))]
    for rf in review_files:
        rf["initialNumbers"] = {k: rf[k] for k in ("evidenceNumber", "branchRange", "suggested")}

    # 写真・音声・動画は、ファイルの中の撮影・録音日時を作成年月日の下書きにする（AI の値や手で入れた値を優先）
    by_path = {}
    for f in st.files:
        by_path.setdefault(f.get("path"), f)
    for rf in review_files:
        src = by_path.get(rf["path"])
        meta = (src.get("captureMeta") if src else None) or None
        rf["captureMeta"] = meta
        if not (is_av_name(rf["name"]) or is_photo_name(rf["name"])) or not meta or not meta.get("recordedAt"):
            continue
        draft = to_wareki_short(meta["recordedAt"])
        key = explanation_date_key(rf)
        if draft and not trim(s_(rf.get(key))):
            rf[key] = draft
            rf["dateDraftFromFile"] = draft

    st.review_files = review_files
    st.consistency = contract.compute_consistency(review_files, ee)
    st.ai_warnings = ([_warning_text(w) for w in ai_warnings] + meta_errors
                      + contract.compute_party_symbol_warnings(review_files, case_info))
    return review_files


def _n(v):
    return num_str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else jstr(v)


def _warning_text(w):
    if isinstance(w, str):
        return w
    msg = w.get("message") if isinstance(w, dict) else None
    return msg if truthy(msg) else json.dumps(w, ensure_ascii=False, separators=(",", ":"))
