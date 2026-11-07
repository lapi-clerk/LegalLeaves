// 自己点検（selftest.py）用の手順: 5.4.2 番号の無いファイルに番号を入れたその場で枝番欄が出るか・
// 枝番が1件だけでも一覧に「の1」が出るか・見つからない出力先へ書き出したときの知らせ。
// window.__ll.files: 番号の無い名前の架空の見本（録音 .m4a など）。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const pause = async (scene) => { window.__llScene = scene; if (window.__ll.pause) await sleep(window.__ll.pause); };
const r = {};

await addFiles(window.__ll.files);
$("no-ai-btn").click();
r.reachedReview = await waitFor(() => state.step === "review");

const rf = state.reviewFiles.find((x) => /\.m4a$/i.test(x.name));
state.selectedReview = state.reviewFiles.indexOf(rf);
renderReview();
r.before = { num: rf.evidenceNumber, branchHidden: $("rf-branch-field").hidden };

// 番号欄に「甲3」と打つ（確定＝欄を離れる前）
const evnum = $("rf-evnum-input");
evnum.focus();
evnum.value = "甲3";
evnum.dispatchEvent(new Event("input", { bubbles: true }));
r.whileTyping = { branchHidden: $("rf-branch-field").hidden, hintHidden: $("rf-evnum-hint").hidden };
await pause("番号を入れた直後（枝番欄が出る）");
evnum.dispatchEvent(new Event("change", { bubbles: true }));
evnum.blur();

// 枝番欄に 1
const br = $("rf-branch-input");
br.focus();
br.value = "1";
br.dispatchEvent(new Event("input", { bubbles: true }));
br.dispatchEvent(new Event("change", { bubbles: true }));
br.blur();
const row = [...document.querySelectorAll("#review-list .ev-row")].find((x) => x.dataset.index === String(state.reviewFiles.indexOf(rf)));
r.listHead = row ? row.querySelector(".ev-head").textContent : null;
r.suggested = rf.suggested;
await pause("枝番1件の一覧表示");

// 見つからない出力先へ書き出す
advanceStep("export");
state.outputFolder = window.__ll.out + "\\消したフォルダ";
state.makeSubfolder = false;
await commitOutputs(buildOutputPlan());
r.missingDir = { step: state.step, errors: state.writeResult.errors.map((e) => e.message) };
await pause("見つからない出力先");
return r;
