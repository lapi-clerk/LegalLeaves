// ---------------------------------------------------------------------------
// イベント配線と初期化（画面の「つなぎこみ」だけを持つファイル）
//
// 分割したので、定義はすべて app-state / app-evidence / app-screens / app-review /
// app-preview / app-explanation / app-output へ移した。ここに残すのは
// 「どのボタンが何を呼ぶか」という配線と、起動時の初期化のみ。
//
// **このファイルは index.html で最後に読み込む。** クラシックスクリプトはグローバル
// スコープを共有するため、ここで実行される配線が参照する関数・定数は、先に読み込まれた
// ファイル側で用意されている必要がある（順序を変えると未定義・TDZで落ちる）。
// ---------------------------------------------------------------------------

// Prevent Electron's default "navigate to dropped file" behavior anywhere
// outside the dedicated dropzones.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

$("rf-source-preview-btn").addEventListener("click", toggleSourcePreview);

// ---------- event wiring ----------

$("select-files-btn").addEventListener("click", async () => {
  handleAddResult(await window.api.selectPdfFiles());
});

$("clear-files-btn").addEventListener("click", () => {
  state.files = [];
  state.excludedFiles = []; // 全クリア＝除外の復元候補も破棄
  state.placeholders = []; // Phase2: 予約枠も破棄
  state.matchKey = "";
  hideUnsupportedWarning();
  update();
});

// reopen a saved batch. The case file's contract goes through the normal
// pipeline (aiText -> buildReviewFiles), so missing originals surface as the usual
// orphan warnings with manual assignment, and everything stays editable.
$("open-case-btn").addEventListener("click", async () => {
  const res = await window.api.openCaseFile();
  if (!res) return;
  if (res.error) {
    renderUnsupportedWarning([{ name: "案件ファイル", reason: res.error }]);
    return;
  }
  const cf = res.caseFile;
  const settings = cf.settings || {};

  state.files = res.existing.map((f) => ({ path: f.path, name: f.name, type: guessType(f.name), metaFields: null, metaError: null }));
  state.aiText = JSON.stringify(cf.contract);
  state.aiCardCollapsed = true; // 復元時も生JSONは畳んで受領カードに
  $("ai-textarea").value = state.aiText;
  state.renameOnly = !!settings.renameOnly;
  $("rename-only-checkbox").checked = state.renameOnly;
  state.makeSubfolder = settings.makeSubfolder !== false;
  state.generateExplanation = !!settings.generateExplanation;
  state.mergeDisabled = new Set(settings.mergeDisabled || []);
  state.manualMatches = {};
  state.matchKey = "";
  hideUnsupportedWarning();

  // metadata for the restored PDFs, then re-apply the saved 維持 choices
  try {
    const metas = await window.api.readPdfMetadata(state.files.map((f) => f.path));
    const by = new Map(metas.map((m) => [m.path, m]));
    state.files = state.files.map((f) => {
      const m = by.get(f.path);
      return m ? { ...f, metaFields: m.fields || [], metaError: m.error || null, officeMeta: m.officeMeta || null } : f;
    });
  } catch (e) { /* metadata stays unresolved; ensureMetadataLoaded retries */ }

  buildReviewFiles();
  const keepMap = cf.metadataKeep || {};
  for (const rf of state.reviewFiles) {
    const keep = keepMap[rf.name];
    if (!keep) continue;
    for (const m of rf.metadata || []) {
      if (keep.includes(m.key)) m.action = "keep";
    }
  }
  enterMatchOrReview(); // 問題があれば照合（読み込み忘れの警告・手動割り当て）、無ければ確認へ
});

$("rename-only-checkbox").addEventListener("change", (e) => {
  state.renameOnly = e.target.checked;
  state.matchKey = ""; // rebuild matching/naming under the new mode
  update();
});

$("unsupported-warning-close").addEventListener("click", hideUnsupportedWarning);

const dropzone = $("pdf-dropzone");
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("is-dragover");
});
dropzone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-dragover");
});
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("is-dragover");
  const files = await collectFilesFromDataTransfer(e.dataTransfer);
  handleAddResult(await window.api.registerDroppedPdfFiles(files));
});

$("ai-textarea").addEventListener("input", (e) => {
  state.aiText = e.target.value;
  validateAiJson();
  update();
});

// テキストエリアへの直接貼り付け（Ctrl+V）でも、成功していれば受領カードに畳む。
// input（手編集）では畳まない＝編集の邪魔をしない。
$("ai-textarea").addEventListener("paste", () => {
  setTimeout(() => {
    if (state.aiText.trim() && !state.aiJsonError) {
      state.aiCardCollapsed = true;
      update();
    }
  }, 0);
});

