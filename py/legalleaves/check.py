# -*- coding: utf-8 -*-
"""
点検する: AI の整理データとフォルダのファイルを突き合わせ、結果を JSON に書く（窓は出さない）。

    LegalLeaves.exe --check <整理データ.json> --files <フォルダ> --report <結果.json> [--include-outputs]

人が画面に貼り付けて「次へ」を押したときと同じ判定（形式チェック → 照合 → 出力前チェック → 出力の計画）を通し、
その結果を知らせる。AI のエージェントが、人に渡す前に自分の整理データを確かめるための入口。

決まり:
  - **提出用のファイルは書き出さない。** 書くのは結果の JSON 1 つだけ。書き出しは、人が確認画面で確かめてから行う
  - 整理データの形は docs/ai-contract.md のまま（人が貼るものと同じ。エージェント専用の項目は無い）
  - 結果にはファイル名が入るので、書く先は渡されたフォルダの中に限る（外へ出さない）
  - 外部へは何も送らない。整理データもアプリの保存場所に残さない
  - 結果は「人が確かめる前の下書き」の状態。確定ではない

終了コード: 0 = 点検した（問題の有無は結果の JSON を見る）／ 1 = 点検できなかった（引数・フォルダ・書く先の誤り）
"""
import json
import os
import sys

from . import APP_NAME, __version__, fileio, service
from .core import checks, contract, explanation, matching, plan
from .core.session import Session

REPORT_VERSION = 1
MAX_PLAN_BYTES = 10 * 1024 * 1024
NOTE = ("人が確認する前の下書きの状態です。確定は LegalLeaves の確認画面で人が行います。"
        "この点検は提出用のファイルを書き出しません。"
        "点検が見るのは、形式・ファイルとの照合・番号と名前の食い違いです。"
        "標目・作成者・立証趣旨などの中身が正しいかは見ていません（確認画面で人が確かめます）。")
USAGE = ("使い方: --check <整理データ.json> --files <フォルダ> --report <結果.json>（結果はフォルダの中に書きます）。"
         "前に書き出した「提出用ファイル」のフォルダも読むときは --include-outputs を付けます")


class CheckError(Exception):
    """点検を始められない誤り（利用者向けの文）"""


def parse_args(argv):
    opts = {}
    i = 0
    while i < len(argv):
        key = argv[i]
        if key in ("--check", "--files", "--report") and i + 1 < len(argv):
            opts[key[2:]] = argv[i + 1]
            i += 2
        elif key == "--include-outputs":
            opts["include_outputs"] = True
            i += 1
        else:
            raise CheckError(f"引数を読めません: {key}。{USAGE}")
    missing = [k for k in ("check", "files", "report") if not opts.get(k)]
    if missing:
        raise CheckError(f"引数が足りません（{'・'.join('--' + k for k in missing)}）。{USAGE}")
    return opts


def _inside(path, folder):
    """path が folder の中か（.. やリンクで外へ出る指定を通さない）"""
    real_dir = os.path.normcase(os.path.realpath(folder))
    real = os.path.normcase(os.path.realpath(path))
    return real.startswith(real_dir.rstrip("\\/") + os.sep)


def resolve_report_path(report, folder):
    path = os.path.abspath(report if os.path.isabs(report) else os.path.join(folder, report))
    if not path.lower().endswith(".json"):
        raise CheckError("結果のファイル名は .json にしてください。")
    if not _inside(path, folder):
        raise CheckError("結果は、点検するフォルダの中に書いてください（ファイル名が入るため、外へは書きません）。")
    if not os.path.isdir(os.path.dirname(path)):
        raise CheckError("結果を書くフォルダがありません。")
    if os.path.isdir(path):
        raise CheckError("結果の名前と同じフォルダがあります。")
    return path


def read_plan_text(path):
    try:
        if os.path.getsize(path) > MAX_PLAN_BYTES:
            raise CheckError("整理データが大きすぎます（10MBまで）。")
        with open(path, "rb") as f:
            return f.read().decode("utf-8-sig")
    except OSError:
        raise CheckError("整理データのファイルを読めません。")
    except UnicodeDecodeError:
        raise CheckError("整理データの文字コードを読めません（UTF-8 で保存してください）。")


def list_paths(folder, include_outputs=False):
    """フォルダの中のファイル（中のフォルダもたどる。並びは画面にフォルダを落としたときと同じ）。
    前に書き出した「提出用ファイル」のフォルダは読まない: 元のファイルと書き出し済みのファイルの両方を読むと、
    同じ証拠が 2 つあるように見えるため。読まなかったフォルダは、結果で知らせる（黙って減らさない）。
    include_outputs を付けたときだけ、画面と同じく全部読む"""
    paths, skipped = [], []
    for root, dirs, files in os.walk(folder):
        dirs.sort()
        if not include_outputs:
            for d in [d for d in dirs if d == service.SUBFOLDER_NAME]:
                dirs.remove(d)
                inside = os.path.join(root, d)
                skipped.append({"folder": os.path.relpath(inside, folder).replace(os.sep, "/"),
                                "files": sum(len(fs) for _r, _d, fs in os.walk(inside))})
        paths.extend(os.path.join(root, f) for f in sorted(files))
    return paths, skipped


