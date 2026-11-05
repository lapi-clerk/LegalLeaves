// 自己点検（selftest.py）用の手順: 窓の大きさを変えたときのプレビューの自動の開閉を確かめる。
// LL_SELFTEST_SIZE=1000x800（狭い）で始め、LL_SELFTEST_RESIZES で途中に広げ・狭め・広げ・狭めを行う:
//   "8000:1700x950,14000:1000x800,20000:1700x950,28000:1000x800"
// 窓の大きさが実際に変わるのを待ってから記録する（時刻のずれに左右されないように）。
// 前半（ボタンを押していない）: 広げると開き、狭めると閉じる
// 後半（ボタンで閉じて開き直した＝押した履歴あり）: 狭めても閉じない
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitWidth = async (ok) => { for (let i = 0; i < 400 && !ok(window.innerWidth); i++) await sleep(100); };
const open = () => !$("rf-source-preview").hidden;
const r = { steps: [] };
const note = (tag) => r.steps.push({ tag, width: window.innerWidth, previewOpen: open() });

await addFiles(window.__ll.files);
$("no-ai-btn").click();
while (state.step !== "review") await sleep(100);
await sleep(1000);
note("狭い窓で開始（ボタンは押していない）→ 閉じている");
await waitWidth((w) => w > 1500); await sleep(2500);
note("広げた後 → 開く");
await waitWidth((w) => w < 1100); await sleep(1500);
note("狭めた後（ボタンを押していない）→ 閉じる");
await waitWidth((w) => w > 1500); await sleep(2500);
note("もう一度広げた後 → 開く");
$("rf-source-preview-btn").click(); // 閉じる（＝押した）
await sleep(800);
$("rf-source-preview-btn").click(); // 開き直す（押した履歴あり）
await sleep(1500);
note("ボタンで閉じて、また開いた後 → 開いている");
await waitWidth((w) => w < 1100); await sleep(1500);
note("狭めた後（ボタンを押した履歴あり）→ 開いたまま");
return r;
