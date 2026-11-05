# -*- coding: utf-8 -*-
"""
Windows の小道具: クリップボード・確認ダイアログ・フォルダを開く。

pywebview にはクリップボードと「はい／いいえ」の確認が無いので、Windows の API を直接使う。
"""
import ctypes
import os
from ctypes import wintypes

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

_user32 = ctypes.WinDLL("user32", use_last_error=True)
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

_user32.OpenClipboard.argtypes = [wintypes.HWND]
_user32.OpenClipboard.restype = wintypes.BOOL
_user32.CloseClipboard.restype = wintypes.BOOL
_user32.EmptyClipboard.restype = wintypes.BOOL
_user32.GetClipboardData.argtypes = [wintypes.UINT]
_user32.GetClipboardData.restype = wintypes.HANDLE
_user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
_user32.SetClipboardData.restype = wintypes.HANDLE
_user32.MessageBoxW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT]
_user32.MessageBoxW.restype = ctypes.c_int
_kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
_kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
_kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
_kernel32.GlobalLock.restype = ctypes.c_void_p
_kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
_kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]


def _open_clipboard():
    import time

    for _ in range(10):  # 他のアプリが一瞬つかんでいることがあるので少し待って再試行
        if _user32.OpenClipboard(None):
            return True
        time.sleep(0.05)
    return False


def read_clipboard_text():
    if not _open_clipboard():
        return ""
    try:
        h = _user32.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return ""
        p = _kernel32.GlobalLock(h)
        if not p:
            return ""
        try:
            return ctypes.wstring_at(p)
        finally:
            _kernel32.GlobalUnlock(h)
    finally:
        _user32.CloseClipboard()


def write_clipboard_text(text):
    data = str(text or "")
    buf = ctypes.create_unicode_buffer(data)
    size = ctypes.sizeof(buf)
    if not _open_clipboard():
        return False
    try:
        _user32.EmptyClipboard()
        h = _kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not h:
            return False
        p = _kernel32.GlobalLock(h)
        ctypes.memmove(p, buf, size)
        _kernel32.GlobalUnlock(h)
        if not _user32.SetClipboardData(CF_UNICODETEXT, h):
            _kernel32.GlobalFree(h)
            return False
        return True  # 成功したらメモリはクリップボードの持ち物になる
    finally:
        _user32.CloseClipboard()


MB_YESNO = 0x04
MB_ICONQUESTION = 0x20
MB_ICONWARNING = 0x30
MB_DEFBUTTON2 = 0x100
MB_SETFOREGROUND = 0x10000
IDYES = 6


def ask_yes_no(hwnd, title, message, warning=False, default_no=True):
    """「はい／いいえ」の確認。既定のボタンは「いいえ」（取り消せない操作を誤って進めない）。"""
    flags = MB_YESNO | MB_SETFOREGROUND | (MB_ICONWARNING if warning else MB_ICONQUESTION)
    if default_no:
        flags |= MB_DEFBUTTON2
    return _user32.MessageBoxW(hwnd or None, str(message or ""), str(title or ""), flags) == IDYES


_WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
_user32.EnumWindows.argtypes = [_WNDENUMPROC, wintypes.LPARAM]
_user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
_user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
_user32.IsWindowVisible.argtypes = [wintypes.HWND]


def find_own_window(title):
    """このプロセスの、見えている窓（題名が title）を探す。確認ダイアログを窓の手前に出すのに使う。
    （窓の部品を別のスレッドから触らずに済むよう、Windows に聞いて探す）"""
    pid = os.getpid()
    found = []

    def cb(hwnd, _lparam):
        owner = wintypes.DWORD()
        _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and _user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(256)
            _user32.GetWindowTextW(hwnd, buf, 256)
            if buf.value == title:
                found.append(hwnd)
                return False
        return True

    _user32.EnumWindows(_WNDENUMPROC(cb), 0)
    return found[0] if found else None


PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
STILL_ACTIVE = 259
_kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
_kernel32.OpenProcess.restype = wintypes.HANDLE
_kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
_kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
_kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                 ctypes.POINTER(wintypes.DWORD)]


def pid_alive(pid):
    """その番号のプロセスが動いているか（作業フォルダを消してよいかの判定用）。"""
    if pid == os.getpid():
        return True
    h = _kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return False
    try:
        code = wintypes.DWORD()
        return bool(_kernel32.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == STILL_ACTIVE
    finally:
        _kernel32.CloseHandle(h)


def open_path(path):
    """フォルダ・ファイルを既定のアプリ（エクスプローラー等）で開く。失敗時は理由を返す（Electron の shell.openPath と同じ）。"""
    try:
        os.startfile(path)  # noqa: S606 — 利用者が選んだ・アプリが作った場所だけを開く
        return ""
    except OSError as e:
        return str(e)
