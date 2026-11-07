// 外部AIの出力（信頼できない入力）に対する検証のテスト。
//
// src/app.js は「レンダラー用の非モジュール スクリプト」なので require できない。
// そこで vm 上で app.js 本体をそのまま読み込み、DOM/preload を寛容な Proxy でスタブして
// 実際の関数（コピーではない）を取り出して叩く。UIに触れない純粋な関数だけを対象にする。
//
// 実行: node test/validation.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { section, check, report } = require("./helpers/assert");

// どんなプロパティ参照・呼び出しも黙って受け流すスタブ（app.js 末尾の DOM 初期化用）
function permissive(name = "stub") {
  const fn = function () { return permissive(name); };
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => "";
      if (k === "toString") return () => "";
      if (typeof k === "symbol") return undefined;
      if (k === "length") return 0;
      if (k === "value" || k === "textContent" || k === "innerHTML") return "";
      if (k === "hidden" || k === "checked" || k === "disabled") return false;
      if (k === "files" || k === "children") return [];
      return permissive(name + "." + String(k));
    },
    set() { return true; },
    apply() { return permissive(name); },
    has() { return true; },
  });
}

const ctx = {
  console,
  window: permissive("window"),
  document: permissive("document"),
  navigator: { clipboard: permissive("clipboard") },
  localStorage: permissive("localStorage"),
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Number, String, Array, Object, Set, Map, RegExp, Error,
  IntersectionObserver: function () { return permissive("io"); },
  requestAnimationFrame: (f) => f && f(),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  Uint8Array, TextEncoder, TextDecoder, Blob: function () {}, URL: permissive("URL"),
};
ctx.window.api = permissive("api");
ctx.globalThis = ctx;
vm.createContext(ctx);

