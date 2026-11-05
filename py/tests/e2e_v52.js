// 自己点検（selftest.py）用の手順: 5.2.x の追加分を実際の窓で確かめる。
//   出力前チェック（番号とファイル名の食い違い）・確認画面の証拠説明書の欄・書き出し後の容量・写真の向き
//   5.2.1: 回転ボタン（確認画面のプレビューと出力前プレビュー）・番号の抜けの表示・証拠説明書の表
// window.__ll.files の順は問わない: 甲1の2_領収書.pdf と、向きの情報が「縦持ち（6）」の写真（甲26_….jpg）。
// window.__ll.out に書き出す（証拠説明書の docx も作る）。LL_SELFTEST_PAUSE（ミリ秒）があれば、
// 見た目を写すために各場面で止まる（window.__llScene に場面の名前が入る）。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const pause = async (scene) => { window.__llScene = scene; if (window.__ll.pause) await sleep(window.__ll.pause); };
const setField = (id, value, ev = "input") => { const e = $(id); e.value = value; e.dispatchEvent(new Event(ev)); };
const r = {};

await addFiles(window.__ll.files);
$("no-ai-btn").click();
r.reachedReview = await waitFor(() => state.step === "review");
const iPdf = state.reviewFiles.findIndex((f) => /\.pdf$/i.test(f.name));
const iJpg = state.reviewFiles.findIndex((f) => /\.jpg$/i.test(f.name));

// 0) 番号の抜け（甲1 の次が甲26）を一覧に示す
state.showAllReview = true;
renderReview();
const gap = $("review-list").querySelector(".ev-gap");
r.gapRow = gap ? gap.textContent : null;

// 1) 証拠説明書の欄（作成者・作成日・原本／写し・立証趣旨）
state.selectedReview = iPdf;
renderReview();
r.explBoxShown = !$("rf-expl-fields").hidden;
setField("rf-author-input", "株式会社見本商事");
setField("rf-created-input", "令和6年4月1日");
setField("rf-orig-select", "原本", "change");
setField("rf-purpose-input", "代金を支払った事実");
const row = buildExplanationData().証拠.find((x) => x.作成者 && x.作成者.includes("見本商事")) || null;
r.explRow = row && { 号証: row.号証, 標目: row.標目, 作成者: row.作成者, 立証趣旨: row.立証趣旨 };

// 2) 回転ボタン（写真）: プレビューの上のボタンで右に90°。表示も横長に変わる
state.selectedReview = iJpg;
renderReview();
if ($("rf-source-preview").hidden) await openSourcePreview(state.reviewFiles[iJpg]);
await waitFor(() => $("rf-source-img").complete && $("rf-source-img").naturalWidth > 0);
r.rotBarShown = !$("rf-rot-bar").hidden;
const before = { w: $("rf-source-img").naturalWidth, h: $("rf-source-img").naturalHeight };
$("rf-rot-bar").querySelector('[data-rot="90"]').click();
await sleep(300);
await waitFor(() => $("rf-source-img").complete && $("rf-source-img").naturalWidth > 0 && $("rf-source-img").naturalWidth !== before.w);
r.rotate = { before, after: { w: $("rf-source-img").naturalWidth, h: $("rf-source-img").naturalHeight },
  stamps: state.reviewFiles[iJpg].stamps.map((s) => s.rotate_degrees), state: $("rf-rot-state").textContent,
  resetShown: !$("rf-rot-reset").hidden };
await pause("確認画面・回転後");
$("rf-rot-bar").querySelector('[data-rot="reset"]').click();
await sleep(500);
r.afterReset = state.reviewFiles[iJpg].stamps.map((s) => s.rotate_degrees);

// 2b) 5.2.2: ファイル名の番号と証拠番号の食い違い → 欄の下に示し、ボタンで片方に合わせる
const jpgRf = state.reviewFiles[iJpg];
// 入力している間は出さない（欄にフォーカスがある間）。欄を離れたら出す
$("rf-suggested").focus();
setField("rf-suggested", "甲027_現場写真.pdf");
r.hiddenWhileTyping = $("rf-num-mismatch").hidden;
$("rf-evnum-input").focus(); // 番号欄へ移る（ファイル名の欄を離れる）→ 番号欄の入力中なのでまだ出さない
setField("rf-evnum-input", "甲0");
r.hiddenWhileTypingNumber = $("rf-num-mismatch").hidden;
setField("rf-evnum-input", "甲26");
$("rf-evnum-input").dispatchEvent(new Event("change"));
$("rf-evnum-input").blur();
r.mismatchBox = { shown: !$("rf-num-mismatch").hidden, text: $("rf-num-mismatch-text").textContent,
  number: $("rf-fix-number").textContent, name: $("rf-fix-name").textContent };
await pause("確認画面・番号の食い違い");
$("rf-fix-number").click();
r.afterFixNumber = { num: jpgRf.evidenceNumber, field: $("rf-evnum-input").value, suggested: jpgRf.suggested,
  boxHidden: $("rf-num-mismatch").hidden };
setField("rf-suggested", "甲026_現場写真.pdf");
$("rf-fix-number").click(); // 甲026 に戻す
r.afterFixBack = jpgRf.evidenceNumber;