// 受領カードの操作
$("ai-receipt-show").addEventListener("click", () => {
  state.aiCardCollapsed = false;
  update();
});
$("ai-receipt-clear").addEventListener("click", () => {
  state.aiText = "";
  state.aiCardCollapsed = false;
  validateAiJson();
  update();
  $("ai-textarea").focus();
});

$("copy-prompt-btn").addEventListener("click", async () => {
  const btn = $("copy-prompt-btn");
  // リネームのみモードでは、スタンプ配置・証拠説明書下書きの指示を省いた
  // 軽量プロンプト（ファイル名の決定だけを頼む）をコピーする＝AIの応答が速くなる
  const ok = await window.api.copyPrompt(state.renameOnly);
  const original = btn.textContent;
  // どちらの版が渡ったか分かるように明示（軽量版/フル版）
  btn.textContent = ok
    ? (state.renameOnly ? "コピーしました（リネーム用・軽量版）" : "コピーしました（フル版）")
    : "コピーできませんでした";
  btn.classList.toggle("is-done", ok);
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("is-done");
  }, 1600);
});

$("copy-names-btn").addEventListener("click", async () => {
  const btn = $("copy-names-btn");
  if (!state.files.length) return;
  const ok = await window.api.writeClipboardText(buildFilenameListText());
  const original = btn.textContent;
  btn.textContent = ok ? "コピーしました" : "コピーできませんでした";
  btn.classList.toggle("is-done", ok);
  setTimeout(() => { btn.textContent = original; btn.classList.remove("is-done"); }, 1600);
});

$("paste-btn").addEventListener("click", async () => {
  const text = await window.api.readClipboardText();
  if (text && text.trim()) {
    state.aiText = text;
    validateAiJson();
    if (!state.aiJsonError) state.aiCardCollapsed = true; // 成功時は受領カードに畳む
  } else {
    state.aiText = "";
    state.aiJsonError = "クリップボードにテキストが見つかりませんでした。";
  }
  update();
});

const proceedWithAi = () => { state.noAi = false; proceedToMatch(); };
$("to-match-btn").addEventListener("click", proceedWithAi);
$("to-match-top-btn").addEventListener("click", proceedWithAi);
// 少数の追加向け: AIの整理データなしで、ファイル名の号証番号を使って確認画面へ進む
const proceedWithoutAi = () => { state.noAi = true; proceedToMatch(); };
$("no-ai-btn").addEventListener("click", proceedWithoutAi);
$("no-ai-top-btn").addEventListener("click", proceedWithoutAi);

$("match-back-btn").addEventListener("click", () => goStep("start"));
$("match-back-top-btn").addEventListener("click", () => goStep("start"));
$("match-next-btn").addEventListener("click", () => advanceStep("review"));
$("match-next-top-btn").addEventListener("click", () => advanceStep("review"));
$("match-skip-btn").addEventListener("click", () => advanceStep("export"));

$("toggle-all-btn").addEventListener("click", () => {
  state.showAllReview = !state.showAllReview;
  if (!state.showAllReview) {
    const rf = state.reviewFiles[state.selectedReview];
    if (!rf || !needsAttention(rf)) {
      const fw = state.reviewFiles.findIndex((r) => needsAttention(r));
      state.selectedReview = fw >= 0 ? fw : 0;
    }
  }
  renderReview();
});

$("rf-confirm-check").addEventListener("change", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (rf) rf.userConfirmed = e.target.checked;
  advanceToNextAttention(); // 要確認のみ表示中は、確認済みにしたら次の要確認へ自動で移る
  renderReview();
});


$("rf-use-explanation").addEventListener("click", () => setTitleSource("explanation"));
$("rf-use-file").addEventListener("click", () => setTitleSource("file"));

$("rf-author-primary").addEventListener("click", () => setAuthorSource("primary"));
$("rf-author-alt").addEventListener("click", () => setAuthorSource("alt"));

$("bulk-author-role").addEventListener("click", () => applyBulkAuthor("primary"));
$("bulk-author-name").addEventListener("click", () => applyBulkAuthor("alt"));

$("bulk-confirm-all").addEventListener("click", () => {
  for (const rf of bulkConfirmTargets()) rf.userConfirmed = true;
  advanceToNextAttention(); // 要確認のみ表示中なら残りの要確認（二択など）へ移る
  renderReview();
});

