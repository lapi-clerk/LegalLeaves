// 自己点検（selftest.py）用の手順: 枝番サンプル（セットA）で、読み込み→照合→ページで分ける→プレビュー→出力 を
// 実際の画面の関数で通す。window.__ll = { files: [{path,name}], out: 出力先 } は Python 側が用意する。
// 画面の関数はクラシックスクリプトのグローバル（addFiles・proceedToMatch・splitByPages ほか）。
const AI = {
  schema_version: "2.0",
  evidence_explanation: { exists: false, file_name: null, first_evidence_number: null, last_evidence_number: null, suggested_file_name: null },
  case: { case_name: "売買代金請求事件", case_number: "令和８年（ワ）第１２３号", court: "東京地方裁判所",
    plaintiff: "株式会社アルファ商事", defendant: "ベータ工業株式会社", party: "原告", lawyers: ["弁護士　山田　太郎"] },
  files: [
    { original_file_name: "原告第1準備書面.pdf", type: "主張系", evidence_number: null, branch_range: null,
      title: "原告第１準備書面", suggested_base_name: "原告第１準備書面", confidence: "high",
      needs_user_confirmation: false, confirmation_question: null, notes: "", stamps: [] },
    { original_file_name: "甲1_売買契約書.pdf", type: "証拠", evidence_number: "甲001", branch_range: null,
      title: "売買契約書", suggested_base_name: "甲001_売買契約書", confidence: "high",
      needs_user_confirmation: false, confirmation_question: null, notes: "",
      author: "原告・被告", created_date: "R7.9.1", proof_purpose: "売買契約の成立", original_or_copy: "原本",
      stamps: [{ page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }] },
    { original_file_name: "甲2.pdf", type: "証拠", evidence_number: "甲002", branch_range: "1～2",
      title: "請求書", suggested_base_name: "甲002_請求書", confidence: "medium",
      needs_user_confirmation: true,
      confirmation_question: "1〜3ページ目＝甲2の1（請求書）、4〜5ページ目＝甲2の2（領収書）。準備書面の引用（請求書・甲２の１、領収書・甲２の２）と、4ページ目から表題が変わるため。",
      notes: "", author: "原告", created_date: "R7.10.31", proof_purpose: "代金の請求と一部弁済",
      stamps: [
        { page: 1, branch: "1", draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } },
        { page: 4, branch: "2", draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } },
      ] },
    { original_file_name: "甲3.pdf", type: "証拠", evidence_number: "甲003", branch_range: null,
      title: "ＬＩＮＥのトーク履歴", suggested_base_name: "甲003_ＬＩＮＥのトーク履歴", confidence: "high",
      needs_user_confirmation: false, confirmation_question: null, notes: "",
      author: "原告・被告", created_date: "R7.11.1", proof_purpose: "不具合の通知がないこと", capture_kind: "スクリーンショット",
      stamps: [{ page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } }] },
  ],
  warnings: [],
};

const r = {};
await addFiles(window.__ll.files);
r.loaded = state.files.map((f) => ({ name: f.name, pageCount: f.pageCount, metaError: f.metaError }));
state.aiText = JSON.stringify(AI);
validateAiJson();
update();
await proceedToMatch();
r.stepAfterMatch = state.step;
r.matchSkipped = state.matchSkipped;

const i = state.reviewFiles.findIndex((x) => x.name === "甲2.pdf");
r.splitPrefill = pageRangesFromStamps(state.reviewFiles[i]);
const parsed = parsePageRanges(r.splitPrefill, state.reviewFiles[i].pageCount);
splitByPages(i, parsed.ranges);
r.afterSplit = state.reviewFiles.map((x) => [x.name, x.evidenceNumber, x.branchRange, x.pageRange]);
for (const rf of state.reviewFiles) rf.userConfirmed = true;

state.outputFolder = window.__ll.out;
state.makeSubfolder = true;
state.generateExplanation = true;
advanceStep("export");

await openPreview(buildOutputPlan());
r.previewFiles = state.previewFiles.map((f) => ({ name: f.name, sources: f.sources }));
await new Promise((res) => setTimeout(res, 1500)); // 1件目の描画を待つ
r.previewCanvases = document.querySelectorAll("#pv-scroll canvas").length;
r.previewOverlayLabels = Array.from(document.querySelectorAll("#pv-scroll .pv-stamp, #pv-scroll [data-label]")).map((e) => e.textContent).slice(0, 10);
const bytes = await window.api.readPreviewBytes(state.previewFiles[0].path);
r.previewBytes = bytes ? bytes.length : 0;

await commitOutputs(buildOutputPlan());
r.stepAfterCommit = state.step;
r.written = (state.writeResult.written || []).map((w) => w.name);
r.errors = state.writeResult.errors || [];
r.outputDir = state.writeResult.outputDir;
return r;
