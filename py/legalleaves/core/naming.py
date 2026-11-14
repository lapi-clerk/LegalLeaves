# -*- coding: utf-8 -*-
"""
表記と番号の読み取り（全角・半角、号証番号、枝番、提出用ファイル名、拡張子）。

画面の src/app-evidence.js・app-state.js と同じ判定。結果は test/tables/naming.json で画面と突き合わせている。
関数の横の「JS: …」は、画面側の同じ関数の名前。
"""
import re

from .js import WS, jstr, s_, trim, utf16_len, nfkc

STAMP_SAFE_Y = 0.07  # 番号の既定の位置（src/timestamp-zone.js と同じ）
KIND_OPTIONS = ["主張系", "証拠説明書", "証拠", "関連事件の申立", "その他"]
CRIMINAL_SYMBOLS = "弁検"  # 刑事の号証（弁号証・検号証）は枝番を使わない
EVIDENCE_SYMBOLS = "甲乙丙丁戊己庚辛壬癸弁検"

_FLAGS = re.ASCII | re.IGNORECASE  # JS の /i（半角の英字だけ大文字小文字を同じに扱う）
_EXT_RE = re.compile(r"\.[^.]+\Z")
_AUDIO_RE = re.compile(r"\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?|amr)\Z", _FLAGS)
_VIDEO_RE = re.compile(r"\.(mp4|mov|avi|wmv|mkv|m4v|flv|webm|3gp|3g2|mpeg|mpg|mts|m2ts|ts|vob)\Z", _FLAGS)
_SUBMITTABLE_RE = re.compile(r"\.(pdf|jpe?g|png|docx?|xlsx?|pptx?|rtf)\Z", _FLAGS)
_PHOTO_RE = re.compile(r"\.(jpe?g|png)\Z", _FLAGS)
_MP_RE = re.compile(r"\.(mp3|mp4)\Z", _FLAGS)
_OFFICE_EXT_RE = re.compile(r"^\.(docx?|xlsx?|pptx?|rtf)\Z")
_PDF_RE = re.compile(r"\.pdf\Z", _FLAGS)

_SYM = f"([{EVIDENCE_SYMBOLS}](?:[A-Za-zＡ-Ｚａ-ｚ])?)"
# 枝番の部分。「の2」「-2」と、アプリ自身が付ける「_2」（2 桁まで。年・日付・整理用の番号を枝番と読まないため）。
# 枝番は 1 つ目か 2 つ目の括弧のどちらかに入る
_FILENAME_BRANCH = f"(?:{WS}*[-‐－の／/]{WS}*0*([0-9]+)|[_＿]0*([0-9]{{1,2}})(?=[_＿\\-‐－・.]|{WS}|\\Z))?"
_FROM_FILENAME_RE = re.compile(f"^{_SYM}{WS}*0*([0-9]+){_FILENAME_BRANCH}")
_TITLE_RE = re.compile(f"^{_SYM}{WS}*0*([0-9]+){_FILENAME_BRANCH}(?:[_＿\\-‐－・.]|{WS})*")
_FROM_SUGGESTED_RE = re.compile(
    f"^{_SYM}{WS}*0*([0-9]+)(?:(?:_|{WS}*[-‐－の／/]{WS}*)0*([0-9]+)(?=[_＿.・]|{WS}|\\Z))?(?:[_＿\\-‐－・]|{WS})*")
_NUMBER_RE = re.compile(r"^([^0-9]+)0*([0-9]+)\Z")
_INPUT_RE = re.compile(f"^([^0-9]+?){WS}*0*([0-9]+){WS}*([-‐－の/／]{WS}*0*([0-9]+)?)?\\Z")
_FW_DIGIT_RE = re.compile("[０-９]")


def _shift(m):
    return chr(ord(m.group(0)) - 0xFEE0)


def _half_digits(s):
    return _FW_DIGIT_RE.sub(_shift, s)


def strip_ext(name):
    return _EXT_RE.sub("", name)


# ---------- 全角・半角 ----------

def to_full_width(s):
    """JS: toFullWidth。裁判文書の中身は、英数字・スペース・括弧を全角にする（日付は別）"""
    out = re.sub("[0-9A-Za-z]", lambda m: chr(ord(m.group(0)) + 0xFEE0), s_(s))
    return fix_wave_dash(out.replace("(", "（").replace(")", "）").replace(" ", "　"))


def to_half_width(s):
    """JS: toHalfWidth"""
    return fix_wave_dash(re.sub("[０-９Ａ-Ｚａ-ｚ．]", _shift, s_(s)))


def to_half_width_filename_part(s):
    """JS: toHalfWidthFilenamePart。ファイル名は、英数字・括弧を半角にする"""
    out = re.sub("[０-９Ａ-Ｚａ-ｚ＿]", _shift, s_(s))
    return fix_wave_dash(out.replace("（", "(").replace("）", ")").replace("　", " "))


