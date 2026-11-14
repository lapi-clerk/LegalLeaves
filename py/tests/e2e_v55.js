// 自己点検（selftest.py）用の手順: 5.5.0 の確認で見つかった 2 点を、実際の窓で確かめる。
//   1) AI が枝番を書き、押印の指示を書かなかったファイルでも、押す番号に枝番が入る（の1・の2～3）
//   2) 別の画面へ移ったら、いちばん上から見せる（前の画面で下までスクロールしていても、出力前チェックの知らせが見える）
// window.__ll.files: tools/make-check-samples.py が作る「3_枝番の範囲」の 2 つ（写真の1.pdf・写真の2と3.pdf）
// 窓は小さめ（LL_SELFTEST_SIZE=1000x600 など）で動かすと、スクロールが確実に起きる。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const r = {};

await addFiles(window.__ll.files);
state.aiText = JSON.stringify({
  schema_version: "2.0",
  files: [
    { original_file_name: "写真の1.pdf", type: "証拠", title: "写真", suggested_base_name: "甲005_1_写真", evidence_number: "甲005", branch_range: "1" },
    { original_file_name: "写真の2と3.pdf", type: "証拠", title: "写真", suggested_base_name: "甲005_2～3_写真", evidence_number: "甲005", branch_range: "2～3" },
  ],
});
validateAiJson();
r.aiJsonError = state.aiJsonError;
await ensureMetadataLoaded();
buildReviewFiles();
advanceStep("review");
r.reachedReview = await waitFor(() => state.step === "review");

// 1) 押す番号（確認画面が押印の欄・プレビューに出すものと同じ作り方）
r.stampLabels = state.reviewFiles.map((f) => ({
  name: f.name, branch: f.branchRange,
  labels: (f.stamps || []).map((s) => deriveStampLabel(f.evidenceNumber, s.branch ?? null)),
}));
r.mergedName = buildOutputPlan().map((o) => o.destName);

// 2) 確認画面でいちばん下までスクロールしてから、出力の画面へ移る
window.scrollTo(0, document.documentElement.scrollHeight);
await sleep(300);
r.scrollBefore = Math.round(window.scrollY);
r.pageIsScrollable = document.documentElement.scrollHeight > window.innerHeight;
advanceStep("export");
await sleep(300);
r.scrollAfterExport = Math.round(window.scrollY);
// 戻るときも同じ
window.scrollTo(0, document.documentElement.scrollHeight);
await sleep(300);
r.scrollBeforeBack = Math.round(window.scrollY);
goStep("review");
await sleep(300);
r.scrollAfterBack = Math.round(window.scrollY);
// 同じ画面のまま描き直すだけのとき（goStep に同じ画面を渡す）は、位置を変えない
window.scrollTo(0, 200);
await sleep(200);
goStep("review");
await sleep(200);
r.scrollStaysOnSameScreen = Math.round(window.scrollY);
return r;
