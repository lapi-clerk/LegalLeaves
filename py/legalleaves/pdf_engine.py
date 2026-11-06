# -*- coding: utf-8 -*-
"""
PDF エンジン — PDF を書き換える処理の唯一の境界（Electron 版 pdf-engine.js の移植）。

画面・呼び出し側はこのモジュールの関数だけを使い、pypdf / reportlab を直接触らない。
「AI が決め、アプリが押す」の分担を保つため、ここは決定論的な処理だけを置く。

契約: docs/ai-contract.md（schema_version 2.0）。
座標・既定値・上限は pdf-engine.js と同じ数値を使う（出力が変わらないように）。

使う部品:
  - pypdf      … PDF の読み書き・ページの回転/結合/切り出し/用紙枠の変更
  - reportlab  … 番号の文字（日本語フォント）と画像ページを描く
  - Pillow     … 白黒スキャン（CCITTFax）のプレビュー用変換
"""
import io
import os
import struct

from pypdf import PdfReader as _PdfReader, PdfWriter, Transformation, overwrite_configuration
from pypdf.generic import (
    ArrayObject,
    BooleanObject,
    DecodedStreamObject,
    DictionaryObject,
    IndirectObject,
    NameObject,
    NumberObject,
    RectangleObject,
)
from reportlab.lib.colors import Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

from . import fileio
from .paths import resource_path

# --- 裁判所タイムスタンプ帯と番号の既定位置（src/timestamp-zone.js と同じ値） ---
STAMP_SAFE_Y = 0.07                      # 上端アンカーの既定 y（帯の直下・A4縦で上端20.8mm）
A4_PT = (595.28, 841.89)
IMG_NUMBER_TOP_PT = STAMP_SAFE_Y * A4_PT[1]  # 画像の番号ボックス上端 ≈58.9pt

ANCHORS = {"top-left", "top-right", "bottom-left", "bottom-right", "center"}
DEFAULT_POSITION = {"x": 0.93, "y": STAMP_SAFE_Y, "anchor": "top-right"}
DEFAULT_COLOR = (0.78, 0.0, 0.0)  # #C80000 寄りの朱色 — 証拠番号の慣例
DEFAULT_FONT_SIZE = 18
MAX_LABEL_CHARS = 100

PAGE_SIZES = {"A4": (595.28, 841.89), "A3": (841.89, 1190.55)}
A4A3_TOL_PT = 6  # ≈2mm。スキャナ由来の微差は許容する
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}

FONT_NAME = "LegalLeavesStamp"
# Noto Sans JP（OFL）を番号の文字だけに絞ったもの。pdf-engine.js と同じファイル。
FONT_FILE = ("assets", "fonts", "NotoSansJP-stamp.ttf")

# pypdf は既定で、1つのデータの塊が約75MBを超える PDF を読まない（壊れた PDF への備え）。
# 図面や写真を高画質でスキャンした証拠では超えることがある（mints の上限は1ファイル200MB）ので広げる。
# 設定は呼び出したスレッドごとなので、PDF を開くたびに設定してから開く。
MAX_PDF_STREAM_BYTES = 1024 * 1024 * 1024


def PdfReader(*args, **kwargs):
    overwrite_configuration(maximum_declared_stream_length=MAX_PDF_STREAM_BYTES,
                            array_based_stream_maximum_output_length=MAX_PDF_STREAM_BYTES)
    return _PdfReader(*args, **kwargs)


_font_ascent = None  # 1000 単位あたりの ascent（fontkit と同じく hhea の値）


# ---------------------------------------------------------------------------
# 小さな道具
# ---------------------------------------------------------------------------
def normalize_angle(a):
    """0|90|180|270 に丸める（JS の normalizeAngle と同じ）。"""
    try:
        a = float(a or 0)
    except (TypeError, ValueError):
        a = 0.0
    return (int(round(a / 90.0)) * 90 % 360 + 360) % 360


def _clamp01(n):
    if not isinstance(n, (int, float)) or isinstance(n, bool) or n != n:
        return 0.0
    return 0.0 if n < 0 else 1.0 if n > 1 else float(n)


def _clamp_font_size(n):
    if not isinstance(n, (int, float)) or isinstance(n, bool) or n != n or n in (float("inf"), float("-inf")):
        return DEFAULT_FONT_SIZE
    return 4 if n < 4 else 200 if n > 200 else n


