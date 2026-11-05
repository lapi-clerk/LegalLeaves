// 出力の中核＝証拠番号スタンプが「正しい文字で・正しい位置に」入るかのテスト。
//
// このアプリの一番の価値はここなので、文字列の生成だけでなく、
// **出力PDFから実際にテキストを抽出して位置まで**確かめる（PDF.jsで読む）。
// 位置の基準はFB-6の実測: mints提出後、各ファイルの1ページ目の上端8〜19mmに
// 裁判所のタイムスタンプ帯が付く。証拠番号はその帯より下に来ていなければならない。
//
// 実行: node test/stamp-output.test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");
const { PDFDocument, PDFName, StandardFonts, rgb } = require("pdf-lib");
const { stampEvidence, mergeAndStamp } = require("./helpers/engine");
const { section, check, report } = require("./helpers/assert");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "legalleaves-stamp-"));
const MM = 72 / 25.4;
const A4 = [595.28, 841.89];

// 中身のある元PDFを作る（空ページだと pdf-lib が結合を拒む）
async function makeSrc(name, pages = 1, size = A4) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage(size).drawRectangle({ x: 30, y: 30, width: 80, height: 40, color: rgb(0.85, 0.85, 0.85) });
  }
  const p = path.join(TMP, name);
  fs.writeFileSync(p, await doc.save());
  return p;
}

// 出力PDFの各ページからテキストと位置を取り出す（PDF.jsの座標は左下原点）
async function readText(pdfPath) {
  const req = createRequire(path.join(__dirname, "..", "package.json"));
  const pdfjs = req("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: false });
  const doc = await task.promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    // getTextContent の transform は「回転前」のPDF座標系。用紙サイズも回転前で取り、
    // /Rotate を自分で当てて「見た目の上端からの距離」を出す（混ぜると値が狂う）。
    const raw = page.getViewport({ scale: 1, rotation: 0 });
    const shown = page.getViewport({ scale: 1 });
    const W = raw.width;
    const H = raw.height;
    const rot = ((page.rotate % 360) + 360) % 360;
    // placeLabel の座標変換の逆。見た目の上端から文字のベースラインまでの距離。
    const visualTop = (x, y) => (rot === 90 ? x : rot === 180 ? y : rot === 270 ? W - x : H - y);
    const visualRight = (x, y) => (rot === 90 ? H - y : rot === 180 ? x : rot === 270 ? y : W - x);
    const content = await page.getTextContent();
    const items = content.items.map((it) => {
      const x = it.transform[4];
      const y = it.transform[5];
      return { text: it.str, x, y, topMm: visualTop(x, y) / MM, rightMm: visualRight(x, y) / MM };
    });
    out.push({
      page: n, rotate: rot,
      width: shown.width, height: shown.height,   // 見た目の用紙サイズ
      items, all: items.map((i) => i.text).join(""),
    });
  }
  await task.destroy(); // destroy は loadingTask 側（doc には無い）
  return out;
}

