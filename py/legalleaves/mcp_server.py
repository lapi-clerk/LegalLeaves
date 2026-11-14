# -*- coding: utf-8 -*-
"""
MCP の窓口: AI のアプリから「点検する」を道具として呼べるようにする（窓は出さない）。

    LegalLeaves.exe --mcp --root <案件のフォルダ> [--root <もう 1 つ> …]

MCP（Model Context Protocol）は、AI のアプリに道具を足すための共通の決まり。特定の AI に限らない。
AI のアプリがこのプログラムを起動し、標準入出力で JSON（JSON-RPC 2.0・1 行に 1 通）をやり取りする。

出す道具は 3 つだけ:
  legalleaves_format  整理データの形（AI への指示文）を読む
  legalleaves_check   整理データとフォルダのファイルを突き合わせて点検する
  legalleaves_open    整理データとフォルダを、LegalLeaves の確認画面に開く（窓を起こす。open_entry.py の --open と同じ入口）

決まり:
  - **書き出す道具は出さない。** 提出用のファイルを作るのは、人が確認画面で確かめてから（確定は人）
  - 点検できるのは、起動時に --root で渡したフォルダの中だけ（AI が PC のどこでも見られる、を防ぐ）
  - このプログラムは外部へ何も送らない。何もファイルに書かない。ネットワークの口も開かない
  - 確認画面に開くときも、書き出さない。整理データは標準入力で窓へ渡し、ファイルに書かない。
    形式の誤りがある整理データは開かない。開いた先の確認と書き出しは、人が画面で行う
    （点検の結果は、呼び出した AI のアプリへ返る。その先の扱いは、その AI のアプリの設定による）
  - 外部の部品は使わない（標準ライブラリだけ。MCP のうち道具の呼び出しに必要な部分だけを自前で話す）
"""
import json
import os
import subprocess
import sys
import time

from . import APP_NAME, __version__, check, service

SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
MAX_LINE_BYTES = 16 * 1024 * 1024
INSTRUCTIONS = (
    "LegalLeaves は、裁判所に出す書類（証拠・主張書面）の名前・番号・証拠説明書を整えるアプリです。"
    "あなた（AI）の役目は「整理データ」（どのファイルが何の証拠か、番号、標目などの下書き）を作ることです。"
    "legalleaves_format で形を読み、整理データを作ったら legalleaves_check で点検し、指摘を直してください。"
    "点検が済んだら、legalleaves_open で、その整理データを LegalLeaves の確認画面に開いて人に渡せます"
    "（利用者が頼んだときだけ使ってください。窓が開きます）。"
    "提出用のファイルを書き出す道具はありません。書き出しは、人が LegalLeaves の確認画面で確かめてから行います。"
    "点検が見るのは形式・照合・番号と名前の食い違いで、標目や立証趣旨などの中身は見ていません。"
    "点検の結果は確定ではなく、人が確かめる前の下書きの状態です。迷うところは needs_user_confirmation を付けて人に渡してください"
    "（要確認は誤りではなく、人に確かめてもらう印です。点検で数えられても、直す必要はありません）。"
)
TOOLS = [
    {
        "name": "legalleaves_format",
        "description": ("LegalLeaves が読み込む「整理データ」（JSON）の形と書き方の決まり（AI への指示文）を返します。"
                        "整理データを作る前に読んでください。事務所の書き方メモが設定されていれば、それも含みます。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "rename_only": {"type": "boolean",
                                "description": "番号を押さず名前だけ整える使い方（リネームのみ）の指示文を返す。既定は false"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "legalleaves_check",
        "description": ("整理データとフォルダのファイルを突き合わせて点検します。人が LegalLeaves に貼り付けたときと同じ判定"
                        "（形式チェック・照合・出力前チェック・出力の計画）を通し、結果を返します。"
                        "何も書き出しません（提出用のファイルは、人が確認画面で確かめてから作ります）。"
                        "点検が見るのは、形式・ファイルとの照合・番号と名前の食い違いだけです。"
                        "標目・作成者・立証趣旨などの中身が正しいかは見ていません。"
                        "結果の読み方: あなたが直すのは、formatError（形式の誤り）・missingFiles（フォルダに無いファイル）・"
                        "unmatched（対応する項目の無いファイル）・numberMismatch（番号と名前の食い違い）・"
                        "outputIssues（出力前チェックの指摘）です。"
                        "needsConfirmation（要確認）は、人が確認画面で確かめる件数です。"
                        "あなたが needs_user_confirmation を付けたものは誤りではなく、人に確かめてもらう印なので、消す必要はありません"
                        "（上の誤りを直せば、それが原因の要確認は減ります）。"
                        "結果は人が確かめる前の下書きの状態です。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "folder": {"type": "string",
                           "description": "提出するファイルを入れたフォルダの場所（フルパス）。起動時に許可されたフォルダの中に限ります"},
                # 文字列で渡されても読む（道具の定義は、どの AI のアプリでも通るよう単純な形にしておく）
                "plan": {"type": "object", "description": "整理データ（legalleaves_format の形の JSON のオブジェクト）"},
            },
            "required": ["folder", "plan"],
            "additionalProperties": False,
        },
    },
    {
        "name": "legalleaves_open",
        "description": ("整理データとフォルダのファイルを、LegalLeaves の確認画面に開きます（利用者のパソコンに窓が開きます）。"
                        "人が「ファイルを入れる → 整理データを貼り付ける → 照合して進む」をしたのと同じ状態になります。"
                        "先に legalleaves_check で点検し、指摘を直してから使ってください。形式の誤りがある整理データは開きません。"
                        "何も書き出しません。確認と書き出しは、開いた画面で人が行います。"
                        "利用者が「開いて」と頼んだときだけ使い、同じ内容を何度も開かないでください。"),
        "inputSchema": {
            "type": "object",
            "properties": {
                "folder": {"type": "string",
                           "description": "提出するファイルを入れたフォルダの場所（フルパス）。起動時に許可されたフォルダの中に限ります"},
                "plan": {"type": "object", "description": "整理データ（legalleaves_check に通したものと同じ JSON のオブジェクト）"},
            },
            "required": ["folder", "plan"],
            "additionalProperties": False,
        },
    },
]


