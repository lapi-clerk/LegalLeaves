# -*- coding: utf-8 -*-
"""
アプリが保存するもの（事務所の書き方メモ・最近使ったフォルダ・画面設定）。

保存先は Electron 版と同じ %APPDATA%\\legal-leaves\\data（版を入れ替えても引き継がれる）。
Edge 部品（WebView2）の作業フォルダも %APPDATA%\\legal-leaves の下に置き、
アンインストールで一緒に消せるようにする（終了時にも消える）。
"""
import json
import os
import shutil

PACKAGE_DIR_NAME = "legal-leaves"      # Electron 版の userData と同じ名前
LEGACY_DIR_NAME = "rakuraku-mints"     # 旧名（楽々mints）時代の保存先
MAX_FIRM_NOTES_BYTES = 200 * 1024
DEFAULT_RECENT_FOLDERS = []


def app_data_root():
    # 自動テスト（selftest）では本物の保存データに触れないよう、別の場所を指定できる
    override = os.environ.get("LL_APPDATA_ROOT")
    if override:
        return override
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, PACKAGE_DIR_NAME)


def data_dir():
    return os.path.join(app_data_root(), "data")


def webview_dir():
    """Edge 部品の作業フォルダ（起動ごとに別。同時に2つ起動しても取り合わない）。"""
    return os.path.join(app_data_root(), "webview", f"s{os.getpid()}")


def cleanup_webview_dirs(own=False, is_alive=None):
    """Edge 部品の作業フォルダを消す。
    own=True: この起動の分（終了時）。部品の子プロセスが終わるまで少し待ちながら消す。
    own=False: 前回までに残った分（起動時。強制終了などで残ったもの）。動いている起動の分は触らない。"""
    import re
    import time

    root = os.path.join(app_data_root(), "webview")
    if own:
        target = webview_dir()
        for _ in range(20):
            shutil.rmtree(target, ignore_errors=True)
            if not os.path.exists(target):
                break
            time.sleep(0.5)
    else:
        try:
            names = os.listdir(root)
        except OSError:
            return
        for n in names:
            m = re.fullmatch(r"s(\d+)", n)
            if m and is_alive and is_alive(int(m.group(1))):
                continue
            shutil.rmtree(os.path.join(root, n), ignore_errors=True)
    try:
        os.rmdir(root)  # 空になったら親も消す
    except OSError:
        pass


def cases_dir():
    return os.path.join(app_data_root(), "cases")


def _file(name):
    return os.path.join(data_dir(), name)


RECENT = "recent-folders.json"
SETTINGS = "settings.json"
FIRM_NOTES = "firm-notes.txt"


def migrate():
    """旧版の保存場所から一度だけ引き継ぐ（Electron 版 main.js の2つの移行と同じ）。"""
    try:
        os.makedirs(data_dir(), exist_ok=True)
    except OSError:
        return
    # 〜v3.8.0 は userData 直下に保存していた
    for name in (RECENT, SETTINGS, FIRM_NOTES):
        old = os.path.join(app_data_root(), name)
        new = _file(name)
        try:
            if os.path.exists(old) and not os.path.exists(new):
                os.replace(old, new)
            elif os.path.exists(old):
                os.remove(old)
        except OSError:
            pass
    # v4.0.0 で楽々mints → LegalLeaves に改称（旧フォルダは消さずに残す）
    old_data = os.path.join(os.path.dirname(app_data_root()), LEGACY_DIR_NAME, "data")
    if os.path.isdir(old_data):
        for name in os.listdir(old_data):
            src, dst = os.path.join(old_data, name), _file(name)
            if os.path.exists(dst):
                continue
            try:
                shutil.copyfile(src, dst)
            except OSError:
                pass


def _read_json(name):
    try:
        with open(_file(name), encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(name, obj):
    try:
        os.makedirs(data_dir(), exist_ok=True)
        with open(_file(name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
    except OSError:
        pass  # 保存できなくても、この回の動作には影響しない


def read_settings():
    return _read_json(SETTINGS)


def write_settings(settings):
    _write_json(SETTINGS, settings)


def read_recent_folders():
    v = _read_json(RECENT).get("recentFolders")
    return list(v) if isinstance(v, list) and v else list(DEFAULT_RECENT_FOLDERS)


def add_recent_folder(path):
    nxt = [path] + [p for p in read_recent_folders() if p != path]
    nxt = nxt[:6]
    _write_json(RECENT, {"recentFolders": nxt})
    return nxt


def read_firm_notes():
    try:
        with open(_file(FIRM_NOTES), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def write_firm_notes(text):
    text = "" if text is None else str(text)
    if len(text.encode("utf-8")) > MAX_FIRM_NOTES_BYTES:
        return False
    try:
        os.makedirs(data_dir(), exist_ok=True)
        with open(_file(FIRM_NOTES), "w", encoding="utf-8", newline="") as f:
            f.write(text)
        return True
    except OSError:
        return False


def app_data_info():
    def count_cases():
        d = cases_dir()
        if not os.path.isdir(d):
            return 0
        return len([n for n in os.listdir(d) if n.endswith((".legalleaves.json", ".mints.json"))])

    return {
        "userDataPath": data_dir(),
        "firmNotesPath": _file(FIRM_NOTES),
        "firmNotesExists": os.path.exists(_file(FIRM_NOTES)),
        "recentFoldersExists": os.path.exists(_file(RECENT)),
        "casesDirPath": cases_dir(),
        "casesCount": count_cases(),
    }


def delete_item(key):
    try:
        if key == "recentFolders":
            if os.path.exists(_file(RECENT)):
                os.remove(_file(RECENT))
        elif key == "firmNotes":
            if os.path.exists(_file(FIRM_NOTES)):
                os.remove(_file(FIRM_NOTES))
        elif key == "cases":
            shutil.rmtree(cases_dir(), ignore_errors=True)
        else:
            return False
        return True
    except OSError:
        return False


def purge_cases_dir():
    """停止中: 案件ファイル（作業の保存）は使わない。過去の版が保存した分も起動時に消す。"""
    shutil.rmtree(cases_dir(), ignore_errors=True)


def delete_everything():
    """アプリが保存したものをすべて消す（Edge 部品が終わった後＝アプリ終了の直前に呼ぶ）。"""
    import time

    for _ in range(10):
        shutil.rmtree(app_data_root(), ignore_errors=True)
        if not os.path.exists(app_data_root()):
            return True
        time.sleep(0.5)
    return False
