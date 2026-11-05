# -*- coding: utf-8 -*-
"""
開発用の自己点検: 実際の窓を開き、画面のスクリプトを動かして結果を JSON に書き、自動で閉じる。

  set LL_SELFTEST_OUT=結果.json
  set LL_SELFTEST_SCRIPT=手順.js   （省略可。画面の中で動かす async 関数の本体）
  set LL_APPDATA_ROOT=作業用の保存先  （必ず指定する。本物のメモ・履歴を書き換えないため）
  python -m legalleaves

LL_SELFTEST_OUT が無いときは何もしない（通常の起動には影響しない）。
"""
import json
import os
import time

BASIC = r"""
const r = {};
r.title = document.title;
r.version = (document.getElementById('brand-version') || {}).textContent || null;
r.screen = (document.querySelector('.screen.is-active') || {dataset:{}}).dataset.screen || null;
r.hasApi = typeof window.api === 'object' && typeof window.api.getInitialOutputState === 'function';
r.pdfjs = typeof window.pdfjsLib;
r.bytesWithoutToken = (await fetch('/bytes/preview?path=x')).status;
r.styleLoaded = getComputedStyle(document.body).fontFamily;
return r;
"""


def _shoot(window, path):
    """窓の見えている範囲を画像にする（自己点検の見た目の確認用）。"""
    try:
        from PIL import ImageGrab
        os.makedirs(os.path.dirname(path), exist_ok=True)
        x, y, w, h = window.x, window.y, window.width, window.height
        ImageGrab.grab(bbox=(x, y, x + w, y + h), all_screens=True).save(path)
    except Exception:
        pass


def run(app, out_path):
    """app: legalleaves.app.App。LL_SELFTEST_FILES（| 区切り）と LL_SELFTEST_OUTDIR があれば、
    利用者が選んだのと同じ扱いで先に受け付けておき、画面側へ window.__ll として渡す。"""
    window = app._window
    if not os.environ.get("LL_APPDATA_ROOT"):
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"selftestError": "LL_APPDATA_ROOT を指定してください（本物の保存データを守るため）"}, f,
                      ensure_ascii=False)
        window.destroy()
        return
    script = BASIC
    custom = os.environ.get("LL_SELFTEST_SCRIPT")
    if custom:
        with open(custom, encoding="utf-8") as f:
            script = f.read()
    files = [p for p in (os.environ.get("LL_SELFTEST_FILES") or "").split("|") if p]
    out_dir = os.environ.get("LL_SELFTEST_OUTDIR") or ""
    accepted = app._session.register_paths(files)["accepted"] if files else []
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        app._session.remember_output_dir(out_dir)
    result = {}
    try:
        window.events.loaded.wait(30)
        size = os.environ.get("LL_SELFTEST_SIZE")  # 例 "1700x950"（広い画面での表示を確かめる）
        if size:
            w, h = (int(v) for v in size.lower().split("x"))
            window.resize(w, h)
            time.sleep(0.5)
        # 例 "4000:1700x950,8000:1000x800" … 開始から4秒後に広げ、8秒後に狭める（窓の大きさの変化を確かめる）
        resizes = os.environ.get("LL_SELFTEST_RESIZES")
        if resizes:
            import threading

            def later():
                start = time.time()
                for step in resizes.split(","):
                    at, wh = step.split(":")
                    time.sleep(max(0.0, start + int(at) / 1000 - time.time()))
                    rw, rh = (int(v) for v in wh.lower().split("x"))
                    window.resize(rw, rh)

            threading.Thread(target=later, daemon=True).start()
        time.sleep(1.5)  # 画面の初期化（init）が終わるのを待つ
        # LL_SELFTEST_PAUSE（ミリ秒）: 手順が場面ごとに止まる時間。LL_SELFTEST_SHOTS（フォルダ）があれば、
        # 場面（window.__llScene）が変わるたびに窓を画像に写す（見た目の確認用）
        pause_ms = int(os.environ.get("LL_SELFTEST_PAUSE") or 0)
        shots = os.environ.get("LL_SELFTEST_SHOTS")
        window.evaluate_js("window.__ll = " + json.dumps({"files": accepted, "out": out_dir, "pause": pause_ms},
                                                         ensure_ascii=False))
        # evaluate_js は非同期の結果を待たないので、画面側の変数に置いてから読みに行く
        js = ("window.__selftest = null; (async () => { try { " + script +
              " } catch (e) { return {selftestError: String(e && e.stack || e)}; } })()"
              ".then((r) => { window.__selftest = JSON.stringify(r === undefined ? null : r); });")
        window.evaluate_js(js)
        deadline = time.time() + float(os.environ.get("LL_SELFTEST_TIMEOUT", "120"))
        scene = None
        while time.time() < deadline:
            if shots:
                now = window.evaluate_js("window.__llScene || null")
                if now and now != scene:
                    scene = now
                    time.sleep(0.6)  # 描画が落ち着くのを待つ
                    _shoot(window, os.path.join(shots, f"{now}.png"))
            raw = window.evaluate_js("window.__selftest")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(0.3)
        else:
            result = {"selftestError": "時間切れ"}
    except Exception as e:  # 点検そのものの失敗も結果に残す
        result = {"selftestError": f"{type(e).__name__}: {e}"}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    app._quitting = True  # 作業中でも「閉じますか」を出さずに閉じる（書き出しまで進めた手順で止まらないように）
    window.destroy()
