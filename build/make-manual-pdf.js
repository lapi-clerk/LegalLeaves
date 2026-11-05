// docs/操作説明書.md から配布用の PDF を作る。
// Usage: node build/make-manual-pdf.js   （npm run manual:pdf）
//
// 追加の依存は入れない方針なので、Markdown→HTML は本文で使っている記法だけを
// 扱う小さな変換をここに持つ（見出し・表・箇条書き・引用・強調・コード・区切り線）。
// 出力は Windows に入っている Microsoft Edge の「PDF に印刷」（画面なし）。
// v4 までは Electron の printToPDF だったが、v5 で Electron をやめたので置き換えた。
// フォントは同梱の Noto Sans JP を埋め込むので、受け取った側の環境に関係なく同じ見た目になる。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "docs", "操作説明書.md");
const OUT = path.join(root, "dist", "LegalLeaves 操作説明書.pdf");
// 版はアプリ本体（py/legalleaves/__init__.py）が正
const version = (/__version__\s*=\s*"([^"]+)"/.exec(
  fs.readFileSync(path.join(root, "py", "legalleaves", "__init__.py"), "utf-8")) || [])[1] || "";

// --- Markdown → HTML（本文で使う記法だけ） ---------------------------------

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 行内の装飾。エスケープ後に適用する（順番: コード → 太字 → 斜体）。
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

// 折り返した行をつなぐ。和文どうしは空白を入れない（入れると不自然な隙間になる）。
function joinLines(buf) {
  return buf.reduce((acc, cur) => {
    if (!acc) return cur;
    const a = acc[acc.length - 1];
    const b = cur[0];
    const cjk = (c) => c && c.charCodeAt(0) > 0x2000;
    return acc + (cjk(a) && cjk(b) ? "" : " ") + cur;
  }, "");
}

function isTableSep(line) {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

function splitRow(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // 区切り線（表の区切りと紛れないよう先に判定する）
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // フェンス付きコード
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 見出し
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    // 引用（中に見出し・箇条書きが入るので中身を再帰的に変換する）
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^>\s?/.test(lines[i]) || (buf.length && !lines[i].trim() && /^>\s?/.test(lines[i + 1] || "")))) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // 表
    if (line.includes("|") && isTableSep(lines[i + 1] || "")) {
      const head = splitRow(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        body.push(splitRow(lines[i]));
        i++;
      }
      const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const tr = body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }

    // 箇条書き（- / 1. / チェックボックス）
    const bullet = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      const ordered = /\d/.test(bullet[2]);
      const items = [];
      let checklist = false;
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) {
          // 箇条書きの続き（インデントされた折り返し行）
          if (items.length && /^\s{2,}\S/.test(lines[i])) {
            const prev = items[items.length - 1].replace(/<[^>]*>/g, "");
            const cont = lines[i].trim();
            const cjk = (c) => c && c.charCodeAt(0) > 0x2000;
            const glue = cjk(prev[prev.length - 1]) && cjk(cont[0]) ? "" : " ";
            items[items.length - 1] += glue + inline(cont);
            i++;
            continue;
          }
          break;
        }
        let text = m[3];
        const cb = text.match(/^\[( |x|X)\]\s+(.*)$/);
        if (cb) {
          checklist = true;
          text = `<span class="cb">${cb[1] === " " ? "☐" : "☑"}</span>${inline(cb[2])}`;
        } else {
          text = inline(text);
        }
        items.push(text);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      const cls = checklist ? ' class="checklist"' : "";
      out.push(`<${tag}${cls}>${items.map((t) => `<li>${t}</li>`).join("")}</${tag}>`);
      continue;
    }

    // 段落（空行まで）
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|```|---+\s*$)/.test(lines[i])) {
      const nextIsTable = lines[i].includes("|") && isTableSep(lines[i + 1] || "");
      if (nextIsTable || /^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) break;
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) out.push(`<p>${inline(joinLines(buf))}</p>`);
    else i++;
  }

  return out.join("\n");
}

// --- ページの体裁 -----------------------------------------------------------

function buildHtml(bodyHtml) {
  // フォントは file:// で参照する（data: URLに埋めるとページのURLが巨大になり読み込みが返らない）
  const fontDir = path.join(root, "assets", "fonts", "ui").replace(/\\/g, "/");
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>LegalLeaves 操作説明書 v${version}</title>
<style>
@font-face { font-family:'Noto Sans JP'; src:url("file:///${fontDir}/NotoSansJP.woff2") format("woff2"); font-weight:100 900; }
/* サブセット（ワードマーク用）なので欧文の見出し1箇所にだけ使う */
@font-face { font-family:'LL Serif'; src:url("file:///${fontDir}/NotoSerifJP-SemiBold.woff2") format("woff2"); font-weight:600; }
:root { --accent:#2E4D39; --leaf:#4F8F3A; --ink:#1B2433; --muted:#5b6472; --line:#d7dce3; }
* { box-sizing:border-box; }
body { font-family:'Noto Sans JP', sans-serif; color:var(--ink); font-size:10.5pt; line-height:1.75;
       margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1 { font-family:'LL Serif','Noto Sans JP',serif; font-weight:600; font-size:26pt; color:var(--accent);
     margin:0 0 2mm; letter-spacing:.01em; }
h2 { font-size:14pt; color:#fff; background:var(--accent); padding:2.2mm 4mm; border-radius:2px;
     margin:9mm 0 4mm; break-after:avoid; }
h3 { font-size:11.5pt; color:var(--accent); border-left:3.5px solid var(--leaf); padding-left:3mm;
     margin:6mm 0 2.5mm; break-after:avoid; }
h4 { font-size:10.5pt; margin:4mm 0 1.5mm; break-after:avoid; }
p { margin:0 0 2.5mm; }
ul, ol { margin:0 0 3mm; padding-left:6mm; }
li { margin:0 0 1mm; }
ul.checklist { list-style:none; padding-left:1mm; }
ul.checklist li { margin-bottom:1.6mm; }
.cb { color:var(--leaf); font-size:12pt; margin-right:2mm; }
strong { font-weight:700; }
code { font-family:Consolas,'Courier New',monospace; font-size:9.5pt; background:#eef1f4;
       padding:.3mm 1.2mm; border-radius:2px; }
pre { background:#f4f6f8; border:1px solid var(--line); border-left:3px solid var(--leaf);
      padding:3mm 4mm; margin:0 0 3mm; overflow-wrap:anywhere; break-inside:avoid; }
pre code { background:none; padding:0; font-size:9.5pt; }
blockquote { margin:0 0 4mm; padding:3.5mm 4.5mm; background:#f2f7f3; border:1px solid #cfe0d4;
             border-left:4px solid var(--leaf); border-radius:2px; break-inside:avoid; }
blockquote > :last-child { margin-bottom:0; }
blockquote h3 { margin-top:0; border:none; padding-left:0; font-size:11pt; }
table { border-collapse:collapse; width:100%; margin:0 0 4mm; font-size:9.5pt; break-inside:avoid; }
th, td { border:1px solid var(--line); padding:1.8mm 2.5mm; text-align:left; vertical-align:top; }
th { background:#eaf0ec; color:var(--accent); font-weight:700; white-space:nowrap; }
hr { border:none; border-top:1px solid var(--line); margin:7mm 0; }
/* 表紙まわり */
.cover { border-bottom:2.5px solid var(--leaf); padding-bottom:4mm; margin-bottom:6mm; }
.cover .tagline { color:var(--leaf); font-size:11pt; font-weight:700; margin:0 0 3mm; }
.cover .meta { color:var(--muted); font-size:9.5pt; }
body > hr:first-of-type { display:none; }
h2 { page-break-after:avoid; }
/* 用紙・余白・ページ下の表示（印刷のページ余白の欄に出す） */
@page { size:A4; margin:16mm 16mm 18mm 16mm;
  @bottom-left { content:"LegalLeaves 操作説明書 v${version}"; font-family:'Noto Sans JP',sans-serif;
                 font-size:8pt; color:#5b6472; }
  @bottom-right { content:counter(page) " / " counter(pages); font-family:'Noto Sans JP',sans-serif;
                  font-size:8pt; color:#5b6472; } }
</style></head><body>${bodyHtml}</body></html>`;
}

