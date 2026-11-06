// 自己点検（selftest.py）用の手順: 5.3.0 確認画面のプレビューに証拠番号とタイムスタンプ帯を重ねる。
// window.__ll.files: 甲1の2_領収書.pdf と 甲4_現場写真.jpg（tmp/追加証拠サンプル。架空のデータ）。
// LL_SELFTEST_PAUSE（ミリ秒）があれば、見た目を写すために各場面で止まる。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const pause = async (scene) => { window.__llScene = scene; if (window.__ll.pause) await sleep(window.__ll.pause); };
const box = () => $("rf-source-preview");
const labels = () => [...box().querySelectorAll(".pv-stamp")].map((e) => e.textContent);
const zones = () => box().querySelectorAll(".pv-zone").length;
const r = {};

await addFiles(window.__ll.files);
$("no-ai-btn").click();
r.reachedReview = await waitFor(() => state.step === "review");
const iPdf = state.reviewFiles.findIndex((f) => /\.pdf$/i.test(f.name));
const iJpg = state.reviewFiles.findIndex((f) => /\.jpg$/i.test(f.name));

// 1) PDF: 番号と帯が重なって出る
state.selectedReview = iPdf;
renderReview();
const pdfRf = state.reviewFiles[iPdf];
r.buttonBefore = $("rf-source-preview-btn").textContent;
if (box().hidden) await openSourcePreview(pdfRf);
await waitFor(() => box().querySelector(".pv-zone"));
r.pdf = { button: $("rf-source-preview-btn").textContent, overlayBar: !$("rf-overlay-bar").hidden,
  labels: labels(), zones: zones(), number: pdfRf.evidenceNumber };
// 番号は帯より下（帯の下端 < 番号の上端）
const z = box().querySelector(".pv-zone").getBoundingClientRect();
const st = box().querySelector(".pv-stamp");
r.pdf.stampBelowZone = st ? st.getBoundingClientRect().top >= z.bottom - 1 : null;
await pause("PDF・番号と帯");

// 2) 番号を直すと、プレビューの番号もその場で変わる
const inp = $("rf-evnum-input");
inp.value = "甲3";
inp.dispatchEvent(new Event("input"));
inp.dispatchEvent(new Event("blur"));
await sleep(300);
r.afterEdit = { number: pdfRf.evidenceNumber, labels: labels() };
await pause("PDF・番号を甲3に直した後");

// 3) 押印なしにすると番号が消え、帯は残る
const toggleBtn = $("rf-stamp-list").querySelector(".meta-toggle, .stamp-toggle, button[class*=toggle]");
if (toggleBtn) { toggleBtn.click(); await sleep(300); }
r.noStamp = { found: !!toggleBtn, labels: labels(), zones: zones() };
if (toggleBtn) { $("rf-stamp-list").querySelector(".meta-toggle, .stamp-toggle, button[class*=toggle]").click(); await sleep(300); }

// 4) 「重ねる」を外すと番号も帯も消える。戻すと出る
$("rf-overlay-toggle").checked = false;
$("rf-overlay-toggle").dispatchEvent(new Event("change"));
await sleep(300);
r.overlayOff = { labels: labels(), zones: zones() };
await pause("PDF・重ねるを外した");
$("rf-overlay-toggle").checked = true;
$("rf-overlay-toggle").dispatchEvent(new Event("change"));
await sleep(300);
r.overlayOn = { labels: labels(), zones: zones() };

// 5) 写真: 出力と同じ A4 の紙面に置き、上の白帯に番号、帯も重ねる
state.selectedReview = iJpg;
renderReview();
const jpgRf = state.reviewFiles[iJpg];
if (box().hidden || sourcePreviewPath !== jpgRf.path) await openSourcePreview(jpgRf);
await waitFor(() => box().querySelector(".source-page-canvas") && box().querySelector(".pv-zone"));
const cv = box().querySelector(".source-page-canvas");
r.jpg = { number: jpgRf.evidenceNumber, labels: labels(), zones: zones(), imgShown: !$("rf-source-img").hidden,
  page: cv ? { w: cv.clientWidth, h: cv.clientHeight, ratio: +(cv.clientHeight / cv.clientWidth).toFixed(3) } : null };
await pause("写真・紙面に番号と帯");
// 「重ねる」を外すと元の画像のまま
$("rf-overlay-toggle").checked = false;
$("rf-overlay-toggle").dispatchEvent(new Event("change"));
await waitFor(() => !$("rf-source-img").hidden && $("rf-source-img").complete);
r.jpgOff = { imgShown: !$("rf-source-img").hidden, labels: labels() };
await pause("写真・重ねるを外した");
$("rf-overlay-toggle").checked = true;
$("rf-overlay-toggle").dispatchEvent(new Event("change"));
await sleep(500);

