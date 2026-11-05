// 自己点検（selftest.py）用の手順: tmp/追加証拠サンプル（「AIを使わずに進む」の試験用）の
// 試し方.txt に書いた結果どおりになるかを確かめる。window.__ll.files にサンプル4つを渡す。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const r = {};
await addFiles(window.__ll.files);
$("no-ai-btn").click();
for (let i = 0; i < 100 && state.step !== "review"; i++) await sleep(100);
r.files = state.reviewFiles.map((f) => ({ name: f.name, num: f.evidenceNumber, branch: f.branchRange,
  title: f.docName, suggested: f.suggested, needsConfirmation: f.needsConfirmation }));
const i4 = state.reviewFiles.findIndex((f) => f.name.startsWith("甲4_"));
state.selectedReview = i4;
renderReview();
r.splitButton = $("rf-split-branch").textContent;
const ev = $("rf-evnum-input");
ev.dispatchEvent(new Event("focus"));
ev.value = "甲6";
ev.dispatchEvent(new Event("input"));
ev.dispatchEvent(new Event("change"));
r.after = { suggested: state.reviewFiles[i4].suggested, placeholders: state.placeholders.map((p) => p.num) };
return r;
