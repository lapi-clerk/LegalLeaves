// mints提出後に付く「裁判所のタイムスタンプ帯」の位置を測るツール。
//
//   node tools/measure-timestamp-band.js "提出前.pdf" "提出後.pdf"
//
// 同じファイルの提出前・提出後を見比べ、**後から増えた描画**＝帯を見つけて位置をmmで出す。
// 出力されるのは数値だけで、ファイルの中身や文字は表示も送信もしない。
//
// A4縦の帯は実測済み（上端8〜19mm）。A4横・A3の帯がどこに入るかが未確認なので、
// 実際に提出した方に測ってもらうためのもの。→ docs/timestamp-band-measurement.md
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const MM = 72 / 25.4;
const req = createRequire(path.join(__dirname, "..", "package.json"));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ページを描画して画素を得る（見た目そのもの＝回転も反映される）
async function renderPages(pdfPath, scale) {
  let pdfjs;
  let canvasLib;
  try {
    pdfjs = req("pdfjs-dist/legacy/build/pdf.mjs");
    canvasLib = req("@napi-rs/canvas");
  } catch (e) {
    fail("必要な部品が見つかりません。このフォルダで先に `npm install` を実行してください。");
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale });
    const canvas = canvasLib.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({
      n,
      w: canvas.width,
      h: canvas.height,
      widthPt: vp.width / scale,
      heightPt: vp.height / scale,
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    });
  }
  await task.destroy();
  return pages;
}

// 2枚を比べて「後にだけある描画」の範囲を返す
function diffBox(before, after) {
  if (before.w !== after.w || before.h !== after.h) return null;
  const a = before.data;
  const b = after.data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < after.h; y++) {
    for (let x = 0; x < after.w; x++) {
      const i = (y * after.w + x) * 4;
      // 「前は白っぽく、後は暗い」＝後から足された描画
      const wasLight = a[i] > 200 && a[i + 1] > 200 && a[i + 2] > 200;
      const nowDark = b[i] < 170 || b[i + 1] < 170 || b[i + 2] < 170;
      if (wasLight && nowDark) {
        count++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return count ? { x0, y0, x1, y1, count } : null;
}

function paperName(wMm, hMm) {
  const near = (v, t) => Math.abs(v - t) < 6;
  if (near(wMm, 210) && near(hMm, 297)) return "A4縦";
  if (near(wMm, 297) && near(hMm, 210)) return "A4横";
  if (near(wMm, 297) && near(hMm, 420)) return "A3縦";
  if (near(wMm, 420) && near(hMm, 297)) return "A3横";
  return "その他";
}

(async () => {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.log("使い方: node tools/measure-timestamp-band.js \"提出前.pdf\" \"提出後.pdf\"");
    process.exit(1);
  }
  for (const p of [beforePath, afterPath]) {
    if (!fs.existsSync(p)) fail(`ファイルが見つかりません: ${p}`);
  }

  const SCALE = 150 / 72; // 150dpi相当
  const before = await renderPages(beforePath, SCALE);
  const after = await renderPages(afterPath, SCALE);

  if (before.length !== after.length) {
    console.log(`※ ページ数が違います（提出前 ${before.length} / 提出後 ${after.length}）。`);
    console.log("  同じファイルの提出前・提出後を指定してください。");
  }

  console.log("");
  console.log("=== タイムスタンプ帯の位置（提出前後の差から検出） ===");
  console.log("※ ファイルの中身は表示・送信していません。下の数値だけお知らせください。");
  console.log("");

  const n = Math.min(before.length, after.length);
  let found = 0;
  for (let i = 0; i < n; i++) {
    const bp = before[i];
    const ap = after[i];
    const wMm = ap.widthPt / MM;
    const hMm = ap.heightPt / MM;
    const box = diffBox(bp, ap);
    const head = `${i + 1}ページ目  用紙 ${wMm.toFixed(0)}×${hMm.toFixed(0)}mm（${paperName(wMm, hMm)}）`;
    if (!box) {
      console.log(`${head}  → 差なし（帯は付いていません）`);
      continue;
    }
    found++;
    const pxToMm = (ap.widthPt / ap.w) / MM;
    const top = box.y0 * pxToMm;
    const bottom = box.y1 * pxToMm;
    const left = box.x0 * pxToMm;
    const rightMargin = (ap.w - 1 - box.x1) * pxToMm;
    console.log(head + "  → 差あり");
    console.log(`    上端から帯の上端 : ${top.toFixed(1)} mm`);
    console.log(`    上端から帯の下端 : ${bottom.toFixed(1)} mm`);
    console.log(`    左端から帯の左端 : ${left.toFixed(1)} mm`);
    console.log(`    右端から帯の右端 : ${rightMargin.toFixed(1)} mm`);
    if (top > hMm * 0.5) {
      console.log("    ※ 帯が紙の下半分にあります。ページの向きが前後で違う可能性があります。");
    }
  }
  console.log("");
  console.log(found === 1
    ? "帯が付いたのは1ページ目だけでした（A4縦での実測と同じ挙動）。"
    : `帯（差分）が見つかったページ: ${found}ページ`);
  console.log("");
  console.log("この結果をそのままお知らせください（docs/timestamp-band-measurement.md の報告項目）。");
})();
