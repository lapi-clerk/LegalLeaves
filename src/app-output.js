// ---------------------------------------------------------------------------
// 出力の確定（提出ファイルの書き出し）と案件ファイルの組み立て
//
// src/app.js から分離（監査⑥）。関数の中身は移動しただけで変更していない。
// ※案件ファイル（FB-1）は画面上は凍結中だが、将来の再開用にコードを保持している。
// ---------------------------------------------------------------------------

// ---------- output / preview ----------

// ---------- FB-1: 案件ファイル（作業の保存・再開） ----------
// The case file stores the FINALIZED review state as a synthetic AI contract plus a
// name->path map of the originals. Reopening feeds it straight back through
// buildReviewFiles(), so matching, manual assignment and warnings for moved/missing
// originals all come for free from the existing pipeline.
function buildCaseFile() {
  const files = state.reviewFiles.map((rf) => ({
    original_file_name: rf.name,
    type: rf.kind,
    evidence_number: rf.evidenceNumber || null,
    branch_range: rf.branchRange || null,
    title: rf.docName || null,
    suggested_base_name: (rf.suggested || "").replace(/\.[^.]+$/, "") || null,
    confidence: "high",
    needs_user_confirmation: false, // the work was reviewed before it was saved
    confirmation_question: null,
    // Numbered evidence with NO stamps means "決定済み: 押印しない". Persist that as an
    // explicit no-op stamp — otherwise buildReviewFiles would re-add the default
    // (押印あり) stamp when the case is reopened.
    stamps: (Array.isArray(rf.stamps) && rf.stamps.length)
      ? rf.stamps
      : (rf.evidenceNumber
        ? [{ page: 1, branch: null, draw_label: false, rotate_degrees: 0, position: { x: 0.93, y: STAMP_SAFE_Y, anchor: "top-right" } }]
        : []),
    author: rf.author || null,
    created_date: rf.createdDate || null,
    proof_purpose: rf.proofPurpose || null,
    original_or_copy: rf.originalOrCopy || null,
    digitized_from_paper: rf.digitizedFromPaper === true ? true : null,
    capture_kind: rf.captureKind || null,
    capture_subject: rf.captureSubject || null,
    capture_datetime: rf.captureDatetime || null,
    capture_location: rf.captureLocation || null,
    capture_by: rf.captureBy || null,
  }));
  const sources = {};
  const metadataKeep = {};
  for (const rf of state.reviewFiles) {
    sources[rf.name] = rf.path;
    const keep = (rf.metadata || []).filter((m) => m.action === "keep").map((m) => m.key);
    if (keep.length) metadataKeep[rf.name] = keep;
  }
  // SEC-C1: baseName はアプリ内保存時のファイル名（例「案件ファイル(甲001～甲006)」）に使う
  const range = evidenceRangeLabel(state.reviewFiles);
  return {
    type: "legalleaves-case",
    version: 1,
    baseName: range ? `案件ファイル(${range})` : "案件ファイル",
    savedAt: new Date().toISOString(),
    contract: {
      schema_version: "2.0",
      evidence_explanation: {
        exists: !!state.explanationExists,
        file_name: null, first_evidence_number: null, last_evidence_number: null, suggested_file_name: null,
      },
      case: state.caseInfo || {},
      files,
      warnings: [],
    },
    sources,
    metadataKeep,
    settings: {
      renameOnly: !!state.renameOnly,
      makeSubfolder: !!state.makeSubfolder,
      generateExplanation: !!state.generateExplanation,
      mergeDisabled: [...state.mergeDisabled],
    },
  };
}

async function commitOutputs(outputs) {
  const btn = $("export-next-btn");
  const commitBtn = $("preview-commit-btn");
  btn.disabled = true;
  commitBtn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "作成中...";
  commitBtn.textContent = "書き出し中...";
  try {
    const explanation = state.generateExplanation && !state.renameOnly && !state.explanationExists && hasEvidenceFiles()
      ? { data: buildExplanationData(), destName: explanationFileName() }
      : null;
    const result = await window.api.createSubmissionFiles({
      outputs,
      destDir: state.outputFolder,
      makeSubfolder: state.makeSubfolder,
      renameOnly: state.renameOnly,
      explanation,
      // FB-1凍結（2026-07-15）: 案件ファイルの自動保存を停止。作業データが無意識にPCへ
      // 残ることが事務所ポリシー上望ましくないため。buildCaseFile()等のコードは
      // 将来の再開（v4）用に保持している。
      caseFile: null,
    });
    state.writeResult = result;
    closePreviewModal();
    advanceStep("done");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
    commitBtn.disabled = false;
    commitBtn.textContent = "承認して書き出す";
  }
}