def load_files(folder, include_outputs=False):
    """フォルダのファイルを、画面と同じ決まりで受け付け、同じ情報を読む"""
    svc = service.Session()
    paths, skipped = list_paths(folder, include_outputs)
    reg = svc.register_paths(paths)
    by_path = {r["path"]: r for r in svc.read_pdf_metadata([a["path"] for a in reg["accepted"]])}
    files = []
    for a in reg["accepted"]:
        r = by_path.get(a["path"]) or {}
        files.append({  # 画面の mergeMetaResult と同じ項目
            "path": a["path"], "name": a["name"],
            "metaFields": r.get("fields") or [], "metaError": r.get("error") or None,
            "officeMeta": r.get("officeMeta") or None, "activeContent": r.get("activeContent") or None,
            "overA3": r.get("overA3") or None, "pageCount": r.get("pageCount") or None,
            "captureMeta": r.get("captureMeta") or None,
        })
    return files, reg["rejected"], skipped


def _file_digest(st, rf, mismatch):
    return {
        "name": rf["name"],
        "matched": rf["matched"],                       # AI の整理データに対応する項目があったか
        "kind": rf["kind"],
        "evidenceNumber": rf["evidenceNumber"],
        "branchRange": rf["branchRange"],
        "title": rf["docName"],
        "submitName": rf["suggested"],                  # 提出用ファイル名（結合する号証は outputs の名前になる）
        "needsConfirmation": rf["needsConfirmation"],   # 確認画面で人が確かめるまで先へ進めない
        "confirmText": rf["confirmText"],
        "numberMismatch": mismatch["kind"] if mismatch else None,
    }


def build_report(plan_text, files, rejected, skipped=()):
    report = {
        "tool": APP_NAME, "version": __version__, "kind": "check", "reportVersion": REPORT_VERSION,
        "note": NOTE,
        "ok": False,
        "formatError": "",
        "rejectedFiles": rejected,  # フォルダにあるが、提出できない形式などで受け付けなかったもの
        # 読まなかったフォルダ（前に書き出した「提出用ファイル」。中のファイルの数つき）
        "skippedFolders": list(skipped),
    }
    st = Session(files=files, ai_text=plan_text)
    error = contract.validate_ai_json(plan_text)
    if not error and not plan_text.strip():
        error = "整理データが空です。"
    if error:
        report["formatError"] = error
        return report
    matching.build_review_files(st)
    rfs = st.review_files
    issues = checks.compute_output_issues(st)
    outputs = plan.build_output_plan(st)
    name_of = {rf["path"]: rf["name"] for rf in rfs}
    report.update({
        "ok": True,
        "summary": {
            "files": len(rfs),
            "matched": sum(1 for rf in rfs if rf["matched"]),
            "unmatched": sum(1 for rf in rfs if not rf["matched"]),
            "missingFiles": len(st.orphan_entries),
            "needsConfirmation": sum(1 for rf in rfs if rf["needsConfirmation"]),
            "outputIssues": len(issues),
            "outputs": len(outputs),
        },
        "files": [_file_digest(st, rf, checks.filename_number_mismatch(st, rf)) for rf in rfs],
        # AI の整理データにあるのに、フォルダに無いファイル（読み込み忘れ・名前の違い）
        "missingFiles": [e.get("original_file_name") for e in st.orphan_entries],
        "consistency": st.consistency,        # 証拠説明書に書かれた番号の範囲との突き合わせ（無ければ null）
        "warnings": st.ai_warnings,
        "outputIssues": [{"file": rfs[i["index"]]["name"] if i["index"] < len(rfs) else None,
                          "text": i["text"]} for i in issues],
        # このまま進めたときにできるファイル（人が確認画面で直せば変わる）
        "outputs": [{"name": o.get("destName"), "evidenceNumber": o.get("evidenceNumber"),
                     "from": [name_of.get(s.get("srcPath")) for s in o["sources"]]} for o in outputs],
        "explanationExists": st.explanation_exists,
        "explanationFileName": explanation.explanation_file_name(st),
    })
    return report


def check_folder(plan_text, folder, include_outputs=False):
    """整理データ（文字列）とフォルダを突き合わせた結果。何も書かない（--check と MCP の窓口の両方が使う）"""
    if not os.path.isdir(folder):
        raise CheckError("点検するフォルダがありません。")
    files, rejected, skipped = load_files(folder, include_outputs)
    return build_report(plan_text, files, rejected, skipped)


def run(argv):
    opts = parse_args(argv)
    folder = os.path.abspath(opts["files"])
    if not os.path.isdir(folder):
        raise CheckError("点検するフォルダがありません。")
    report_path = resolve_report_path(opts["report"], folder)
    if os.path.exists(opts["check"]) and os.path.exists(report_path) and os.path.samefile(opts["check"], report_path):
        raise CheckError("結果の名前が整理データと同じです（整理データを上書きしてしまいます）。")
    plan_text = read_plan_text(opts["check"])
    report = check_folder(plan_text, folder, bool(opts.get("include_outputs")))
    fileio.write_atomic(report_path, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report_path


def main(argv):
    """起動の引数に --check があるときに呼ばれる。窓は出さない"""
    try:
        path = run(argv)
    except CheckError as e:
        _say(f"点検できませんでした: {e}")
        return 1
    except Exception as e:  # 想定外の誤りでも、窓を出さずに終わる
        _say(f"点検できませんでした: {type(e).__name__}: {e}")
        return 1
    _say(f"点検の結果を書きました: {path}")
    return 0


def _say(text):
    # 配布用の exe は黒い画面を持たないので、出力先が無いことがある（そのときは終了コードだけで知らせる）
    out = sys.stderr or sys.stdout
    if out:
        try:
            # 呼ぶ側のプログラムが読めるよう UTF-8 で出す（exe では既定が Shift_JIS になり、文字化けする）
            out.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
        try:
            print(text, file=out)
        except (OSError, ValueError):
            pass