$("rf-stamp-new").addEventListener("click", () => setStampChoice("new"));
$("rf-stamp-done").addEventListener("click", () => setStampChoice("done"));

$("bulk-stamp-new").addEventListener("click", () => { applyBulkStamp("new"); renderReview(); });
$("bulk-stamp-done").addEventListener("click", () => { applyBulkStamp("done"); renderReview(); });

// 挿入ボタン: 選択中が枝番付きなら枝番レベル、単独なら号証レベルで挿入する。
$("rf-insert-before").addEventListener("click", () => {
  const rf = state.reviewFiles[state.selectedReview];
  const p = parseEvidenceNumber(rf && rf.evidenceNumber);
  if (!p) return;
  if (rf.branchRange != null) insertBranchSlot(rf.evidenceNumber, branchSortKey(rf.branchRange));
  else insertSlotAt(p.sym, p.num);
});
$("rf-insert-after").addEventListener("click", () => {
  const rf = state.reviewFiles[state.selectedReview];
  const p = parseEvidenceNumber(rf && rf.evidenceNumber);
  if (!p) return;
  if (rf.branchRange != null) insertBranchSlot(rf.evidenceNumber, branchSortKey(rf.branchRange) + 1);
  else insertSlotAt(p.sym, p.num + 1);
});
$("rf-split-branch").addEventListener("click", splitIntoBranches);
// 1つのPDFにまとめてスキャンした枝番を、ページ範囲で分ける／元に戻す
$("rf-split-pages").addEventListener("click", openSplitPagesForm);
$("split-pages-cancel").addEventListener("click", closeSplitPagesForm);
$("split-pages-ok").addEventListener("click", submitSplitPagesForm);
$("split-pages-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSplitPagesForm();
  else if (e.key === "Escape") closeSplitPagesForm();
});
$("rf-unsplit-pages").addEventListener("click", unsplitPages);

document.querySelectorAll(".ai-orig-restore").forEach((btn) => {
  btn.addEventListener("click", () => restoreAiOriginal(btn.dataset.restore));
});

// 全体初期化: JSONを貼り直さずに、確認画面での手動修正をすべて取り消す
// window.confirm はElectronで閉じた直後にフォーカスが戻らず、セレクト等が
// 反応しなくなる（他のウィンドウに切り替えると復帰＝実機report）。ウィンドウ所有の
// ネイティブダイアログ（main側で focus() も行う）に置き換える。
$("review-reset-all-btn").addEventListener("click", async () => {
  const ok = await window.api.confirmDialog({
    message: "確認画面での手動修正（証拠番号・文書名・種類・押印や作成者の選択など）をすべて取り消して、" +
        "AIの整理データどおりに戻します。「ファイルごと除外」したファイルも読み込み一覧へ戻ります。" +
        "よろしいですか？",
    okLabel: "実行する",
  });
  if (!ok) return;
  // 「ファイルごと除外」も編集の一種として、まとめて取り消す（復元する）
  if (state.excludedFiles.length) {
    const have = new Set(state.files.map((f) => f.path));
    state.files = [...state.files, ...state.excludedFiles.filter((f) => f && !have.has(f.path))];
    state.excludedFiles = [];
  }
  state.matchKey = ""; // 照合キャッシュを破棄して再構築
  state.mergeDisabled.clear();
  buildReviewFiles();
  renderReview();
});

$("rf-remove-file-btn").addEventListener("click", async () => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  const ok = await window.api.confirmDialog({
    message: `「${rf.name}」を読み込み一覧から除外します。よろしいですか？\n（「編集をすべて取り消す」で戻せます）`,
    okLabel: "実行する",
  });
  if (!ok) return;
  const p = parseEvidenceNumber(rf.evidenceNumber);
  // 「編集をすべて取り消す」で復元できるよう、除外前のエントリを退避しておく
  const entry = state.files.find((f) => f.path === rf.path);
  if (entry) state.excludedFiles.push(entry);
  removeFile(rf.path); // state.files から除去（matchKeyも破棄される）
  buildReviewFiles();
  normalizeBranches(); // 枝番グループが1件になったら単独の号証に戻す
  renderReview();
  if (p) offerCloseGap(p.sym, p.num);
});

