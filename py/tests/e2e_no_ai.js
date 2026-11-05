// 自己点検（selftest.py）用の手順: 「AIを使わずに進む」と、確認画面の改善を実際の窓で確かめる。
// window.__ll.files: 号証番号つきの名前のファイル（甲1の2_領収書.pdf・甲3_写真.pdf）と、番号なし（準備書面）
// 広い画面（LL_SELFTEST_SIZE=1700x950 など）で動かすと、全件表示とプレビューの自動表示も確かめられる。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const r = { innerWidth: window.innerWidth };

await addFiles(window.__ll.files);
r.noAiButtonShown = !$("no-ai-btn").hidden && !$("no-ai-top-btn").hidden;
$("no-ai-btn").click();
r.reachedReview = await waitFor(() => state.step === "review");
r.matchSkipped = state.matchSkipped;
r.files = state.reviewFiles.map((f) => ({
  name: f.name, kind: f.kind, num: f.evidenceNumber, branch: f.branchRange, title: f.docName,
  suggested: f.suggested, needsConfirmation: f.needsConfirmation,
}));
r.showAll = state.showAllReview;
r.hiddenNote = ($("review-list").querySelector(".ev-hidden-note") || {}).textContent || null;

// 「甲3の1にする」の名前（枝番の無い甲3を選ぶ）
const i3 = state.reviewFiles.findIndex((f) => f.evidenceNumber === "甲003");
state.selectedReview = i3;
renderReview();
r.splitButton = $("rf-split-branch").textContent;
await sleep(2500); // 広い画面ならプレビューが自動で開く
r.autoPreviewOpen = !$("rf-source-preview").hidden;
r.previewButton = $("rf-source-preview-btn").textContent;

// 閉じたら、別のファイルを選んでも自動では開かない
if (r.autoPreviewOpen) {
  $("rf-source-preview-btn").click();
  const i1 = state.reviewFiles.findIndex((f) => f.evidenceNumber === "甲001");
  state.selectedReview = i1;
  renderReview();
  await sleep(1500);
  r.afterCloseStaysClosed = $("rf-source-preview").hidden;
  state.autoSourcePreview = true; // 次の確認のために戻す
}

// 証拠番号の書き換え（甲3 → 甲5）: ファイル名の番号と、空いた甲3/甲4の空き枠
state.selectedReview = state.reviewFiles.findIndex((f) => f.name.startsWith("甲3_"));
renderReview();
const ev = $("rf-evnum-input");
ev.dispatchEvent(new Event("focus"));
ev.value = "甲5";
ev.dispatchEvent(new Event("input"));
ev.dispatchEvent(new Event("change"));
const rf = state.reviewFiles[state.selectedReview];
r.afterRenumber = { num: rf.evidenceNumber, suggested: rf.suggested, suggestedField: $("rf-suggested").value,
  placeholders: state.placeholders.map((p) => p.num + (p.branch ? "の" + p.branch : "")) };
r.listRows = Array.from($("review-list").querySelectorAll(".ev-head")).map((e) => e.textContent).slice(0, 12);
r.placeholderRow = !!$("review-list").querySelector(".ev-placeholder");
return r;
