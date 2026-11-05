// 自己点検（selftest.py）用の手順: Word・Excel の証拠を読み込み、プレビュー（Office 変換を含む）→
// 出力（証拠説明書の Word と PDF を含む）まで通す。MS Office か LibreOffice が入っている PC で使う。
// window.__ll = { files: [Word, Excel], out: 出力先 }
const st = { page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } };
const ev = (name, num, title) => ({
  original_file_name: name, type: "証拠", evidence_number: num, branch_range: null, title,
  suggested_base_name: `${num}_${title}`, confidence: "high", needs_user_confirmation: false,
  author: "原告", created_date: "R7.9.1", proof_purpose: `${title}の存在`, stamps: [st],
});
const AI = {
  schema_version: "2.0",
  evidence_explanation: { exists: false },
  case: { court: "東京地方裁判所", case_number: "令和８年（ワ）第１２３号", plaintiff: "株式会社アルファ商事",
    defendant: "ベータ工業株式会社", party: "原告", lawyers: ["弁護士　山田　太郎"] },
  files: window.__ll.files.map((f, i) => ev(f.name, `甲0${10 + i}`, f.name.replace(/^甲\d+_|\.[^.]+$/g, ""))),
  warnings: [],
};

const r = {};
await addFiles(window.__ll.files);
r.officeMeta = state.files.map((f) => ({ name: f.name, officeMeta: f.officeMeta || null }));
state.aiText = JSON.stringify(AI);
validateAiJson();
update();
await proceedToMatch();
r.step = state.step;
for (const rf of state.reviewFiles) rf.userConfirmed = true;
state.outputFolder = window.__ll.out;
state.makeSubfolder = true;
state.generateExplanation = true;
advanceStep("export");

const t0 = Date.now();
await openPreview(buildOutputPlan());
r.previewSeconds = Math.round((Date.now() - t0) / 100) / 10;
r.preview = [];
for (let i = 0; i < state.previewFiles.length; i++) {
  await showPreviewFile(i);
  for (let n = 1; n <= pvState.pages.length; n++) await pvRenderPage(n);
  r.preview.push({ name: state.previewFiles[i].name, pages: pvState.pages.length,
    imageFailed: pvState.pages.some((p) => p.imageFailed) });
}
r.previewErrors = Array.from(document.querySelectorAll("#preview-modal-overlay .pv-error, #preview-modal-overlay .warn-text")).map((e) => e.textContent).slice(0, 5);

const t1 = Date.now();
await commitOutputs(buildOutputPlan());
r.commitSeconds = Math.round((Date.now() - t1) / 100) / 10;
r.stepAfterCommit = state.step;
r.written = (state.writeResult.written || []).map((w) => w.name);
r.errors = state.writeResult.errors || [];
return r;
