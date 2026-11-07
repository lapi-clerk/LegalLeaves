// 自己点検（selftest.py）用の手順: 5.4.6 写真の EXIF の撮影日時を撮影日の下書きにし、証拠説明書（Word）まで届くか。
// 立証趣旨が空でも出力前プレビューに証拠説明書の表が出るか。出力した PDF に写真の EXIF が残らないかは、外（Python）で確かめる。
// window.__ll.files: 機械で作った架空の見本（EXIF の撮影日時・位置・機種つきの .jpg、機器の撮影時刻つきの .mov、
// 作成日時だけの .m4a）。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const pause = async (scene) => { window.__llScene = scene; if (window.__ll.pause) await sleep(window.__ll.pause); };
const r = {};

await addFiles(window.__ll.files);
r.captureMeta = state.files.map((f) => [f.name, f.captureMeta]);
$("no-ai-btn").click();
r.reachedReview = await waitFor(() => state.step === "review");

const numbers = { jpg: "甲001", mov: "甲002", m4a: "甲003" };
for (const rf of state.reviewFiles) {
  const ext = rf.name.split(".").pop().toLowerCase();
  rf.kind = "証拠";
  rf.evidenceNumber = numbers[ext];
  rf.suggested = `${numbers[ext]}_${rf.name.replace(/\.[^.]+$/, "")}`;
  rf.userConfirmed = true;
}
// 下書きは確認画面を開いたときに入る（buildReviewFiles）。番号は上で入れたので、ここで見る
r.drafts = state.reviewFiles.map((rf) => [rf.name, rf.createdDate || null, rf.dateDraftFromFile || null]);

const jpg = state.reviewFiles.find((x) => /\.jpg$/i.test(x.name));
state.selectedReview = state.reviewFiles.indexOf(jpg);
renderReview();
$("rf-expl-fields").open = true;
r.photo = {
  authorLabel: $("rf-author-label").textContent,
  dateLabel: $("rf-created-label").textContent,
  dateValue: $("rf-created-input").value,
  noteShown: !$("rf-created-draft-note").hidden,
  note: $("rf-created-draft-note").textContent,
  metaRows: [...document.querySelectorAll("#rf-meta-rows .meta-row")].map((x) => x.textContent),
  stampListShown: !$("rf-stamp-list").hidden,
};
document.querySelector("#rf-meta-rows").scrollIntoView({ block: "start" });
await pause("写真の撮影日の下書き");

// 出力前プレビュー: 立証趣旨が空でも証拠説明書の表が出る
advanceStep("export");
state.generateExplanation = true;
await openPreview(buildOutputPlan());
const explBtn = document.querySelector(".preview-file-expl");
r.explButton = !!explBtn;
if (explBtn) explBtn.click();
const tbl = document.querySelector("#pv-scroll .expl-pv-table");
r.explTable = tbl ? Array.from(tbl.rows).map((tr) => Array.from(tr.cells).map((c) => c.textContent).join(" | ")) : null;
await pause("出力前プレビュー・証拠説明書");
closePreviewModal();

state.outputFolder = window.__ll.out;
state.makeSubfolder = false;
await commitOutputs(buildOutputPlan());
r.done = { step: state.step, list: $("done-list").textContent, errors: state.writeResult.errors };
return r;