(async () => {
  section("単体の証拠にスタンプする");
  const src = await makeSrc("src.pdf");
  const dest = path.join(TMP, "甲001.pdf");
  await stampEvidence({
    srcPath: src, destPath: dest, evidenceNumber: "甲001",
    stamps: [{ page: 1, branch: null, draw_label: true, rotate_degrees: 0,
               position: { x: 0.93, y: 0.07, anchor: "top-right" } }],
  });
  let pages = await readText(dest);
  check("1ページで出力される", pages.length === 1);
  check("「甲第1号証」が入っている", pages[0].all.includes("甲第1号証"), pages[0].all);

  section("位置: 裁判所タイムスタンプ帯（上端8〜19mm）と重ならない");
  const label = pages[0].items.find((i) => i.text.includes("甲第1号証")) || pages[0].items[0];
  check(`帯より下にある（上端から ${label.topMm.toFixed(1)}mm > 19mm）`, label.topMm > 19, String(label.topMm));
  check(`紙からはみ出していない（上端から ${label.topMm.toFixed(1)}mm < 297mm）`, label.topMm < 297);
  check(`右寄せになっている（右端から ${label.rightMm.toFixed(1)}mm < 50mm）`, label.rightMm < 50, String(label.rightMm));

  section("枝番つきの表記");
  const dest2 = path.join(TMP, "甲002-1.pdf");
  await stampEvidence({
    srcPath: src, destPath: dest2, evidenceNumber: "甲002",
    stamps: [{ page: 1, branch: "1", draw_label: true, rotate_degrees: 0,
               position: { x: 0.93, y: 0.07, anchor: "top-right" } }],
  });
  pages = await readText(dest2);
  check("「甲第2号証の1」になる", pages[0].all.includes("甲第2号証の1"), pages[0].all);

  section("刑事の号証（弁・検）も押せる");
  const dest3 = path.join(TMP, "弁003.pdf");
  await stampEvidence({
    srcPath: src, destPath: dest3, evidenceNumber: "弁003",
    stamps: [{ page: 1, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }],
  });
  check("「弁第3号証」が入っている", (await readText(dest3))[0].all.includes("弁第3号証"));

  section("押印しない指定では文字を書かない");
  const dest4 = path.join(TMP, "no-stamp.pdf");
  await stampEvidence({
    srcPath: src, destPath: dest4, evidenceNumber: "甲004",
    stamps: [{ page: 1, draw_label: false, rotate_degrees: 0 }],
  });
  check("号証の文字が入らない", !(await readText(dest4))[0].all.includes("号証"));

  section("複数ファイルの結合（枝番ごとにページを分けて押す）");
  const a = await makeSrc("a.pdf", 2);
  const b = await makeSrc("b.pdf", 1);
  const merged = path.join(TMP, "甲005_1-2.pdf");
  const res = await mergeAndStamp({
    sources: [
      { srcPath: a, stamps: [{ page: 1, branch: "1", draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }] },
      { srcPath: b, stamps: [{ page: 1, branch: "2", draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }] },
    ],
    destPath: merged, evidenceNumber: "甲005",
  });
  pages = await readText(merged);
  check("3ページに結合される（2+1）", pages.length === 3 && res.pageCount === 3, String(pages.length));
  check("1ページ目が「甲第5号証の1」", pages[0].all.includes("甲第5号証の1"), pages[0].all);
  check("2ページ目には押さない（枝番の続き）", !pages[1].all.includes("号証"), pages[1].all);
  check("3ページ目が「甲第5号証の2」", pages[2].all.includes("甲第5号証の2"), pages[2].all);

  section("1つのPDFをページ範囲で枝番に分けて結合する");
  {
    // ページごとに目印の文字（P1〜P5）を入れ、どのページが使われたかを確かめる
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 5; i++) doc.addPage(A4).drawText(`P${i}`, { x: 60, y: 400, size: 20, font });
    const scan = path.join(TMP, "scan5.pdf");
    fs.writeFileSync(scan, await doc.save());
    const stamp = (branch) => [{ page: 1, branch, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }];
    const out = path.join(TMP, "甲008_1～2.pdf");
    const r = await mergeAndStamp({
      destPath: out, evidenceNumber: "甲008",
      sources: [{ srcPath: scan, pages: [1, 3], stamps: stamp("1") }, { srcPath: scan, pages: [4, 5], stamps: stamp("2") }],
    });
    const ps = await readText(out);
    const marks = ps.map((p) => (p.all.match(/P\d/) || [""])[0]).join(",");
    check("5ページがそのままの順で入る", ps.length === 5 && marks === "P1,P2,P3,P4,P5", marks);
    check("1ページ目が「甲第8号証の1」", ps[0].all.includes("甲第8号証の1"), ps[0].all);
    check("2・3ページ目には押さない", !ps[1].all.includes("号証") && !ps[2].all.includes("号証"));
    check("4ページ目が「甲第8号証の2」", ps[3].all.includes("甲第8号証の2"), ps[3].all);
    check("ページ範囲が結果に返る（プレビューの対応付け用）",
      JSON.stringify(r.sources.map((s) => [s.pages, s.startPage, s.pageCount])) === "[[[1,3],1,3],[[4,5],4,2]]");

    const part = path.join(TMP, "part.pdf");
    await mergeAndStamp({ destPath: part, evidenceNumber: "甲009", sources: [{ srcPath: scan, pages: [4, 5], stamps: stamp("2") }] });
    const pp = await readText(part);
    check("範囲の一部だけを切り出せる（4〜5ページ目）", pp.length === 2 && pp[0].all.includes("P4") && pp[1].all.includes("P5"));

    let threw = false;
    try {
      await mergeAndStamp({ destPath: path.join(TMP, "bad.pdf"), evidenceNumber: "甲010", sources: [{ srcPath: scan, pages: [4, 6], stamps: [] }] });
    } catch (_) { threw = true; }
    check("全ページ数を超える範囲はエラーにする（黙って丸めない）", threw && !fs.existsSync(path.join(TMP, "bad.pdf")));
  }

  section("回転しても番号は紙の上部（帯の下）に来る");
  for (const rot of [90, 180, 270]) {
    const d = path.join(TMP, `rot${rot}.pdf`);
    await stampEvidence({
      srcPath: src, destPath: d, evidenceNumber: "甲006",
      stamps: [{ page: 1, draw_label: true, rotate_degrees: rot, position: { x: 0.93, y: 0.07, anchor: "top-right" } }],
    });
    const p = (await readText(d))[0];
    const it = p.items.find((i) => i.text.includes("号証")) || p.items[0];
    check(`${rot}度: 文字が入る`, p.all.includes("甲第6号証"), p.all);
    check(`${rot}度: 見た目の右上に来る（右端から ${it.rightMm.toFixed(1)}mm）`, it.rightMm < 60, String(it.rightMm));
    console.log(`       （参考）${rot}度: 見た目の上端から ${it.topMm.toFixed(1)}mm ` +
                `／見た目の用紙 ${(p.width / MM).toFixed(0)}×${(p.height / MM).toFixed(0)}mm`);
  }

  section("非A4/A3（名刺サイズ）はA4に整えられる");
  const card = await makeSrc("card.pdf", 1, [91 * MM, 55 * MM]); // 名刺 91x55mm
  const cardOut = path.join(TMP, "card-out.pdf");
  await stampEvidence({
    srcPath: card, destPath: cardOut, evidenceNumber: "甲007",
    stamps: [{ page: 1, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }],
  });
  const cp = (await readText(cardOut))[0];
  const wMm = cp.width / MM;
  const hMm = cp.height / MM;
  check(`A4になる（${wMm.toFixed(0)}×${hMm.toFixed(0)}mm）`, Math.abs(wMm - 210) < 3 && Math.abs(hMm - 297) < 3, `${wMm}x${hMm}`);
  check("番号が入っている", cp.all.includes("甲第7号証"), cp.all);

  // 消すと決めた作成者名・XMP（Word が入れる詳細情報）が、出力のどこにも残らないこと。
  // v5.2.1 で保存前の後片付けを「参照をたどる」方式に変えた（大きな PDF で1分以上かかったため）ので確かめる。
  section("消したメタデータが出力に残らない");
  {
    const doc = await PDFDocument.create();
    doc.addPage(A4).drawRectangle({ x: 30, y: 30, width: 80, height: 40, color: rgb(0.85, 0.85, 0.85) });
    doc.setAuthor("MITEIHON_TAROU");
    const xmp = doc.context.stream('<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>MITEIHON_TAROU</dc:creator></x:xmpmeta>',
      { Type: "Metadata", Subtype: "XML" });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));
    const src = path.join(TMP, "meta.pdf");
    fs.writeFileSync(src, await doc.save({ useObjectStreams: false }));
    const has = (p) => fs.readFileSync(p).includes("MITEIHON_TAROU");
    check("元のPDFには名前がある（試験の前提）", has(src), "");
    const cleared = path.join(TMP, "meta-cleared.pdf");
    await stampEvidence({ srcPath: src, destPath: cleared, evidenceNumber: "甲001",
      stamps: [{ page: 1, draw_label: true }], clearMetadataKeys: ["XMP", "Author"] });
    check("削除にした作成者・XMP の名前が残らない", !has(cleared), "");
    check("番号は押されている", (await readText(cleared))[0].all.includes("甲第1号証"), "");
    const kept = path.join(TMP, "meta-kept.pdf");
    await stampEvidence({ srcPath: src, destPath: kept, evidenceNumber: "甲001",
      stamps: [{ page: 1, draw_label: true }], clearMetadataKeys: [] });
    check("維持にしたものは残る", has(kept), "");
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  report();
})();