def _parse_color(c):
    if not c:
        return DEFAULT_COLOR
    if isinstance(c, dict) and isinstance(c.get("r"), (int, float)):
        return (c.get("r", 0), c.get("g", 0), c.get("b", 0))
    s = str(c).lstrip("#")
    if len(s) != 6:
        return DEFAULT_COLOR
    try:
        n = int(s, 16)
    except ValueError:
        return DEFAULT_COLOR
    return (((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)


def _ensure_font():
    """番号用フォントを一度だけ登録し、ascent（hhea・1000 単位）を読む。"""
    global _font_ascent
    if _font_ascent is not None:
        return
    path = resource_path(*FONT_FILE)
    pdfmetrics.registerFont(TTFont(FONT_NAME, path))
    with open(path, "rb") as f:
        data = f.read()
    num = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(num):
        tag, _cs, off, _ln = struct.unpack(">4sIII", data[12 + 16 * i:28 + 16 * i])
        tables[tag.decode("latin-1")] = off
    upem = struct.unpack(">H", data[tables["head"] + 18:tables["head"] + 20])[0]
    ascent = struct.unpack(">h", data[tables["hhea"] + 4:tables["hhea"] + 6])[0]
    # pdf-lib（fontkit）の heightAtSize(size, {descender:false}) と同じ高さにするため hhea の ascent を使う
    _font_ascent = ascent * 1000.0 / upem


def derive_label(evidence_number, branch_range=None):
    """「甲001」+ 枝番 → 「甲第1号証の1」。番号として読めなければ None。"""
    if evidence_number is None:
        return None
    s = str(evidence_number).strip()
    i = 0
    while i < len(s) and not s[i].isdigit():
        i += 1
    sym, digits = s[:i], s[i:]
    if not sym or not digits or not digits.isdigit() or not digits.isascii():
        return None
    label = f"{sym}第{int(digits)}号証"
    b = "" if branch_range is None else str(branch_range).strip()
    if b:
        label += f"の{b}"
    return label


def is_size_over_a3(w, h):
    """内容が A3 にも原寸で収まらないか（読み込み時の警告に使う）。"""
    a3w, a3h = PAGE_SIZES["A3"]

    def fits(pw, ph):
        return w <= pw + 0.5 and h <= ph + 0.5

    return not (fits(a3w, a3h) or fits(a3h, a3w))


def _is_a4_or_a3(w, h):
    def near(a, b):
        return abs(a - b) <= A4A3_TOL_PT

    for sw, sh in (PAGE_SIZES["A4"], PAGE_SIZES["A3"]):
        if (near(w, sw) and near(h, sh)) or (near(w, sh) and near(h, sw)):
            return True
    return False


def is_image_path(p):
    return os.path.splitext(str(p or ""))[1].lower() in IMAGE_EXTS


# ---------------------------------------------------------------------------
# スタンプ指示の正規化
# ---------------------------------------------------------------------------
def normalize_op(op, evidence_number):
    """契約の stamps[] の1要素を、描画用の素の指示にする（JS の normalizeOp と同じ規則）。"""
    op = op or {}
    draw_label = op.get("drawLabel") is not False and op.get("draw_label") is not False
    branch = op.get("branch") if op.get("branch") is not None else op.get("branchRange")
    if draw_label:
        label = str(op["label"])[:MAX_LABEL_CHARS] if op.get("label") is not None else derive_label(evidence_number, branch)
    else:
        label = None
    if op.get("pageIndex") is not None:
        page_index = int(op["pageIndex"])
    else:
        page = op.get("page")
        page_index = (int(page) if isinstance(page, (int, float)) and not isinstance(page, bool) else 1) - 1
    rotate = op.get("rotate")
    if rotate is None:
        rotate = op.get("rotate_degrees", 0)
    font_size = op.get("fontSize")
    if font_size is None:
        font_size = op.get("font_size_pt")
    return {
        "pageIndex": page_index,
        "rotate": normalize_angle(rotate),
        "drawLabel": draw_label,
        "label": label,
        "position": op.get("position"),
        "fontSize": font_size,
        "color": op.get("color"),
    }


# ---------------------------------------------------------------------------
# 番号の配置（JS の placeLabel と同じ計算）
# ---------------------------------------------------------------------------
def _label_geometry(page_w, page_h, label, final_rot, position, font_size):
    """見た目（回転後）の紙面で指定された位置を、回転前のページ座標へ戻す。
    戻り値: (x, y) = 回転前ページ座標での文字の基線左端（用紙枠の原点からの距離）。"""
    _ensure_font()
    size = _clamp_font_size(font_size)
    pos = position if isinstance(position, dict) else DEFAULT_POSITION
    anchor = pos.get("anchor") if pos.get("anchor") in ANCHORS else "top-right"
    nx = _clamp01(pos.get("x"))
    ny = _clamp01(pos.get("y"))

    tw = pdfmetrics.stringWidth(label, FONT_NAME, size)
    th = _font_ascent * size / 1000.0  # ascent のみ（descender を含めない）

    swap = final_rot in (90, 270)
    vw = page_h if swap else page_w
    vh = page_w if swap else page_h

    px = nx * vw
    py_top = ny * vh
    box_left, box_top = px, py_top
    if anchor in ("top-right", "bottom-right"):
        box_left = px - tw
    if anchor in ("bottom-left", "bottom-right"):
        box_top = py_top - th
    if anchor == "center":
        box_left = px - tw / 2
        box_top = py_top - th / 2

    ua = box_left
    va = vh - box_top - th
    if final_rot == 90:
        x, y = page_w - va, ua
    elif final_rot == 180:
        x, y = page_w - ua, page_h - va
    elif final_rot == 270:
        x, y = va, page_h - ua
    else:
        x, y = ua, va
    return x, y, size


def _overlay_for_page(page, labels):
    """1ページ分の番号（複数可）を描いた重ね合わせ用ページを作る。"""
    mb = page.mediabox
    w, h = float(mb.width), float(mb.height)
    ox, oy = float(mb.left), float(mb.bottom)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(max(w, 1), max(h, 1)), pageCompression=1)
    for label, final_rot, position, font_size, color in labels:
        x, y, size = _label_geometry(w, h, label, final_rot, position, font_size)
        r, g, b = _parse_color(color)
        c.saveState()
        c.setFillColor(Color(r, g, b))
        c.setFont(FONT_NAME, size)
        c.translate(x + ox, y + oy)  # 用紙枠の原点ぶんずらす（負原点のページにも載る）
        if final_rot:
            c.rotate(final_rot)  # 反時計回り（pdf-lib の degrees() と同じ向き）
        c.drawString(0, 0, label)
        c.restoreState()
    c.showPage()
    c.save()
    buf.seek(0)
    return PdfReader(buf).pages[0]


def _apply_ops(writer, ops):
    """回転（1ページ1回）と番号の描画。ops の pageIndex は出力 PDF での絶対位置。"""
    pages = writer.pages
    n = len(pages)
    for op in ops:
        if op["pageIndex"] < 0 or op["pageIndex"] >= n:
            raise ValueError(f"page out of range: index {op['pageIndex']} (pages: {n})")

    rotated = set()
    per_page = {}
    results = []
    for op in ops:
        i = op["pageIndex"]
        page = pages[i]
        if i not in rotated:
            existing = normalize_angle(page.get("/Rotate", 0) or 0)
            final = normalize_angle(existing + op["rotate"])
            if final != existing:
                page[NameObject("/Rotate")] = NumberObject(final)
            rotated.add(i)
        final_rot = normalize_angle(page.get("/Rotate", 0) or 0)
        if op["drawLabel"] and op["label"] and str(op["label"]).strip():
            per_page.setdefault(i, []).append((op["label"], final_rot, op["position"], op["fontSize"], op["color"]))
        results.append({"pageIndex": i, "label": op["label"], "finalRot": final_rot})

    for i, labels in per_page.items():
        page = pages[i]
        page.merge_page(_overlay_for_page(page, labels))
    return results


# ---------------------------------------------------------------------------
# 用紙の正規化（A4/A3）
# ---------------------------------------------------------------------------
def _pick_page_box(w, h):
    a4, a3 = PAGE_SIZES["A4"], PAGE_SIZES["A3"]
    cands = [(a4[0], a4[1]), (a4[1], a4[0]), (a3[0], a3[1]), (a3[1], a3[0])]
    thresh = 0.9  # これ以上縮めずに収まる最小の紙を選ぶ
    for pw, ph in cands:
        s = min(pw / w, ph / h, 1)
        if s >= thresh:
            return pw, ph, s
    landscape = w > h
    pw = a3[1] if landscape else a3[0]
    ph = a3[0] if landscape else a3[1]
    return pw, ph, min(pw / w, ph / h, 1)


def _normalize_page_to_box(page):
    """非 A4/A3 のページを A4/A3 の紙面へ中央配置する（JS の normalizePageToBox と同じ）。"""
    mb = page.mediabox
    bx, by = float(mb.left), float(mb.bottom)
    w, h = float(mb.width), float(mb.height)
    pw, ph, scale = _pick_page_box(w, h)
    if scale >= 1:
        # 原寸で収まる（名刺等）: 内容は触らず、用紙枠だけを広げて中央に見せる（負の原点）
        ox = bx - (pw - w) / 2
        oy = by - (ph - h) / 2
        page.mediabox = RectangleObject([ox, oy, ox + pw, oy + ph])
        page.cropbox = RectangleObject([ox, oy, ox + pw, oy + ph])
        return
    # A3 にも原寸で収まらない大きいページだけ、内容を実際に縮小して中央へ
    sw, sh = w * scale, h * scale
    tx = (pw - sw) / 2 - bx * scale
    ty = (ph - sh) / 2 - by * scale
    page.add_transformation(Transformation().scale(scale, scale).translate(tx, ty))
    page.mediabox = RectangleObject([0, 0, pw, ph])
    page.cropbox = RectangleObject([0, 0, pw, ph])


def _needs_normalize(pages):
    return any(not _is_a4_or_a3(float(p.mediabox.width), float(p.mediabox.height)) for p in pages)


def _add_normalized_pages(writer, src_pages, page_size=None):
    """変換した Office/RTF の PDF を、各ページ A4/A3 の新しい紙面へ縮小・中央配置する。"""
    w0, h0 = PAGE_SIZES.get(page_size or "A4", PAGE_SIZES["A4"])
    for sp in src_pages:
        box = sp.mediabox
        bx, by = float(box.left), float(box.bottom)
        w, h = float(box.width), float(box.height)
        landscape = w > h
        pw = h0 if landscape else w0
        ph = w0 if landscape else h0
        scale = min(pw / w, ph / h)
        dw, dh = w * scale, h * scale
        page = writer.add_blank_page(pw, ph)
        t = Transformation().translate(-bx, -by).scale(scale, scale).translate((pw - dw) / 2, (ph - dh) / 2)
        page.merge_transformed_page(sp, t, expand=False)


# ---------------------------------------------------------------------------
# 画像 → A4/A3 の1ページ
# ---------------------------------------------------------------------------
def _image_page_pdf(src_path, page_size=None, margin_pt=None, rotate=0):
    """画像を A4/A3 の1ページにした PDF（1ページ）を作り、(reader のページ, ページ高さ) を返す。
    回転は画像そのものへ焼き込む（ページの /Rotate は使わない）。上端に番号用の白帯を空ける。
    写真の向きの情報（EXIF）は、エクスプローラーやブラウザと同じ見え方にそろえてから rotate を足す。
    rotate は PDF のページと同じく時計回りの角度（AI との約束 docs/ai-contract.md）。下の描画（c.rotate）は
    反時計回りなので、符号を反転して渡す（5.2.0 までは逆向きに回っていた）。"""
    img, exif_ccw = _image_reader_upright(src_path)
    iw, ih = img.getSize()
    rot = normalize_angle(exif_ccw - normalize_angle(rotate))
    swap = rot in (90, 270)
    rw, rh = (ih, iw) if swap else (iw, ih)
    w0, h0 = PAGE_SIZES.get(page_size or "A4", PAGE_SIZES["A4"])
    landscape = rw > rh
    pw = h0 if landscape else w0
    ph = w0 if landscape else h0
    margin = 34 if margin_pt is None else margin_pt
    top_band = 80  # 番号用に上端へ空ける白帯（ラベルの下に約1cmのすき間）
    avail_w = pw - margin * 2
    avail_h = ph - margin - top_band
    scale = min(avail_w / rw, avail_h / rh)
    dw, dh = rw * scale, rh * scale
    sw, sh = iw * scale, ih * scale
    lx = (pw - dw) / 2
    by = margin + (avail_h - dh) / 2
    if rot == 90:
        ax, ay = lx + dw, by
    elif rot == 180:
        ax, ay = lx + dw, by + dh
    elif rot == 270:
        ax, ay = lx, by + dh
    else:
        ax, ay = lx, by

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(pw, ph), pageCompression=1)
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, pw, ph, stroke=0, fill=1)
    c.saveState()
    c.translate(ax, ay)
    if rot:
        c.rotate(rot)
    c.drawImage(img, 0, 0, width=sw, height=sh, mask="auto")
    c.restoreState()
    c.showPage()
    c.save()
    buf.seek(0)
    return PdfReader(buf).pages[0], ph