// 6) 写真を右に90°: 紙面の縦横が入れ替わり（見本の写真は横長＝A4横 → A4縦）、番号と帯は出たまま
await waitFor(() => box().querySelector(".source-page-canvas")); // 切り替えで描き直した紙面
const cvNow = box().querySelector(".source-page-canvas");
const wasLandscape = cvNow ? cvNow.clientWidth > cvNow.clientHeight : null;
$("rf-rot-bar").querySelector('[data-rot="90"]').click();
await sleep(400);
await waitFor(() => { const c = box().querySelector(".source-page-canvas"); return c && (c.clientWidth > c.clientHeight) !== wasLandscape; });
const cv2 = box().querySelector(".source-page-canvas");
r.jpgRotated = { wasLandscape, orientationChanged: cv2 ? (cv2.clientWidth > cv2.clientHeight) !== wasLandscape : null,
  labels: labels(), zones: zones() };
await pause("写真・右に90°");
$("rf-rot-bar").querySelector('[data-rot="reset"]').click();
await sleep(400);

// 7) 何ページもある PDF（3つ目のファイル・5ページ）: 上のボタンは全ページ、各ページの上のボタンはそのページだけ
const iMulti = state.reviewFiles.findIndex((f) => f.name === "甲2.pdf");
if (iMulti >= 0) {
  state.selectedReview = iMulti;
  renderReview();
  const mrf = state.reviewFiles[iMulti];
  if (!mrf.evidenceNumber) { mrf.evidenceNumber = "甲002"; renderReview(); }
  if (box().hidden || sourcePreviewPath !== mrf.path) await openSourcePreview(mrf);
  await waitFor(() => (srcPv.slots || []).length === 5);
  const rotState = () => $("rf-rot-state").textContent;
  const btnX = (sel) => Math.round($("rf-rot-bar").querySelector(sel).getBoundingClientRect().left);
  const x0 = btnX('[data-prot="90"]');
  $("rf-rot-bar").querySelector('[data-rot="90"]').click();
  await sleep(600);
  const x1 = btnX('[data-prot="90"]');
  $("rf-rot-bar").querySelector('[data-rot="90"]').click(); // 続けて押しても同じ場所にある
  await sleep(600);
  r.multi = { pageGroup: !$("rf-page-rot").hidden, nowAtTop: $("rf-page-now").textContent,
    buttonMoved: x0 !== x1 || btnX('[data-prot="90"]') !== x0,
    afterTwoClicks: [1, 2, 3, 4, 5].map((p) => pageRotation(mrf, p)), state: rotState() };
  // v5.3.3: 3ページ目を枠の中ほどへ送り、「表示中のページ」の ↺ で3ページ目だけ左に90°
  const pv = box();
  const s3 = srcPv.slots[2];
  await srcPv.redraw(3);
  pv.scrollTop += s3.getBoundingClientRect().top - pv.getBoundingClientRect().top
    - (pv.clientHeight - s3.clientHeight) / 2;
  await sleep(400);
  r.multi.nowAfterScroll = $("rf-page-now").textContent;
  $("rf-rot-bar").querySelector('[data-prot="-90"]').click();
  await sleep(600);
  r.multi.afterPage3 = [1, 2, 3, 4, 5].map((p) => pageRotation(mrf, p));
  r.multi.stateMixed = rotState();
  r.multi.nowAfterRotate = $("rf-page-now").textContent;
  // 番号のドラッグのため、1ページ目へ戻る
  pv.scrollTop = 0;
  await sleep(300);
  r.multi.stampRows = $("rf-stamp-list").querySelectorAll(".stamp-row").length;
  await pause("何ページもあるPDF・全ページ180°と3ページ目だけ90°");

  // 8) 番号をドラッグで動かす → 位置が変わり、帯に入れると警告が出る
  const stEl = box().querySelector(".pv-stamp");
  const before = JSON.stringify(mrf.stamps[0].position);
  if (stEl) {
    const b = stEl.getBoundingClientRect();
    const opts = (x, y) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 1 });
    stEl.dispatchEvent(new PointerEvent("pointerdown", opts(b.left + 5, b.top + 5)));
    stEl.dispatchEvent(new PointerEvent("pointermove", opts(b.left - 60, b.top - 40)));
    stEl.dispatchEvent(new PointerEvent("pointerup", opts(b.left - 60, b.top - 40)));
    await sleep(400);
  }
  r.drag = { found: !!stEl, before, after: JSON.stringify(mrf.stamps[0].position),
    zoneWarn: !!$("rf-stamp-list").querySelector(".stamp-zone-warn") };
  await pause("番号をドラッグで帯の中へ");
  const fix = $("rf-stamp-list").querySelector(".zone-fix-btn");
  if (fix) { fix.click(); await sleep(300); }
  r.drag.afterFix = JSON.stringify(mrf.stamps[0].position);

  // 9) 書き出して、出力 PDF の向きを外（Python）で確かめる
  state.outputFolder = window.__ll.out;
  state.makeSubfolder = false;
  await commitOutputs(buildOutputPlan());
  r.done = { step: state.step, errors: state.writeResult.errors, list: $("done-list").textContent };
}

return r;
