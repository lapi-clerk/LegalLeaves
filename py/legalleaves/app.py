# -*- coding: utf-8 -*-
"""
LegalLeaves（Python＋pywebview 版）の起動と窓まわり。

  - 画面は Electron 版と同じ src/ をそのまま使う（呼び出し口 window.api だけ web/bridge.js で差し替え）
  - 画面は pywebview（Edge の部品 WebView2）の専用の窓に出す。配信は 127.0.0.1 だけで、外部とは通信しない
  - PDF のバイト列（プレビュー・元ファイル）は、同じ 127.0.0.1 の窓口から合言葉つきで渡す
    （pywebview の呼び出しは JSON 経由なので、大きなバイト列には向かない）

落とし穴（試作で確認済み）:
  - js_api のオブジェクトに窓を「公開の属性」で持たせない。pywebview が窓の内部まで辿り、終了時に固まる
  - text_select=True にしないと画面の文字を選べない（エラー文をコピーできない）
"""
import os
import secrets
import sys
import threading
import time

import bottle
import webview
from webview.dom import _dnd_state

from . import APP_NAME, __version__, service, storage, winutil
from .paths import resource_path

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
ASSET_ALLOW = ("brand-logo.png", "fonts/")  # 画面が参照する assets だけを配る
SOURCE_FILE_TYPES = (
    "対応ファイル (*.pdf;*.jpg;*.jpeg;*.png;*.docx;*.doc;*.xlsx;*.xls;*.pptx;*.ppt;*.rtf;*.mp3;*.mp4;*.m4a;*.wav;*.aac;*.wma;*.flac;*.ogg;*.opus;*.aiff;*.aif;*.amr;*.oga;*.mov;*.avi;*.wmv;*.mkv;*.m4v;*.flv;*.webm;*.3gp;*.3g2;*.mpeg;*.mpg;*.mts;*.m2ts;*.ts;*.vob)",
    "PDF (*.pdf)",
    "画像 (*.jpg;*.jpeg;*.png)",
    "Office・RTF (*.docx;*.doc;*.xlsx;*.xls;*.pptx;*.ppt;*.rtf)",
    "音声・動画 (mp3・mp4 にして出します) (*.mp3;*.mp4;*.m4a;*.wav;*.aac;*.wma;*.flac;*.ogg;*.opus;*.aiff;*.aif;*.amr;*.oga;*.mov;*.avi;*.wmv;*.mkv;*.m4v;*.flv;*.webm;*.3gp;*.3g2;*.mpeg;*.mpg;*.mts;*.m2ts;*.ts;*.vob)",
)
QUIT_MESSAGE = "作業中の内容が失われます。本当に終了しますか？"