# 向きの情報（EXIF Orientation）→ 正しい向きにするための回転（反時計回りの角度。描画の c.rotate と同じ向き）。
# 3・6・8 は回転だけなので元の JPEG をそのまま使い、反転を含む 2・4・5・7 は画素を作り直す。
_EXIF_ROTATION = {3: 180, 6: 270, 8: 90}


def _image_reader_upright(src_path):
    """(ImageReader, 追加で回す反時計回りの角度) を返す。向きの情報が無い・読めないときはそのまま。"""
    try:
        from PIL import Image, ImageOps
        with Image.open(src_path) as im:
            orientation = im.getexif().get(0x0112, 1)
            if orientation in (2, 4, 5, 7):
                return ImageReader(ImageOps.exif_transpose(im)), 0
    except Exception:
        orientation = 1
    return ImageReader(src_path), _EXIF_ROTATION.get(orientation, 0)


def _image_bake_rotation(stamps):
    for s in stamps or []:
        if not isinstance(s, dict):
            continue
        r = s.get("rotate_degrees")
        if r is None:
            r = s.get("rotate")
        r = normalize_angle(r or 0)
        if r:
            return r
    return 0


def _fix_image_op(op, page_height):
    """焼き込み後の画像ページ用: ページ回転を無効化し、番号の縦位置を帯直下の物理位置へ固定する。"""
    op["rotate"] = 0
    cur = op.get("position") if isinstance(op.get("position"), dict) else DEFAULT_POSITION
    x = cur.get("x") if isinstance(cur.get("x"), (int, float)) else DEFAULT_POSITION["x"]
    op["position"] = {"x": x, "y": IMG_NUMBER_TOP_PT / page_height, "anchor": "top-right"}


