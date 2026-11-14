# -*- coding: utf-8 -*-
"""
提出用ファイル名と、出力の計画（どのファイルを、どの名前で、どうまとめて出すか）。

画面の src/app-evidence.js（mergeDestName・outputDestName・buildOutputPlan）と src/app-review.js
（suggestedForTitle）と同じ判定。計画を作るだけで、ファイルは書かない。
"""
import re

from .js import jstr, s_, trim
from .naming import (STAMP_SAFE_Y, branch_sort_key, fix_wave_dash, is_av_name, strip_ext, submit_ext_for,
                     to_half_width_filename_part, to_pdf_name)


def default_stamp():
    """JS: defaultStamp。番号のある証拠に押印の指示が無いときの既定（右上）"""
    return {"page": 1, "branch": None, "draw_label": True, "rotate_degrees": 0,
            "position": {"x": 0.93, "y": STAMP_SAFE_Y, "anchor": "top-right"}}


def _branch_part(rf):
    br = rf.get("branchRange")
    return "" if br is None else to_half_width_filename_part(trim(jstr(br)))


def suggested_for_title(st, rf, title):
    """JS: suggestedForTitle。標目から提出用ファイル名を作る（号証_枝番_標目）"""
    ext = submit_ext_for(rf.get("name"), st.rename_only)
    t = to_half_width_filename_part(title or "")
    branch = _branch_part(rf)
    num = rf.get("evidenceNumber")
    prefix = (f"{num}_{branch}" if branch else num) if num else ""
    base = f"{prefix}_{t}" if prefix and t else (t or strip_ext(rf.get("name") or ""))
    return f"{base}{ext}"


def merge_dest_name(num, group):
    """JS: mergeDestName。結合する号証の名前（号証番号_枝番の範囲_標目）"""
    branches = [b for b in (_branch_part(g) for g in group) if b]
    title = to_half_width_filename_part(trim(s_(group[0].get("docName"))))
    base = num
    if len(branches) > 1:
        # 枝番そのものが範囲（「1～2」）のこともあるので、全部の数字のうち最小と最大で範囲を作る
        nums = [int(d) for b in branches for d in re.findall("[0-9]+", b)]
        lo = min(nums) if nums else branches[0]
        hi = max(nums) if nums else branches[-1]
        base = f"{num}_{lo}" if lo == hi else f"{num}_{lo}～{hi}"
    elif branches:
        base = f"{num}_{branches[0]}"
    return f"{base}{'_' + title if title else ''}.pdf"


def output_dest_name(num, group):
    """JS: outputDestName。号証の保存名。1 ファイルだけなら確認画面の「提出用ファイル名」のとおり"""
    single = trim(s_(group[0].get("suggested"))) if len(group) == 1 else ""
    return to_pdf_name(single) if single else merge_dest_name(num, group)


def merge_group_for(st, num):
    """JS: mergeGroupFor。同じ号証にまとめるファイル（枝番の順）"""
    group = [x for x in st.review_files if x.get("evidenceNumber") == num and not is_av_name(x.get("name"))]
    return sorted(group, key=lambda x: branch_sort_key(x.get("branchRange")))


def _source(rf):
    src = {}
    if "path" in rf:
        src["srcPath"] = rf["path"]
    src["pages"] = rf.get("pageRange") or None  # ページ範囲で分けた枝番は、その範囲だけを使う
    if "stamps" in rf:
        src["stamps"] = rf["stamps"]
    actions = {}
    for m in rf.get("metadata") or []:
        if "action" in m:
            actions[jstr(m["key"]) if "key" in m else "undefined"] = m["action"]
    src["metadataActions"] = actions
    return src


def build_output_plan(st):
    """JS: buildOutputPlan。出力の計画。同じ号証の証拠は 1 つの PDF にまとめる（音声・動画、「別々に出力」、
    「名前だけ整える」はまとめない）"""
    outputs = []
    emitted = set()
    for rf in st.review_files:
        num = rf.get("evidenceNumber")
        if num and not st.rename_only and not is_av_name(rf.get("name")) and num not in st.merge_disabled:
            if num in emitted:
                continue
            emitted.add(num)
            group = merge_group_for(st, num)
            outputs.append({"evidenceNumber": num, "destName": output_dest_name(num, group),
                            "sources": [_source(g) for g in group]})
        else:
            out = {"evidenceNumber": num or None}  # 番号は残す（押す番号をここから作るため）
            if "suggested" in rf:
                s = rf["suggested"]
                out["destName"] = fix_wave_dash(s) if isinstance(s, str) else s  # 人が波ダッシュで打った名前も直す
            out["sources"] = [_source(rf)]
            outputs.append(out)
    return outputs
