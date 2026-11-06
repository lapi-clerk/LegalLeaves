// PDFの能動的コンテンツ（JavaScript・埋め込みファイル・フォーム等）の検出テスト。
//
// 検出できていないと「無い」と誤って伝えることになるので、種類ごとに実物のPDFを組み立てて
// 検出されることを確認する。あわせて、普通のPDFで誤検出しないことも確認する。
//
// 実行: node test/active-content.test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument, PDFName, PDFArray, PDFString, PDFHexString, rgb } = require("pdf-lib");
const engine = require("./helpers/engine");
const { activeContentLabels } = engine;
// Python 版は非同期になるので、判定はいったん結果を待ってから行う
const inspectActiveContent = (doc) => engine.inspectActiveContent(doc);
const { section, check, report } = require("./helpers/assert");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "legalleaves-active-"));

async function base() {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawRectangle({ x: 30, y: 30, width: 80, height: 40, color: rgb(0.85, 0.85, 0.85) });
  return doc;
}

// 作ったPDFを一度保存して読み直す（実ファイルと同じ経路で検出できるか確かめる）
async function roundTrip(doc, name) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, await doc.save());
  return await PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true, updateMetadata: false });
}

(async () => {
  section("普通のPDFでは何も検出しない（誤検出しない）");
  let doc = await roundTrip(await base(), "plain.pdf");
  check("検出ゼロ", (await inspectActiveContent(doc)).length === 0, JSON.stringify((await inspectActiveContent(doc))));

  section("文書レベルのJavaScript");
  doc = await base();
  {
    const ctx = doc.context;
    const js = ctx.obj({ S: "JavaScript", JS: PDFString.of("app.alert('hi');") });
    const nameTree = ctx.obj({ Names: ctx.obj([PDFString.of("A"), ctx.register(js)]) });
    doc.catalog.set(PDFName.of("Names"), ctx.obj({ JavaScript: ctx.register(nameTree) }));
  }
  doc = await roundTrip(doc, "js.pdf");
  check("JavaScriptを検出", (await inspectActiveContent(doc)).includes("javascript"), JSON.stringify((await inspectActiveContent(doc))));

  section("開いたときの自動実行（OpenAction）");
  doc = await base();
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ S: "JavaScript", JS: PDFString.of("x") }));
  doc = await roundTrip(doc, "openaction.pdf");
  check("自動実行を検出", (await inspectActiveContent(doc)).includes("openAction"), JSON.stringify((await inspectActiveContent(doc))));

  section("埋め込みファイル");
  doc = await base();
  {
    const ctx = doc.context;
    const stream = ctx.flateStream(new TextEncoder().encode("secret"));
    const spec = ctx.obj({ Type: "Filespec", F: PDFString.of("memo.txt"), EF: ctx.obj({ F: ctx.register(stream) }) });
    const tree = ctx.obj({ Names: ctx.obj([PDFString.of("memo.txt"), ctx.register(spec)]) });
    doc.catalog.set(PDFName.of("Names"), ctx.obj({ EmbeddedFiles: ctx.register(tree) }));
  }
  doc = await roundTrip(doc, "embedded.pdf");
  check("埋め込みファイルを検出", (await inspectActiveContent(doc)).includes("embeddedFile"), JSON.stringify((await inspectActiveContent(doc))));

  section("入力フォーム（AcroForm）とXFA");
  doc = await base();
  {
    const form = doc.getForm();
    form.createTextField("test.field").addToPage(doc.getPages()[0], { x: 50, y: 700, width: 100, height: 20 });
  }
  doc = await roundTrip(doc, "form.pdf");
  check("入力フォームを検出", (await inspectActiveContent(doc)).includes("form"), JSON.stringify((await inspectActiveContent(doc))));

  doc = await base();
  {
    const ctx = doc.context;
    const xfaStream = ctx.flateStream(new TextEncoder().encode("<xdp/>"));
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: ctx.obj([]), XFA: ctx.register(xfaStream) }));
  }
  doc = await roundTrip(doc, "xfa.pdf");
  check("XFAを検出", (await inspectActiveContent(doc)).includes("xfa"), JSON.stringify((await inspectActiveContent(doc))));

  section("注釈のアクション（外部リンク・起動・送信・添付）");
  const annotCases = [
    ["link", { Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: { S: "URI", URI: PDFString.of("https://example.com") } }],
    ["launch", { Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: { S: "Launch", F: PDFString.of("calc.exe") } }],
    ["submitForm", { Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: { S: "SubmitForm" } }],
    ["embeddedFile", { Type: "Annot", Subtype: "FileAttachment", Rect: [0, 0, 10, 10] }],
    ["javascript", { Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: { S: "JavaScript", JS: PDFString.of("x") } }],
  ];
  for (const [expect, dict] of annotCases) {
    const d = await base();
    const ctx = d.context;
    const annot = ctx.register(ctx.obj(dict));
    d.getPages()[0].node.set(PDFName.of("Annots"), ctx.obj([annot]));
    const loaded = await roundTrip(d, `annot-${expect}.pdf`);
    const got = (await inspectActiveContent(loaded));
    check(`${expect} を検出`, got.includes(expect), JSON.stringify(got));
  }

  section("複数が同時に入っていても全部拾う");
  doc = await base();
  {
    const ctx = doc.context;
    doc.catalog.set(PDFName.of("OpenAction"), ctx.obj({ S: "JavaScript", JS: PDFString.of("x") }));
    const annot = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: { S: "URI", URI: PDFString.of("https://x") } }));
    doc.getPages()[0].node.set(PDFName.of("Annots"), ctx.obj([annot]));
  }
  doc = await roundTrip(doc, "multi.pdf");
  {
    const got = (await inspectActiveContent(doc));
    check("自動実行と外部リンクの両方", got.includes("openAction") && got.includes("link"), JSON.stringify(got));
  }

  section("利用者向けの日本語ラベル");
  const labels = activeContentLabels(["javascript", "embeddedFile"]);
  check("日本語になる", labels[0].includes("JavaScript") && labels[1].includes("埋め込み"), JSON.stringify(labels));
  check("未知の種類はそのまま返す", activeContentLabels(["unknownKind"])[0] === "unknownKind");

  fs.rmSync(TMP, { recursive: true, force: true });
  report();
})();