# ---------------------------------------------------------------------------
# メタデータ
# ---------------------------------------------------------------------------
INFO_KEYS = {
    "Title": "/Title", "Author": "/Author", "Subject": "/Subject",
    "Keywords": "/Keywords", "Creator": "/Creator", "Producer": "/Producer",
}


def _clear_metadata(writer, keys):
    """指定された文書情報と XMP を消す。XMP は参照を外すだけでなく本体も残さない（保存時に孤立物を除く）。"""
    keys = list(keys or [])
    info = writer._info.get_object() if getattr(writer, "_info", None) is not None else None
    for k in keys:
        if k == "XMP":
            if "/Metadata" in writer._root_object:
                del writer._root_object["/Metadata"]
        elif k in INFO_KEYS and info is not None and INFO_KEYS[k] in info:
            del info[INFO_KEYS[k]]


def _open_reader(path_or_bytes):
    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, (bytes, bytearray)) else path_or_bytes
    reader = PdfReader(src, strict=False)
    if reader.is_encrypted:
        # 所有者パスワードだけのPDF（閲覧は自由）は空のパスワードで開ける
        try:
            ok = reader.decrypt("")
        except Exception:
            ok = 0
        if not ok:
            raise ValueError("パスワードで保護されたPDFは扱えません。保護を解除してからお試しください。")
    return reader


