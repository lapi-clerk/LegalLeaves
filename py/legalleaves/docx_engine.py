# -*- coding: utf-8 -*-
"""
証拠説明書（Word）の下書きを作る（Electron 版 docx-engine.js の移植）。

テンプレート assets/templates/証拠説明書テンプレート.docx の差し込み記号は docxtemplater の書式:
  {名前}            … 値に置き換える（無い値は空欄。改行は Word の改行にする）
  {#名前} … {/名前} … 表の1行の中で始まって終わるものは「行の繰り返し」。
                       配列なら要素ごとに行を複製、真なら1回、偽・空なら行ごと消す。
このテンプレートが使うのはこの2種類だけなので、ここではそれだけを docxtemplater と同じ結果に
なるよう実装する（外部の差し込み部品を増やさない）。

data = {
  提出日, 裁判所, 事件番号, 提出者側, 代理人,
  証拠: [ { 通常: true, 号証, 標目, 作成年月日, 作成者, 立証趣旨, 備考 }, ... ]
}
"""
import io
import re
import zipfile

from . import fileio

_T_RE = re.compile(r"(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)")
_TAG_RE = re.compile(r"\{([^{}]+)\}")
_PARA_RE = re.compile(r"<w:p[\s>].*?</w:p>|<w:p\s*/>", re.S)


def _xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _xml_unescape(s):
    return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def _value_text(v):
    if v is None or v is False:
        return ""
    if v is True:
        return "true"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _render_value(value, rpr=""):
    """値を <w:t> の中身へ。改行は docxtemplater（linebreaks: true）と同じく、
    文字の連なり（w:r）をいったん閉じて改行だけの w:r を挟み、同じ書式（rPr）で続ける。"""
    parts = _value_text(value).split("\n")
    sep = "</w:t></w:r><w:r><w:br/></w:r><w:r>" + rpr + '<w:t xml:space="preserve">'
    return sep.join(_xml_escape(p) for p in parts)


def _run_props(fragment, at):
    """fragment の at の位置にある w:t を含む w:r の書式（<w:rPr>…</w:rPr>）を返す。"""
    starts = [m.start() for m in re.finditer(r"<w:r[\s>]", fragment[:at])]
    if not starts:
        return ""
    m = re.search(r"<w:rPr>.*?</w:rPr>", fragment[starts[-1]:at], re.S)
    return m.group(0) if m else ""


def _lookup(name, scopes):
    for scope in scopes:  # 内側（繰り返しの要素）から外側へ探す
        if isinstance(scope, dict) and name in scope:
            return scope[name]
    return None


def _replace_tags(fragment, scopes):
    """fragment（段落など）の中の {名前} を置き換える。記号が複数の w:t にまたがっても扱う。
    区切り（{#…}{/…}）はここに来る前に処理済みで、残っていれば消す。"""
    nodes = list(_T_RE.finditer(fragment))
    if not nodes:
        return fragment
    texts = [_xml_unescape(m.group(2)) for m in nodes]
    joined = "".join(texts)
    if "{" not in joined:
        return fragment
    # 各 w:t の開始位置（連結文字列の中で）
    starts = []
    pos = 0
    for t in texts:
        starts.append(pos)
        pos += len(t)

    def seg_of(i):
        for k in range(len(starts) - 1, -1, -1):
            if starts[k] <= i:
                return k
        return 0

    # 記号の文字は消し、値は記号が始まる w:t の、その位置へ入れる（他の w:t の書式は保つ）
    removed = [set() for _ in texts]
    inserts = [dict() for _ in texts]
    for m in _TAG_RE.finditer(joined):
        name = m.group(1).strip()
        ks = seg_of(m.start())
        rpr = _run_props(fragment, nodes[ks].start())
        value_xml = "" if name[:1] in ("#", "/") else _render_value(_lookup(name, scopes), rpr)
        inserts[ks][m.start() - starts[ks]] = value_xml
        for i in range(m.start(), m.end()):
            k = seg_of(i)
            removed[k].add(i - starts[k])

    new_texts = []
    for k, t in enumerate(texts):
        buf = []
        for i in range(len(t) + 1):
            if i in inserts[k]:
                buf.append(inserts[k][i])
            if i < len(t) and i not in removed[k]:
                buf.append(_xml_escape(t[i]))
        new_texts.append("".join(buf))

    out = []
    last = 0
    for m, txt in zip(nodes, new_texts):
        out.append(fragment[last:m.start()])
        open_tag = m.group(1)
        if txt == _xml_escape(_xml_unescape(m.group(2))):
            out.append(m.group(0))  # 変わらない w:t はそのまま
        elif txt == "":
            out.append("<w:t/>")  # 空になった w:t は docxtemplater と同じく空要素で書く
        else:
            if "xml:space" not in open_tag:
                open_tag = '<w:t xml:space="preserve">'
            out.append(open_tag + txt + m.group(3))
        last = m.end()
    out.append(fragment[last:])
    return "".join(out)