def fix_wave_dash(s):
    """JS: fixWaveDash。波ダッシュ（U+301C）を全角チルダ（U+FF5E）にそろえる。見た目が同じで別の文字なので、
    外へ出る値（提出用ファイル名・枝番・証拠説明書の号証欄）に入る手前で直す"""
    return ("" if s is None else jstr(s)).replace("〜", "～")


# ---------- 号証番号 ----------

def parse_evidence_number(s):
    """JS: parseEvidenceNumber。"甲001" → {"sym": "甲", "num": 1}。読めなければ None"""
    m = _NUMBER_RE.match(trim(s_(s)))
    return {"sym": m.group(1), "num": int(m.group(2))} if m else None


def pad_evidence(sym, num):
    """JS: padEvidence"""
    return f"{jstr(sym)}{jstr(num).rjust(3, '0')}"


def is_valid_evidence_number(num):
    """JS: isValidEvidenceNumber。番号として正しいか（「甲0」は正しくない）"""
    p = parse_evidence_number(num)
    return bool(p) and p["num"] >= 1


def short_number_label(num):
    """JS: shortNumberLabel。「甲001」→「甲1」"""
    p = parse_evidence_number(num)
    return f"{p['sym']}{p['num']}" if p else s_(num)


def is_criminal_symbol(sym):
    s = trim(s_(sym))
    return bool(s) and s[0] in CRIMINAL_SYMBOLS


def is_criminal_evidence_num(ev_num):
    """JS: isCriminalEvidenceNum"""
    p = parse_evidence_number(ev_num)
    return is_criminal_symbol(p["sym"]) if p else is_criminal_symbol(ev_num)


def parse_evidence_input(raw):
    """JS: parseEvidenceInput。証拠番号欄の入力を、号証番号と枝番に分ける"""
    s = trim(s_(raw))
    if not s:
        return None
    m = _INPUT_RE.match(s)
    if not m:
        return None
    sym = trim(m.group(1))
    branch_ok = not is_criminal_symbol(sym)
    return {
        "num": f"{sym}{str(int(m.group(2))).rjust(3, '0')}",
        "hasBranch": branch_ok and bool(m.group(3)),
        "branch": str(int(m.group(4))) if branch_ok and m.group(4) else None,
    }


def parse_evidence_from_filename(name):
    """JS: parseEvidenceFromFilename。ファイル名の先頭の号証番号（と枝番）"""
    base = _half_digits(trim(strip_ext(s_(name))))
    m = _FROM_FILENAME_RE.match(base)
    if not m:
        return None
    br = m.group(3) or m.group(4)
    return {
        "num": f"{m.group(1)}{str(int(m.group(2))).rjust(3, '0')}",
        "branch": str(int(br)) if br and not is_criminal_symbol(m.group(1)) else None,
    }


def title_from_filename(name):
    """JS: titleFromFilename。ファイル名から号証番号を除いた残り（標目の候補）。番号が無ければ拡張子を除いた名前"""
    base = trim(strip_ext(s_(name)))
    m = _TITLE_RE.match(_half_digits(base))
    if not m:
        return base
    rest = trim(base[len(m.group(0)):])
    return rest or base


def number_from_suggested(name):
    """JS: numberFromSuggested。提出用ファイル名の先頭の番号"""
    m = _FROM_SUGGESTED_RE.match(_half_digits(s_(name)))
    if not m:
        return None
    return {
        "num": f"{m.group(1)}{str(int(m.group(2))).rjust(3, '0')}",
        "branch": str(int(m.group(3))) if m.group(3) and not is_criminal_symbol(m.group(1)) else None,
        "length": utf16_len(m.group(0)),
    }


def number_prefix(num, branch):
    """JS: numberPrefix。提出用ファイル名の先頭に付ける番号（甲003 / 甲003_2）"""
    if not num:
        return ""
    b = "" if branch is None else to_half_width_filename_part(trim(jstr(branch)))
    return f"{num}_{b}" if b else num


def derive_stamp_label(evidence_number, branch):
    """JS: deriveStampLabel。押す番号（甲第1号証の2）"""
    if not evidence_number:
        return None
    m = _NUMBER_RE.match(trim(jstr(evidence_number)))
    if not m:
        return None
    s = f"{m.group(1)}第{m.group(2)}号証"
    b = "" if branch is None else trim(jstr(branch))
    return f"{s}の{b}" if b else s


def explanation_evidence_label(evidence_number, branch):
    """JS: explanationEvidenceLabel。証拠説明書の号証欄（乙041-1）"""
    p = parse_evidence_number(evidence_number)
    if not p:
        return to_half_width(evidence_number or "")
    s = pad_evidence(p["sym"], p["num"])
    b = "" if branch is None else fix_wave_dash(to_half_width(trim(jstr(branch))))
    return f"{s}-{b}" if b else s