// index.html が読み込むクラシックスクリプトを「その順に」評価する。
// こうしておくと app.js を複数ファイルへ分割しても、テストが実際の読み込み順を
// そのまま再現するため、順序の誤り（未定義・TDZ）もこのテストで検出できる。
// （type="module" の pdfjs ローダーは対象外＝レンダラー実行時にしか意味がない）
const SRC_DIR = path.join(__dirname, "..", "src");
const html = fs.readFileSync(path.join(SRC_DIR, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
  .map((m) => m[1])
  .filter((attrs) => !/type\s*=\s*["']module["']/.test(attrs))
  .map((attrs) => (attrs.match(/src\s*=\s*["']([^"']+)["']/) || [])[1])
  .filter(Boolean);
if (!scripts.length) {
  console.log("FAIL index.html からスクリプトを読み取れませんでした");
  process.exit(1);
}
console.log("読み込み順:", scripts.join(" → "));
for (const rel of scripts) {
  const file = path.join(SRC_DIR, rel.replace(/^\.\//, ""));
  const code = fs.readFileSync(file, "utf8");
  try {
    vm.runInContext(code, ctx, { filename: path.basename(file) });
  } catch (e) {
    // 末尾の DOM 初期化で落ちても、関数宣言は既にコンテキストへ載っている
    console.log(`(note) ${path.basename(file)} 読み込み時の例外は無視:`, e.message.slice(0, 100));
  }
}

const { checkAiLimits, computeConsistency, listForMessage, parseEvidenceFromFilename, parseEvidenceInput, isCriminalEvidenceNum } = ctx;
// const/let は vm のグローバルオブジェクトに載らない（レキシカル束縛）ので式で取り出す
const AI_LIMITS = vm.runInContext("AI_LIMITS", ctx);
const MAX_EVIDENCE_RANGE_SCAN = vm.runInContext("MAX_EVIDENCE_RANGE_SCAN", ctx);

section("関数が取り出せている");
check("checkAiLimits", typeof checkAiLimits === "function");
check("computeConsistency", typeof computeConsistency === "function");
check("AI_LIMITS", !!AI_LIMITS);

section("AI出力の検証: 正常なデータは通す（誤検知しない）");
check("通常のデータ", checkAiLimits({
  files: [
    { original_file_name: "甲1_契約書.pdf", title: "契約書", evidence_number: "甲001",
      proof_purpose: "本件契約の成立を立証する。".repeat(30),
      stamps: [{ page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }] },
    { original_file_name: "訴状.docx", title: "訴状", evidence_number: null, stamps: [] },
  ],
  warnings: ["確認してください"],
}) === null);
check("300件のファイル", checkAiLimits({ files: Array.from({ length: 300 }, (_, i) => ({ original_file_name: `甲${i}.pdf` })) }) === null);
check("1ファイル200ページ分の押印指示", checkAiLimits({ files: [{ original_file_name: "a.pdf", stamps: Array.from({ length: 200 }, () => ({ page: 1 })) }] }) === null);
check("stamps:[null] は許容（後段で無視される）", checkAiLimits({ files: [{ stamps: [null] }] }) === null);

section("AI出力の検証: 壊れた・極端なデータを弾く");
check("files:[null]（クラッシュ源）", !!checkAiLimits({ files: [null] }));
check("files:[123]", !!checkAiLimits({ files: [123] }));
check("files:[[]]", !!checkAiLimits({ files: [[]] }));
check("ファイル件数の超過", !!checkAiLimits({ files: Array.from({ length: AI_LIMITS.files + 1 }, () => ({})) }));
check("warnings 件数の超過", !!checkAiLimits({ files: [], warnings: Array.from({ length: AI_LIMITS.warnings + 1 }, () => "x") }));
check("押印指示の件数超過", !!checkAiLimits({ files: [{ stamps: Array.from({ length: AI_LIMITS.stamps + 1 }, () => ({ page: 1 })) }] }));
check("巨大なファイル名", !!checkAiLimits({ files: [{ original_file_name: "あ".repeat(AI_LIMITS.name + 1) }] }));
check("巨大な立証趣旨", !!checkAiLimits({ files: [{ proof_purpose: "あ".repeat(AI_LIMITS.text + 1) }] }));
check("stamps が配列でない", !!checkAiLimits({ files: [{ stamps: { page: 1 } }] }));
check("stamps の要素が数値", !!checkAiLimits({ files: [{ stamps: [42] }] }));
check("ページ番号が負", !!checkAiLimits({ files: [{ stamps: [{ page: -5 }] }] }));
check("ページ番号が巨大", !!checkAiLimits({ files: [{ stamps: [{ page: 1e12 }] }] }));
check("ページ番号が文字列", !!checkAiLimits({ files: [{ stamps: [{ page: "1" }] }] }));

section("証拠説明書の番号範囲: 異常な範囲でも固まらない");
const rfs = [{ evidenceNumber: "甲001" }, { evidenceNumber: "甲002" }];
const t0 = Date.now();
const huge = computeConsistency(rfs, { exists: true, first_evidence_number: "甲1", last_evidence_number: "甲999999999" });
const elapsed = Date.now() - t0;
check(`甲1〜甲999999999 が即座に返る（${elapsed}ms・従来は10億回ループ）`, elapsed < 500);
check("「範囲が広すぎる」旨を案内する", !!huge && huge.issues.some((s) => s.includes("広すぎる")));

section("証拠説明書の番号範囲: 通常の動作は変わらない（回帰）");
const normal = computeConsistency(rfs, { exists: true, first_evidence_number: "甲1", last_evidence_number: "甲004" });
check("甲1〜甲4 で 甲003・甲004 の不足を検出", !!normal && normal.issues.some((s) => s.includes("甲003") && s.includes("甲004")));
check("過不足なしなら指摘ゼロ", (() => {
  const r = computeConsistency(rfs, { exists: true, first_evidence_number: "甲1", last_evidence_number: "甲2" });
  return !!r && r.issues.length === 0;
})());
check(`上限ちょうど(${MAX_EVIDENCE_RANGE_SCAN})は走査する`, (() => {
  const r = computeConsistency(rfs, { exists: true, first_evidence_number: "甲1", last_evidence_number: "甲" + MAX_EVIDENCE_RANGE_SCAN });
  return !!r && !r.issues.some((s) => s.includes("広すぎる"));
})());

section("長い一覧の丸め");
check("50件までは全部並べる", listForMessage(Array.from({ length: 50 }, (_, i) => "甲" + i)).includes("甲49"));
check("超過分は「…ほかN件」", listForMessage(Array.from({ length: 120 }, (_, i) => "甲" + i)).includes("…ほか70件"));

section("刑事の号証（弁・検）は枝番を使わない");
check("弁3-1.pdf → 枝番なし", parseEvidenceFromFilename("弁3-1.pdf").branch === null);
check("検2-3.pdf → 枝番なし", parseEvidenceFromFilename("検2-3.pdf").branch === null);
check("甲3の1.pdf → 枝番1（民事は従来どおり）", parseEvidenceFromFilename("甲3の1.pdf").branch === "1");
check("乙12-2.pdf → 枝番2（民事は従来どおり）", parseEvidenceFromFilename("乙12-2.pdf").branch === "2");
check("手入力 弁3-1 → 枝番を取らない", parseEvidenceInput("弁3-1").branch === null);
check("手入力 甲3-1 → 枝番1", parseEvidenceInput("甲3-1").branch === "1");
check("刑事判定: 弁/検=true, 甲/乙/甲A=false",
  isCriminalEvidenceNum("弁003") && isCriminalEvidenceNum("検002") &&
  !isCriminalEvidenceNum("甲003") && !isCriminalEvidenceNum("乙001") && !isCriminalEvidenceNum("甲A003"));

section("読み込んだファイル情報の取り込み（経路が分かれても項目が欠けない）");
const merged = ctx.mergeMetaResult(
  { path: "C:/x/a.pdf", name: "a.pdf" },
  { path: "C:/x/a.pdf", fields: [{ key: "Title", value: "t" }], officeMeta: { removePersonalInfo: false },
    activeContent: ["JavaScript"], overA3: { wmm: 594, hmm: 420 } });
check("メタデータ項目", Array.isArray(merged.metaFields) && merged.metaFields.length === 1);
check("Wordの個人情報フラグ", !!merged.officeMeta);
check("能動的コンテンツ", Array.isArray(merged.activeContent));
check("A3超の寸法", !!merged.overA3 && merged.overA3.wmm === 594);
check("結果が無ければ元のまま", ctx.mergeMetaResult({ name: "a" }, undefined).name === "a");
check("PDFのページ数（ページで枝番に分ける）", ctx.mergeMetaResult({ name: "a" }, { pageCount: 7 }).pageCount === 7);

section("1つのPDFをページ範囲で枝番に分ける: 範囲の読み取り");
{
  const { parsePageRanges, pageRangesFromStamps, stampsForPageRange } = ctx;
  const ok = (t, n) => JSON.stringify(parsePageRanges(t, n).ranges);
  check("1-3, 4-5（全5ページ）", ok("1-3, 4-5", 5) === "[[1,3],[4,5]]");
  check("全角・〜・読点も読める", ok("１〜３、４～５", 5) === "[[1,3],[4,5]]");
  check("1ページだけの枝番", ok("1-2, 3, 4-5", 5) === "[[1,2],[3,3],[4,5]]");
  check("ページ数が不明でも読める", ok("1-3, 4-9", null) === "[[1,3],[4,9]]");
  check("2つ未満は不可", !!parsePageRanges("1-5", 5).error);
  check("1ページ目から始まらないと不可", !!parsePageRanges("2-3, 4-5", 5).error);
  check("抜けがあると不可（3ページ目が無い）", !!parsePageRanges("1-2, 4-5", 5).error);
  check("重なりがあると不可", !!parsePageRanges("1-3, 3-5", 5).error);
  check("最後のページまで含めないと不可", !!parsePageRanges("1-2, 3-4", 5).error);
  check("全ページ数を超えると不可", !!parsePageRanges("1-3, 4-6", 5).error);
  check("逆順の範囲は不可", !!parsePageRanges("3-1, 4-5", 5).error);
  check("読めない文字は不可", !!parsePageRanges("1-3, あ", 5).error);

  const st = (page, branch, draw = true) => ({ page, branch, draw_label: draw, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } });
  check("AIのページごとの枝番から初期値を作る",
    pageRangesFromStamps({ pageCount: 5, stamps: [st(1, "1"), st(4, "2")] }) === "1-3, 4-5");
  check("枝番が1種類なら初期値なし", pageRangesFromStamps({ pageCount: 5, stamps: [st(1, "1")] }) === "");

  const local = stampsForPageRange([st(1, "1"), st(4, "2"), { ...st(5, "2", false), rotate_degrees: 90 }], 4, 5, "2", true);
  check("範囲内のスタンプだけを、範囲内のページ番号へ付け替える",
    local.length === 2 && local[0].page === 1 && local[1].page === 2 && local[1].rotate_degrees === 90);
  check("番号は先頭ページだけに押す", local[0].draw_label === true && local[1].draw_label === false);
  const noStamp = stampsForPageRange([st(1, "1")], 2, 3, "2", true);
  check("先頭ページにスタンプが無ければ既定の位置に足す", noStamp.length === 1 && noStamp[0].page === 1 && noStamp[0].branch === "2");
  const mid = stampsForPageRange([st(3, "1")], 1, 3, "1", true);
  check("途中のページの番号は回転だけにする（同じ枝番を2回押さない）",
    mid.find((s) => s.page === 3).draw_label === false && mid.find((s) => s.page === 1).draw_label === true);
  check("押印しない指定のファイルには番号を足さない", stampsForPageRange([st(1, null, false)], 1, 2, "1", false).every((s) => s.draw_label === false));
}

section("1つのPDFをページ範囲で枝番に分ける: 分割・出力プラン・元に戻す");
{
  vm.runInContext("renderReview = function () {}", ctx); // 画面描画は対象外
  const S = vm.runInContext("state", ctx);
  const st = (page, branch) => ({ page, branch, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } });
  const mk = (over) => ({ path: "C:/x/scan.pdf", name: "scan.pdf", kind: "証拠", docName: "請求書と領収書", suggested: "", metadata: [],
    evidenceNumber: "甲003", branchRange: null, pageCount: 5, stamps: [st(1, null)], ...over });
  S.renameOnly = false;
  S.mergeDisabled = new Set();
  S.placeholders = [];
  S.reviewFiles = [
    mk({ path: "C:/x/a.pdf", name: "a.pdf", evidenceNumber: "甲002", pageCount: 1 }),
    mk({}),
    mk({ path: "C:/x/b.pdf", name: "b.pdf", evidenceNumber: "甲004", pageCount: 1 }),
  ];
  check("2ページ以上のPDFは分けられる", ctx.canSplitByPages(S.reviewFiles[1]));
  check("1ページのPDFは分けられない", !ctx.canSplitByPages(S.reviewFiles[0]));
  ctx.splitByPages(1, [[1, 3], [4, 5]]);
  const pieces = S.reviewFiles.filter((r) => r.path === "C:/x/scan.pdf");
  check("2つの枝番になる", pieces.length === 2 && S.reviewFiles.length === 4);
  check("甲003の1＝1〜3ページ目", pieces[0].branchRange === "1" && JSON.stringify(pieces[0].pageRange) === "[1,3]");
  check("甲003の2＝4〜5ページ目", pieces[1].branchRange === "2" && JSON.stringify(pieces[1].pageRange) === "[4,5]");
  check("それぞれ先頭ページに自分の枝番を押す",
    pieces.every((p) => p.stamps[0].page === 1 && p.stamps[0].draw_label !== false && p.stamps[0].branch === p.branchRange));
  check("ファイル名に枝番が入る", /^甲003_1_/.test(pieces[0].suggested) && /^甲003_2_/.test(pieces[1].suggested));
  const plan = ctx.buildOutputPlan();
  const out3 = plan.find((o) => o.evidenceNumber === "甲003");
  check("出力では1つの号証PDFに結合する", !!out3 && out3.sources.length === 2);
  check("出力の各ソースにページ範囲が付く",
    JSON.stringify(out3.sources.map((s) => s.pages)) === "[[1,3],[4,5]]" && out3.sources.every((s) => s.srcPath === "C:/x/scan.pdf"));
  check("結合後のファイル名は 甲003_1～2_…", /^甲003_1～2_/.test(out3.destName), out3.destName);
  check("ほかの号証には影響しない", plan.find((o) => o.evidenceNumber === "甲002").sources[0].pages === null);

  S.selectedReview = S.reviewFiles.indexOf(pieces[1]);
  ctx.unsplitPages();
  const back = S.reviewFiles.filter((r) => r.path === "C:/x/scan.pdf");
  check("元に戻すと1つのファイルになる", back.length === 1 && S.reviewFiles.length === 3 && back[0].pageRange == null);
  check("元に戻すと枝番なしへ戻る", back[0].branchRange == null && back[0].stamps.filter((s) => s.draw_label !== false).length === 1);

  // すでに枝番付き（甲003の2）のPDFを分けると、後ろの枝番は繰り下がる
  S.reviewFiles = [
    mk({ path: "C:/x/c1.pdf", name: "c1.pdf", branchRange: "1", pageCount: 1, stamps: [st(1, "1")] }),
    mk({ branchRange: "2", stamps: [st(1, "2")] }),
    mk({ path: "C:/x/c3.pdf", name: "c3.pdf", branchRange: "3", pageCount: 1, stamps: [st(1, "3")] }),
  ];
  ctx.splitByPages(1, [[1, 2], [3, 5]]);
  const brs = S.reviewFiles.map((r) => `${r.name}:${r.branchRange}`).join(",");
  check("の2を2つに分けると の2・の3、元の の3 は の4 へ", brs === "c1.pdf:1,scan.pdf:2,scan.pdf:3,c3.pdf:4", brs);
  S.selectedReview = 1;
  ctx.unsplitPages();
  const brs2 = S.reviewFiles.map((r) => `${r.name}:${r.branchRange}`).join(",");
  check("元に戻すと枝番も詰め直す", brs2 === "c1.pdf:1,scan.pdf:2,c3.pdf:3", brs2);

  // AIが1ファイルに枝番の範囲（"1～2"）を入れ、ページごとに枝番を割り当てた場合
  S.reviewFiles = [
    mk({ branchRange: "1～2", stamps: [st(1, "1"), st(4, "2")] }),
    mk({ path: "C:/x/d.pdf", name: "d.pdf", branchRange: "3", pageCount: 1, stamps: [st(1, "3")] }),
  ];
  check("枝番の範囲は先頭の数字で並べる（1～2 → 1、全角２ → 2）", ctx.branchSortKey("1～2") === 1 && ctx.branchSortKey("２") === 2 && ctx.branchSortKey(null) === 0);
  check("入力欄の下書きは 1-3, 4-5", ctx.pageRangesFromStamps(S.reviewFiles[0]) === "1-3, 4-5");
  ctx.splitByPages(0, [[1, 3], [4, 5]]);
  const brs3 = S.reviewFiles.map((r) => `${r.name}:${r.branchRange}`).join(",");
  check("範囲 1～2 のファイルを2つに分けると の1・の2（後ろの の3 は動かない）", brs3 === "scan.pdf:1,scan.pdf:2,d.pdf:3", brs3);
  check("それぞれの先頭ページにだけ番号を押す",
    S.reviewFiles.slice(0, 2).every((p) => p.stamps.filter((s) => s.draw_label !== false).length === 1 && p.stamps[0].page === 1));
}

section("照合で問題がなければ、照合画面を飛ばして確認画面へ進む");
{
  const S = vm.runInContext("state", ctx);
  vm.runInContext("goStep = function (s) { state.step = s; }", ctx); // 画面描画は対象外
  const reset = () => {
    S.reviewFiles = [{ name: "甲1.pdf", matched: true }, { name: "準備書面.pdf", matched: true }];
    S.orphanEntries = [];
    S.consistency = { issues: [] };
    S.aiWarnings = [];
    S.renameOnly = false;
    S.aiText = "{}";
    S.maxReachedIndex = 0;
  };
  const go = () => { ctx.enterMatchOrReview(); return S.step; };
  reset();
  check("すべて対応していれば確認画面へ直行", go() === "review" && S.matchSkipped === true);
  check("飛ばしても「照合」は済み扱い（上の段から戻れる）", S.maxReachedIndex >= 2);
  reset(); S.reviewFiles[0].matched = false;
  check("AIデータに無いファイルがあれば照合で止まる", go() === "match" && S.matchSkipped === false);
  reset(); S.orphanEntries = [{ original_file_name: "甲2.pdf" }];
  check("読み込み忘れがあれば照合で止まる", go() === "match");
  reset(); S.consistency = { issues: [{ kind: "missing" }] };
  check("証拠説明書との食い違いがあれば照合で止まる", go() === "match");
  reset(); S.aiWarnings = ["原告側なのに乙になっています"];
  check("AIの注意・記号ずれがあれば照合で止まる", go() === "match");
  reset(); S.reviewFiles[0].needsConfirmation = true;
  check("「要確認」のファイルだけなら確認画面へ（確認画面で1件ずつ対応する）", go() === "review");
  reset(); S.renameOnly = true; S.aiText = ""; S.reviewFiles.forEach((r) => { r.matched = false; });
  check("リネームのみ・AIデータなしは従来どおり確認画面へ", go() === "review");
}

section("AIを使わずに進む: ファイル名から標目を取り出す");
{
  const t = ctx.titleFromFilename;
  check("甲1の2_領収書.pdf → 領収書", t("甲1の2_領収書.pdf") === "領収書", t("甲1の2_領収書.pdf"));
  check("乙12-2 LINE.pdf → LINE", t("乙12-2 LINE.pdf") === "LINE", t("乙12-2 LINE.pdf"));
  check("甲００５・写真.jpg（全角数字）→ 写真", t("甲００５・写真.jpg") === "写真", t("甲００５・写真.jpg"));
  check("甲A3_図面.pdf（系列記号）→ 図面", t("甲A3_図面.pdf") === "図面", t("甲A3_図面.pdf"));
  check("番号だけ（甲3.pdf）なら名前のまま", t("甲3.pdf") === "甲3", t("甲3.pdf"));
  check("番号なし（準備書面.pdf）なら名前のまま", t("準備書面.pdf") === "準備書面", t("準備書面.pdf"));
}

section("証拠番号を書き換えたら、提出用ファイル名と空き枠が追従する");
{
  const S = vm.runInContext("state", ctx);
  const mk = (num, name, title) => ({ path: "C:/x/" + name, name, kind: "証拠", docName: title, evidenceNumber: num,
    branchRange: null, suggested: `${num}_${title}.pdf`, stamps: [], metadata: [] });
  S.renameOnly = false;
  S.placeholders = [];
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), mk("甲002", "b.pdf", "請求書"), mk("甲003", "c.pdf", "LINE")];
  // 甲003 → 甲004（実機確認の画面の例: 甲003 を空けて、あとで別の証拠を入れる）
  let rf = S.reviewFiles[2];
  rf.evidenceNumber = "甲004";
  ctx.afterEvidenceNumberEdited(rf, "甲003", null);
  check("ファイル名の番号が変わる（甲003_LINE → 甲004_LINE）", rf.suggested === "甲004_LINE.pdf", rf.suggested);
  check("空いた甲003が空き枠になる（挿入したときと同じ表示）",
    S.placeholders.length === 1 && S.placeholders[0].num === "甲003", JSON.stringify(S.placeholders));
  // 甲004 → 甲003 に戻すと、空き枠は埋まって消え、空いた甲004（いちばん後ろ）は空き枠にしない
  rf.evidenceNumber = "甲003";
  ctx.afterEvidenceNumberEdited(rf, "甲004", null);
  check("空いた番号に戻すと空き枠は消える／末尾が空いても空き枠にしない（打ち間違いの訂正）",
    S.placeholders.length === 0 && rf.suggested === "甲003_LINE.pdf", JSON.stringify(S.placeholders) + " " + rf.suggested);
  // 甲002 → 甲005（間を飛ばす）: 甲002 が空き枠になる
  rf = S.reviewFiles[1];
  rf.evidenceNumber = "甲005";
  ctx.afterEvidenceNumberEdited(rf, "甲002", null);
  check("途中が空いたら空き枠（甲002）を作る", S.placeholders.length === 1 && S.placeholders[0].num === "甲002", JSON.stringify(S.placeholders));
  rf.evidenceNumber = "甲002";
  ctx.afterEvidenceNumberEdited(rf, "甲005", null);
  check("甲002に戻すと空き枠は消える", S.placeholders.length === 0, JSON.stringify(S.placeholders));
  // 枝番を付ける（甲002 → 甲002の2）
  rf.branchRange = "2";
  ctx.afterEvidenceNumberEdited(rf, "甲002", null);
  check("枝番を付けるとファイル名にも入る（甲002_2_請求書）", rf.suggested === "甲002_2_請求書.pdf", rf.suggested);
  // 手で付けた名前（先頭が番号でない）は触らない
  rf.suggested = "請求書（差し替え版）.pdf";
  rf.evidenceNumber = "甲006";
  ctx.afterEvidenceNumberEdited(rf, "甲002", "2");
  check("手で付けたファイル名はそのまま", rf.suggested === "請求書（差し替え版）.pdf", rf.suggested);
  S.placeholders = [];

  // 後から追加する甲1の2だけを読み込んだとき、ほかを外しても の2 は外れない
  S.reviewFiles = [Object.assign(mk("甲001", "甲1の2_領収書.pdf", "領収書"), { branchRange: "2", suggested: "甲001_2_領収書.pdf" })];
  ctx.normalizeBranches();
  check("単独の「の2」は枝番を外さない（追加分の甲1の2）", S.reviewFiles[0].branchRange === "2", S.reviewFiles[0].branchRange);
  S.reviewFiles = [Object.assign(mk("甲003", "c.pdf", "LINE"), { branchRange: "1", suggested: "甲003_1_LINE.pdf" })];
  ctx.normalizeBranches();
  check("単独の「の1」は従来どおり枝番を外す（甲3の2を外した後の甲3の1）", S.reviewFiles[0].branchRange === null, S.reviewFiles[0].branchRange);
}

section("出力前チェック（番号とファイル名の食い違い）と、保存される名前");
{
  const S = vm.runInContext("state", ctx);
  const mk = (num, name, title, branch = null) => ({ path: "C:/x/" + name, name, kind: "証拠", docName: title, evidenceNumber: num,
    branchRange: branch, suggested: `${num}${branch ? "_" + branch : ""}_${title}.pdf`, stamps: [], metadata: [] });
  S.renameOnly = false;
  S.placeholders = [];
  S.mergeDisabled = new Set();
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), mk("甲002", "b.pdf", "請求書")];
  check("食い違いが無ければ空", ctx.computeOutputIssues().length === 0, JSON.stringify(ctx.computeOutputIssues()));

  // 提出用ファイル名の欄を手で直したら、その名前で保存される（番号と名前から作り直さない）
  S.reviewFiles[1].suggested = "甲002_請求書（再発行）.pdf";
  const plan = ctx.buildOutputPlan();
  check("1ファイルの号証は欄の名前で保存される", plan.some((o) => o.destName === "甲002_請求書（再発行）.pdf"), JSON.stringify(plan.map((o) => o.destName)));
  S.reviewFiles[1].suggested = "甲002_請求書";
  check("拡張子が無ければ .pdf を付ける", ctx.buildOutputPlan().some((o) => o.destName === "甲002_請求書.pdf"), "");

  // 欄の番号と押す番号が違う（甲003_… に甲第4号証が押される）
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), Object.assign(mk("甲004", "c.pdf", "LINE"), { suggested: "甲003_LINE.pdf" })];
  let iss = ctx.computeOutputIssues();
  check("ファイル名の番号と押す番号の食い違いを見つける", iss.length === 1 && iss[0].index === 1 && /甲第4号証/.test(iss[0].text), JSON.stringify(iss));
  S.reviewFiles[1].suggested = "LINE.pdf";
  iss = ctx.computeOutputIssues();
  check("番号で始まらない名前も知らせる", iss.length === 1 && /始まっていません/.test(iss[0].text), JSON.stringify(iss));

  // 枝番: 重なり・混在・飛び
  S.reviewFiles = [mk("甲005", "d1.pdf", "写真", "1"), mk("甲005", "d2.pdf", "写真", "1")];
  iss = ctx.computeOutputIssues();
  check("枝番の重なり（甲5の1が2つ）", iss.some((x) => /甲5の1 が2つ/.test(x.text)), JSON.stringify(iss));
  S.reviewFiles = [mk("甲005", "d1.pdf", "写真", "1"), mk("甲005", "d2.pdf", "写真")];
  iss = ctx.computeOutputIssues();
  check("枝番のあり／なしの混在", iss.some((x) => /混ざっています/.test(x.text)), JSON.stringify(iss));
  S.reviewFiles = [mk("甲005", "d1.pdf", "写真", "1"), mk("甲005", "d3.pdf", "写真", "3")];
  iss = ctx.computeOutputIssues();
  check("枝番の飛び（甲5の2が無い）", iss.length === 1 && /甲5の2 がありません/.test(iss[0].text), JSON.stringify(iss));
  S.placeholders = [{ num: "甲005", branch: "2" }];
  check("空き枠で取ってある枝番は飛びとしない", ctx.computeOutputIssues().length === 0, JSON.stringify(ctx.computeOutputIssues()));
  S.placeholders = [];

  // 番号の無い証拠・同じ名前が2つ
  S.reviewFiles = [Object.assign(mk("", "e.pdf", "メモ"), { evidenceNumber: null, suggested: "メモ.pdf" })];
  iss = ctx.computeOutputIssues();
  check("番号の無い証拠を知らせる", iss.length === 1 && /証拠番号がありません/.test(iss[0].text), JSON.stringify(iss));
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), Object.assign(mk("甲002", "b.pdf", "請求書"), { suggested: "甲001_契約書.pdf" })];
  iss = ctx.computeOutputIssues();
  check("同じ名前のファイルが2つできることを知らせる", iss.some((x) => /同じ名前のファイル/.test(x.text)), JSON.stringify(iss));

  S.renameOnly = true;
  check("リネームのみのときは調べない", ctx.computeOutputIssues().length === 0, "");
  S.renameOnly = false;
  S.reviewFiles = [];
}

