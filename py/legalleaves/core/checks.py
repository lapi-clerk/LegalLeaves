# -*- coding: utf-8 -*-
"""
出力前チェック: 書き出す前に、番号まわりの食い違いを決まった規則で拾う。

画面の src/app-evidence.js（filenameNumberMismatch・computeOutputIssues）と同じ判定。
判定はプログラム、確定は人。書き出しは止めず、知らせるだけ。
"""
from .js import jstr, s_, trim
from .naming import (branch_sort_key, derive_stamp_label, is_av_name, is_valid_evidence_number, number_from_suggested,
                     number_prefix, short_number_label, to_half_width_filename_part)
from .plan import build_output_plan, merge_dest_name, merge_group_for


def suggested_is_output_name(st, rf):
    """JS: suggestedIsOutputName。提出用ファイル名がそのまま保存名になるか（1 ファイルだけの号証）"""
    num = rf.get("evidenceNumber") if rf else None
    return (not st.rename_only and bool(num) and not is_av_name(rf.get("name"))
            and (num in st.merge_disabled or len(merge_group_for(st, num)) <= 1))


def filename_number_mismatch(st, rf):
    """JS: filenameNumberMismatch。提出用ファイル名の先頭の番号と証拠番号の食い違い。合っていれば None。
      number    … 両方とも正しい番号で、食い違う
      badNumber … 証拠番号が正しくない・ファイル名の番号は正しい
      missing   … ファイル名に正しい番号が無い・証拠番号は正しい
      bothBad   … どちらも正しくない
      nameEmpty … 証拠以外のファイルで、提出用ファイル名が空"""
    if st.rename_only or not rf or is_av_name(rf.get("name")):
        return None
    num = rf.get("evidenceNumber")
    num_empty = not trim(s_(num))
    name_empty = not trim(s_(rf.get("suggested")))
    if num_empty and rf.get("kind") != "証拠":
        return {"kind": "nameEmpty", "nameEmpty": name_empty} if name_empty else None
    if not num_empty and not suggested_is_output_name(st, rf):
        return None  # 結合する号証は番号から名前を作る
    own_ok = is_valid_evidence_number(num)
    f = number_from_suggested(rf.get("suggested"))
    file_ok = bool(f) and is_valid_evidence_number(f["num"])
    if not own_ok and not file_ok:
        return {"kind": "bothBad", "numEmpty": num_empty, "nameEmpty": name_empty}
    if not own_ok:
        return {"kind": "badNumber", "file": {"num": f["num"], "branch": f["branch"]}, "numEmpty": num_empty}
    if not file_ok:
        return {"kind": "missing", "nameEmpty": name_empty}
    br = rf.get("branchRange")
    mine = None if br is None else to_half_width_filename_part(trim(jstr(br)))
    simple = mine is None or (mine.isascii() and mine.isdigit())  # 範囲（1～2）のときは号証番号だけを比べる
    same_branch = not simple or f["branch"] == (None if mine is None else str(int(mine)))
    if f["num"] == num and same_branch:
        return None
    return {"kind": "number", "file": {"num": f["num"], "branch": f["branch"] if simple else br}}


def _label_with_branch(num, branch):
    return f"{short_number_label(num)}{'の' + jstr(branch) if branch is not None and branch != '' else ''}"