def _row_spans(xml):
    """表の行（<w:tr>…</w:tr>）の範囲を返す。<w:trPr> 等と取り違えないよう厳密に探す。"""
    spans = []
    for m in re.finditer(r"<w:tr[\s>]", xml):
        end = xml.find("</w:tr>", m.start())
        if end >= 0:
            spans.append((m.start(), end + len("</w:tr>")))
    return spans


def _row_text(row):
    return "".join(_xml_unescape(m.group(2)) for m in _T_RE.finditer(row))


def _render_row(row, scopes):
    """行の中の {#名前}…{/名前}（行の繰り返し）を展開して、行の XML の並びを返す。"""
    text = _row_text(row)
    m = re.search(r"\{#([^{}]+)\}", text)
    if not m:
        return [_replace_paragraphs(row, scopes)]
    name = m.group(1).strip()
    if "{/" + name + "}" not in text:
        return [_replace_paragraphs(row, scopes)]
    # この区切りを消した行を、値に応じて0回以上展開する（入れ子の区切りは再帰で処理）
    inner = _remove_section_tags(row, name)
    value = _lookup(name, scopes)
    if isinstance(value, list):
        out = []
        for item in value:
            out.extend(_render_row(inner, [item] + scopes))
        return out
    if value:
        return _render_row(inner, ([value] if isinstance(value, dict) else []) + scopes)
    return []


def _remove_section_tags(row, name):
    """行の中から {#name} と {/name} を1つずつ取り除く（w:t をまたいでいても可）。"""
    for tag in ("{#" + name + "}", "{/" + name + "}"):
        nodes = list(_T_RE.finditer(row))
        texts = [_xml_unescape(n.group(2)) for n in nodes]
        joined = "".join(texts)
        i = joined.find(tag)
        if i < 0:
            continue
        j = i + len(tag)
        pos = 0
        pieces = []
        last = 0
        for n, t in zip(nodes, texts):
            a, b = pos, pos + len(t)
            keep = t
            if b > i and a < j:
                keep = t[:max(i - a, 0)] + t[min(j - a, len(t)):]
            pieces.append(row[last:n.start()] + n.group(1) + _xml_escape(keep) + n.group(3))
            last = n.end()
            pos = b
        pieces.append(row[last:])
        row = "".join(pieces)
    return row


def _replace_paragraphs(xml, scopes):
    return _PARA_RE.sub(lambda m: _replace_tags(m.group(0), scopes), xml)


def render_document_xml(xml, data):
    scopes = [data or {}]
    out = []
    last = 0
    for s, e in _row_spans(xml):
        row = xml[s:e]
        if "{#" not in _row_text(row):
            continue
        out.append(_replace_paragraphs(xml[last:s], scopes))
        out.extend(_render_row(row, scopes))
        last = e
    out.append(_replace_paragraphs(xml[last:], scopes))
    return "".join(out)


def generate_evidence_explanation(template_path, dest_path, data):
    """テンプレートに事件情報と証拠の行を差し込み、dest_path（.docx）へ壊れない形で保存する。"""
    with zipfile.ZipFile(template_path) as zin:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                content = zin.read(item.filename)
                if item.filename in ("word/document.xml",) or re.match(r"word/(header|footer)\d*\.xml$", item.filename):
                    content = render_document_xml(content.decode("utf-8"), data).encode("utf-8")
                zout.writestr(item, content)
    fileio.write_atomic(dest_path, buf.getvalue())
    return dest_path