$("rf-kind").addEventListener("change", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  rf.kind = e.target.value;
  // manually reclassifying a file as the 証拠説明書 also gives it the range name
  if (rf.kind === "証拠説明書") {
    rf.suggested = `${explanationBaseName(state.reviewFiles)}${submitExtFor(rf.name)}`;
  }
  // 「証拠」にしたのに証拠番号が無いと、証拠一覧に並ばずドラッグ並べ替え・押印もできない
  // （番号が号証を決める＝一覧のグルーピングは番号ベース）。既存の採番から次番号が分かれば
  // 自動で振ってその場で証拠として扱えるようにし、分からない（最初の証拠）ときは番号欄へ誘導する。
  // 逆に「証拠」から外したときは証拠番号も外す。一覧・結合・押印はすべて
  // 証拠番号で判定しているため、番号が残ると種類だけ変えても証拠のまま残ってしまう
  // （実機report: 主張系に変えたのに甲009として一覧に残る）。
  if (rf.kind !== "証拠" && rf.evidenceNumber) {
    rf.evidenceNumber = null;
    rf.branchRange = null;
    rf.stamps = [];                       // 証拠でないので押印しない
    rf.suggested = suggestedForTitle(rf, rf.docName); // 提出名から号証部分を落とす
  }
  let focusEvnum = false;
  if (rf.kind === "証拠" && !rf.evidenceNumber && !state.renameOnly) {
    const next = nextEvidenceNumberSuggestion();
    if (next) {
      rf.evidenceNumber = next;
      if (Array.isArray(rf.stamps) && rf.stamps.length === 0) rf.stamps = [defaultStamp()];
      rf.suggested = suggestedForTitle(rf, rf.docName); // 提出名も号証書式に合わせる
    } else {
      focusEvnum = true;
    }
  }
  renderReview(); // select要素なのでキャレット問題なし＝ヒント含め全体を更新
  if (focusEvnum) { const el = $("rf-evnum-input"); if (el) el.focus(); }
});
$("rf-docname").addEventListener("input", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  const before = rf.docName;
  rf.docName = e.target.value;
  // 提出用ファイル名が標目から作った名前のままなら、標目に合わせて変える（手で変えた名前は触らない）。
  // v5.2.0 から、1ファイルだけの号証はこの欄の名前で保存するため、標目の修正がファイル名にも届くようにする。
  if (rf.suggested === suggestedForTitle(rf, before)) {
    rf.suggested = suggestedForTitle(rf, rf.docName);
    $("rf-suggested").value = rf.suggested;
    renderAiOriginalHint("rf-suggested-orig", rf, "suggested", rf.suggested);
  }
  renderAiOriginalHint("rf-docname-orig", rf, "docName", rf.docName);
});
$("rf-suggested").addEventListener("input", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  rf.suggested = e.target.value;
  renderAiOriginalHint("rf-suggested-orig", rf, "suggested", rf.suggested);
  renderNumMismatch(rf);
});
// 食い違いの知らせは、入力中は出さず、Enter か欄を離れたとき（確定）に出す
for (const id of ["rf-suggested", "rf-branch-input"]) $(id).addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur();
});
for (const id of ["rf-evnum-input", "rf-branch-input", "rf-suggested"]) {
  $(id).addEventListener("focus", () => { $("rf-num-mismatch").classList.add("is-stale"); });
  $(id).addEventListener("blur", () => {
    const rf = state.reviewFiles[state.selectedReview];
    if (rf) renderNumMismatch(rf);
  });
}
// v5.2.2: ファイル名の番号と証拠番号を、ボタンを押したときだけ片方に合わせる
for (const [id, which] of [["rf-fix-number", "number"], ["rf-fix-name", "name"], ["rf-fix-reset", "reset"]]) {
  $(id).addEventListener("click", () => {
    const rf = state.reviewFiles[state.selectedReview];
    if (rf && applyNumFix(rf, which)) renderReview();
  });
}
$("rf-evnum-input").addEventListener("input", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  // 「弁3-1」のように号証番号＋枝番をまとめて入力できる。区切りがあれば枝番欄にも反映する。
  const parsed = parseEvidenceInput(e.target.value);
  if (parsed) {
    rf.evidenceNumber = parsed.num;
    if (parsed.hasBranch) {
      rf.branchRange = parsed.branch;
      setStampBranch(rf, parsed.branch);
      $("rf-branch-input").value = parsed.branch || "";
    }
  } else {
    rf.evidenceNumber = e.target.value.trim() || null;
  }
  renderEvidenceDerived(rf); // live-update labels + merge note (leave caret alone)
  // 左一覧の「証拠／証拠以外」の振り分けも入力の都度反映する（確定＝別ファイル選択を待たない）。
  // 一覧は入力欄とは別DOM（#review-list）なのでキャレット・フォーカスは保持される。
  renderEvidenceList(state.selectedReview);
});
// v5.2.0: 確認画面の「証拠説明書の内容（任意）」の入力をそのファイルへ書き込む
const bindExplField = (id, apply) => {
  $(id).addEventListener("input", (e) => {
    const rf = state.reviewFiles[state.selectedReview];
    if (rf) apply(rf, e.target.value);
  });
};
bindExplField("rf-author-input", (rf, v) => {
  rf[explanationFieldKeys(rf).author] = v;
  if (!rf.captureKind) { rf.authorDecided = true; rf.authorSource = "primary"; } // 手で入れた作成者を正とする
});
bindExplField("rf-created-input", (rf, v) => { rf[explanationFieldKeys(rf).date] = v; renderDateDraftNote(rf); });
bindExplField("rf-purpose-input", (rf, v) => { rf.proofPurpose = v; });
$("rf-orig-select").addEventListener("change", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (rf) rf.originalOrCopy = e.target.value;
});