section("ファイル名の番号と証拠番号を、ボタンで片方に合わせる");
{
  const S = vm.runInContext("state", ctx);
  const mk = (num, name, title, branch = null) => ({ path: "C:/x/" + name, name, kind: "証拠", docName: title, evidenceNumber: num,
    branchRange: branch, suggested: `${num}${branch ? "_" + branch : ""}_${title}.pdf`, stamps: [{ page: 1, branch, draw_label: true }], metadata: [] });
  S.renameOnly = false;
  S.placeholders = [];
  S.mergeDisabled = new Set();
  const nf = (n) => JSON.stringify(ctx.numberFromSuggested(n));

  // 読み取り: アプリの形（甲003_2_）と人の形（甲3の2_・甲3-2）。標目が数字で始まっても枝番と読まない
  check("甲003_2_領収書.pdf → 甲003 の2", ctx.numberFromSuggested("甲003_2_領収書.pdf").branch === "2", nf("甲003_2_領収書.pdf"));
  check("甲3の2_領収書.pdf → 甲003 の2", ctx.numberFromSuggested("甲3の2_領収書.pdf").num === "甲003", nf("甲3の2_領収書.pdf"));
  check("甲003_2024年契約書.pdf は枝番なし", ctx.numberFromSuggested("甲003_2024年契約書.pdf").branch === null, nf("甲003_2024年契約書.pdf"));

  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), Object.assign(mk("甲004", "c.pdf", "写真"), { suggested: "甲003_写真.pdf" })];
  let rf = S.reviewFiles[1];
  check("食い違いを見つける（甲3 と 甲4）", ctx.filenameNumberMismatch(rf).file.num === "甲003", JSON.stringify(ctx.filenameNumberMismatch(rf)));
  check("同じ番号の書き方違い（甲4_写真）は食い違いにしない",
    ctx.filenameNumberMismatch(Object.assign({}, rf, { suggested: "甲4_写真.pdf" })) === null, "");

  // ① 証拠番号をファイル名に合わせる
  ctx.applyNumFix(rf, "number");
  check("証拠番号が甲003になる", rf.evidenceNumber === "甲003", rf.evidenceNumber);
  check("ファイル名はそのまま", rf.suggested === "甲003_写真.pdf", rf.suggested);
  check("いちばん後ろの番号を下げただけなので空き枠は作らない（番号を書き換えたときと同じ）",
    S.placeholders.length === 0, JSON.stringify(S.placeholders));
  check("食い違いが消える", ctx.computeOutputIssues().length === 0, JSON.stringify(ctx.computeOutputIssues()));
  S.placeholders = [];

  // ② ファイル名を証拠番号に合わせる（標目の部分は残す）
  rf = Object.assign(mk("甲004", "c.pdf", "写真"), { suggested: "甲3の2_現場写真（拡大）.pdf" });
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), rf];
  ctx.applyNumFix(rf, "name");
  check("ファイル名の番号だけ変わる（甲004_現場写真（拡大））", rf.suggested === "甲004_現場写真（拡大）.pdf", rf.suggested);
  rf.suggested = "現場写真.pdf";
  check("番号の無い名前は「始まっていない」", ctx.filenameNumberMismatch(rf).kind === "missing", "");
  ctx.applyNumFix(rf, "name");
  check("番号の無い名前には番号を前に付ける", rf.suggested === "甲004_現場写真.pdf", rf.suggested);
  rf.branchRange = "2";
  ctx.applyNumFix(rf, "name");
  check("枝番も入る（甲004_2_現場写真）", rf.suggested === "甲004_2_現場写真.pdf", rf.suggested);

  // 証拠番号を「甲0」にして確定しても、ファイル名は追従しない（甲000_ にしない）
  rf = mk("甲004", "c.pdf", "写真");
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), rf];
  rf.evidenceNumber = "甲000";
  ctx.afterEvidenceNumberEdited(rf, "甲004", null);
  check("正しくない番号にはファイル名を追従させない", rf.suggested === "甲004_写真.pdf", rf.suggested);

  // 甲004 → 甲000 → 甲004（5.2.4 の試用）: 空き枠（甲004・甲000）を作らない
  {
    const a = mk("甲004", "d.pdf", "写真");
    S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), a, mk("甲005", "e.pdf", "LINE")];
    S.placeholders = [];
    a.evidenceNumber = "甲000";
    ctx.afterEvidenceNumberEdited(a, "甲004", null);
    check("正しくない番号にしても、元の番号（甲004）を空き枠にしない", S.placeholders.length === 0, JSON.stringify(S.placeholders));
    a.evidenceNumber = "甲004";
    ctx.afterEvidenceNumberEdited(a, "甲000", null);
    check("戻しても「甲000」の空き枠を作らない", S.placeholders.length === 0, JSON.stringify(S.placeholders));
    a.evidenceNumber = "甲000";
    check("一覧の印: 正しくない番号は「要修正」（ファイル名に正しい番号があるので）", ctx.numMarkFor(a) === "warn", String(ctx.numMarkFor(a)));
    a.suggested = "";
    check("一覧の印: 両方とも正しくなければ「エラー」", ctx.numMarkFor(a) === "error", String(ctx.numMarkFor(a)));
  }

  // 片方が番号として正しくないときは、正しいほうに合わせるボタンだけ
  const kind = (x) => (ctx.filenameNumberMismatch(x) || {}).kind || null;
  const labels = (x) => ctx.numFixLabels(x);
  rf = Object.assign(mk("甲0", "c.pdf", "写真"), { suggested: "甲004_現場写真.pdf" });
  S.reviewFiles = [mk("甲001", "a.pdf", "契約書"), rf];
  check("証拠番号「甲0」・ファイル名は甲4 → 証拠番号を合わせるボタンだけ",
    kind(rf) === "badNumber" && !!labels(rf).number && labels(rf).name === null, JSON.stringify(labels(rf)));
  check("ファイル名に合わせる処理は動かない（甲000で始めない）", !ctx.applyNumFix(rf, "name") && rf.suggested === "甲004_現場写真.pdf", rf.suggested);
  ctx.applyNumFix(rf, "number");
  check("証拠番号が甲004になる", rf.evidenceNumber === "甲004" && kind(rf) === null, rf.evidenceNumber);
  rf.suggested = "甲000_現場写真.pdf";
  check("ファイル名が甲000・証拠番号は正しい → ファイル名を合わせるボタンだけ",
    kind(rf) === "missing" && labels(rf).number === null && !!labels(rf).name, JSON.stringify(labels(rf)));
  ctx.applyNumFix(rf, "name");
  check("ファイル名が甲004_現場写真になる", rf.suggested === "甲004_現場写真.pdf", rf.suggested);
  rf.evidenceNumber = "甲";
  rf.suggested = "現場写真.pdf";
  check("両方とも正しくない → ボタンなしのエラー表示",
    kind(rf) === "bothBad" && labels(rf).error === true && !labels(rf).number && !labels(rf).name, JSON.stringify(labels(rf)));
  check("出力前チェックにも出る", ctx.computeOutputIssues().some((x) => /正しくありません/.test(x.text)), JSON.stringify(ctx.computeOutputIssues()));

  // 欄を空にしたとき（5.2.3 の試用: 両方消すと何も出なかった）
  rf.evidenceNumber = "";
  rf.suggested = "";
  check("証拠番号もファイル名も空 → 赤のエラー（ボタンなし）",
    kind(rf) === "bothBad" && labels(rf).error && /空です/.test(labels(rf).text) && !labels(rf).number && !labels(rf).name, JSON.stringify(labels(rf)));
  rf.suggested = "甲026_写真.pdf";
  check("証拠番号だけ空・ファイル名は甲26 → 証拠番号を合わせるボタンだけ",
    kind(rf) === "badNumber" && labels(rf).number === "証拠番号を甲26にする" && !labels(rf).name, JSON.stringify(labels(rf)));
  check("出力前チェックの「証拠番号がありません」にもボタンが付く", ctx.computeOutputIssues().some((x) => x.fix && /証拠番号がありません/.test(x.text)), "");
  ctx.applyNumFix(rf, "number");
  check("証拠番号が甲026になる", rf.evidenceNumber === "甲026", rf.evidenceNumber);
  rf.suggested = "";
  check("ファイル名だけ空 → 赤のエラーと、ファイル名を作るボタン",
    kind(rf) === "missing" && labels(rf).error && labels(rf).text === "提出用ファイル名が空です" && !!labels(rf).name, JSON.stringify(labels(rf)));
  ctx.applyNumFix(rf, "name");
  check("ファイル名が 甲026_写真.pdf になる", rf.suggested === "甲026_写真.pdf", rf.suggested);
  // 両方とも正しくないとき: そのファイルだけ最初の値に戻すボタン
  rf.initialNumbers = { evidenceNumber: "甲026", branchRange: null, suggested: "甲026_写真.pdf" };
  rf.evidenceNumber = "";
  rf.suggested = "";
  check("両方とも空 → 最初の値に戻すボタン", /^最初の値に戻す（甲26・甲026_写真\.pdf）$/.test(labels(rf).reset || ""), JSON.stringify(labels(rf)));
  rf.evidenceNumber = "甲027";
  check("片方が正しければ戻すボタンは出さない（合わせるボタンで直す）", !labels(rf).reset, JSON.stringify(labels(rf)));
  rf.evidenceNumber = "甲";
  ctx.applyNumFix(rf, "reset");
  check("戻すと番号・ファイル名が最初の値になり、食い違いが消える",
    rf.evidenceNumber === "甲026" && rf.suggested === "甲026_写真.pdf" && kind(rf) === null, rf.evidenceNumber + " " + rf.suggested);
  const memo = { path: "C:/x/m.pdf", name: "m.pdf", kind: "主張系", docName: "準備書面", evidenceNumber: null, branchRange: null, suggested: "", stamps: [], metadata: [] };
  S.reviewFiles = [memo];
  check("証拠以外でファイル名が空 → 標目から作るボタン", kind(memo) === "nameEmpty" && labels(memo).name === "ファイル名を標目から作る", JSON.stringify(labels(memo)));
  ctx.applyNumFix(memo, "name");
  check("ファイル名が標目から作られる", memo.suggested === "準備書面.pdf", memo.suggested);
  S.reviewFiles = [];
}