def _new_writer():
    w = PdfWriter()
    w.metadata = None  # pypdf が既定で入れる Producer を持たせない
    return w


def _drop_unreachable(writer):
    """文書の根（Root・Info）からたどれないもの（消した XMP 等）を書き出さないようにする。
    pypdf の compress_identical_objects は、同じものを探すために全部の中身を展開して比べるため、
    100MB を超えるスキャンでは1分以上かかった。ここでは参照をたどるだけにする（中身は展開しない）。"""
    objs = writer._objects
    keep = set()
    stack = []

    def visit_ref(ref):
        if isinstance(ref, IndirectObject) and ref.pdf is writer and ref.idnum not in keep:
            keep.add(ref.idnum)
            if 0 < ref.idnum <= len(objs):
                stack.append(objs[ref.idnum - 1])

    for top in (writer.root_object, writer._info):
        if top is not None and getattr(top, "indirect_reference", None) is not None:
            visit_ref(top.indirect_reference)
    trailer_id = getattr(writer, "_ID", None)
    if trailer_id is not None and getattr(trailer_id, "indirect_reference", None) is not None:
        visit_ref(trailer_id.indirect_reference)
    while stack:
        obj = stack.pop()
        if isinstance(obj, DictionaryObject):  # StreamObject も DictionaryObject（辞書の部分だけ見る）
            children = obj.values()
        elif isinstance(obj, ArrayObject):
            children = obj
        else:
            continue
        for v in children:
            if isinstance(v, IndirectObject):
                visit_ref(v)
            elif isinstance(v, (DictionaryObject, ArrayObject)):
                stack.append(v)
    for i in range(len(objs)):
        if objs[i] is not None and (i + 1) not in keep:
            objs[i] = None


def _save(writer, dest_path):
    # 参照されなくなったもの（消した XMP 等）を残さない
    try:
        _drop_unreachable(writer)
    except Exception:
        pass
    buf = io.BytesIO()
    writer.write(buf)
    fileio.write_atomic(dest_path, buf.getvalue())


def _page_indices(total, pages):
    """sources[].pages（[from, to]・1始まり・両端含む）を0始まりの番号にする。範囲外はエラー。"""
    if pages is None:
        return list(range(total))
    try:
        frm, to = int(pages[0]), int(pages[1])
        if frm != pages[0] or to != pages[1]:
            raise ValueError
    except (TypeError, ValueError, IndexError):
        raise ValueError(f"ページの範囲が正しくありません（{pages}／全{total}ページ）")
    if frm < 1 or to < frm or to > total:
        raise ValueError(f"ページの範囲が正しくありません（{frm},{to}／全{total}ページ）")
    return list(range(frm - 1, to))