// 書き換える前の番号・枝番を覚えておく（確定時にファイル名の番号と空き枠を追従させるため）
let editBefore = null;
const rememberBefore = () => {
  const rf = state.reviewFiles[state.selectedReview];
  editBefore = rf ? { rf, num: rf.evidenceNumber, branch: rf.branchRange } : null;
};
const applyAfterEdit = (rf) => {
  if (!editBefore || editBefore.rf !== rf) return;
  afterEvidenceNumberEdited(rf, editBefore.num, editBefore.branch);
  editBefore = { rf, num: rf.evidenceNumber, branch: rf.branchRange };
  $("rf-suggested").value = rf.suggested;
  renderAiOriginalHint("rf-suggested-orig", rf, "suggested", rf.suggested);
};
$("rf-evnum-input").addEventListener("focus", rememberBefore);
$("rf-branch-input").addEventListener("focus", rememberBefore);
$("rf-branch-input").addEventListener("change", () => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  applyAfterEdit(rf);
  renderEvidenceList(state.selectedReview);
});
// Enterで確定（フォーカスを外す→changeが走り、正規化「弁4→弁004」＋押印付与＋一覧反映）。
$("rf-evnum-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur();
});
$("rf-evnum-input").addEventListener("change", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  // On blur, normalize "甲1" -> "甲001"（枝番付き「甲1-2」は号証番号と枝番へ分ける）so
  // grouping/sorting stay consistent. 番号欄には号証番号だけを残し、枝番は枝番欄へ。
  const parsed = parseEvidenceInput(e.target.value);
  if (parsed) {
    rf.evidenceNumber = parsed.num;
    e.target.value = parsed.num;
    if (parsed.hasBranch) rf.branchRange = parsed.branch;
  }
  // entering a number on a file with no stamp -> auto-add a default stamp (#6)
  if (rf.evidenceNumber && Array.isArray(rf.stamps) && rf.stamps.length === 0) {
    rf.stamps = [defaultStamp()];
  }
  // 単一スタンプなら枝番をラベル（「の◯」）へ揃える（枝番欄の編集と同じ扱い）
  if (rf.branchRange != null) setStampBranch(rf, rf.branchRange);
  $("rf-branch-input").value = rf.branchRange || "";
  applyAfterEdit(rf); // 提出用ファイル名の番号・途中で空いた番号の空き枠を追従
  renderEvidenceDerived(rf);
  renderEvidenceList(state.selectedReview); // 正規化後の番号・グループを一覧へ反映
});
// 枝番の編集。結合順・結合ファイル名は rf.branchRange から算出されるのでこれで反映。
// 単一スタンプのファイルはスタンプ側の枝番（＝印字ラベルの「の◯」）も揃える。
$("rf-branch-input").addEventListener("input", (e) => {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  const v = e.target.value.trim() || null;
  rf.branchRange = v;
  setStampBranch(rf, v);
  renderEvidenceDerived(rf); // 結合ノート＋スタンプラベルを即時更新
  renderEvidenceList(state.selectedReview); // 枝番の入れ子表示も即時反映
});

// 照合を飛ばして来た場合は「戻る」も読み込みへ直帰する
const reviewGoBack = () => goStep(state.matchSkipped ? "start" : "match");
$("review-back-btn").addEventListener("click", reviewGoBack);
$("review-back-top-btn").addEventListener("click", reviewGoBack);
$("review-next-btn").addEventListener("click", () => advanceStep("export"));
$("review-next-top-btn").addEventListener("click", () => advanceStep("export"));

