// 自己点検（selftest.py）用の手順: プレビュー画面で画像の証拠を回したとき（その1件だけ作り直す経路）に、
// 向きが変わり、番号が上端の帯の下に残り、注記が出ないことを確かめる。
// window.__ll.files の順: 写真（JPEG・横長）。
const st = { page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } };
const AI = {
  schema_version: "2.0", evidence_explanation: { exists: false }, case: {},
  files: [{ original_file_name: "写真_横.jpg", type: "証拠", evidence_number: "甲004", title: "写真",
    suggested_base_name: "甲004_写真", confidence: "high", needs_user_confirmation: false, stamps: [st] }],
  warnings: [],
};
async function snapshot(tag) {
  for (let n = 1; n <= pvState.pages.length; n++) await pvRenderPage(n);
  const p = pvState.pages[0];
  const ctx = p.canvas.getContext("2d");
  const d = ctx.getImageData(0, 0, p.canvas.width, p.canvas.height).data;
  let dark = 0;
  for (let j = 0; j < d.length; j += 4) if (d[j] < 248 || d[j + 1] < 248 || d[j + 2] < 248) dark++;
  const doc = pvState.doc;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const text = (await page.getTextContent()).items.map((x) => x.str).join("");
  const label = (await page.getTextContent()).items.find((x) => x.str.includes("号証"));
  return {
    tag, file: state.previewFiles[state.selectedPreview].name,
    pageMm: `${Math.round(vp.width / 2.8346)}x${Math.round(vp.height / 2.8346)}`,
    orientation: vp.width > vp.height ? "横" : "縦",
    text, labelTopMm: label ? Number(((vp.height - label.transform[5]) / 2.8346).toFixed(1)) : null,
    darkPercent: Number((dark * 100 / (d.length / 4)).toFixed(2)),
    imageFailed: !!p.imageFailed,
    stampsRotate: state.reviewFiles.map((rf) => (rf.stamps || []).map((s) => s.rotate_degrees)),
  };
}

const r = { steps: [] };
await addFiles(window.__ll.files);
state.aiText = JSON.stringify(AI);
validateAiJson();
update();
await proceedToMatch();
advanceStep("export");
await openPreview(buildOutputPlan());
await showPreviewFile(0);
r.steps.push(await snapshot("回す前"));
await setPreviewRotate(90);
r.steps.push(await snapshot("90度回した後"));
await setPreviewRotate(180);
r.steps.push(await snapshot("180度にした後"));
await setPreviewRotate(0);
r.steps.push(await snapshot("0度に戻した後"));
return r;