// Windows に入っている Microsoft Edge を画面なしで動かし、PDF に印刷する。
// 利用者の Edge の設定・履歴に触れないよう、使い捨ての作業フォルダを指定する。
function findEdge() {
  const cands = [
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("Microsoft Edge が見つかりません（EDGE_PATH で場所を指定できます）");
  return hit;
}

// --- 実行 -------------------------------------------------------------------

(async function main() {
  const md = fs.readFileSync(SRC, "utf-8");
  let html = mdToHtml(md);

  // 冒頭（タイトル・タグライン・版）を表紙ブロックにまとめる
  html = html.replace(
    /^<h1>(.*?)<\/h1>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>/,
    (_m, t, tag, meta) =>
      `<div class="cover"><h1>${t}</h1><p class="tagline">${tag}</p><p class="meta">${meta}</p></div>`
  );

  // 一時HTMLに書き出してから読む（file:// なら同梱フォントもそのまま参照できる）
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ll-manual-"));
  const tmp = path.join(work, "manual.html");
  fs.writeFileSync(tmp, buildHtml(html), "utf-8");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  try { fs.unlinkSync(OUT); } catch { /* 無ければよい */ } // 古いPDFを「できた」と取り違えない
  const r = spawnSync(findEdge(), [
    "--headless", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer",
    `--user-data-dir=${path.join(work, "profile")}`,
    "--virtual-time-budget=5000", // フォントの読み込みを待つ
    `--print-to-pdf=${OUT}`,
    pathToFileURL(tmp).href,
  ], { timeout: 120000, windowsHide: true });
  // Edge は別のプロセスへ仕事を渡して先に戻ることがあるので、PDF ができて大きさが落ち着くまで待つ
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let last = -1;
  for (let i = 0; i < 120; i++) {
    const size = fs.existsSync(OUT) ? fs.statSync(OUT).size : -1;
    if (size > 0 && size === last) break;
    last = size;
    sleep(500);
  }
  if (r.error || !fs.existsSync(OUT)) {
    console.error("PDF を作れませんでした", r.error || String(r.stderr || ""));
    process.exit(1);
  }
  // 文書情報: 題名だけを残し、作成アプリ（Edge の名前・版）などは消す（配布物に余計な情報を載せない）
  const { PDFDocument } = require("pdf-lib");
  const doc = await PDFDocument.load(fs.readFileSync(OUT), { updateMetadata: false });
  doc.setTitle(`LegalLeaves 操作説明書 v${version}`);
  doc.setAuthor(""); doc.setSubject(""); doc.setKeywords([]); doc.setCreator(""); doc.setProducer("");
  fs.writeFileSync(OUT, await doc.save({ updateMetadata: false }));
  // Edge の作業フォルダは Edge が閉じきるまで消せないことがあるので、少し粘って消す
  for (let i = 0; i < 20 && fs.existsSync(work); i++) {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { sleep(500); }
  }
  console.log("created:", OUT, `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})();