section("確認画面のプレビュー: ページで分けた枝番のページの対応と、帯を出すページ（5.3.0）");
{
  const S = vm.runInContext("state", ctx);
  const whole = { path: "C:/x/a.pdf", name: "a.pdf", pageRange: null };
  const piece = { path: "C:/x/a.pdf", name: "a.pdf", pageRange: [3, 5] };
  check("分けていなければ元のページ番号のまま", ctx.sourcePageToRfPage(whole, 4) === 4);
  check("3〜5ページの枝番: 元の3ページ目＝その証拠の1ページ目", ctx.sourcePageToRfPage(piece, 3) === 1);
  check("3〜5ページの枝番: 元の5ページ目＝3ページ目", ctx.sourcePageToRfPage(piece, 5) === 3);
  check("範囲の外のページは 0（その証拠に入らない）",
    ctx.sourcePageToRfPage(piece, 2) === 0 && ctx.sourcePageToRfPage(piece, 6) === 0);

  // 帯は「出力の1ページ目」にだけ出す。同じ番号で結合される枝番は、先頭（枝番の小さいほう）だけ
  const b1 = { path: "C:/x/b1.pdf", name: "b1.pdf", evidenceNumber: "甲002", branchRange: "1", stamps: [] };
  const b2 = { path: "C:/x/b2.pdf", name: "b2.pdf", evidenceNumber: "甲002", branchRange: "2", stamps: [] };
  const solo = { path: "C:/x/c.pdf", name: "c.pdf", evidenceNumber: "甲003", branchRange: null, stamps: [] };
  S.reviewFiles = [b2, b1, solo];
  S.renameOnly = false;
  check("結合の先頭（甲2の1）の1ページ目には帯を出す", ctx.stampOnOutputFirstPage(b1, { page: 1 }) === true);
  check("結合の2つ目（甲2の2）には帯を出さない（出力では途中のページになる）", ctx.stampOnOutputFirstPage(b2, { page: 1 }) === false);
  check("1つだけの証拠の1ページ目には帯を出す", ctx.stampOnOutputFirstPage(solo, { page: 1 }) === true);
  check("2ページ目には帯を出さない", ctx.stampOnOutputFirstPage(solo, { page: 2 }) === false);
  S.mergeDisabled.add("甲002");
  check("「別々に出力」にしたら甲2の2にも帯を出す", ctx.stampOnOutputFirstPage(b2, { page: 1 }) === true);
  S.mergeDisabled.delete("甲002");
  S.reviewFiles = [];
}

