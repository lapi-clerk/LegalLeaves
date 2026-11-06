// 出力ファイルが「途中まで書かれた状態」で残らないことのテスト。
// 実行: node test/atomic-write.test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeFileAtomic, copyFileAtomic, stampEvidence } = require("./helpers/engine");
const { PDFDocument } = require("pdf-lib");
const { section, check, report } = require("./helpers/assert");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "legalleaves-atomic-"));
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".part-"));

(async () => {
  section("書き込みの成功時");
  const dest = path.join(TMP, "out.txt");
  const body = "証拠説明書のテスト内容\n".repeat(100);
  writeFileAtomic(dest, body);
  check("内容が正しく書かれる", fs.readFileSync(dest, "utf-8") === body);
  check("一時ファイルが残らない", leftovers(TMP).length === 0, JSON.stringify(leftovers(TMP)));

  section("既存ファイルへの上書き（従来と同じ挙動）");
  writeFileAtomic(dest, "上書き後");
  check("上書きできる", fs.readFileSync(dest, "utf-8") === "上書き後");
  check("一時ファイルが残らない", leftovers(TMP).length === 0);

  section("書き込みの失敗時（提出フォルダに壊れたファイルを残さない）");
  const badDir = path.join(TMP, "存在しないフォルダ");
  const badDest = path.join(badDir, "out.pdf");
  let threw = false;
  try { writeFileAtomic(badDest, "x"); } catch (_) { threw = true; }
  check("エラーになる", threw);
  check("最終的なファイル名は作られない", !fs.existsSync(badDest));
  check("一時ファイルも残らない", leftovers(TMP).length === 0);

  section("コピーの成功・失敗");
  const src = path.join(TMP, "src.bin");
  fs.writeFileSync(src, Buffer.from([1, 2, 3, 4, 5]));
  const copyDest = path.join(TMP, "copied.bin");
  copyFileAtomic(src, copyDest);
  check("内容が一致する", Buffer.compare(fs.readFileSync(copyDest), fs.readFileSync(src)) === 0);
  check("一時ファイルが残らない", leftovers(TMP).length === 0);

  threw = false;
  const missingDest = path.join(TMP, "from-missing.bin");
  try { copyFileAtomic(path.join(TMP, "ない.bin"), missingDest); } catch (_) { threw = true; }
  check("元ファイルが無ければエラー", threw);
  check("コピー先は作られない", !fs.existsSync(missingDest));
  check("一時ファイルも残らない", leftovers(TMP).length === 0);

  section("PDF出力（stampEvidence）が一時ファイルを残さない");
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawRectangle({ x: 20, y: 20, width: 60, height: 60 });
  const pdfSrc = path.join(TMP, "src.pdf");
  fs.writeFileSync(pdfSrc, await doc.save());
  const pdfDest = path.join(TMP, "甲001_テスト.pdf");
  await stampEvidence({
    srcPath: pdfSrc, destPath: pdfDest, evidenceNumber: "甲001",
    stamps: [{ page: 1, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }],
  });
  check("出力PDFが作られる", fs.existsSync(pdfDest) && fs.statSync(pdfDest).size > 0);
  check("PDFとして読み込める（壊れていない）", (await PDFDocument.load(fs.readFileSync(pdfDest))).getPageCount() === 1);
  check("一時ファイルが残らない", leftovers(TMP).length === 0, JSON.stringify(leftovers(TMP)));

  fs.rmSync(TMP, { recursive: true, force: true });
  report();
})();
