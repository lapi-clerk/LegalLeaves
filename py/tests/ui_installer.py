# -*- coding: utf-8 -*-
"""インストーラ（NSIS）の画面を Windows の標準ボタンとして直接操作する試験。
最後の画面の「デスクトップにショートカットを作る」の初期状態を読み、指定の状態にして完了する。
「起動する」のチェックは外す（アプリを開かない）。
  python ui_install.py <setup.exe> on|off|keep
"""
import ctypes
import os
import subprocess
import sys
import time
import winreg
from ctypes import wintypes

sys.stdout.reconfigure(encoding="utf-8")
u = ctypes.WinDLL("user32", use_last_error=True)
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
u.EnumWindows.argtypes = [EnumProc, wintypes.LPARAM]
u.EnumChildWindows.argtypes = [wintypes.HWND, EnumProc, wintypes.LPARAM]
u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
u.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
u.SendMessageW.restype = ctypes.c_ssize_t
u.IsWindowVisible.argtypes = [wintypes.HWND]
BM_GETCHECK, BM_CLICK = 0x00F0, 0x00F5


def text(h):
    b = ctypes.create_unicode_buffer(256)
    u.GetWindowTextW(h, b, 256)
    return b.value


def cls(h):
    b = ctypes.create_unicode_buffer(64)
    u.GetClassNameW(h, b, 64)
    return b.value


def top_windows(pid):
    out = []

    def cb(h, _):
        p = wintypes.DWORD()
        u.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value == pid and u.IsWindowVisible(h):
            out.append(h)
        return True

    u.EnumWindows(EnumProc(cb), 0)
    return out


def buttons(pid):
    out = []

    def cb(h, _):
        if cls(h) == "Button" and u.IsWindowVisible(h):
            out.append((h, text(h)))
        return True

    for w in top_windows(pid):
        u.EnumChildWindows(w, EnumProc(cb), 0)
    return out


def find(pid, part, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        for h, t in buttons(pid):
            if part in t:
                return h
        time.sleep(0.2)
    raise SystemExit(f"見つかりません: {part} / 見えているボタン: {[t for _, t in buttons(pid)]}")


def reg_pref():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\LegalLeaves") as k:
            return winreg.QueryValueEx(k, "DesktopShortcut")[0]
    except OSError:
        return "（なし）"


setup, want = sys.argv[1], sys.argv[2]
p = subprocess.Popen([setup])
u.SendMessageW(find(p.pid, "インストール"), BM_CLICK, 0, 0)  # 最初の画面のボタンは「インストール」
desk = find(p.pid, "デスクトップにショートカット", timeout=120)
initial = u.SendMessageW(desk, BM_GETCHECK, 0, 0) == 1
print("最後の画面の初期状態:", "チェックあり" if initial else "チェックなし")
if (want == "on" and not initial) or (want == "off" and initial):
    u.SendMessageW(desk, BM_CLICK, 0, 0)
for h, t in buttons(p.pid):
    if "起動する" in t and u.SendMessageW(h, BM_GETCHECK, 0, 0) == 1:
        u.SendMessageW(h, BM_CLICK, 0, 0)
u.SendMessageW(find(p.pid, "完了"), BM_CLICK, 0, 0)
p.wait(30)
# 「起動する」で開いたアプリがあれば普通に閉じる（次の回で「起動中です」にならないように）
subprocess.run(["powershell", "-NoProfile", "-Command",
                "Get-Process LegalLeaves -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow(); [void]$_.WaitForExit(15000) }"],
               capture_output=True)
time.sleep(0.5)
desktop = os.path.join(os.environ["USERPROFILE"], "Desktop", "LegalLeaves.lnk")
print("完了後: デスクトップのショートカット =", os.path.exists(desktop), "/ 記憶 =", reg_pref())