def compute_output_issues(st):
    """JS: computeOutputIssues。[{index: 確認画面の一覧の何番目か, text, fix（ボタンで直せるもの）}]"""
    if st.rename_only:
        return []
    issues = []
    rfs = st.review_files

    # 1) 1 ファイルだけの号証: 提出用ファイル名の先頭の番号と、押す番号が合っているか
    for i, rf in enumerate(rfs):
        num, br, name = rf.get("evidenceNumber"), rf.get("branchRange"), jstr(rf.get("name"))
        if rf.get("kind") == "証拠" and not num:
            issues.append({"index": i, "fix": True, "text": f"「{name}」は証拠ですが、証拠番号がありません（番号は押されません）"})
            continue
        mm = filename_number_mismatch(st, rf)
        if not mm:
            continue
        label = f"{short_number_label(num)}{'の' + jstr(br) if br is not None else ''}"
        sug = s_(rf.get("suggested"))
        kind = mm["kind"]
        if kind == "number":
            text = f"{label}：提出用ファイル名「{sug}」の番号が、押す番号（{jstr(derive_stamp_label(num, br))}）と合っていません"
        elif kind == "missing":
            text = (f"{label}：提出用ファイル名が空です" if mm["nameEmpty"]
                    else f"{label}：提出用ファイル名「{sug}」が号証番号（{number_prefix(num, br)}）で始まっていません")
        elif kind == "badNumber":
            text = (f"「{name}」：証拠番号「{jstr(num)}」が番号として正しくありません"
                    f"（ファイル名の番号は {_label_with_branch(mm['file']['num'], mm['file']['branch'])}）")
        elif kind == "bothBad":
            text = f"「{name}」：証拠番号「{jstr(num)}」が番号として正しくありません（ファイル名にも正しい番号がありません）"
        else:
            text = f"「{name}」：提出用ファイル名が空です"
        issues.append({"index": i, "fix": True, "text": text})

    # 2) 同じ号証の中: 枝番の重なり・枝番あり／なしの混在・途中の抜け
    by_num = {}
    for i, rf in enumerate(rfs):
        num = rf.get("evidenceNumber")
        if num and not is_av_name(rf.get("name")):
            by_num.setdefault(num, []).append((rf, i))
    for num, items in by_num.items():
        short = short_number_label(num)
        if len(items) > 1:
            no_branch = [x for x in items if x[0].get("branchRange") is None]
            if no_branch and len(no_branch) < len(items):
                issues.append({"index": no_branch[0][1], "text":
                               f"{short}：枝番のあるファイルと無いファイルが混ざっています（「{jstr(no_branch[0][0].get('name'))}」に枝番がありません）"})
            elif len(no_branch) > 1:
                issues.append({"index": no_branch[1][1], "text":
                               f"{short}：枝番の無いファイルが{len(no_branch)}つあります（どれにも「{jstr(derive_stamp_label(num, None))}」が押されます）"})
        seen = {}
        for rf, i in items:
            if rf.get("branchRange") is None:
                continue
            k = branch_sort_key(rf["branchRange"])
            if k in seen:
                issues.append({"index": i, "text": f"{short}の{k} が2つあります（「{jstr(seen[k])}」と「{jstr(rf.get('name'))}」）"})
            else:
                seen[k] = rf.get("name")
        keys = list(seen) + [branch_sort_key(p["branch"]) for p in st.placeholders
                             if p.get("num") == num and p.get("branch") is not None]
        if len(keys) >= 2:
            missing = [f"{short}の{k}" for k in range(min(keys) + 1, max(keys)) if k not in keys]
            if missing:
                issues.append({"index": items[0][1], "text": f"{short}：{'・'.join(missing)} がありません（枝番が飛んでいます）"})
        # 標目の違うファイルを 1 つにまとめるとき: まとめた名前は 1 つ目の枝番の標目になる。名前は変えず、知らせるだけ
        if len(items) > 1 and num not in st.merge_disabled:
            group = merge_group_for(st, num)
            titles = list(dict.fromkeys(
                t for t in (to_half_width_filename_part(trim(s_(g.get("docName")))) for g in group) if t))
            if len(titles) > 1:
                first = next((i for rf, i in items if rf is group[0]), items[0][1])
                issues.append({"index": first, "text":
                               f"{short}：標目の違うファイル（{'・'.join(titles)}）を1つにまとめます。"
                               f"まとめた名前は「{merge_dest_name(num, group)}」になります"})

    # 3) 同じ名前のファイルが 2 つできる（2 つ目には「 (2)」が付いてしまう）
    names = {}
    for o in build_output_plan(st):
        key = s_(o.get("destName")).lower()
        names[key] = names.get(key, 0) + 1
    for key, n in names.items():
        if n < 2:
            continue
        i = next((j for j, rf in enumerate(rfs) if s_(rf.get("suggested")).lower() == key), -1)
        issues.append({"index": max(0, i), "text": f"同じ名前のファイル「{key}」が{n}つできます（2つ目以降には「 (2)」などが付きます）"})
    return issues