$("choose-folder-btn").addEventListener("click", async () => {
  const result = await window.api.selectOutputFolder(state.outputFolder);
  if (result) {
    state.outputFolder = result.path;
    state.recentFolders = result.recentFolders;
    renderExport();
  }
});

const folderDropzone = $("folder-dropzone");
folderDropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  folderDropzone.classList.add("is-dragover");
});
folderDropzone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  folderDropzone.classList.remove("is-dragover");
});
folderDropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  folderDropzone.classList.remove("is-dragover");
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  try {
    const dirPath = await window.api.resolveDroppedOutputPath(file);
    if (dirPath) {
      state.outputFolder = dirPath;
      state.recentFolders = [dirPath, ...state.recentFolders.filter((p) => p !== dirPath)].slice(0, 6);
      renderExport();
    }
  } catch (err) {
    // unresolvable path; ignore
  }
});

$("make-subfolder-checkbox").addEventListener("change", (e) => {
  state.makeSubfolder = e.target.checked;
  renderExport(); // 実際の保存先表示を追従
});

$("preview-toggle-checkbox").addEventListener("change", (e) => {
  state.previewEnabled = e.target.checked;
  window.api.setPreviewEnabled(state.previewEnabled);
  $("export-next-btn").textContent = state.previewEnabled && !state.renameOnly && hasPreviewableOutput() ? "プレビューして作成" : "提出用ファイルを作成";
});

$("gen-expl-checkbox").addEventListener("change", (e) => {
  state.generateExplanation = e.target.checked;
  renderExport(); // プレビューボタン表示とサマリを追従
});

$("export-back-btn").addEventListener("click", () => goStep("review"));

$("preview-stamp-new").addEventListener("click", () => setPreviewStamp("new"));
$("preview-stamp-done").addEventListener("click", () => setPreviewStamp("done"));
$("preview-bulk-new").addEventListener("click", () => { applyBulkStamp("new"); renderPreviewStampControls(); pvLayoutAllOverlays(); });
$("preview-bulk-done").addEventListener("click", () => { applyBulkStamp("done"); renderPreviewStampControls(); pvLayoutAllOverlays(); });

// v5.2.1: 向きはボタンで（右に90°・左に90°・180°・元に戻す）
$("preview-rot-bar").addEventListener("click", (e) => {
  const b = e.target.closest(".rot-btn");
  if (!b) return;
  if (b.dataset.prot) setPreviewPageRotate(b.dataset.prot); // v5.3.2: 表示中のページだけ
  else setPreviewRotate(b.dataset.rot);
});
// v5.3.2: スクロールで「表示中のページ」を追う（画面の中ほどに見えているページ）
{
  let ticking = false;
  $("pv-scroll").addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; pvUpdateCurrentPage(); });
  }, { passive: true });
}
$("rf-rot-bar").addEventListener("click", (e) => {
  const b = e.target.closest(".rot-btn");
  if (b && b.dataset.prot) rotatePageInReview(b.dataset.prot); // v5.3.3: 表示中のページだけ
  else if (b) rotateInReview(b.dataset.rot);
});
$("rf-overlay-toggle").addEventListener("change", (e) => setSourceOverlay(e.target.checked));
// v5.3.3: 確認画面のプレビューも「表示中のページ」を追う（出力前のプレビューと同じ形）
{
  let ticking = false;
  $("rf-source-preview").addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateReviewCurrentPage(); });
  }, { passive: true });
}

$("export-next-btn").addEventListener("click", async () => {
  const outputs = buildOutputPlan();
  // Only open the preview when there's something previewable; a pure audio/video
  // batch (or rename-only mode) has nothing to stamp, so create the files directly.
  if (state.previewEnabled && !state.renameOnly && hasPreviewableOutput()) {
    await openPreview(outputs);
  } else {
    await commitOutputs(outputs);
  }
});

$("preview-commit-btn").addEventListener("click", () => {
  // プレビュー中のドラッグ・向き・押印の編集は rf.stamps に書き戻されているので、
  // 承認時に計画を作り直してから焼き込む（開いた時点のスナップショットを使わない）。
  commitOutputs(buildOutputPlan());
});
$("preview-cancel-btn").addEventListener("click", cancelPreview);
$("preview-modal-close").addEventListener("click", cancelPreview);

$("open-folder-btn").addEventListener("click", () => {
  if (state.lastOutputDir) window.api.openLastOutputDir();
});