class ToolError(Exception):
    """道具を実行できない誤り（AI に返す文）"""


def parse_roots(argv):
    roots = []
    i = 0
    while i < len(argv):
        if argv[i] == "--root" and i + 1 < len(argv):
            real = service.canonical(argv[i + 1])
            if real and os.path.isdir(real):
                roots.append(real)
            i += 2
        else:
            i += 1
    return roots


def _allowed(folder, roots):
    real = service.canonical(folder)
    if not real or not os.path.isdir(real):
        raise ToolError("フォルダがありません。")
    for root in roots:
        if real == root or real.startswith(root.rstrip("\\/") + os.sep):
            return real
    raise ToolError(
        "このフォルダは点検できません。点検できるのは、LegalLeaves の MCP を設定したときに許可したフォルダ（--root）の中だけです。"
        "利用者に、設定にこのフォルダを足してもらってください。" if roots else
        "点検できるフォルダが設定されていません。利用者に、MCP の設定に --root <案件のフォルダ> を足してもらってください。")


def call_tool(name, args, roots):
    if not isinstance(args, dict):
        args = {}
    if name == "legalleaves_format":
        return service.prompt_text(args.get("rename_only") is True)
    if name == "legalleaves_check":
        folder, plan = args.get("folder"), args.get("plan")
        if not isinstance(folder, str) or not folder.strip():
            raise ToolError("folder（フォルダの場所）を渡してください。")
        if isinstance(plan, (dict, list)):
            plan = json.dumps(plan, ensure_ascii=False)
        if not isinstance(plan, str):
            raise ToolError("plan（整理データ）を、JSON のオブジェクトか文字列で渡してください。")
        try:
            report = check.check_folder(plan, _allowed(folder, roots))
        except check.CheckError as e:
            raise ToolError(str(e))
        return json.dumps(report, ensure_ascii=False, indent=2)
    if name == "legalleaves_open":
        folder, plan = args.get("folder"), args.get("plan")
        if not isinstance(folder, str) or not folder.strip():
            raise ToolError("folder（フォルダの場所）を渡してください。")
        if isinstance(plan, (dict, list)):
            plan = json.dumps(plan, ensure_ascii=False)
        if not isinstance(plan, str):
            raise ToolError("plan（整理データ）を、JSON のオブジェクトか文字列で渡してください。")
        real = _allowed(folder, roots)
        try:
            report = check.check_folder(plan, real)
        except check.CheckError as e:
            raise ToolError(str(e))
        if report.get("formatError"):
            raise ToolError("整理データの形式に誤りがあるので、開きませんでした。直してから、もう一度お試しください: "
                            + str(report["formatError"]))
        if not report["summary"]["files"]:
            raise ToolError("フォルダに、読み込めるファイルがありません。")
        # 画面の知らせにフォルダの名前を出すので、大文字小文字をならす前の場所を渡す（許可の判定は real で済んでいる）
        _launch_window(plan, os.path.realpath(os.path.abspath(folder)))
        s = report["summary"]
        return json.dumps({
            "opened": True,
            "note": ("LegalLeaves の確認画面を開きました。ここから先（内容の確認・書き出し）は、利用者が画面で行います。"
                     "利用者に、開いた窓を確かめるよう伝えてください。提出用のファイルは、まだ作られていません。"),
            "summary": {"files": s["files"], "unmatched": s["unmatched"], "missingFiles": s["missingFiles"],
                        "needsConfirmation": s["needsConfirmation"], "outputIssues": s["outputIssues"]},
        }, ensure_ascii=False, indent=2)
    raise ToolError(f"その道具はありません: {name}")


