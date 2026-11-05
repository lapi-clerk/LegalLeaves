# -*- coding: utf-8 -*-
"""
テスト用の入口: 標準入力の JSON {"fn": 名前, "params": {...}} で PDF エンジン等を呼び、結果を JSON で返す。

自動テスト（test/*.test.js・Node で動く）から使う。テストは v4（Electron 版）から引き継いだもので、
同じ判定基準のまま Python 版を確かめている（test/helpers/engine.js を参照）。
"""
import json
import sys

from . import fileio, pdf_engine


def _transcode(params):
    with open(params["inPath"], "rb") as f:
        data = f.read()
    out = pdf_engine.transcode_ccitt_for_preview(data)
    with open(params["outPath"], "wb") as f:
        f.write(out)
    return {"same": out is data}


def _inspect(params):
    reader = pdf_engine._open_reader(params["path"])
    return pdf_engine.inspect_active_content(reader)


def _write_atomic(params):
    fileio.write_atomic(params["destPath"], params.get("text", ""))
    return True


def _copy_atomic(params):
    fileio.copy_atomic(params["srcPath"], params["destPath"])
    return True


FUNCS = {
    "stampEvidence": pdf_engine.stamp_evidence,
    "mergeAndStamp": pdf_engine.merge_and_stamp,
    "transcodeCCITTForPreview": _transcode,
    "inspectActiveContent": _inspect,
    "activeContentLabels": lambda p: pdf_engine.active_content_labels(p.get("keys")),
    "deriveLabel": lambda p: pdf_engine.derive_label(p.get("evidenceNumber"), p.get("branch")),
    "writeAtomic": _write_atomic,
    "copyAtomic": _copy_atomic,
}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    try:
        result = FUNCS[req["fn"]](req.get("params") or {})
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except Exception as e:  # テスト側でエラーを再現できるよう内容を返す
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