$("done-restart-btn").addEventListener("click", () => {
  state.maxReachedIndex = 0;
  state.openedFrom = null; // 新しい作業は、人が自分で入れるもの
  renderOutsideOpenNote();
  state.aiText = "";
  state.aiJsonError = "";
  state.aiCardCollapsed = false;
  state.files = [];
  state.excludedFiles = [];
  state.placeholders = [];
  state.reviewFiles = [];
  state.aiWarnings = [];
  state.matchKey = "";
  state.selectedReview = 0;
  state.showAllReview = false;
  state.writeResult = null;
  state.mergeDisabled.clear();
  state.manualMatches = {};
  state.consistency = null;
  state.renameOnly = false;
  $("rename-only-checkbox").checked = false;
  state.caseInfo = null;
  state.explanationExists = false;
  state.generateExplanation = false;
  $("gen-expl-checkbox").checked = false;
  hideUnsupportedWarning();
  $("ai-textarea").value = "";
  goStep("start");
});

document.querySelectorAll(".step-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (STEP_ORDER.indexOf(btn.dataset.step) <= state.maxReachedIndex) goStep(btn.dataset.step);
  });
});

$("help-btn").addEventListener("click", async () => {
  $("help-modal-overlay").hidden = false;
  // データの保存場所を表示
  try {
    const info = await window.api.getAppDataInfo();
    $("help-data-path").textContent = `保存先フォルダ: ${info.userDataPath}`;
  } catch (_) {}
});

// データの削除操作
$("open-appdata-btn").addEventListener("click", () => window.api.openAppDataDir());
$("delete-recent-btn").addEventListener("click", async () => {
  if (!(await window.api.confirmDialog({ message: "最近使ったフォルダの履歴を削除します（依頼者名などを含むパスの履歴が消えます）。よろしいですか？", okLabel: "削除する" }))) return;
  await window.api.deleteAppDataItem("recentFolders");
  state.recentFolders = [];
  state.outputFolder = "";
  update();
});
// 「案件ファイルを削除」ボタンは、案件ファイルの自動保存停止＋起動時清掃に伴い撤去
// （delete-app-data-item("cases") のIPC自体は将来の再開用に保持）。
// 取り消せない操作なので、確認はmainプロセスのネイティブダイアログに一本化する
// （削除される実際のフォルダのパスまで示す・既定はキャンセル）。画面側で二重に聞かない。
$("delete-appdata-btn").addEventListener("click", async () => {
  await window.api.deleteAllAppData();
});
$("help-modal-close").addEventListener("click", closeHelpModal);
$("help-modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "help-modal-overlay") closeHelpModal();
});

$("firm-notes-btn").addEventListener("click", async () => {
  const text = await window.api.readFirmNotes();
  $("firm-notes-textarea").value = text || "";
  $("firm-notes-status").textContent = "";
  $("firm-notes-overlay").hidden = false;
  $("firm-notes-textarea").focus();
  // 実際の保存先パスを表示（保存場所が分からない不安への対応）
  try {
    const info = await window.api.getAppDataInfo();
    $("firm-notes-path").textContent = `保存先: ${info.firmNotesPath}`;
  } catch (_) {}
});
$("firm-notes-open-dir").addEventListener("click", () => window.api.openAppDataDir());
$("firm-notes-save").addEventListener("click", async () => {
  const ok = await window.api.writeFirmNotes($("firm-notes-textarea").value);
  if (ok) {
    closeFirmNotesModal();
  } else {
    $("firm-notes-status").textContent = "保存できませんでした";
  }
});
$("firm-notes-cancel").addEventListener("click", closeFirmNotesModal);
$("firm-notes-close").addEventListener("click", closeFirmNotesModal);
$("firm-notes-overlay").addEventListener("click", (e) => {
  if (e.target.id === "firm-notes-overlay") closeFirmNotesModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("preview-modal-overlay").hidden) cancelPreview();
  else if (!$("firm-notes-overlay").hidden) closeFirmNotesModal();
  else if (!$("help-modal-overlay").hidden) closeHelpModal();
});

$("quit-btn").addEventListener("click", () => {
  const hasUnsavedWork = state.files.length > 0 || state.aiText.trim() !== "";
  window.api.quitApp(hasUnsavedWork);
});

// 窓の大きさが「プレビューを右に並べられる幅」をまたいだら、プレビューを自動で開く／閉じる
if (window.matchMedia) {
  const wideMq = window.matchMedia(WIDE_PREVIEW_QUERY);
  if (wideMq.addEventListener) wideMq.addEventListener("change", (e) => onPreviewWidthChange(e.matches));
}

// ---------- init ----------

