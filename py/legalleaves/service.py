# -*- coding: utf-8 -*-
"""
画面から呼ばれる処理の本体（Electron 版 main.js の移植。窓・ダイアログは app.py 側）。

ここは画面に依存しないので、そのまま自動テストできる。
読み込み・出力の許可リスト（利用者が選んだファイル・フォルダだけを扱う）もここで持つ。
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile

from . import docx_engine, fileio, pdf_engine, storage
from .paths import resource_path

SUBFOLDER_NAME = "提出用ファイル"
MAX_BATCH_FILES = 500
MAX_SOURCE_FILE_BYTES = 500 * 1024 * 1024  # SEC-C7: 1ファイル500MB

OFFICE_EXTS = {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".rtf"}
AV_EXTS = {".mp3", ".mp4"}
SOURCE_EXTS = {".pdf", ".jpg", ".jpeg", ".png", ".mp3", ".mp4"} | OFFICE_EXTS
OUTPUT_EXTS = {".pdf", ".mp3", ".mp4"}
AV_UNSUPPORTED_EXTS = {
    ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif", ".amr",
    ".mov", ".avi", ".wmv", ".mkv", ".m4v", ".flv", ".webm", ".3gp", ".3g2", ".mpeg", ".mpg", ".mts", ".ts", ".vob",
}
IMG_UNSUPPORTED_EXTS = {".gif", ".bmp", ".tif", ".tiff", ".webp", ".heic", ".heif", ".svg", ".ico"}
OOXML_TEXT_EXTS = {".docx", ".docm"}
INLINE_PREVIEW_EXTS = {".pdf", ".png", ".jpg", ".jpeg"}
METADATA_KEYS = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]
WINDOWS_RESERVED_RE = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.I)
TEMP_PREFIX = "legalleaves-"
CREATE_NO_WINDOW = 0x08000000


def _ext(p):
    return os.path.splitext(str(p or ""))[1].lower()


def rejection_reason(name):
    """提出できない形式なら利用者向けの理由。対応形式・拡張子なし（フォルダ等）は None。"""
    ext = _ext(name)
    if not ext or ext in SOURCE_EXTS:
        return None
    if ext in AV_UNSUPPORTED_EXTS:
        return "音声・動画は .mp3 / .mp4 のみ提出できます。変換してからお試しください。"
    if ext in IMG_UNSUPPORTED_EXTS:
        return "画像は .jpeg / .png のみ対応です。変換してからお試しください。"
    return "この形式は提出できません（対応: PDF／画像(.jpeg,.png)／Office(Word・Excel・PowerPoint・RTF)／音声(.mp3)・動画(.mp4)）。"


def oversize_reason(path):
    try:
        if os.path.getsize(path) > MAX_SOURCE_FILE_BYTES:
            return "500MBを超えるファイルは読み込めません（分割するか、容量を減らしてください）。"
    except OSError:
        pass
    return None


def is_av_path(p):
    return _ext(p) in AV_EXTS


def is_office_path(p):
    return _ext(p) in OFFICE_EXTS


def canonical(p):
    """実在するパスの正規形（大文字小文字・シンボリックリンクを吸収）。無ければ None。"""
    if not isinstance(p, str) or not p.strip():
        return None
    try:
        real = os.path.realpath(os.path.abspath(p), strict=True)
    except (OSError, TypeError):
        return None
    return os.path.normcase(real)


# ---------------------------------------------------------------------------
# ファイル名
# ---------------------------------------------------------------------------
def clean_base_name(name):
    """フォルダ部分と Windows で使えない文字を取り除く（貼り付けた AI データの名前で出力先の外へ出ない）。"""
    base = os.path.basename(str(name or "").replace("/", "\\").split("\\")[-1])
    base = re.sub(r'[\\/:*?"<>|]', "_", base)
    base = re.sub(r"^\.+", "", base)
    base = re.sub(r"[. ]+$", "", base).strip()
    stem = base[:base.index(".")] if "." in base else base
    if WINDOWS_RESERVED_RE.match(stem):
        base = "_" + base
    return base


def dedupe_dest_path(d, file_name):
    stem, ext = os.path.splitext(file_name)
    candidate = os.path.join(d, file_name)
    n = 2
    while os.path.exists(candidate):
        candidate = os.path.join(d, f"{stem} ({n}){ext}")
        n += 1
    return candidate


def sanitize_file_name(file_name):
    cleaned = clean_base_name(file_name)
    if not cleaned:
        return "untitled.pdf"
    return cleaned if _ext(cleaned) in OUTPUT_EXTS else cleaned + ".pdf"


def rename_only_dest(d, dest_name, src_path):
    src_ext = _ext(src_path)
    base = clean_base_name(dest_name) or "untitled"
    if _ext(base) != src_ext:
        base += src_ext
    return dedupe_dest_path(d, base)


def unique_dest_path(d, file_name):
    return dedupe_dest_path(d, sanitize_file_name(file_name))


def meta_keys_to_clear(actions):
    if not isinstance(actions, dict):
        return []
    return [k for k, v in actions.items() if v == "delete"]


def is_valid_page_range(pages):
    return (isinstance(pages, list) and len(pages) == 2
            and all(isinstance(x, int) and not isinstance(x, bool) for x in pages)
            and pages[0] >= 1 and pages[1] >= pages[0])


# ---------------------------------------------------------------------------
# Office/RTF → PDF（MS Office を優先し、無ければ LibreOffice）
# ---------------------------------------------------------------------------
OFFICE_APP_FOR_EXT = {
    ".doc": "word", ".docx": "word", ".rtf": "word",
    ".xls": "excel", ".xlsx": "excel",
    ".ppt": "powerpoint", ".pptx": "powerpoint",
}

# 入っている MS Office（買い切り・Microsoft 365 とも同じ COM）で PDF に書き出す。
# Unblock-File でダウンロード由来の印（MOTW）を外し、保護ビューで自動化が止まらないようにする。
# マクロは必ず無効（証拠は相手方由来のことが多く、信頼できない）。
CONVERT_PS1 = r'''param([string]$Src,[string]$Dst,[string]$App)
$ErrorActionPreference = "Stop"
try { Unblock-File -Path $Src -ErrorAction SilentlyContinue } catch {}
switch ($App) {
  "word" {
    $a = New-Object -ComObject Word.Application
    $a.Visible = $false; $a.DisplayAlerts = 0
    try { $a.AutomationSecurity = 3 } catch {}
    try { $d = $a.Documents.Open($Src,$false,$true); $d.ExportAsFixedFormat($Dst,17); $d.Close($false) }
    finally { $a.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($a) | Out-Null }
  }
  "excel" {
    $a = New-Object -ComObject Excel.Application
    $a.Visible = $false; $a.DisplayAlerts = $false
    try { $a.AutomationSecurity = 3 } catch {}
    try { $wb = $a.Workbooks.Open($Src,0,$true); $wb.ExportAsFixedFormat(0,$Dst); $wb.Close($false) }
    finally { $a.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($a) | Out-Null }
  }
  "powerpoint" {
    $a = New-Object -ComObject PowerPoint.Application
    try { $a.AutomationSecurity = 3 } catch {}
    try { $p = $a.Presentations.Open($Src,$true,$false,$false); $p.SaveAs($Dst,32); $p.Close() }
    finally { $a.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($a) | Out-Null }
  }
  default { throw "unsupported app" }
}
if (-not (Test-Path $Dst)) { throw "PDF was not produced" }
'''


def _temp_root():
    return tempfile.gettempdir()


def _convert_script_path():
    p = os.path.join(_temp_root(), TEMP_PREFIX + "convert.ps1")
    with open(p, "w", encoding="utf-8-sig") as f:  # BOM 付き: 日本語パスを PowerShell 5.1 が正しく読む
        f.write(CONVERT_PS1)
    return p


def _find_soffice():
    for c in (os.environ.get("SOFFICE_PATH"),
              r"C:\Program Files\LibreOffice\program\soffice.exe",
              r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"):
        if c and os.path.isfile(c):
            return c
    return shutil.which("soffice") or "soffice"


def convert_office_to_pdf(src_path):
    """Office/RTF を PDF にする。戻り値 (pdf のパス, 一時フォルダ)。呼び出し側が一時フォルダを消す。"""
    ext = _ext(src_path)
    base = os.path.splitext(os.path.basename(src_path))[0]
    temp_dir = os.path.join(_temp_root(), f"{TEMP_PREFIX}conv-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}")
    os.makedirs(temp_dir, exist_ok=True)
    # 元ファイルには触れず、複製に対して変換する
    src_copy = os.path.join(temp_dir, os.path.basename(src_path))
    shutil.copyfile(src_path, src_copy)
    out = os.path.join(temp_dir, base + ".pdf")

    try:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-File", _convert_script_path(), "-Src", src_copy, "-Dst", out,
             "-App", OFFICE_APP_FOR_EXT.get(ext, "word")],
            timeout=180, check=True, capture_output=True, creationflags=CREATE_NO_WINDOW,
        )
        if os.path.exists(out):
            return out, temp_dir
    except Exception:
        pass  # MS Office が無い・失敗 → LibreOffice へ

    try:
        if os.path.exists(out):
            os.remove(out)
    except OSError:
        pass
    try:
        profile = os.path.join(_temp_root(), TEMP_PREFIX + "lo-profile")
        profile_url = "file:///" + profile.replace("\\", "/")
        subprocess.run(
            [_find_soffice(), f"-env:UserInstallation={profile_url}", "--headless", "--norestore",
             "--convert-to", "pdf", "--outdir", temp_dir, src_copy],
            timeout=180, check=True, capture_output=True, creationflags=CREATE_NO_WINDOW,
        )
        if os.path.exists(out):
            return out, temp_dir
        pdfs = [f for f in os.listdir(temp_dir) if f.lower().endswith(".pdf")]
        if pdfs:
            return os.path.join(temp_dir, pdfs[0]), temp_dir
    except Exception:
        pass

    shutil.rmtree(temp_dir, ignore_errors=True)
    raise RuntimeError(f"変換できませんでした（{os.path.basename(src_path)}）。MS Office または LibreOffice が必要です。")


def inspect_docx_personal_info(path):
    """FB-19: Word 文書の「保存時に個人情報を削除」の有無と、残っている作成者などを返す。"""
    try:
        if os.path.getsize(path) > 40 * 1024 * 1024:
            return None
        with zipfile.ZipFile(path) as z:
            def text_of(name):
                try:
                    return z.read(name).decode("utf-8", "replace")
                except KeyError:
                    return ""
            remove = re.search(r"<w:removePersonalInformation\b", text_of("word/settings.xml")) is not None
            core = text_of("docProps/core.xml")

            def pick(tag):
                m = re.search(rf"<{tag}[^>]*>([\s\S]*?)</{tag}>", core)
                return re.sub(r"<[^>]*>", "", m.group(1)).strip() if m else ""

            return {"removePersonalInfo": remove, "creator": pick("dc:creator"),
                    "lastModifiedBy": pick("cp:lastModifiedBy"), "title": pick("dc:title")}
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 1回の起動（セッション）が持つ状態
# ---------------------------------------------------------------------------
class Session:
    def __init__(self):
        self.allowed_sources = set()
        self.allowed_output_dirs = set()
        self.last_output_dir = ""
        self.preview_dir = ""
        self.dirty = False

    # --- 許可リスト ---
    def remember_source(self, path):
        c = canonical(path)
        if not c or _ext(path) not in SOURCE_EXTS:
            return False
        try:
            if not os.path.isfile(path) or os.path.getsize(path) > MAX_SOURCE_FILE_BYTES:
                return False
        except OSError:
            return False
        self.allowed_sources.add(c)
        return True

    def remember_output_dir(self, path):
        c = canonical(path)
        if not c or not os.path.isdir(path):
            return False
        self.allowed_output_dirs.add(c)
        return True

    def is_allowed_source(self, path):
        c = canonical(path)
        return bool(c) and c in self.allowed_sources

    def is_allowed_output_dir(self, path):
        c = canonical(path)
        return bool(c) and c in self.allowed_output_dirs

    def is_in_preview_dir(self, path):
        f, d = canonical(path), canonical(self.preview_dir)
        if not f or not d:
            return False
        return f.startswith(d.rstrip("\\/") + os.sep)

    def cleanup_preview_dir(self):
        if self.preview_dir:
            shutil.rmtree(self.preview_dir, ignore_errors=True)
        self.preview_dir = ""

    # --- ファイルの受け付け ---
    def register_paths(self, paths):
        """パス（ファイル・フォルダ）を受け付ける。フォルダは中のファイルを再帰的にたどる。"""
        accepted, rejected = [], []
        for p in _expand_paths(paths):
            if len(accepted) + len(rejected) >= MAX_BATCH_FILES:
                break
            name = os.path.basename(p)
            if self.remember_source(p):
                accepted.append({"path": p, "name": name})
            else:
                reason = oversize_reason(p) or rejection_reason(name)
                if reason:
                    rejected.append({"name": name, "reason": reason})
        return {"accepted": accepted, "rejected": rejected}

    # --- 読み込み画面の情報 ---
    def read_pdf_metadata(self, paths):
        out = []
        if not isinstance(paths, list):
            return out
        for p in paths[:MAX_BATCH_FILES]:
            try:
                if not self.is_allowed_source(p):
                    raise ValueError("選択されていないファイルです")
                ext = _ext(p)
                if ext in OOXML_TEXT_EXTS:
                    out.append({"path": p, "name": os.path.basename(p), "fields": [],
                                "officeMeta": inspect_docx_personal_info(p)})
                    continue
                if ext != ".pdf":
                    out.append({"path": p, "name": os.path.basename(p), "fields": []})
                    continue
                info = pdf_engine.read_info(p)
                item = {"path": p, "name": os.path.basename(p), "fields": info["fields"],
                        "pageCount": info["pageCount"]}
                if info["overA3"]:
                    item["overA3"] = info["overA3"]
                if info["activeContent"]:
                    item["activeContent"] = info["activeContent"]
                out.append(item)
            except Exception as e:
                out.append({"path": p, "name": os.path.basename(str(p)), "fields": [], "error": _error_text(e)})
        return out

    # --- 出力 ---
    def build_outputs_into(self, outputs, final_dir, rename_only=False):
        written, errors = [], []
        for output in (outputs or [])[:MAX_BATCH_FILES]:
            name = (output or {}).get("destName") or ""
            conv_dirs = []
            try:
                sources = (output or {}).get("sources")
                if not isinstance(sources, list) or not sources:
                    raise ValueError("出力データの形式が正しくありません")
                for s in sources:
                    if not isinstance(s, dict) or not self.is_allowed_source(s.get("srcPath")):
                        raise ValueError("選択されていないファイルです")
                    if s.get("pages") is not None and not is_valid_page_range(s.get("pages")):
                        raise ValueError("ページの範囲が正しくありません")
                ev = output.get("evidenceNumber") or None

                if rename_only:
                    s = sources[0]
                    src = s["srcPath"]
                    if is_office_path(src):
                        pdf, tmp = convert_office_to_pdf(src)
                        conv_dirs.append(tmp)
                        dest = rename_only_dest(final_dir, output.get("destName"), "x.pdf")
                        pdf_engine.stamp_evidence({
                            "srcPath": pdf, "destPath": dest, "evidenceNumber": None, "stamps": [],
                            "clearMetadataKeys": METADATA_KEYS + ["XMP"], "normalize": True,
                        })
                        written.append({"name": os.path.basename(dest), "path": dest, "evidenceNumber": ev})
                        continue
                    dest = rename_only_dest(final_dir, output.get("destName"), src)
                    clear = meta_keys_to_clear(s.get("metadataActions"))
                    if _ext(src) == ".pdf" and clear:
                        pdf_engine.stamp_evidence({
                            "srcPath": src, "destPath": dest, "evidenceNumber": None, "stamps": [],
                            "clearMetadataKeys": clear, "normalize": False,
                        })
                    else:
                        fileio.copy_atomic(src, dest)
                    written.append({"name": os.path.basename(dest), "path": dest, "evidenceNumber": ev})
                    continue

                dest_path = unique_dest_path(final_dir, output.get("destName"))
                if len(sources) == 1 and is_av_path(sources[0]["srcPath"]):
                    fileio.copy_atomic(sources[0]["srcPath"], dest_path)  # 音声・動画は名前だけ
                    written.append({"name": os.path.basename(dest_path), "path": dest_path, "evidenceNumber": ev})
                    continue

                resolved = []
                for s in sources:
                    if is_office_path(s["srcPath"]):
                        pdf, tmp = convert_office_to_pdf(s["srcPath"])
                        conv_dirs.append(tmp)
                        resolved.append({**s, "srcPath": pdf, "normalize": True})
                    else:
                        resolved.append({**s, "normalize": False})

                # ページ範囲で分けた枝番（pages）を含む出力は、1件でも結合の経路を通す
                if len(resolved) == 1 and resolved[0].get("pages") is None:
                    s = resolved[0]
                    res = pdf_engine.stamp_evidence({
                        "srcPath": s["srcPath"], "destPath": dest_path, "evidenceNumber": ev,
                        "stamps": s.get("stamps") if isinstance(s.get("stamps"), list) else [],
                        "clearMetadataKeys": meta_keys_to_clear(s.get("metadataActions")),
                        "normalize": s["normalize"],
                    })
                    src_info = [{"srcPath": sources[0]["srcPath"], "pages": None, "startPage": 1,
                                 "pageCount": res["pageCount"]}]
                else:
                    # 結合: 新しい文書にページを集めるので、元の文書情報は引き継がれない
                    res = pdf_engine.merge_and_stamp({
                        "destPath": dest_path, "evidenceNumber": ev,
                        "sources": [{"srcPath": s["srcPath"],
                                     "stamps": s.get("stamps") if isinstance(s.get("stamps"), list) else [],
                                     "normalize": s["normalize"], "pages": s.get("pages")} for s in resolved],
                    })
                    # 画面との対応付けのため、変換後の一時 PDF ではなく元ファイルのパスで返す
                    src_info = [{"srcPath": sources[i]["srcPath"] if i < len(sources) else si["srcPath"],
                                 "pages": si.get("pages"), "startPage": si["startPage"],
                                 "pageCount": si["pageCount"]}
                                for i, si in enumerate(res["sources"])]
                written.append({"name": os.path.basename(dest_path), "path": dest_path,
                                "evidenceNumber": ev, "sources": src_info})
            except Exception as e:
                errors.append({"name": name, "message": _error_text(e)})
            finally:
                for d in conv_dirs:
                    shutil.rmtree(d, ignore_errors=True)
        return {"written": written, "errors": errors}

    def generate_explanation_into(self, final_dir, explanation):
        """証拠説明書: 編集用の .docx と、提出用の .pdf（メタデータを消し A4 にそろえる）。"""
        template = resource_path("assets", "templates", "証拠説明書テンプレート.docx")
        data = (explanation or {}).get("data") or {}
        docx_path = rename_only_dest(final_dir, (explanation or {}).get("destName") or "証拠説明書.docx", "x.docx")
        docx_engine.generate_evidence_explanation(template, docx_path, data)
        written = [{"name": os.path.basename(docx_path), "path": docx_path, "evidenceNumber": None}]
        errors = []
        # UX-18: 未入力（●●）が残っているうちは PDF 化しない（Word で埋めた後に作り直すため）
        if "●●" in json.dumps(data, ensure_ascii=False):
            return {"written": written, "errors": errors}
        stem = os.path.splitext(os.path.basename(docx_path))[0]
        try:
            pdf, tmp = convert_office_to_pdf(docx_path)
            try:
                pdf_dest = rename_only_dest(final_dir, stem + ".pdf", "x.pdf")
                pdf_engine.stamp_evidence({
                    "srcPath": pdf, "destPath": pdf_dest, "evidenceNumber": None, "stamps": [],
                    "clearMetadataKeys": METADATA_KEYS + ["XMP"], "normalize": True,
                })
                written.append({"name": os.path.basename(pdf_dest), "path": pdf_dest, "evidenceNumber": None})
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        except Exception as e:
            errors.append({"name": stem + ".pdf",
                           "message": f"証拠説明書のPDF化に失敗しました（Wordのdocxは作成済み）: {e}"})
        return {"written": written, "errors": errors}

    def create_submission_files(self, payload):
        payload = payload or {}
        outputs = payload.get("outputs")
        if not isinstance(outputs, list):
            return {"written": [], "errors": [{"name": "", "message": "出力データの形式が正しくありません"}]}
        dest_dir = payload.get("destDir")
        if not self.is_allowed_output_dir(dest_dir):
            return {"written": [], "errors": [{"name": (o or {}).get("destName") or "", "message": "選択されていない出力先です"}
                                              for o in outputs]}
        final_dir = os.path.join(dest_dir, SUBFOLDER_NAME) if payload.get("makeSubfolder") else dest_dir
        try:
            os.makedirs(final_dir, exist_ok=True)
        except OSError as e:
            return {"written": [], "errors": [{"name": (o or {}).get("destName") or "",
                                               "message": f"出力先フォルダを作成できません: {e}"} for o in outputs]}
        r = self.build_outputs_into(outputs, final_dir, bool(payload.get("renameOnly")))
        expl = payload.get("explanation")
        if expl and expl.get("data"):
            try:
                g = self.generate_explanation_into(final_dir, expl)
                r["written"] += g["written"]
                r["errors"] += g["errors"]
            except Exception as e:
                r["errors"].append({"name": expl.get("destName") or "証拠説明書.docx",
                                    "message": f"証拠説明書の生成に失敗しました: {e}"})
        _with_sizes(r["written"])
        storage.add_recent_folder(dest_dir)
        self.remember_output_dir(final_dir)
        self.last_output_dir = final_dir
        self.cleanup_preview_dir()
        return {**r, "outputDir": final_dir, "caseFileSaved": None}

    # --- プレビュー ---
    def generate_preview(self, payload):
        outputs = (payload or {}).get("outputs")
        if not isinstance(outputs, list):
            return {"files": [], "errors": [{"name": "", "message": "出力データの形式が正しくありません"}]}
        self.cleanup_preview_dir()
        d = os.path.join(_temp_root(), f"{TEMP_PREFIX}preview-{int(time.time() * 1000)}")
        try:
            os.makedirs(d, exist_ok=True)
        except OSError as e:
            return {"files": [], "errors": [{"name": "", "message": f"プレビュー用フォルダを作成できません: {e}"}]}
        self.preview_dir = d
        previewable = [o for o in outputs
                       if not (isinstance(o, dict) and isinstance(o.get("sources"), list)
                               and len(o["sources"]) == 1 and is_av_path(o["sources"][0].get("srcPath")))]
        r = self.build_outputs_into(previewable, d)
        return {"files": _with_sizes(r["written"]), "errors": r["errors"]}

    def regenerate_preview_file(self, payload):
        if not self.preview_dir:
            return {"file": None, "errors": []}
        output = (payload or {}).get("output")
        if not isinstance(output, dict) or not isinstance(output.get("sources"), list) or not output["sources"]:
            return {"file": None, "errors": [{"name": "", "message": "出力データの形式が正しくありません"}]}
        if len(output["sources"]) == 1 and is_av_path(output["sources"][0].get("srcPath")):
            return {"file": None, "errors": []}
        old = (payload or {}).get("oldPath")
        if old and self.is_in_preview_dir(old):
            try:
                os.remove(old)
            except OSError:
                pass
        r = self.build_outputs_into([output], self.preview_dir)
        _with_sizes(r["written"])
        return {"file": r["written"][0] if r["written"] else None, "errors": r["errors"]}

    def read_preview_bytes(self, path):
        if not self.is_in_preview_dir(path):
            return None
        with open(path, "rb") as f:
            return pdf_engine.transcode_ccitt_for_preview(f.read())

    def read_source_bytes(self, path):
        if not self.is_allowed_source(path):
            return None
        ext = _ext(path)
        if ext not in INLINE_PREVIEW_EXTS:
            return None
        with open(path, "rb") as f:
            data = f.read()
        if ext == ".pdf":
            data = pdf_engine.transcode_ccitt_for_preview(data)
        return ext, data


def _error_text(e):
    """部品が英語で返すエラーを、画面に出せる日本語にする（元の文は詳細として残す）。"""
    msg = str(e) or type(e).__name__
    if re.search(r"[぀-ヿ一-鿿]", msg):
        return msg
    return f"このファイルを処理できませんでした（詳細: {msg}）"


def _with_sizes(written):
    """出力したファイルの大きさ（バイト）を添える（画面で合計と、アップロードの上限の案内に使う）。"""
    for w in written:
        try:
            w["size"] = os.path.getsize(w["path"])
        except (OSError, KeyError, TypeError):
            w["size"] = None
    return written


def _expand_paths(paths):
    """ドロップされたファイル・フォルダを、ファイルの並びへ（フォルダは中を再帰的に）。"""
    out = []
    for p in paths or []:
        if not isinstance(p, str):
            continue
        if os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs.sort()
                for f in sorted(files):
                    out.append(os.path.join(root, f))
        else:
            out.append(p)
    return out


def cleanup_stale_temp_dirs():
    """SEC-C4: クラッシュ等で残った一時フォルダを起動時に消す（使用中の可能性を考え1時間以上前のものだけ）。"""
    root = _temp_root()
    cutoff = time.time() - 3600
    try:
        names = os.listdir(root)
    except OSError:
        return
    for n in names:
        if not re.match(r"^(legalleaves|rakuraku)-(conv|preview|explprev|lo-profile)", n):
            continue
        p = os.path.join(root, n)
        try:
            if os.path.getmtime(p) < cutoff:
                shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else os.remove(p)
        except OSError:
            pass


def prompt_text(rename_only):
    """AI 用プロンプト（同梱）＋事務所の書き方メモ。"""
    name = "ai-prompt-rename-only.txt" if rename_only else "ai-prompt.txt"
    with open(resource_path("assets", name), encoding="utf-8") as f:
        text = f.read()
    notes = storage.read_firm_notes().strip()
    if notes:
        text += ("\n\n---\n【この事務所の立証趣旨・書式の工夫（利用者設定）】\n"
                 "以下は本ソフトの利用事務所が設定した独自の方針です。上記ルールと矛盾しない範囲で反映してください。\n"
                 f"{notes}\n")
    return text