section("向き: すべてのページ・そのページだけ（5.3.0）");
{
  const mk = () => ({ path: "C:/x/scan.pdf", name: "scan.pdf", pageCount: 3, pageRange: null, evidenceNumber: "甲005",
    stamps: [{ page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }] });
  const rf = mk();
  ctx.rotateAllPages([rf], "90");
  check("すべてのページ: 3ページとも右に90°", [1, 2, 3].every((p) => ctx.pageRotation(rf, p) === 90),
    JSON.stringify([1, 2, 3].map((p) => ctx.pageRotation(rf, p))));
  check("すべて同じ向き → 状態は右に90°", ctx.uniformRotation([rf]) === 90);
  check("押印の行は1ページ目の番号だけ（回転のために足した指示は行にしない）", ctx.stampRowsOf(rf).length === 1);
  ctx.setPageRotation(rf, 2, ctx.nextRotation(ctx.pageRotation(rf, 2), "-90"));
  check("2ページ目だけ左に90° → 2ページ目は元の向き、ほかは右に90°",
    ctx.pageRotation(rf, 1) === 90 && ctx.pageRotation(rf, 2) === 0 && ctx.pageRotation(rf, 3) === 90);
  check("向きがページごとに違う → 状態は null（ページごとに違います）", ctx.uniformRotation([rf]) === null);
  check("向きを戻した2ページ目の「回転だけ」の指示は消える", !rf.stamps.some((s) => s.page === 2));
  ctx.rotateAllPages([rf], "90");
  check("すべてのページをさらに右に90° → 差は保ったまま（180°・90°・180°）",
    ctx.pageRotation(rf, 1) === 180 && ctx.pageRotation(rf, 2) === 90 && ctx.pageRotation(rf, 3) === 180);
  ctx.rotateAllPages([rf], "reset");
  check("元に戻す → すべて元の向き・回転だけの指示は残らない",
    ctx.uniformRotation([rf]) === 0 && rf.stamps.length === 1 && rf.stamps[0].draw_label === true, JSON.stringify(rf.stamps));

  // 同じページにスタンプが2つ（番号と枝番など）あるときは、最初のものだけが角度を持つ（エンジンは1ページ1回）
  const two = mk();
  two.stamps.push({ page: 1, branch: "2", draw_label: true, rotate_degrees: 0, position: { x: 0.5, y: 0.5, anchor: "center" } });
  ctx.setPageRotation(two, 1, 90);
  check("同じページの2つ目のスタンプは 0（足し算で 180° にならない）",
    two.stamps[0].rotate_degrees === 90 && two.stamps[1].rotate_degrees === 0);

  // スタンプが無い証拠: 1ページ目はふつうのスタンプ（押印の行を兼ねる）として足す
  const bare = { path: "C:/x/b.pdf", name: "b.pdf", pageCount: 2, pageRange: null, evidenceNumber: "甲006", stamps: [] };
  ctx.rotateAllPages([bare], "180");
  check("スタンプが無くても全ページ回る", ctx.pageRotation(bare, 1) === 180 && ctx.pageRotation(bare, 2) === 180);
  check("1ページ目は押印の行に出る（押さない）・2ページ目は出ない",
    ctx.stampRowsOf(bare).length === 1 && ctx.stampRowsOf(bare)[0].page === 1 && ctx.stampRowsOf(bare)[0].draw_label === false);

  // ページで分けた枝番: その証拠のページ数（範囲）だけ回す
  const piece = { path: "C:/x/s.pdf", name: "s.pdf", pageCount: 9, pageRange: [4, 6], evidenceNumber: "甲007", stamps: [] };
  ctx.rotateAllPages([piece], "90");
  check("4〜6ページの枝番: 回るのはその証拠の3ページだけ", ctx.rfPageCount(piece) === 3
    && [1, 2, 3].every((p) => ctx.pageRotation(piece, p) === 90) && !piece.stamps.some((s) => s.page > 3));
}

section("撮影・録音日時 → 和暦の下書き（5.4.4）");
{
  const w = ctx.toWarekiShort;
  check("令和", w("2025-11-18T01:12") === "R7.11.18");
  check("令和の初日", w("2019-05-01T00:00") === "R1.5.1");
  check("平成の最後の日", w("2019-04-30T23:59") === "H31.4.30");
  check("平成", w("2010-02-03T10:00") === "H22.2.3");
  check("読めない値は空", w("") === "" && w(null) === "" && w("2025/11/18") === "" && w("1980-01-01T00:00") === "");
}

// 取り込み経路は2つある。片方だけ項目を足すと警告が出なくなる（実際に A3 超の警告で発生した）ので、
// 両方が集約関数を通っていることをソースで確認する。
{
  const src = fs.readFileSync(path.join(SRC_DIR, "app-state.js"), "utf8");
  const calls = (src.match(/mergeMetaResult\(f, byPath\.get/g) || []).length;
  check(`両方の取り込み経路が集約関数を使う（${calls}箇所）`, calls === 2, String(calls));
}

report();