def branch_sort_key(br):
    """JS: branchSortKey。枝番の並び順（範囲は先頭の数字）"""
    m = re.search("[0-9]+", to_half_width(s_(br)))
    return int(m.group(0)) if m else 0


# ---------- 名前の照合・拡張子 ----------

def norm_key(name):
    """JS: normKey。空白・全角半角・大文字小文字のゆれを無視した名前"""
    return re.sub(f"{WS}+", "", nfkc(s_(name))).lower()


def norm_key_no_ext(name):
    """JS: normKeyNoExt"""
    return norm_key(strip_ext(s_(name)))


def is_av_name(name):
    """JS: isAvName。音声・動画か"""
    n = s_(name)
    return bool(_AUDIO_RE.search(n) or _VIDEO_RE.search(n))


def is_video_name(name):
    return bool(_VIDEO_RE.search(s_(name)))


def needs_av_conversion(name):
    """JS: needsAvConversion"""
    return is_av_name(name) and not _MP_RE.search(s_(name))


def is_photo_name(name):
    """JS: isPhotoName"""
    return bool(_PHOTO_RE.search(s_(name)))


def is_submittable_name(name):
    """JS: isSubmittableName。アプリが受け取れる種類か"""
    return bool(_SUBMITTABLE_RE.search(s_(name))) or is_av_name(name)


def output_ext_for(name):
    """JS: outputExtFor。音声 → .mp3、動画 → .mp4、ほかは .pdf"""
    n = s_(name)
    if _AUDIO_RE.search(n):
        return ".mp3"
    if _VIDEO_RE.search(n):
        return ".mp4"
    return ".pdf"


def submit_ext_for(name, rename_only=False):
    """JS: submitExtFor。提出用の拡張子（名前だけ整えるときは元の拡張子。Office は PDF にする）"""
    if rename_only:
        m = _EXT_RE.search(s_(name))
        ext = m.group(0).lower() if m else ""
        if is_av_name(name):
            return output_ext_for(name)
        return ".pdf" if _OFFICE_EXT_RE.match(ext) else ext
    return output_ext_for(name)


def to_pdf_name(single):
    """1 ファイルだけの号証の保存名（.pdf でなければ .pdf に替える）"""
    return fix_wave_dash(single if _PDF_RE.search(single) else re.sub(r"\.[^.\\/]+\Z", "", single) + ".pdf")


def to_wareki_short(iso):
    """JS: toWarekiShort。"2025-11-18T01:12" → "R7.11.18"。読めなければ空の文字列"""
    m = re.match(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})", s_(iso))
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not y or mo < 1 or mo > 12 or d < 1 or d > 31:
        return ""
    key = y * 10000 + mo * 100 + d
    if key >= 20190501:
        return f"R{y - 2018}.{mo}.{d}"
    if key >= 19890108:
        return f"H{y - 1988}.{mo}.{d}"
    return ""


def parse_page_ranges(text, total=None):
    """JS: parsePageRanges。「1-3, 4-5」→ [[1,3],[4,5]]。1 ページ目から最後まで、すき間・重なり無しで 2 つ以上"""
    src = re.sub("[〜～~ー－―−‐]", "-", to_half_width(s_(text)))
    parts = [p for p in re.split(f"(?:[,、，]|{WS})+", src) if p]
    if not parts:
        return {"error": "ページの範囲を入力してください（例: 1-3, 4-5）。"}
    ranges = []
    for p in parts:
        m = re.match(r"^([0-9]+)(?:-([0-9]+))?\Z", p)
        if not m:
            return {"error": f"「{p}」をページの範囲として読めません（例: 1-3）。"}
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        if start < 1 or end < start:
            return {"error": f"「{p}」は、ページの範囲として正しくありません。"}
        ranges.append([start, end])
    if len(ranges) < 2:
        return {"error": "2つ以上に分けてください（例: 1-3, 4-5）。"}
    if ranges[0][0] != 1:
        return {"error": "1ページ目から始めてください。"}
    for i in range(1, len(ranges)):
        prev = ranges[i - 1][1]
        if ranges[i][0] != prev + 1:
            return {"error": f"{prev}ページ目の次は{prev + 1}ページ目から始めてください（抜けや重なりがあります）。"}
    last = ranges[-1][1]
    if total and last != total:
        return {"error": f"このPDFは全{total}ページです。最後の枝番は{total}ページ目まで含めてください。" if last < total
                else f"このPDFは全{total}ページです。{total}ページ目より後ろは指定できません。"}
    return {"ranges": ranges}


def list_for_message(items, limit=50):
    """JS: listForMessage。知らせの文に番号を並べる（多すぎるときは省く）"""
    if len(items) <= limit:
        return "、".join(items)
    return f"{'、'.join(items[:limit])} …ほか{len(items) - limit}件"