class Api:
    """画面（bridge.js）から呼ばれる窓口。名前は Electron 版 preload.js の各関数に対応する。
    ※ 窓などの内部の物は先頭に _ を付けて持つ（pywebview に辿らせない）。"""

    def __init__(self, app):
        self._app = app

    # --- 起動時 ---
    def session_token(self):
        return self._app._token

    def get_initial_output_state(self):
        recent = self._visible_recent(storage.read_recent_folders())
        settings = storage.read_settings()
        return {
            "outputFolder": recent[0] if recent else "",
            "recentFolders": recent,
            "previewEnabled": settings.get("previewEnabled") is not False,
            "appVersion": __version__,
        }

    def set_preview_enabled(self, enabled):
        s = storage.read_settings()
        s["previewEnabled"] = bool(enabled)
        storage.write_settings(s)
        return s["previewEnabled"]

    # --- ファイル・フォルダの選択 ---
    def select_pdf_files(self):
        r = self._app._window.create_file_dialog(webview.FileDialog.OPEN, allow_multiple=True,
                                                 file_types=SOURCE_FILE_TYPES)
        return self._app._session.register_paths(list(r or []))

    def select_output_folder(self, current_path=""):
        kw = {"directory": current_path} if current_path and os.path.isdir(current_path) else {}
        r = self._app._window.create_file_dialog(webview.FileDialog.FOLDER, **kw)
        if not r:
            return None
        folder = r[0]
        self._app._session.remember_output_dir(folder)
        return {"path": folder, "recentFolders": self._visible_recent(storage.add_recent_folder(folder))}

    def _visible_recent(self, folders):
        # いま見つからないフォルダ（消した・移した・外付けを外した）は一覧に出さない。
        # 出すと選べてしまい、出力のときに断られる（記録は残すので、戻せばまた出る）。
        # 起動時だけでなく、フォルダを選んだ後に返す一覧も同じに絞る（5.4.2 では選んだ後に出ていた）。
        return [p for p in folders if self._app._session.remember_output_dir(p)]

    def register_dropped_files(self, count=0):
        paths = self._app._take_dropped_paths()
        if not paths:
            return {"accepted": [], "rejected": [{"name": "ドロップしたファイル",
                                                  "reason": "ファイルの場所を受け取れませんでした。「ファイルを選択」からお試しください。"}]}
        return self._app._session.register_paths(paths)

    def resolve_dropped_output_path(self):
        paths = self._app._take_dropped_paths()
        if not paths:
            return None
        p = paths[0]
        d = p if os.path.isdir(p) else os.path.dirname(p)
        return d if self._app._session.remember_output_dir(d) else None

    # --- クリップボード・プロンプト ---
    def read_clipboard_text(self):
        return winutil.read_clipboard_text()

    def write_clipboard_text(self, text):
        return winutil.write_clipboard_text(text)

    def copy_prompt(self, rename_only=False):
        try:
            return winutil.write_clipboard_text(service.prompt_text(bool(rename_only)))
        except OSError:
            return False

    # --- 事務所の書き方メモ・保存データ ---
    def read_firm_notes(self):
        return storage.read_firm_notes()

    def write_firm_notes(self, text):
        return storage.write_firm_notes(text)

    def get_app_data_info(self):
        return storage.app_data_info()

    def open_app_data_dir(self):
        os.makedirs(storage.data_dir(), exist_ok=True)
        return winutil.open_path(storage.data_dir())

    def delete_app_data_item(self, key):
        return storage.delete_item(key)

    def delete_all_app_data(self):
        msg = ("アプリが保存したデータをすべて削除しますか？\n\n"
               f"削除される場所:\n{storage.app_data_root()}\n\n"
               "含まれるもの:\n・事務所の書き方メモ\n・最近使ったフォルダの履歴\n・画面設定と内部キャッシュ\n\n"
               "読み込んだ元ファイルや、出力済みの提出ファイルには影響しません。\n"
               "この操作は取り消せません。「はい」を押すと削除してアプリを終了します。")
        if not winutil.ask_yes_no(self._app._hwnd(), APP_NAME, msg, warning=True):
            return False
        self._app._delete_all_on_exit = True
        self._app._quit()
        return True

    # --- 確認・終了 ---
    def confirm_dialog(self, opts=None):
        opts = opts or {}
        message = str(opts.get("message") or "")
        if opts.get("detail"):
            message += "\n\n" + str(opts["detail"])
        return winutil.ask_yes_no(self._app._hwnd(), APP_NAME, message)

    def set_dirty(self, dirty):
        self._app._dirty = bool(dirty)
        return True

    def quit_app(self, opts=None):
        if (opts or {}).get("hasUnsavedWork") and not winutil.ask_yes_no(self._app._hwnd(), APP_NAME, QUIT_MESSAGE):
            return False
        self._app._quit()
        return True

    # --- 出力・プレビュー ---
    def read_pdf_metadata(self, paths):
        return self._app._session.read_pdf_metadata(paths)

    def create_submission_files(self, payload):
        return self._app._session.create_submission_files(payload)

    def get_progress(self):
        return self._app._session.get_progress()

    def generate_preview(self, payload):
        return self._app._session.generate_preview(payload)

    def regenerate_preview_file(self, payload):
        return self._app._session.regenerate_preview_file(payload)

    def discard_preview(self):
        self._app._session.cleanup_preview_dir()
        return True

    def open_last_output_dir(self):
        s = self._app._session
        if not s.last_output_dir or not s.is_allowed_output_dir(s.last_output_dir):
            return "許可されていないパスです"
        return winutil.open_path(s.last_output_dir)

    def open_source_file(self, path):
        if not self._app._session.is_allowed_source(path):
            return "許可されていないパスです"
        return winutil.open_path(path)

    def open_case_file(self):
        # 停止中: 案件ファイル（作業の保存・再開）は使わない。画面のボタンも隠してある。
        return {"error": "「前回の作業を開く」は現在停止しています。"}