# ---------------------------------------------------------------------------
# 公開する処理
# ---------------------------------------------------------------------------
def stamp_evidence(params):
    """1つの元ファイル（PDF・画像）の複製に、回転補正と番号を入れて dest へ保存する。元は書き換えない。"""
    src_path = params["srcPath"]
    dest_path = params["destPath"]
    evidence_number = params.get("evidenceNumber")
    raw_ops = params["stamps"] if isinstance(params.get("stamps"), list) else [params]
    ops = [normalize_op(op, evidence_number) for op in raw_ops]

    if is_image_path(src_path):
        writer = _new_writer()
        page, page_h = _image_page_pdf(src_path, params.get("pageSize"), params.get("marginPt"),
                                       _image_bake_rotation(raw_ops))
        writer.add_page(page)
        for op in ops:
            _fix_image_op(op, page_h)
    else:
        reader = _open_reader(src_path)
        if params.get("normalize"):
            writer = _new_writer()
            _add_normalized_pages(writer, reader.pages, params.get("pageSize"))
        else:
            writer = PdfWriter(clone_from=reader)
            if _needs_normalize(writer.pages):
                for p in writer.pages:
                    _normalize_page_to_box(p)

    _clear_metadata(writer, params.get("clearMetadataKeys"))
    results = _apply_ops(writer, ops)
    _save(writer, dest_path)
    return {"destPath": dest_path, "evidenceNumber": evidence_number, "pageCount": len(writer.pages),
            "results": results}


def merge_and_stamp(params):
    """複数の元ファイル（枝番ごとのファイル、またはページ範囲で分けた枝番）を1つの PDF に結合して押す。
    各 source の stamps[].page はその source の中での1始まり（pages 指定時は範囲の中での番号）。"""
    dest_path = params["destPath"]
    evidence_number = params.get("evidenceNumber")
    sources = params.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("sources is required")

    writer = _new_writer()
    ops = []
    source_info = []
    for source in sources:
        offset = len(writer.pages)
        img_page_h = None
        if is_image_path(source["srcPath"]):
            page, img_page_h = _image_page_pdf(source["srcPath"], source.get("pageSize"), source.get("marginPt"),
                                               _image_bake_rotation(source.get("stamps")))
            writer.add_page(page)
            added = 1
        else:
            reader = _open_reader(source["srcPath"])
            indices = _page_indices(len(reader.pages), source.get("pages"))
            if source.get("normalize"):
                _add_normalized_pages(writer, [reader.pages[i] for i in indices], source.get("pageSize"))
            else:
                needs = _needs_normalize([reader.pages[i] for i in indices])
                for i in indices:
                    p = writer.add_page(reader.pages[i])
                    if needs:
                        _normalize_page_to_box(p)
            added = len(writer.pages) - offset

        source_info.append({"srcPath": source["srcPath"], "pages": source.get("pages"),
                            "startPage": offset + 1, "pageCount": added})
        for stamp in source.get("stamps") or []:
            op = normalize_op(stamp, evidence_number)
            op["pageIndex"] += offset
            if img_page_h is not None:
                _fix_image_op(op, img_page_h)
            ops.append(op)

    results = _apply_ops(writer, ops)
    _save(writer, dest_path)
    return {"destPath": dest_path, "evidenceNumber": evidence_number, "pageCount": len(writer.pages),
            "sources": source_info, "results": results}


def read_info(path):
    """読み込み画面用: 文書情報・XMP の有無・ページ数・A3 超の寸法・能動的コンテンツ。"""
    reader = _open_reader(path)
    fields = []
    info = reader.metadata or {}
    for key, pdf_key in INFO_KEYS.items():
        v = info.get(pdf_key)
        if v is not None and str(v).strip():
            fields.append({"key": key, "value": str(v)})
    if "/Metadata" in reader.trailer["/Root"]:
        fields.append({"key": "XMP", "value": "詳細メタデータ（タイトル・作成者などの複製。PDFビュワーのタブ表示に使われます）"})
    over_a3 = None
    pt_per_mm = 72 / 25.4
    for p in reader.pages:
        w, h = float(p.mediabox.width), float(p.mediabox.height)
        if is_size_over_a3(w, h):
            over_a3 = {"wmm": round(w / pt_per_mm), "hmm": round(h / pt_per_mm)}
            break
    try:
        active = active_content_labels(inspect_active_content(reader))
    except Exception:
        active = []
    return {"fields": fields, "pageCount": len(reader.pages), "overA3": over_a3, "activeContent": active}


# ---------------------------------------------------------------------------
# 能動的コンテンツの検出（削除はしない）
# ---------------------------------------------------------------------------
ACTIVE_CONTENT_LABELS = {
    "javascript": "JavaScript（開いたときに動く命令）",
    "openAction": "自動実行の設定（開いたときの動作）",
    "embeddedFile": "埋め込みファイル・添付",
    "form": "入力フォーム",
    "xfa": "XFAフォーム（特殊な入力フォーム）",
    "link": "外部リンク",
    "launch": "外部プログラムの起動指定",
    "submitForm": "フォームの送信指定",
}


