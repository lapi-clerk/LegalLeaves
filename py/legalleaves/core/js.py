# -*- coding: utf-8 -*-
"""
画面（JavaScript）と同じ結果を出すための小さな道具。

判定は画面（src/app-*.js）と Python（このフォルダ）の 2 か所にあり、同じ表（test/tables/*.json）で縛っている。
JavaScript と Python で動きが違うところを、ここに集める。

  - 正規表現: JS の \\d は半角数字だけ・$ は末尾だけ。Python の \\d は全角数字も拾い、$ は末尾の改行の前にも合う。
    → 数字は [0-9]、末尾は \\Z と書く。空白は WS を使う
  - 真偽: JS では空の配列・空のオブジェクトは「真」。Python では「偽」→ truthy() を使う
  - 文字数: JS は UTF-16 の単位で数える（絵文字などは 2）→ utf16_len() を使う
  - 文字列の並び: 画面は日本語の並び（漢字は JIS の順）→ sym_sort_key() を使う
"""
import math
import unicodedata

# JS の \s・trim() が対象にする文字
_WS_CHARS = "\t\n\x0b\x0c\r                  　﻿"
WS = "[\\t\\n\\x0b\\x0c\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"


def truthy(v):
    """JS の真偽（空の配列・空のオブジェクトは真）"""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    if isinstance(v, str):
        return v != ""
    return True


def oor(v, default):
    """JS の `v || default`"""
    return v if truthy(v) else default


def num_str(n):
    """JS の数値 → 文字列（1.0 は "1"）"""
    if isinstance(n, float):
        if math.isnan(n):
            return "NaN"
        if n.is_integer() and abs(n) < 1e21:
            return str(int(n))
        return repr(n)
    return str(n)


def jstr(v):
    """JS の String(v)・テンプレートへの埋め込み"""
    if isinstance(v, str):
        return v
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return num_str(v)
    if isinstance(v, (list, tuple)):
        return ",".join("" if x is None else jstr(x) for x in v)
    return "[object Object]"


def s_(v):
    """JS の String(v || "")"""
    return jstr(v) if truthy(v) else ""


def trim(s):
    """JS の trim()"""
    return s.strip(_WS_CHARS)


def utf16_len(s):
    """JS の文字列の length"""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def to_number(v):
    """JS の数値への変換（計算に使う分だけ）。数にならなければ NaN"""
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    if v is None:
        return 0
    if isinstance(v, str):
        t = trim(v)
        if t == "":
            return 0
        try:
            return float(t)
        except ValueError:
            return math.nan
    return math.nan


def js_round(x):
    """JS の Math.round（.5 は大きいほうへ）"""
    return math.floor(x + 0.5)


def nfkc(s):
    return unicodedata.normalize("NFKC", s)


def sym_sort_key(sym):
    """号証記号の並び（画面の localeCompare・日本語と同じ: 英数字 → かな → 漢字は JIS の順）。
    甲乙丙… は「乙 検 甲 丁 丙 弁 戊」の順になる（音読みの順）。"""
    key = []
    for ch in sym:
        if ch.isascii():
            key.append((0, ch.lower().encode("ascii")))
            continue
        try:
            key.append((1, ch.encode("euc_jp")))
        except UnicodeEncodeError:
            key.append((2, ch.encode("utf-8")))
    return tuple(key)
