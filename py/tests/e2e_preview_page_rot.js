// 自己点検（selftest.py）用の手順: 5.3.2 出力前プレビューの「表示中のページ」だけを回すボタン。
// window.__ll.files: 何ページもある PDF 1つ（tmp/枝番サンプル/セットA の 甲2.pdf・5ページ。架空のデータ）。
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
const rf = state.reviewFiles[0];
if (!rf.evidenceNumber) { rf.evidenceNumber = "甲002"; }
const rots = () => [1, 2, 3, 4, 5].map((p) => pageRotation(rf, p));
const x = (sel) => Math.round($("preview-rot-bar").querySelector(sel).getBoundingClientRect().left);

advanceStep("export");
await openPreview(buildOutputPlan());
await showPreviewFile(0);
await waitFor(() => pvState.pages.length === 5 && pvState.pages.every((e) => e.rendered || e.n > 20));
r.groupShown = !$("preview-page-rot").hidden;
r.labelAtTop = $("preview-page-now").textContent;

// 3ページ目を枠の中ほどへ送る → 「3ページ目」になる
const scroll = $("pv-scroll");
const p3 = pvState.pages[2].wrap;
scroll.scrollTop += p3.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (scroll.clientHeight - p3.clientHeight) / 2;
await sleep(300);
r.labelAfterScroll = $("preview-page-now").textContent;
await pause("出力前プレビュー・3ページ目を表示");

// 表示中のページだけ右に90°。続けて押せるよう、ボタンの位置は変わらない
const xBefore = x('[data-prot="90"]');
$("preview-rot-bar").querySelector('[data-prot="90"]').click();
await sleep(600);
r.afterPage = { rots: rots(), label: $("preview-page-now").textContent, state: $("preview-rot-state").textContent,
  buttonMoved: x('[data-prot="90"]') !== xBefore };
r.page3Landscape = (() => { const c = pvState.pages[2].canvas; return c.clientWidth > c.clientHeight; })();
await pause("出力前プレビュー・3ページ目だけ右に90°");

// すべてのページを右に90° → 差は保ったまま
$("preview-rot-bar").querySelector('[data-rot="90"]').click();
await sleep(800);
r.afterAll = { rots: rots(), state: $("preview-rot-state").textContent, buttonMoved: x('[data-prot="90"]') !== xBefore };

// 書き出して、出力 PDF の向きを外（Python）で確かめる
closePreviewModal();
state.outputFolder = window.__ll.out;
state.makeSubfolder = false;
await commitOutputs(buildOutputPlan());
r.done = { step: state.step, errors: state.writeResult.errors, list: $("done-list").textContent };
return r;
