// 自己点検（selftest.py）用の手順: 5.4.0 音声・動画を .mp3・.mp4 にして出す（撮影場所などの情報は消す）。
// window.__ll.files: 機械で作った架空の見本（.m4a の録音・HEVC の .mov・回転情報つきの .mp4）。
// 書き出した後の中身（形式・情報が消えたか）は、外（Python と ffprobe）で確かめる。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const pause = async (scene) => { window.__llScene = scene; if (window.__ll.pause) await sleep(window.__ll.pause); };
const r = {};

await addFiles(window.__ll.files);
r.loaded = state.files.map((f) => f.name);
$("no-ai-btn").click();
r.reachedReview = await waitFor(() => state.step === "review");

// 番号と提出用ファイル名を入れる（拡張子は画面が .mp3・.mp4 を付ける）
const numbers = { m4a: "甲010", mov: "甲011", mp4: "甲012" };
for (const rf of state.reviewFiles) {
  const ext = rf.name.split(".").pop().toLowerCase();
  if (!numbers[ext]) continue;
  rf.type = "証拠";
  rf.evidenceNumber = numbers[ext];
  rf.suggested = `${numbers[ext]}_${rf.name.replace(/\.[^.]+$/, "")}`;
}
renderReview();
const mov = state.reviewFiles.find((x) => /\.mov$/i.test(x.name));
state.selectedReview = state.reviewFiles.indexOf(mov);
renderReview();
r.reviewName = $("rf-name").textContent;
r.planNames = buildOutputPlan().map((o) => o.destName);
await pause("確認画面・変換の注記");

// 書き出し（進み具合の表示を拾う）
advanceStep("export");
state.outputFolder = window.__ll.out;
state.makeSubfolder = false;
const seen = new Set();
const watcher = setInterval(() => { const t = $("export-next-btn").textContent; if (t) seen.add(t); }, 100);
await commitOutputs(buildOutputPlan());
clearInterval(watcher);
r.progressTexts = [...seen].filter((t) => t.includes("変換"));
r.done = { step: state.step, errors: state.writeResult.errors, list: $("done-list").textContent };
await pause("完了画面");
return r;
