// 自己点検（selftest.py）用の手順: プレビューで「表示できませんでした」の注記が誤って出ないか、
// 画像の証拠（JPEG・PNG）がプレビューに描けているかを確かめる。
// window.__ll.files の順: 準備書面（文字の少ないページあり）・写真（JPEG）・スクリーンショット（PNG）。
const st = { page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } };
const AI = {
  schema_version: "2.0",
  evidence_explanation: { exists: false },
  case: {},
  files: [
    { original_file_name: "原告第1準備書面.pdf", type: "主張系", evidence_number: null, title: "原告第１準備書面",
      suggested_base_name: "原告第１準備書面", confidence: "high", needs_user_confirmation: false, stamps: [] },
    { original_file_name: "写真_横.jpg", type: "証拠", evidence_number: "甲004", title: "写真",
      suggested_base_name: "甲004_写真", confidence: "high", needs_user_confirmation: false, stamps: [st] },
    { original_file_name: "スクショ_縦.png", type: "証拠", evidence_number: "甲005", title: "スクリーンショット",
      suggested_base_name: "甲005_スクリーンショット", confidence: "high", needs_user_confirmation: false, stamps: [st] },
  ],
  warnings: [],
};

const r = { files: [] };
await addFiles(window.__ll.files);
state.aiText = JSON.stringify(AI);
validateAiJson();
update();
await proceedToMatch();
advanceStep("export");
await openPreview(buildOutputPlan());

for (let i = 0; i < state.previewFiles.length; i++) {
  await showPreviewFile(i);
  for (let n = 1; n <= pvState.pages.length; n++) await pvRenderPage(n);
  const pages = pvState.pages.map((p, k) => {
    const ctx = p.canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, p.canvas.width, p.canvas.height).data;
    let dark = 0;
    for (let j = 0; j < d.length; j += 4) if (d[j] < 248 || d[j + 1] < 248 || d[j + 2] < 248) dark++;
    return {
      page: k + 1,
      rendered: !!p.rendered,
      imageFailed: !!p.imageFailed,
      darkPercent: Number((dark * 100 / (d.length / 4)).toFixed(3)),
      noteShown: !!p.wrap.querySelector(".pv-unrenderable-note"),
    };
  });
  r.files.push({ name: state.previewFiles[i].name, pages });
}
return r;