// 2c) 証拠番号に「甲0」と入れて Enter（試用で起きた操作）: ファイル名は追従せず、証拠番号を合わせるボタンだけ出る
const typeAndEnter = (id, value) => {
  const el = $(id);
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event("input"));
  el.dispatchEvent(new Event("change"));
  el.blur();
};
typeAndEnter("rf-evnum-input", "甲0");
r.badNumber = { num: jpgRf.evidenceNumber, suggested: jpgRf.suggested, text: $("rf-num-mismatch-text").textContent,
  numberBtn: $("rf-fix-number").hidden ? null : $("rf-fix-number").textContent, nameBtn: $("rf-fix-name").hidden ? null : $("rf-fix-name").textContent };
await pause("確認画面・証拠番号が正しくない");
$("rf-fix-number").click();
r.afterBadNumberFix = jpgRf.evidenceNumber;
// 両方とも正しくない: 赤のエラー表示（ボタンなし）
typeAndEnter("rf-suggested", "現場写真.pdf");
typeAndEnter("rf-evnum-input", "甲");
r.bothBad = { error: $("rf-num-mismatch").classList.contains("is-error"), text: $("rf-num-mismatch-text").textContent,
  buttons: [$("rf-fix-number").hidden, $("rf-fix-name").hidden] };
await pause("確認画面・両方正しくない");
typeAndEnter("rf-evnum-input", "甲26");
$("rf-fix-name").click();
r.afterBothBad = { num: jpgRf.evidenceNumber, suggested: jpgRf.suggested, boxHidden: $("rf-num-mismatch").hidden };
// 両方とも消したとき（5.2.3 の試用）: 赤のエラー
typeAndEnter("rf-suggested", "");
typeAndEnter("rf-evnum-input", "");
r.bothEmpty = { error: $("rf-num-mismatch").classList.contains("is-error"), shown: !$("rf-num-mismatch").hidden,
  text: $("rf-num-mismatch-text").textContent };
r.resetBtn = $("rf-fix-reset").hidden ? null : $("rf-fix-reset").textContent;
await pause("確認画面・両方とも空");
$("rf-fix-reset").click(); // そのファイルだけ最初の値に戻す
r.afterReset = { num: jpgRf.evidenceNumber, suggested: jpgRf.suggested, boxHidden: $("rf-num-mismatch").hidden };
typeAndEnter("rf-suggested", ""); // ファイル名だけ空 → ファイル名を作るボタン
r.nameEmpty = { text: $("rf-num-mismatch-text").textContent, nameBtn: $("rf-fix-name").textContent };
$("rf-fix-name").click();
r.afterBothEmpty = { num: jpgRf.evidenceNumber, suggested: jpgRf.suggested, boxHidden: $("rf-num-mismatch").hidden };

// 3) 出力前チェック: 欄に別の番号を入力すると、出力画面のいちばん上に出る → 押すと確認画面のその証拠へ
setField("rf-suggested", "甲025_写真.pdf");
advanceStep("export");
const oc = $("output-check");
r.checkWithIssue = oc.textContent;
r.checkIsFirst = oc.parentElement.firstElementChild === oc;
r.checkFixButtons = Array.from(oc.querySelectorAll(".num-fix-btn")).map((b) => b.textContent);
await pause("出力画面・食い違いあり");
const item = oc.querySelector(".output-check-item");
if (item) item.click();
r.afterClick = { step: state.step, selected: state.reviewFiles[state.selectedReview] && state.reviewFiles[state.selectedReview].name };
// 出力画面のボタンで、ファイル名のほうを証拠番号に合わせる（確認画面に戻らずに直せる）
advanceStep("export");
const nameBtn = Array.from($("output-check").querySelectorAll(".num-fix-btn")).find((b) => b.textContent.startsWith("ファイル名を"));
if (nameBtn) nameBtn.click();
r.afterFixName = jpgRf.suggested;
r.checkClean = $("output-check").textContent;

// 4) 出力前プレビュー: 写真の向き・回転ボタン・証拠説明書の表
state.generateExplanation = true;
await openPreview(buildOutputPlan());
const pj = state.previewFiles.findIndex((f) => /甲026/.test(f.name));
await showPreviewFile(pj);
const vp = (await pvState.doc.getPage(1)).getViewport({ scale: 1 });
r.photoPage = vp.height > vp.width ? "縦" : "横";
r.previewRotBar = !$("preview-this-stamp").hidden && !!$("preview-rot-bar").querySelector('[data-rot="-90"]');
r.previewSizes = Array.from(document.querySelectorAll(".preview-file .pf-num")).map((e) => e.textContent);
const explBtn = document.querySelector(".preview-file-expl");
r.explButton = !!explBtn;
if (explBtn) explBtn.click();
const tbl = document.querySelector("#pv-scroll .expl-pv-table");
r.explTable = tbl ? Array.from(tbl.rows).map((tr) => Array.from(tr.cells).map((c) => c.textContent).join(" | ")) : null;
await pause("出力前プレビュー・証拠説明書");
closePreviewModal();

// 5) 書き出し（証拠説明書つき）と完了画面の容量
state.outputFolder = window.__ll.out;
state.makeSubfolder = false;
await commitOutputs(buildOutputPlan());
r.done = { step: state.step, list: $("done-list").textContent, sizeNote: $("done-size-note").textContent,
  sizeNoteBeforeList: $("done-size-note").nextElementSibling === $("done-list"),
  errors: state.writeResult.errors };
await pause("完了画面");
return r;
