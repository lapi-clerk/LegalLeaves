// PDFエンジンの上限・クランプと、白黒スキャン(CCITTFax)変換の正しさのテスト。
//
// fixtures の .g4 は PIL で生成した合成データ（単一ストリップのG4）。個人情報は含まない。
// expected.json に元画像の黒画素数が入っており、復号結果と突き合わせて「正しく復号できている」
// ことまで確認する（変換されたかどうかだけでなく、中身が合っているか）。
//
// 実行: node test/pdf-limits.test.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { PDFDocument, PDFName, PDFRawStream } = require("pdf-lib");
const { transcodeCCITTForPreview, stampEvidence } = require("./helpers/engine");
const { section, check, report } = require("./helpers/assert");

const FIX = path.join(__dirname, "fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected.json"), "utf8"));
const small = fs.readFileSync(path.join(FIX, "ccitt-240x120.g4"));
const big = fs.readFileSync(path.join(FIX, "ccitt-6000x6000.g4"));
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "legalleaves-test-"));

// 指定寸法のCCITT画像を持つPDFを作る（宣言寸法を実データと変えて上限を試せる）
async function buildPdf(images) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (const img of images) {
    const page = doc.addPage([200, 200]);
    const dict = ctx.obj({
      Type: "XObject", Subtype: "Image", Width: img.w, Height: img.h,
      BitsPerComponent: 1, ColorSpace: "DeviceGray", Filter: "CCITTFaxDecode",
      DecodeParms: ctx.obj({ K: -1, Columns: img.w, Rows: img.h }),
    });
    const ref = ctx.register(PDFRawStream.of(dict, new Uint8Array(img.data)));
    page.node.setXObject(PDFName.of("Im0"), ref);
    page.node.set(PDFName.of("Contents"), ctx.register(
      PDFRawStream.of(ctx.obj({}), new TextEncoder().encode("q 200 0 0 200 0 0 cm /Im0 Do Q"))));
  }
  return Buffer.from(await doc.save());
}

// 変換後のPDFから「CCITTのまま」「変換済み」の枚数と、変換済み画像の黒画素数を得る
async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  let ccitt = 0;
  const converted = [];
  for (const page of doc.getPages()) {
    const xo = page.node.Resources().lookup(PDFName.of("XObject"));
    if (!xo || !xo.entries) continue;
    for (const [, ref] of xo.entries()) {
      const s = ctx.lookup(ref);
      const f = s.dict.get(PDFName.of("Filter"));
      const name = f && f.asString ? f.asString() : String(f);
      if (name.includes("CCITT")) { ccitt++; continue; }
      const raw = s.getContents();
      const inflated = zlib.inflateSync(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength));
      let black = 0;
      for (let i = 0; i < inflated.length; i += 3) if (inflated[i] < 128) black++; // DeviceRGB の R
      converted.push({ black, samples: inflated.length / 3 });
    }
  }
  return { ccitt, converted };
}

(async () => {
  section("白黒スキャン(CCITTFax)の変換: 中身が正しく復元される");
  let r = await inspect(await transcodeCCITTForPreview(await buildPdf([{ w: 240, h: 120, data: small }])));
  const exp1 = expected["ccitt-240x120"];
  check("240x120 が変換される", r.converted.length === 1 && r.ccitt === 0);
  check(`画素数が一致（${exp1.width * exp1.height}）`, r.converted[0] && r.converted[0].samples === exp1.width * exp1.height);
  check(`黒画素が元画像と一致（${exp1.blackPixels}）`, r.converted[0] && r.converted[0].black === exp1.blackPixels,
    r.converted[0] && String(r.converted[0].black));
  check("白地の画像が反転されない（反転保険の誤作動なし）", r.converted[0] && r.converted[0].black < r.converted[0].samples / 2);

  section("CCITTが無いPDFは素通し");
  const plain = await PDFDocument.create();
  plain.addPage([200, 200]).drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  const plainBytes = Buffer.from(await plain.save());
  const out = await transcodeCCITTForPreview(plainBytes);
  check("バイト列がそのまま返る", Buffer.compare(Buffer.from(out), plainBytes) === 0);

  section("1画像あたりの総画素上限（メモリ枯渇の防止）");
  r = await inspect(await transcodeCCITTForPreview(await buildPdf([{ w: 20000, h: 20000, data: small }])));
  check("20000x20000（4億画素・RGBAで約1.6GB）は変換しない", r.ccitt === 1 && r.converted.length === 0);
  r = await inspect(await transcodeCCITTForPreview(await buildPdf([{ w: 1e9, h: 1e9, data: small }])));
  check("1e9 x 1e9 も変換しない", r.ccitt === 1 && r.converted.length === 0);

  section("上限内の高解像度スキャンは通す（正当なデータを弾かない）");
  const exp2 = expected["ccitt-6000x6000"];
  const t0 = Date.now();
  r = await inspect(await transcodeCCITTForPreview(await buildPdf([{ w: 6000, h: 6000, data: big }])));
  check(`6000x6000（3600万画素・A4 600dpi相当）が変換される（${Date.now() - t0}ms）`, r.converted.length === 1 && r.ccitt === 0);
  check(`黒画素が元画像と一致（${exp2.blackPixels}）`, r.converted[0] && r.converted[0].black === exp2.blackPixels,
    r.converted[0] && String(r.converted[0].black));

  section("ファイル全体の復号量の上限");
  r = await inspect(await transcodeCCITTForPreview(await buildPdf([
    { w: 6000, h: 6000, data: big }, // 累計 3600万
    { w: 6000, h: 6000, data: big }, // 累計 7200万
    { w: 6000, h: 6000, data: big }, // 残り2800万では足りず打ち切り
  ])));
  check("合計1億画素を超える分は変換せず素通し（2枚変換・1枚素通し）", r.converted.length === 2 && r.ccitt === 1,
    JSON.stringify({ converted: r.converted.length, ccitt: r.ccitt }));

  section("スタンプ値のクランプ（極端な値でも壊れない）");
  const src = await PDFDocument.create();
  src.addPage([595.28, 841.89]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
  const srcPath = path.join(TMP, "src.pdf");
  const destPath = path.join(TMP, "out.pdf");
  fs.writeFileSync(srcPath, await src.save());
  let ok = true;
  let err = "";
  try {
    await stampEvidence({
      srcPath, destPath, evidenceNumber: "甲001",
      stamps: [{ page: 1, draw_label: true, rotate_degrees: 0, font_size_pt: 1e9,
                 label: "あ".repeat(50000), position: { x: 0.9, y: 0.07, anchor: "top-right" } }],
    });
  } catch (e) { ok = false; err = e.message; }
  check("巨大フォントサイズ・5万文字ラベルでも例外なく出力できる", ok, err);
  check("出力ファイルが生成される", ok && fs.existsSync(destPath) && fs.statSync(destPath).size > 0);

  fs.rmSync(TMP, { recursive: true, force: true });
  report();
})();
