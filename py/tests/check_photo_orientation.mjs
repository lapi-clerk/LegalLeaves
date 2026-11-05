// 写真の向きの試験: tools/make-exif-samples.py のサンプル（どれもエクスプローラーでは「上に赤・左に青」）を
// Python 版で PDF にし、描いた結果が正立しているか（用紙が縦・赤が上・青が左）を確かめる。
//   node py/tests/check_photo_orientation.mjs <サンプルのフォルダ> <作業フォルダ> [追加で回す角度]
// 角度を付けたときは「8枚とも向き1（そのまま）と同じ描かれ方になるか」を確かめる。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { spawnSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { createCanvas } = require("@napi-rs/canvas");
const [srcDir, work] = process.argv.slice(2, 4).map((p) => path.resolve(p));
const extra = Number(process.argv[4] || 0);
let first = null;
fs.mkdirSync(work, { recursive: true });

function py(fn, params) {
  const r = spawnSync(path.join(ROOT, "py", ".venv", "Scripts", "python.exe"), ["-m", "legalleaves.engine_cli"], {
    cwd: path.join(ROOT, "py"), input: JSON.stringify({ fn, params }), encoding: "utf-8" });
  const out = JSON.parse(r.stdout);
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

let allOk = true;
for (const name of fs.readdirSync(srcDir).filter((n) => n.endsWith(".jpg")).sort()) {
  const dest = path.join(work, name.replace(/\.jpg$/, ".pdf"));
  py("stampEvidence", { srcPath: path.join(srcDir, name), destPath: dest, evidenceNumber: "甲020",
    stamps: [{ page: 1, draw_label: true, rotate_degrees: extra }] });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(dest)) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 0.5 });
  const c = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let rx = 0, ry = 0, rn = 0, bx = 0, by = 0, bn = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const k = (y * c.width + x) * 4;
    if (d[k] > 150 && d[k + 1] < 60 && d[k + 2] < 60 && y > 80) { rx += x; ry += y; rn++; } // 赤（上端の番号の文字は除く）
    if (d[k] < 60 && d[k + 1] < 120 && d[k + 2] > 150) { bx += x; by += y; bn++; }        // 青
  }
  const portrait = vp.height > vp.width;
  const redTop = rn && bn && ry / rn < by / bn;
  const blueLeft = rn && bn && bx / bn < rx / rn;
  const sig = `${portrait}/${!!redTop}/${!!blueLeft}`;
  if (first === null) first = sig;
  const ok = extra ? sig === first : portrait && redTop && blueLeft;
  allOk = allOk && ok;
  console.log(`${ok ? "OK" : "NG"}  ${name}  用紙=${portrait ? "縦" : "横"} 赤が上=${!!redTop} 青が左=${!!blueLeft}`);
}
console.log(extra ? (allOk ? `追加の${extra}度回転は8枚とも同じ向きになった` : "向きがそろわないものがある") : (allOk ? "すべて正立" : "正立していないものがある"));
