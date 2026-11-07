// 自己点検（selftest.py）用の手順: 5.4.4〜5.4.5 音声・動画の撮影・録音日時を、確認画面の撮影日・録音日の下書きにする。
// window.__ll.files: 機械で作った架空の見本（機器の撮影時刻つきの .mov・ファイルの作成日時だけの .m4a・日時の無い .mp4。下書きは機器の記録からだけ）。
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

const numbers = { m4a: "甲010", mov: "甲011", mp4: "甲012" };
for (const rf of state.reviewFiles) {
  const ext = rf.name.split(".").pop().toLowerCase();
  rf.type = "証拠";
  rf.kind = "証拠";
  rf.evidenceNumber = numbers[ext];
}
r.drafts = state.reviewFiles.map((rf) => [rf.name, rf.createdDate, rf.dateDraftFromFile || null]);

const show = async (re, scene) => {
  const rf = state.reviewFiles.find((x) => re.test(x.name));
  state.selectedReview = state.reviewFiles.indexOf(rf);
  renderReview();
  $("rf-expl-fields").open = true;
  const o = {
    fieldsShown: !$("rf-expl-fields").hidden,
    authorLabel: $("rf-author-label").textContent,
    dateLabel: $("rf-created-label").textContent,
    dateValue: $("rf-created-input").value,
    noteShown: !$("rf-created-draft-note").hidden,
    metaRows: [...document.querySelectorAll("#rf-meta-rows .meta-row")].map((x) => x.textContent),
    deleteCount: $("rf-delete-count").textContent,
    stampListHidden: $("rf-stamp-list").hidden,
    evidenceLabel: $("rf-evidence-label").textContent,
  };
  $("rf-created-input").scrollIntoView({ block: "center" });
  await pause(scene);
  return o;
};
r.audio = await show(/\.m4a$/i, "録音の下書き");
r.video = await show(/\.mov$/i, "動画の下書き");
r.noDate = await show(/\.mp4$/i, "日時の無い動画");

// 手で書き換えると「下書き」の知らせが消える
await show(/\.m4a$/i, "書き換え前");
const inp = $("rf-created-input");
inp.value = "R7.10.15";
inp.dispatchEvent(new Event("input", { bubbles: true }));
r.afterEdit = { value: state.reviewFiles.find((x) => /\.m4a$/i.test(x.name)).createdDate, noteShown: !$("rf-created-draft-note").hidden };

// 証拠説明書の行に載るか
const ex = buildExplanationData();
r.explRows = (ex.証拠 || []).map((x) => [x.号証, x.作成年月日, x.作成者]);
return r;