def _launch_window(plan_text, folder):
    """LegalLeaves の窓を、確認画面から開く入口（--open）で起こす。整理データは標準入力で渡す（ファイルに書かない）。
    この窓口（MCP）が終わっても、窓は残る"""
    if getattr(sys, "frozen", False):
        cmd = [sys.executable]
    else:
        cmd = [sys.executable, "-m", "legalleaves"]
    cmd += ["--open", "-", "--files", folder]
    env = dict(os.environ)
    for k in [k for k in env if k.startswith("LL_SELFTEST")]:
        del env[k]
    flags = 0
    if os.name == "nt":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    hook = os.environ.get("LL_MCP_OPEN_HOOK")  # テスト用: 窓を出さず、起こすはずだった内容をこのファイルに書く
    if hook:
        with open(hook, "w", encoding="utf-8") as f:
            json.dump({"cmd": cmd[-4:], "planBytes": len(plan_text.encode("utf-8"))}, f, ensure_ascii=False)
        return
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                env=env, creationflags=flags, close_fds=True)
        proc.stdin.write(plan_text.encode("utf-8"))
        proc.stdin.close()
    except OSError as e:
        raise ToolError(f"LegalLeaves を起動できませんでした: {e}")
    time.sleep(1.0)
    if proc.poll() not in (None, 0):
        raise ToolError("LegalLeaves を開けませんでした（起動してすぐに終わりました）。")


def handle(msg, roots):
    """1 通を処理して返事を返す（知らせ＝id の無いものには返事をしない）"""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        if isinstance(msg, dict) and "method" not in msg:
            return None  # こちらからは何も頼まないので、返事（result・error）が来ても使わない
        return _error(msg.get("id") if isinstance(msg, dict) else None, -32600, "Invalid Request")
    method, mid = msg["method"], msg.get("id")
    if "id" not in msg:
        return None
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    if method == "initialize":
        wanted = params.get("protocolVersion")
        return _result(mid, {
            "protocolVersion": wanted if wanted in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": APP_NAME, "version": __version__},
            "instructions": INSTRUCTIONS,
        })
    if method == "ping":
        return _result(mid, {})
    if method == "tools/list":
        return _result(mid, {"tools": TOOLS})
    if method == "tools/call":
        try:
            text = call_tool(params.get("name"), params.get("arguments"), roots)
            return _result(mid, {"content": [{"type": "text", "text": text}], "isError": False})
        except ToolError as e:
            return _result(mid, {"content": [{"type": "text", "text": str(e)}], "isError": True})
        except Exception as e:  # 想定外の誤りでも止まらず、AI に知らせる
            return _result(mid, {"content": [{"type": "text", "text": f"点検できませんでした: {type(e).__name__}: {e}"}],
                                 "isError": True})
    return _error(mid, -32601, f"Method not found: {method}")


def _result(mid, result):
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _error(mid, code, message):
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def main(argv):
    """起動の引数に --mcp があるときに呼ばれる。標準入力が閉じるまで動く"""
    stdin = getattr(sys.stdin, "buffer", None)
    stdout = getattr(sys.stdout, "buffer", None)
    if stdin is None or stdout is None:
        return 1  # 標準入出力が無い（AI のアプリから起動されていない）
    roots = parse_roots(argv)
    while True:
        line = stdin.readline(MAX_LINE_BYTES + 1)
        if not line:
            return 0
        if len(line) > MAX_LINE_BYTES:
            return 1  # 桁違いに大きな 1 通は読まずに終わる
        if not line.strip():
            continue
        try:
            msg = json.loads(line.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            reply = _error(None, -32700, "Parse error")
        else:
            reply = handle(msg, roots)
        if reply is not None:
            # 1 行に 1 通（改行は JSON の中では \n と書かれるので、行の途中には入らない）
            stdout.write(json.dumps(reply, ensure_ascii=False).encode("utf-8") + b"\n")
            stdout.flush()