(async function init() {
  try {
    const initial = await window.api.getInitialOutputState();
    state.outputFolder = initial.outputFolder || "";
    state.recentFolders = initial.recentFolders || [];
    state.previewEnabled = initial.previewEnabled !== false;
    if (initial.appVersion) $("brand-version").textContent = `v${initial.appVersion}`;
  } catch (e) {
    // no persisted state available; proceed with empty defaults
  }
  showScreen(state.step);
  update();
  await applyOpenRequest();
})();

// ---------- 右クリックのメニュー（コピー・貼り付け） ----------
// この窓には、ブラウザの右クリックのメニューが出ない。文字を選んで右クリックしたときに「コピー」を、
// 入力欄では「貼り付け」も出す（Ctrl+C・Ctrl+V を知らなくても、確認事項の文などを写せるように）。
function closeContextMenu() {
  const m = document.getElementById("ctx-menu");
  if (m) m.remove();
}
function contextMenuItem(label, onPick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ctx-menu-item";
  b.textContent = label;
  // 押した瞬間に選択が外れないよう、mousedown では何もしない（click で実行する）
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => { closeContextMenu(); onPick(); });
  return b;
}
document.addEventListener("contextmenu", (e) => {
  closeContextMenu();
  const el = e.target;
  const isField = el && (el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && /^(text|search|url|tel|email|number|)$/i.test(el.getAttribute("type") || "")));
  const editable = isField && !el.readOnly && !el.disabled;
  let selected = "";
  if (isField && typeof el.selectionStart === "number") {
    selected = el.value.substring(el.selectionStart, el.selectionEnd);
  } else {
    selected = String(window.getSelection ? window.getSelection() : "");
  }
  const items = [];
  if (selected.trim()) items.push(contextMenuItem("コピー", () => window.api.writeClipboardText(selected)));
  if (editable) {
    items.push(contextMenuItem("貼り付け", async () => {
      const text = await window.api.readClipboardText();
      if (!text) return;
      el.focus();
      el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }));
  }
  if (!items.length) return;
  e.preventDefault();
  const menu = document.createElement("div");
  menu.id = "ctx-menu";
  menu.className = "ctx-menu";
  menu.setAttribute("role", "menu");
  items.forEach((b) => menu.appendChild(b));
  document.body.appendChild(menu);
  // 窓の外へはみ出さない位置に置く
  const x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
});
document.addEventListener("mousedown", (e) => {
  const m = document.getElementById("ctx-menu");
  if (m && !m.contains(e.target)) closeContextMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeContextMenu(); });
window.addEventListener("blur", closeContextMenu);
window.addEventListener("scroll", closeContextMenu, true);

// 確認画面から開く入口（--open）で渡されたものを、起動時に 1 回だけ受け取る。
// 人が「ファイルを入れる → 整理データを貼り付ける → 照合して進む」をしたときと同じ処理を、同じ順に呼ぶ
// （別の読み込み経路を作らない。整理データの検査も、進めるかどうかの判定も、人のときと同じもの）。
async function applyOpenRequest() {
  let req = null;
  try {
    req = await window.api.takeOpenRequest();
  } catch (e) {
    return;
  }
  if (!req) return;
  const accepted = req.accepted || [];
  const rejected = req.rejected || [];
  state.openedFrom = { folderName: req.folderName || "", count: accepted.length, skipped: req.skipped || [] };
  renderOutsideOpenNote();
  hideUnsupportedWarning();
  if (accepted.length) await addFiles(accepted);
  if (rejected.length) renderUnsupportedWarning(rejected);
  state.aiText = String(req.aiText || "");
  $("ai-textarea").value = state.aiText;
  validateAiJson();
  if (!state.aiJsonError) state.aiCardCollapsed = true;
  update();
  // 「照合して進む」が押せる状態のときだけ、押す（押せないときは、読み込み画面で止まって理由が見える）
  const btn = $("to-match-btn");
  if (!btn.disabled) btn.click();
}

function renderOutsideOpenNote() {
  const note = $("outside-open-note");
  const o = state.openedFrom;
  note.hidden = !o;
  if (!o) return;
  const skippedCount = o.skipped.reduce((n, s) => n + (s.files || 0), 0);
  note.textContent =
    `AI のアプリなど、外から開きました。フォルダ「${o.folderName}」の ${o.count} 件を読み込み、整理データを貼り付けた状態です。` +
    "内容は、まだ人が確かめていない下書きです。いつもどおり確かめてから書き出してください。" +
    (skippedCount ? `（前に書き出した「提出用ファイル」のフォルダの ${skippedCount} 件は、読み込んでいません。）` : "");
}
