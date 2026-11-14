# -*- coding: utf-8 -*-
"""
「点検する」の入口（--check）を、実際に起動して確かめる。

    py\\.venv\\Scripts\\python py\\tests\\check_entry.py        （npm test にも入っている）

作業用のフォルダに小さな PDF と整理データを作り、`python -m legalleaves --check …` を別のプロセスで動かして、
結果の JSON と終了コードを見る。窓が出ないこと（＝すぐ終わること）も、制限時間で確かめる。
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PY_DIR = os.path.join(ROOT, "py")
sys.path.insert(0, PY_DIR)

from pypdf import PdfWriter  # noqa: E402

# LL_EXE に配布用の LegalLeaves.exe の場所を入れると、開発用の起動の代わりにその exe で確かめる
APP = [os.environ["LL_EXE"]] if os.environ.get("LL_EXE") else [sys.executable, "-m", "legalleaves"]

passed = failed = 0
failures = []


def check(label, ok, extra=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  OK   {label}")
    else:
        failed += 1
        failures.append(label)
        print(f"  FAIL {label}" + (f" -> {extra}" if extra else ""))


def make_pdf(path, pages=1):
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    with open(path, "wb") as f:
        w.write(f)


def run_check(*args):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    r = subprocess.run([*APP, *args], cwd=PY_DIR, env=env,
                       capture_output=True, timeout=60)  # 窓が出て止まると、ここで時間切れになる
    return r.returncode, r.stderr.decode("utf-8", "replace")


def tree(folder):
    return sorted(os.path.relpath(os.path.join(d, f), folder) for d, _dirs, fs in os.walk(folder) for f in fs)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="ll-check-") as work:
        folder = os.path.join(work, "案件")
        os.makedirs(folder)
        make_pdf(os.path.join(folder, "甲1_契約書.pdf"), 2)
        make_pdf(os.path.join(folder, "甲2の1_請求書.pdf"))
        make_pdf(os.path.join(folder, "甲2の2_領収書.pdf"))
        make_pdf(os.path.join(folder, "メモ.pdf"))
        with open(os.path.join(folder, "図.gif"), "wb") as f:
            f.write(b"GIF89a")
        plan = {
            "schema_version": "2.0",
            "case": {"party": "原告", "court": "東京地方裁判所"},
            "files": [
                {"original_file_name": "甲1_契約書.pdf", "type": "証拠", "title": "契約書", "evidence_number": "甲001"},
                {"original_file_name": "甲2の1_請求書.pdf", "type": "証拠", "title": "請求書",
                 "evidence_number": "甲002", "branch_range": "1"},
                {"original_file_name": "甲2の2_領収書.pdf", "type": "証拠", "title": "領収書",
                 "evidence_number": "甲002", "branch_range": "2", "needs_user_confirmation": True,
                 "confirmation_question": "日付が読めません。"},
                {"original_file_name": "甲3_写真.pdf", "type": "証拠", "title": "写真", "evidence_number": "甲003"},
            ],
            "warnings": ["注意があります"],
        }
        plan_path = os.path.join(work, "整理データ.json")
        with open(plan_path, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False)
        before = tree(folder)

        print("\n=== 点検する（通常） ===")
        report_path = os.path.join(folder, "点検結果.json")
        code, err = run_check("--check", plan_path, "--files", folder, "--report", report_path)
        check("終了コードが 0", code == 0, err)
        check("結果の JSON ができる", os.path.isfile(report_path))
        check("フォルダに増えたのは結果の JSON だけ（提出用のファイルを書き出さない）",
              tree(folder) == sorted(before + ["点検結果.json"]), str(tree(folder)))
        rep = json.load(open(report_path, encoding="utf-8")) if os.path.isfile(report_path) else {}
        check("形式チェックを通る", rep.get("ok") is True and rep.get("formatError") == "")
        check("人の確認前であることを書く", "確認" in rep.get("note", ""))
        s = rep.get("summary", {})
        check("件数（4件・対応あり3・対応なし1・フォルダに無い1・要確認2）",
              (s.get("files"), s.get("matched"), s.get("unmatched"), s.get("missingFiles"), s.get("needsConfirmation"))
              == (4, 3, 1, 1, 2), str(s))
        check("フォルダに無いファイルを知らせる", rep.get("missingFiles") == ["甲3_写真.pdf"])
        check("受け付けなかったファイルを理由つきで知らせる",
              [r["name"] for r in rep.get("rejectedFiles", [])] == ["図.gif"] and "jpeg" in rep["rejectedFiles"][0]["reason"])
        names = {o["name"]: o["from"] for o in rep.get("outputs", [])}
        check("同じ号証は 1 つにまとめる計画になる",
              names.get("甲002_1～2_請求書.pdf") == ["甲2の1_請求書.pdf", "甲2の2_領収書.pdf"], str(names))
        check("1 ファイルの号証は提出用ファイル名のとおり", names.get("甲001_契約書.pdf") == ["甲1_契約書.pdf"], str(names))
        memo = next((f for f in rep.get("files", []) if f["name"] == "メモ.pdf"), {})
        check("対応の無いファイルは要確認", memo.get("matched") is False and memo.get("needsConfirmation") is True)
        check("AI の注意を載せる", "注意があります" in rep.get("warnings", []))
        check("ファイルの場所（フルパス）を結果に書かない", work not in json.dumps(rep, ensure_ascii=False))

        print("\n=== 前に書き出した「提出用ファイル」のフォルダは読まない ===")
        out_dir = os.path.join(folder, "提出用ファイル")
        os.makedirs(os.path.join(out_dir, "中"))
        make_pdf(os.path.join(out_dir, "甲001_契約書.pdf"))
        make_pdf(os.path.join(out_dir, "中", "甲002_1～2_請求書.pdf"))
        code, err = run_check("--check", plan_path, "--files", folder, "--report", report_path)
        rep = json.load(open(report_path, encoding="utf-8"))
        check("読むファイルの数は変わらない（4件）", code == 0 and rep.get("summary", {}).get("files") == 4, rep.get("summary"))
        check("読まなかったフォルダと、中のファイルの数を知らせる（黙って減らさない）",
              rep.get("skippedFolders") == [{"folder": "提出用ファイル", "files": 2}], rep.get("skippedFolders"))
        code, err = run_check("--check", plan_path, "--files", folder, "--report", report_path, "--include-outputs")
        rep = json.load(open(report_path, encoding="utf-8"))
        check("--include-outputs を付けると読む（6件・読まなかったフォルダなし）",
              code == 0 and rep.get("summary", {}).get("files") == 6 and rep.get("skippedFolders") == [],
              f"{rep.get('summary')} {rep.get('skippedFolders')}")
        import shutil
        shutil.rmtree(out_dir)

        print("\n=== 結果の名前を、フォルダからの相対で渡す ===")
        code, err = run_check("--check", plan_path, "--files", folder, "--report", "結果2.json")
        check("フォルダの中にできる", code == 0 and os.path.isfile(os.path.join(folder, "結果2.json")), err)

        print("\n=== 整理データが壊れている ===")
        bad = os.path.join(work, "壊れた.json")
        with open(bad, "w", encoding="utf-8") as f:
            f.write('{"files": [')
        code, err = run_check("--check", bad, "--files", folder, "--report", report_path)
        rep = json.load(open(report_path, encoding="utf-8"))
        check("点検はしたことにして（0）、形式の誤りを結果に書く",
              code == 0 and rep.get("ok") is False and "JSON" in rep.get("formatError", ""), f"{code} {rep.get('formatError')}")
        check("形式が誤りのときは、照合の結果を出さない", "outputs" not in rep and "files" not in rep)

        print("\n=== 点検できない（終了コード 1・何も書かない） ===")
        outside = os.path.join(work, "外.json")
        code, err = run_check("--check", plan_path, "--files", folder, "--report", outside)
        check("結果をフォルダの外に書かせない", code == 1 and not os.path.exists(outside), err)
        code, err = run_check("--check", plan_path, "--files", folder, "--report", os.path.join(folder, "..", "外2.json"))
        check("「..」で外へ出る指定も通さない", code == 1 and not os.path.exists(os.path.join(work, "外2.json")), err)
        code, err = run_check("--check", plan_path, "--files", folder, "--report", os.path.join(folder, "結果.txt"))
        check("結果の名前は .json だけ", code == 1 and not os.path.exists(os.path.join(folder, "結果.txt")), err)
        code, err = run_check("--check", plan_path, "--files", os.path.join(work, "無い"), "--report", "x.json")
        check("フォルダが無い", code == 1 and "フォルダ" in err, err)
        code, err = run_check("--check", os.path.join(work, "無い.json"), "--files", folder, "--report", "x.json")
        check("整理データが無い", code == 1 and not os.path.exists(os.path.join(folder, "x.json")), err)
        code, err = run_check("--check", plan_path, "--files", folder)
        check("引数が足りない", code == 1 and "--report" in err, err)
        inside_plan = os.path.join(folder, "中の整理データ.json")
        with open(inside_plan, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False)
        code, err = run_check("--check", inside_plan, "--files", folder, "--report", inside_plan)
        check("整理データを結果で上書きさせない",
              code == 1 and json.load(open(inside_plan, encoding="utf-8")) == plan, err)

    print(f"\n===== {passed} PASS / {failed} FAIL =====")
    if failed:
        print("失敗: " + " / ".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