def _resolve(v):
    try:
        return v.get_object() if isinstance(v, IndirectObject) else v
    except Exception:
        return None


def inspect_active_content(reader):
    """開いた PdfReader から、含まれている能動的コンテンツの種類を返す（JS と同じ判定）。"""
    found = []

    def add(k):
        if k not in found:
            found.append(k)

    cat = _resolve(reader.trailer["/Root"])
    if "/OpenAction" in cat or "/AA" in cat:
        add("openAction")
    names = _resolve(cat.get("/Names"))
    if isinstance(names, DictionaryObject):
        if names.get("/JavaScript") is not None:
            add("javascript")
        if names.get("/EmbeddedFiles") is not None:
            add("embeddedFile")
    acro = _resolve(cat.get("/AcroForm"))
    if isinstance(acro, DictionaryObject):
        add("form")
        if acro.get("/XFA") is not None:
            add("xfa")
    for page in reader.pages:
        annots = _resolve(page.get("/Annots"))
        if not isinstance(annots, ArrayObject):
            continue
        for ref in annots:
            an = _resolve(ref)
            if not isinstance(an, DictionaryObject):
                continue
            sub = str(_resolve(an.get("/Subtype")) or "")
            if sub == "/FileAttachment":
                add("embeddedFile")
            if sub == "/Widget":
                add("form")
            if "/AA" in an:
                add("javascript")
            act = _resolve(an.get("/A"))
            if isinstance(act, DictionaryObject):
                s = str(_resolve(act.get("/S")) or "")
                if s == "/JavaScript":
                    add("javascript")
                if s == "/Launch":
                    add("launch")
                if s == "/URI":
                    add("link")
                if s == "/SubmitForm":
                    add("submitForm")
    return found


def active_content_labels(keys):
    return [ACTIVE_CONTENT_LABELS.get(k, k) for k in keys or []]


# ---------------------------------------------------------------------------
# プレビュー用: 白黒スキャン（CCITTFax）を描ける画像へ差し替える（出力ファイルは無変更）
# ---------------------------------------------------------------------------
CCITT_PREVIEW_CAP = 40
CCITT_MAX_PIXELS = 40 * 1000 * 1000        # 1画像あたり
CCITT_MAX_TOTAL_PIXELS = 100 * 1000 * 1000  # 1ファイル内の合計


def _num(v, default):
    v = _resolve(v)
    if isinstance(v, bool):
        return default
    return v if isinstance(v, (int, float)) else default


def _bool(v, default):
    v = _resolve(v)
    if isinstance(v, BooleanObject):
        return v.value  # bool(BooleanObject(False)) は True になるので値を直接見る
    return v if isinstance(v, bool) else default


def _filter_names(v):
    v = _resolve(v)
    if isinstance(v, NameObject):
        return [str(v)[1:]]
    if isinstance(v, ArrayObject):
        return [str(_resolve(x))[1:] for x in v]
    return []


def _build_tiff(width, height, comp, photometric, t4opts, strip):
    tags = [
        (256, 3, 1, width), (257, 3, 1, height), (258, 3, 1, 1), (259, 3, 1, comp),
        (262, 3, 1, photometric), (273, 4, 1, 0), (277, 3, 1, 1), (278, 4, 1, height),
        (279, 4, 1, len(strip)),
    ]
    if comp == 3:
        tags.append((292, 4, 1, t4opts))
    tags.sort()
    header = 8
    strip_off = header + 2 + len(tags) * 12 + 4
    out = bytearray(b"II") + struct.pack("<HI", 42, header) + struct.pack("<H", len(tags))
    for tag, typ, cnt, val in tags:
        v = strip_off if tag == 273 else val
        if typ == 3:
            out += struct.pack("<HHIHH", tag, typ, cnt, v & 0xFFFF, 0)
        else:
            out += struct.pack("<HHII", tag, typ, cnt, v)
    out += struct.pack("<I", 0)
    return bytes(out) + bytes(strip)


def _border_is_dark(img):
    """余白が黒優勢か（白黒の取り違えの保険・プレビュー用途）。JS 版と同じく四辺の帯を数える
    （角は左右と上下の両方で数える）。画素を1つずつ見ると遅いので、帯ごとの濃度分布で数える。"""
    w, h = img.size
    b = max(2, round(min(w, h) * 0.02))
    strips = [(0, 0, b, h), (w - b, 0, w, h), (0, 0, w, b), (0, h - b, w, h)]
    dark = total = 0
    for box in strips:
        hist = img.crop(box).histogram()
        dark += sum(hist[:128])
        total += sum(hist)
    return total > 0 and dark > total * 0.5


