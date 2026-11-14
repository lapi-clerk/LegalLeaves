# -*- coding: utf-8 -*-
"""
MCP の窓口（--mcp）を、実際に起動して確かめる。

    py\\.venv\\Scripts\\python py\\tests\\mcp_entry.py        （npm test にも入っている）

AI のアプリの代わりに、`python -m legalleaves --mcp --root …` を別のプロセスで起動し、標準入出力で
JSON（1 行に 1 通）をやり取りする。事務所の書き方メモを読むので、保存先は作業用のフォルダに向ける（LL_APPDATA_ROOT）。
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
        print(f"  FAIL {label}" + (f" -> {str(extra)[:600]}" if extra != "" else ""))


def make_pdf(path):
    w = PdfWriter()
    w.add_blank_page(width=595, height=842)
    with open(path, "wb") as f:
        w.write(f)


def tree(folder):
    return sorted(os.path.relpath(os.path.join(d, f), folder) for d, _dirs, fs in os.walk(folder) for f in fs)


class Client:
    def __init__(self, args, appdata, hook=None):
        env = dict(os.environ, LL_APPDATA_ROOT=appdata)
        if hook:  # 「確認画面で開く」で、窓を出さずに、起こすはずだった内容をこのファイルに書かせる
            env["LL_MCP_OPEN_HOOK"] = hook
        self.p = subprocess.Popen([*APP, "--mcp", *args], cwd=PY_DIR, env=env,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.next_id = 0

    def send_raw(self, data):
        self.p.stdin.write(data)
        self.p.stdin.flush()

    def read(self):
        return json.loads(self.p.stdout.readline().decode("utf-8"))

    def request(self, method, params=None):
        self.next_id += 1
        msg = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            msg["params"] = params
        self.send_raw(json.dumps(msg, ensure_ascii=False).encode("utf-8") + b"\n")
        reply = self.read()
        assert reply.get("id") == self.next_id, reply
        return reply

    def notify(self, method):
        self.send_raw(json.dumps({"jsonrpc": "2.0", "method": method}).encode("utf-8") + b"\n")

    def tool(self, name, arguments):
        r = self.request("tools/call", {"name": name, "arguments": arguments})["result"]
        return r["isError"], r["content"][0]["text"]

    def close(self):
        self.p.stdin.close()
        code = self.p.wait(timeout=30)
        rest = self.p.stdout.read()
        err = self.p.stderr.read().decode("utf-8", "replace")
        return code, rest, err


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="ll-mcp-") as work:
        appdata = os.path.join(work, "保存先")
        folder = os.path.join(work, "案件")
        sub = os.path.join(folder, "追加分")
        other = os.path.join(work, "別の案件")
        for d in (appdata, sub, other):
            os.makedirs(d)
        make_pdf(os.path.join(folder, "甲1_契約書.pdf"))
        make_pdf(os.path.join(sub, "甲2_領収書.pdf"))
        make_pdf(os.path.join(other, "乙1_秘密.pdf"))
        os.makedirs(os.path.join(folder, "提出用ファイル"))  # 前に書き出したもの（点検では読まない）
        make_pdf(os.path.join(folder, "提出用ファイル", "甲001_契約書.pdf"))
        plan = {"files": [
            {"original_file_name": "甲1_契約書.pdf", "type": "証拠", "title": "契約書", "evidence_number": "甲001"},
            {"original_file_name": "甲2_領収書.pdf", "type": "証拠", "title": "領収書", "evidence_number": "甲002"},
            {"original_file_name": "甲3_写真.pdf", "type": "証拠", "title": "写真", "evidence_number": "甲003"},
        ]}
        before = tree(work)

        print("\n=== つなぐ ===")
        hook = os.path.join(tempfile.mkdtemp(prefix="ll-mcp-hook-"), "open.json")  # 点検するフォルダの外に置く
        c = Client(["--root", folder], appdata, hook)
        r = c.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                     "clientInfo": {"name": "test", "version": "0"}})
        res = r.get("result", {})
        check("最初の返事が JSON で返る（余計な文字を出さない）", "result" in r, r)
        check("相手の版に合わせる", res.get("protocolVersion") == "2025-06-18", res.get("protocolVersion"))
        check("名前と版を名乗る", res.get("serverInfo", {}).get("name") == "LegalLeaves" and res["serverInfo"].get("version"))
        check("使い方の説明に「書き出す道具は無い」と書く", "書き出す道具はありません" in res.get("instructions", ""))
        c.notify("notifications/initialized")  # 知らせには返事をしない（次の返事の番号がずれないことで確かめる）
        check("ping に答える", c.request("ping").get("result") == {})
        r = c.request("initialize", {"protocolVersion": "1999-01-01"})
        check("知らない版には、こちらの最新の版を答える", r["result"]["protocolVersion"] == "2025-06-18")

        print("\n=== 道具の一覧 ===")
        tools = c.request("tools/list")["result"]["tools"]
        names = [t["name"] for t in tools]
        check("道具は 3 つだけ（形を読む・点検する・確認画面で開く）",
              names == ["legalleaves_format", "legalleaves_check", "legalleaves_open"], names)
        text = json.dumps(tools, ensure_ascii=False)
        check("書き出す・消す道具を出していない",
              not any(w in " ".join(names) for w in ("write", "export", "create", "delete", "save")))
        open_tool = next((t for t in tools if t["name"] == "legalleaves_open"), {"description": ""})
        check("開く道具の説明に「書き出しません」「人が行います」と書く",
              "書き出しません" in open_tool["description"] and "人が行います" in open_tool["description"])
        check("どの道具にも説明と引数の形がある",
              all(t.get("description") and t.get("inputSchema", {}).get("type") == "object" for t in tools))
        check("点検の説明に「書き出しません」と書く", "書き出しません" in text)
        check_tool = next((x for x in tools if x["name"] == "legalleaves_check"), {"description": ""})
        check("点検の説明に、見ている範囲と、要確認は誤りではないことを書く",
              "中身が正しいかは見ていません" in check_tool["description"] and "誤りではなく" in check_tool["description"])

        print("\n=== 形を読む ===")
        err, text = c.tool("legalleaves_format", {})
        check("指示文が返る", not err and "original_file_name" in text and "evidence_number" in text, text[:200])
        err, text2 = c.tool("legalleaves_format", {"rename_only": True})
        check("リネームのみの指示文は別のもの", not err and text2 != text and len(text2) > 100)

        print("\n=== 点検する ===")
        err, text = c.tool("legalleaves_check", {"folder": folder, "plan": plan})
        rep = json.loads(text) if not err else {}
        check("結果が返る", not err and rep.get("ok") is True, text[:300])
        s = rep.get("summary", {})
        check("中のフォルダもたどる（2件・フォルダに無い1件）",
              (s.get("files"), s.get("matched"), s.get("missingFiles")) == (2, 2, 1), s)
        check("前に書き出した「提出用ファイル」のフォルダは読まず、読まなかったことを知らせる",
              rep.get("skippedFolders") == [{"folder": "提出用ファイル", "files": 1}], rep.get("skippedFolders"))
        check("人の確認前であることと、中身は見ていないことを書く",
              "確認" in rep.get("note", "") and "立証趣旨" in rep.get("note", ""))
        check("ファイルの場所（フルパス）を返さない", work not in text and work.replace("\\", "\\\\") not in text)
        err, text = c.tool("legalleaves_check", {"folder": sub, "plan": json.dumps(plan, ensure_ascii=False)})
        check("許可したフォルダの中のフォルダも点検できる・整理データは文字列でも読む",
              not err and json.loads(text)["summary"]["files"] == 1, text[:300])
        err, text = c.tool("legalleaves_check", {"folder": folder, "plan": '{"files": ['})
        check("形式の誤りは、結果の中で知らせる", not err and json.loads(text).get("ok") is False and "JSON" in json.loads(text)["formatError"])

        print("\n=== 点検できない ===")
        err, text = c.tool("legalleaves_check", {"folder": other, "plan": plan})
        check("許可していないフォルダは断る（ファイル名を返さない）", err and "許可" in text and "秘密" not in text, text)
        err, text = c.tool("legalleaves_check", {"folder": os.path.join(folder, "..", "別の案件"), "plan": plan})
        check("「..」で外へ出る指定も断る", err and "秘密" not in text, text)
        err, text = c.tool("legalleaves_check", {"folder": work, "plan": plan})
        check("許可したフォルダの親も断る", err and "秘密" not in text, text)
        err, text = c.tool("legalleaves_check", {"folder": os.path.join(folder, "無い"), "plan": plan})
        check("無いフォルダ", err and "フォルダ" in text, text)
        err, text = c.tool("legalleaves_check", {"folder": folder})
        check("整理データが無い", err and "plan" in text, text)
        err, text = c.tool("legalleaves_write", {"folder": folder})
        check("無い道具", err and "ありません" in text, text)

        print("\n=== 確認画面で開く（窓は出さず、起こす内容だけを確かめる） ===")
        err, text = c.tool("legalleaves_open", {"folder": folder, "plan": plan})
        rep = json.loads(text) if not err else {}
        launched = json.load(open(hook, encoding="utf-8")) if os.path.exists(hook) else None
        check("開いたと答え、ここから先は人が行うと伝える",
              not err and rep.get("opened") is True and "利用者が画面で" in rep.get("note", ""), text[:300])
        check("確認画面から開く入口（--open）で起こす。整理データは標準入力で渡す",
              bool(launched) and launched["cmd"][:3] == ["--open", "-", "--files"] and launched["planBytes"] > 10, launched)
        check("起こすフォルダは、許可したフォルダ",
              bool(launched) and os.path.normcase(os.path.realpath(launched["cmd"][3])) == os.path.normcase(os.path.realpath(folder)),
              launched)
        check("開いたときも、ファイルの場所（フルパス）を返さない", work not in text and work.replace("\\", "\\\\") not in text)
        if os.path.exists(hook):
            os.remove(hook)
        err, text = c.tool("legalleaves_open", {"folder": folder, "plan": '{"files": ['})
        check("形式の誤りがある整理データは開かない", err and "形式" in text and not os.path.exists(hook), text)
        err, text = c.tool("legalleaves_open", {"folder": other, "plan": plan})
        check("許可していないフォルダは開かない", err and "許可" in text and not os.path.exists(hook), text)
        err, text = c.tool("legalleaves_open", {"folder": folder})
        check("整理データが無ければ開かない", err and "plan" in text and not os.path.exists(hook), text)

        print("\n=== 決まりから外れた入力でも止まらない ===")
        r = c.request("resources/list")
        check("知らない頼みには「無い」と答える", r.get("error", {}).get("code") == -32601, r)
        c.send_raw(b"{ not json\n")
        check("JSON として読めない 1 通", c.read().get("error", {}).get("code") == -32700)
        c.send_raw(b"\n")
        c.send_raw(json.dumps({"jsonrpc": "2.0", "id": 99, "result": {}}).encode() + b"\n")  # 返事の形のもの（無視する）
        check("そのあとも答える", c.request("ping").get("result") == {})
        code, rest, err_text = c.close()
        check("入力が閉じたら終わる（終了コード 0・余計な出力なし）", code == 0 and rest == b"", f"{code} {rest[:200]} {err_text[:300]}")

        print("\n=== フォルダを許可せずに起動する ===")
        c = Client([], appdata)
        c.request("initialize", {"protocolVersion": "2024-11-05"})
        err, text = c.tool("legalleaves_check", {"folder": folder, "plan": plan})
        check("どのフォルダも点検できず、設定の足し方を伝える", err and "--root" in text, text)
        err, text = c.tool("legalleaves_format", {})
        check("形を読むことはできる", not err and "original_file_name" in text)
        c.close()

        check("最初から最後まで、何もファイルを書いていない", tree(work) == before, tree(work))

    print(f"\n===== {passed} PASS / {failed} FAIL =====")
    if failed:
        print("失敗: " + " / ".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