class App:
    def __init__(self):
        self._session = service.Session()
        self._token = secrets.token_urlsafe(32)
        self._window = None
        self._dirty = False
        self._quitting = False
        self._delete_all_on_exit = False
        self._drop_lock = threading.Lock()

    # --- ドロップされたファイルの場所 ---
    def _take_dropped_paths(self):
        """bridge.js が渡したドロップのファイルの場所を受け取る（WebView2 が教えてくれる）。"""
        for _ in range(20):  # 通常はすでに届いている。念のため少しだけ待つ
            with self._drop_lock:
                items = list(_dnd_state["paths"])
                _dnd_state["paths"].clear()
            if items:
                return [p for _name, p in items]
            time.sleep(0.05)
        return []

    def _hwnd(self):
        return winutil.find_own_window(APP_NAME)

    def _quit(self):
        self._quitting = True
        threading.Thread(target=self._window.destroy, daemon=True).start()

    def _on_closing(self):
        """窓の × で閉じるとき、作業中なら確かめる。False を返すと閉じない。"""
        if self._quitting or not self._dirty:
            return True
        if winutil.ask_yes_no(self._hwnd(), APP_NAME, QUIT_MESSAGE):
            self._quitting = True
            return True
        return False

    # --- 画面の配信（127.0.0.1 のみ） ---
    def _server(self):
        app = bottle.Bottle()
        src_root = resource_path("src")
        assets_root = resource_path("assets")

        def no_cache(resp):
            resp.set_header("Cache-Control", "no-store")
            return resp

        @app.hook("before_request")
        def _guard():
            # DNS リバインディング対策: 127.0.0.1 / localhost 以外の名前で来た要求は受けない
            host = (bottle.request.get_header("Host") or "").rsplit(":", 1)[0]
            if host not in ("127.0.0.1", "localhost"):
                bottle.abort(403)

        @app.route("/")
        def _root():
            bottle.redirect("/src/index.html")

        @app.route("/bridge.js")
        def _bridge():
            return no_cache(bottle.static_file("bridge.js", root=WEB_DIR, mimetype="text/javascript", charset="utf-8"))

        @app.route("/src/<path:path>")
        def _src(path):
            if path == "index.html":
                with open(os.path.join(src_root, "index.html"), encoding="utf-8") as f:
                    html = f.read()
                html = _adapt_index_html(html)
                bottle.response.content_type = "text/html; charset=utf-8"
                bottle.response.set_header("Cache-Control", "no-store")
                return html
            mime = "text/javascript" if path.endswith((".js", ".mjs")) else "auto"
            return no_cache(bottle.static_file(path, root=src_root, mimetype=mime, charset="utf-8"))

        @app.route("/assets/<path:path>")
        def _assets(path):
            if not path.startswith(ASSET_ALLOW):
                bottle.abort(404)
            return no_cache(bottle.static_file(path, root=assets_root))

        @app.route("/bytes/<kind>")
        def _bytes(kind):
            if not secrets.compare_digest(bottle.request.get_header("X-LL-Token") or "", self._token):
                bottle.abort(403)
            path = bottle.request.query.getunicode("path") or ""
            try:
                if kind == "preview":
                    data, ext = self._session.read_preview_bytes(path), ".pdf"
                elif kind == "source":
                    r = self._session.read_source_bytes(path)
                    ext, data = r if r else ("", None)
                else:
                    data, ext = None, ""
            except OSError:
                data = None
            if data is None:
                bottle.abort(404)
            bottle.response.content_type = "application/octet-stream"
            bottle.response.set_header("X-LL-Ext", ext)
            bottle.response.set_header("Cache-Control", "no-store")
            return data

        return app

    def run(self):
        storage.migrate()
        service.cleanup_stale_temp_dirs()
        storage.purge_cases_dir()
        storage.cleanup_webview_dirs(own=False, is_alive=winutil.pid_alive)  # 前回の強制終了などの残り
        # bridge.js がドロップのファイルを渡したとき、pywebview がその場所を受け取るようにする
        # （受け取りは pywebview の DOM イベント登録の数で判定される。ここでは常に受け取る）
        _dnd_state["num_listeners"] = max(1, _dnd_state.get("num_listeners", 0))

        self._window = webview.create_window(
            APP_NAME, self._server(), js_api=Api(self),
            width=1280, height=860, min_size=(480, 520), background_color="#f4f6f9",
            text_select=True,
        )
        self._window.events.closing += self._on_closing
        os.makedirs(storage.app_data_root(), exist_ok=True)
        selftest_out = os.environ.get("LL_SELFTEST_OUT")  # 開発用の自己点検（selftest.py）
        if selftest_out:
            from . import selftest
            func, args = selftest.run, (self, selftest_out)
        else:
            func, args = None, None
        # private_mode: Edge 部品の作業データ（キャッシュ等）は終了時に消す。置き場所はアプリの保存先の下
        webview.start(func, args, private_mode=True, storage_path=storage.webview_dir())

        self._session.cleanup_preview_dir()
        # Edge 部品は自分でも作業フォルダを消すが、子プロセスの終了が遅いと消し残すので、ここで確実に消す
        storage.cleanup_webview_dirs(own=True)
        if self._delete_all_on_exit:
            storage.delete_everything()


def _adapt_index_html(html):
    """Electron 版の index.html を、この版で配るための最小限の手直し:
    - 画面の安全設定（CSP）に、同じ配信元からのデータ取得（connect-src 'self'）を足す
    - window.api を用意する bridge.js を、画面のスクリプトより先に読む"""
    html = html.replace("default-src 'none';", "default-src 'none'; connect-src 'self';", 1)
    marker = '<script src="./timestamp-zone.js"></script>'
    return html.replace(marker, '<script src="/bridge.js"></script>\n' + marker, 1)


def main():
    if sys.stdout:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    App().run()