def _ccitt_to_gray(stream, budget):
    """1枚の CCITTFax 画像ストリームを 8bit グレーの PIL 画像へ。対象外・失敗は None。"""
    from PIL import Image, ImageOps

    try:
        if str(_resolve(stream.get("/Subtype"))) != "/Image":
            return None
        if _bool(stream.get("/ImageMask"), False):
            return None
        filters = _filter_names(stream.get("/Filter") or stream.get("/F"))
        if filters != ["CCITTFaxDecode"]:
            return None
        dp = _resolve(stream.get("/DecodeParms") or stream.get("/DP"))
        if isinstance(dp, ArrayObject):
            dp = _resolve(dp[0])
        dp = dp if isinstance(dp, DictionaryObject) else {}
        height = _num(stream.get("/Height") or stream.get("/H"), 0)
        k = _num(dp.get("/K"), 0)
        columns = _num(dp.get("/Columns"), 1728)
        rows = _num(dp.get("/Rows"), height) or height
        black_is_1 = _bool(dp.get("/BlackIs1"), False)
        if _bool(dp.get("/EncodedByteAlign"), False):
            return None
        if not columns or not rows or columns < 0 or rows < 0:
            return None
        pixels = columns * rows
        if pixels > CCITT_MAX_PIXELS:
            return None
        if budget is not None:
            if budget[0] < pixels:
                return None
            budget[0] -= pixels
        raw = stream._data  # 生の CCITT データ（復号しない）
        comp = 4 if k < 0 else 3
        t4 = 1 if k > 0 else 0
        photometric = 0 if black_is_1 else 1
        tiff = _build_tiff(int(columns), int(rows), comp, photometric, t4, raw)
        img = Image.open(io.BytesIO(tiff))
        img.load()
        gray = img.convert("L")
        dec = _resolve(stream.get("/Decode") or stream.get("/D"))
        if isinstance(dec, ArrayObject) and len(dec) >= 2 and float(dec[0]) == 1 and float(dec[1]) == 0:
            gray = ImageOps.invert(gray)
        if _border_is_dark(gray):
            gray = ImageOps.invert(gray)
        return gray
    except Exception:
        return None


def transcode_ccitt_for_preview(data):
    """PDF バイト列中の CCITTFax 画像を、プレビュー（pdf.js）で描ける画像へ置き換えて返す。
    CCITT が無い・失敗したときは元のバイト列をそのまま返す（プレビューを壊さない）。"""
    try:
        if b"CCITTFaxDecode" not in data:
            return data
        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(data), strict=False))
        writer.metadata = None
        budget = [CCITT_MAX_TOTAL_PIXELS]
        replaced = {}
        checked = set()
        for page in writer.pages:
            res = _resolve(page.get("/Resources"))
            xobjs = _resolve(res.get("/XObject")) if isinstance(res, DictionaryObject) else None
            if not isinstance(xobjs, DictionaryObject):
                continue
            for name in list(xobjs.keys()):
                ref = xobjs.raw_get(name)  # [] だと参照が自動で解決され、どの画像か見分けられない
                key = ref.idnum if isinstance(ref, IndirectObject) else None
                if key is None:
                    continue
                if key in replaced:
                    xobjs[NameObject(name)] = replaced[key]
                    continue
                if key in checked or len(replaced) >= CCITT_PREVIEW_CAP:
                    continue
                checked.add(key)
                gray = _ccitt_to_gray(_resolve(ref), budget)
                if gray is None:
                    continue
                rgb = gray.convert("RGB")  # JS 版と同じく DeviceRGB で入れる
                plain = DecodedStreamObject()
                plain.set_data(rgb.tobytes())
                stream = plain.flate_encode(level=6)
                stream.update({
                    NameObject("/Type"): NameObject("/XObject"),
                    NameObject("/Subtype"): NameObject("/Image"),
                    NameObject("/Width"): NumberObject(rgb.width),
                    NameObject("/Height"): NumberObject(rgb.height),
                    NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                    NameObject("/BitsPerComponent"): NumberObject(8),
                })
                new_ref = writer._add_object(stream)
                replaced[key] = new_ref
                xobjs[NameObject(name)] = new_ref
        if not replaced:
            return data
        try:
            writer.compress_identical_objects(remove_identicals=False, remove_orphans=True)
        except Exception:
            pass
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue()
    except Exception:
        return data


__all__ = [
    "stamp_evidence", "merge_and_stamp", "derive_label", "normalize_angle", "is_size_over_a3",
    "transcode_ccitt_for_preview", "inspect_active_content", "active_content_labels", "read_info",
]
