// ---------------------------------------------------------------------------
// 画面遷移と「読み込み」「照合」画面の描画
//
// src/app.js から分離。関数の中身は移動しただけで変更していない。
// ---------------------------------------------------------------------------

function goStep(step) {
  const changed = state.step !== step;
  state.step = step;
  showScreen(step);
  update();
  // 別の画面へ移ったら、いちばん上から見せる（前の画面で下までスクロールしていると、移った先の上にある
  // 出力前チェックの知らせなどが見えないまま始まってしまう。5.4.6 の試用で指摘）
  if (changed && typeof window !== "undefined" && typeof window.scrollTo === "function") window.scrollTo(0, 0);
}

function advanceStep(step) {
  const idx = STEP_ORDER.indexOf(step);
  if (idx > state.maxReachedIndex) state.maxReachedIndex = idx;
  goStep(step);
}

function showScreen(step) {
  document.querySelectorAll(".screen").forEach((sec) => {
    sec.classList.toggle("is-active", sec.dataset.screen === step);
  });
}

function renderStepNav() {
  const idx = STEP_ORDER.indexOf(state.step);
  document.querySelectorAll(".step-button").forEach((btn) => {
    const i = STEP_ORDER.indexOf(btn.dataset.step);
    btn.classList.toggle("is-active", i === idx);
    btn.classList.toggle("is-done", i < state.maxReachedIndex);
    btn.classList.toggle("is-locked", i > state.maxReachedIndex);
    btn.querySelector(".step-num").textContent = i < state.maxReachedIndex ? "✓" : String(i + 1);
    // 現在のステップと未到達（ロック）状態を支援技術にも伝える
    if (i === idx) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
    btn.setAttribute("aria-disabled", i > state.maxReachedIndex ? "true" : "false");
  });
}

function renderHeading() {
  const [title, summary] = META[state.step];
  $("screen-title").textContent = title;
  $("screen-summary").textContent = summary;
}

let _lastDirty = null;
function update() {
  renderStepNav();
  renderHeading();
  if (state.step === "start") renderStart();
  else if (state.step === "match") renderMatch();
  else if (state.step === "review") renderReview();
  else if (state.step === "export") renderExport();
  else if (state.step === "done") renderDone();
  // keep main.js in sync so the titlebar × can confirm before discarding work
  const dirty = state.files.length > 0 || state.aiText.trim() !== "";
  if (dirty !== _lastDirty) { _lastDirty = dirty; window.api.setDirty(dirty); }
}

function hintMessage() {
  if (state.aiJsonError) return state.aiJsonError;
  // リネームのみモードはAIデータなしでも進める（メタデータ削除ユーティリティとして）
  if (state.renameOnly) {
    return state.files.length ? "" : "ファイルを追加してください";
  }
  if (!state.files.length && !state.aiText.trim()) return "ファイルの追加とAI整理データの貼り付けが必要です";
  if (!state.files.length) return "ファイルを追加してください";
  if (!state.aiText.trim()) return "AIの整理データを貼り付けてください（少数の追加なら「AIを使わずに進む」も使えます）";
  return "";
}

function removeFile(path) {
  state.files = state.files.filter((x) => x.path !== path);
  state.matchKey = ""; // force照合/確認データの再構築
  update();
}

function renderStart() {
  $("file-count-pill").textContent = `${state.files.length}件`;
  $("clear-files-btn").hidden = state.files.length === 0;
  $("copy-names-row").hidden = state.files.length === 0; // ファイル名リストのコピーは読み込み後に

  // A3を超えるPDF（mintsはA4/A3のみ）は出力時にA3へ縮小する旨と、縮小で読み取りに支障が
  // 出る場合の選択肢（紙提出・記録外）を案内する。
  const oversize = state.files.filter((f) => f.overA3);
  if (oversize.length) {
    const list = oversize.map((f) => `「${f.name}」（約${f.overA3.wmm}×${f.overA3.hmm}mm）`).join("、");
    $("oversize-warning-text").textContent =
      `${list} はA3を超えています（mintsの提出物はA4・A3のみ）。出力時はA3に縮小して収めます。` +
      `図面など縮小すると読み取りに支障がある場合は、紙での提出、または「記録外」としてのアップロード（サイズ制限なし）をご検討ください。`;
  }
  $("oversize-warning").classList.toggle("is-visible", oversize.length > 0);

  const list = $("file-list");
  list.innerHTML = "";
  for (const f of state.files) {
    const row = document.createElement("div");
    row.className = "file-row";
    const type = document.createElement("span");
    type.className = "file-type";
    type.textContent = f.type;
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = f.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.title = "この提出ファイルを外す";
    remove.setAttribute("aria-label", `${f.name} を外す`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeFile(f.path));
    row.append(type, name, remove);
    list.appendChild(row);
  }

  const ta = $("ai-textarea");
  if (ta.value !== state.aiText) ta.value = state.aiText;

  // 正常受領時は生JSONを畳んで受領カードを表示（畳むのは貼り付け操作の直後のみ。
  // 「内容を見る」でテキストエリアに戻れる）。
  const hasValid = state.aiText.trim() !== "" && !state.aiJsonError;
  const showCard = hasValid && state.aiCardCollapsed;
  $("ai-receipt").hidden = !showCard;
  ta.hidden = showCard;
  $("paste-btn").hidden = showCard;
  if (showCard) $("ai-receipt-sub").textContent = aiReceiptSummary();

  // JSONエラーは他の警告と同じバナー方式＋入力欄にも赤枠で「ここが原因」を示す
  const errEl = $("ai-json-error");
  if (state.aiJsonError) {
    $("ai-json-error-text").textContent = state.aiJsonError;
    errEl.hidden = false;
  } else {
    errEl.hidden = true;
  }
  ta.classList.toggle("is-error", !!state.aiJsonError);

  // リネームのみモードはAIデータが空でも進める（元名のままメタデータ削除だけ行う）。
  // AIデータが貼られているのに壊れている場合は通常どおりブロックする。
  const canProceed = state.files.length > 0 && !state.aiJsonError &&
    (state.renameOnly || state.aiText.trim() !== "");
  // 照合の相手（AIデータ）が無いときはボタンの行き先表示も「確認へ進む」にする。
  // AIデータがあるときは照合してから、問題が無ければ確認へ直行する（行き先はまだ決まらない）ので
  // 「照合して進む」とする。※ここで skipMatchStep() を使わない（照合前なので判定できない）。
  const nextLabel = noAiData() ? "確認へ進む" : "照合して進む";
  $("to-match-btn").textContent = nextLabel;
  $("to-match-btn").disabled = !canProceed;
  $("proceed-hint").textContent = canProceed ? "" : hintMessage();
  // 上部の同機能ボタン（下部がスクロールしないと見えない対策）を同期
  $("to-match-top-btn").textContent = nextLabel;
  $("to-match-top-btn").disabled = !canProceed;
  $("proceed-hint-top").textContent = canProceed ? "" : hintMessage();
  // 「AIを使わずに進む」: ファイルがあって AIの整理データがまだ無いときだけ出す（リネームのみは元から AI 不要）
  const offerNoAi = !state.renameOnly && state.files.length > 0 && !state.aiText.trim();
  $("no-ai-btn").hidden = !offerNoAi;
  $("no-ai-top-btn").hidden = !offerNoAi;
}

function renderMatch() {
  const rfs = state.reviewFiles;
  const matchCount = rfs.filter((r) => r.matched).length;
  const warnCount = rfs.filter((r) => needsAttention(r)).length; // 二択持ちも「確認」に数える
  const deleteCount = rfs.reduce((sum, r) => sum + r.metadata.filter((m) => m.action === "delete").length, 0);

  $("metric-filecount").textContent = String(state.files.length);
  $("metric-matchcount").textContent = String(matchCount);
  $("metric-warncount").textContent = String(warnCount);
  $("metric-deletecount").textContent = String(deleteCount);

  // 未一致の分類。unmatchedRows＝読み込んだのにAIに無いファイル、
  // orphans＝AIにあるのにファイルが無いエントリ。両者の組合せで案内を出し分ける。
  const orphans = state.orphanEntries || [];
  const unmatchedRows = rfs.filter((r) => !r.matched && !noAiData());
  const forgotToLoad = orphans.length > 0 && unmatchedRows.length === 0; // 読み込み忘れ
  const forgotToSend = orphans.length === 0 && unmatchedRows.length > 0; // 送信忘れ
  const genuineAssign = orphans.length > 0 && unmatchedRows.length > 0;  // 表記ゆれ等の手動割当

  const banner = $("warn-banner");
  banner.hidden = warnCount === 0;
  if (warnCount > 0) $("warn-count-badge").textContent = `確認 ${warnCount}件`;
  // all-clear (nothing flagged, no warnings, 証拠説明書 consistent, 未一致/orphanなし) -> skip review
  const hasConsistencyIssue = !!(state.consistency && state.consistency.issues.length);
  const allClear = warnCount === 0 && !hasConsistencyIssue && state.aiWarnings.length === 0 &&
    orphans.length === 0;
  $("allclear-banner").hidden = !allClear;
  $("match-skip-btn").hidden = !allClear;

  renderConsistency();

  const extra = $("extra-warnings");
  extra.innerHTML = "";

  // AIデータにあるファイルが読み込まれていない（＝読み込み忘れ）。割り当て先が
  // 無いので「手動で割り当て」ではなく、読み込みへ戻る導線を強く出す。
  if (forgotToLoad) {
    const div = document.createElement("div");
    div.className = "warn-banner inline is-visible";
    const pill = document.createElement("span");
    pill.className = "pill pill-warn-solid pill-nowrap";
    pill.textContent = "読み込み忘れ？";
    const text = document.createElement("div");
    text.className = "warn-text";
    const lead = document.createElement("div");
    lead.className = "uw-lead";
    lead.textContent = "AIの整理データにある次のファイルが読み込まれていません（読み込み忘れの可能性があります）:";
    const names = document.createElement("div");
    names.className = "uw-line";
    names.textContent = orphans.map((e) => e.original_file_name).join("、");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zone-fix-btn back-to-load-btn";
    btn.textContent = "読み込みへ戻ってファイルを追加する";
    btn.addEventListener("click", () => goStep("start"));
    text.append(lead, names, btn);
    div.append(pill, text);
    extra.appendChild(div);
  }

  // 読み込んだファイルがAIデータに1件も無い（＝AIへの送信忘れ）。送り忘れの疑いが
  // あるファイル名を1つのバナーに圧縮して表示する（各行の無意味なドロップダウンは出さない）。
  if (forgotToSend) {
    const div = document.createElement("div");
    div.className = "warn-banner inline is-visible";
    const pill = document.createElement("span");
    pill.className = "pill pill-warn-solid pill-nowrap";
    pill.textContent = "送信忘れ？";
    const text = document.createElement("div");
    text.className = "warn-text";
    const lead = document.createElement("div");
    lead.className = "uw-lead";
    lead.textContent = "次のファイルはAIの整理データに含まれていません（AIへ送り忘れていないかご確認ください）:";
    const names = document.createElement("div");
    names.className = "uw-line";
    names.textContent = unmatchedRows.map((r) => r.name).join("、");
    text.append(lead, names);
    div.append(pill, text);
    extra.appendChild(div);
  }

  // 手動割当が有効なケース（AIにも未対応があり、読み込んだ側にも未一致がある＝表記ゆれ等）。
  // 従来どおりクリックで未一致行へ誘導する。
  if (genuineAssign) {
    for (const entry of orphans) {
      const div = document.createElement("div");
      div.className = "warn-banner inline is-visible is-clickable";
      div.title = "クリックすると未一致のファイル行へ移動します";
      const text = document.createElement("div");
      text.className = "warn-text";
      text.textContent = `AIデータ内の「${entry.original_file_name}」に対応するファイルがありません（未一致のファイルに手動で割り当てられます）。`;
      div.appendChild(text);
      div.addEventListener("click", () => {
        const target = document.querySelector("#match-rows .table-row.has-assign");
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("is-highlighted");
        setTimeout(() => target.classList.remove("is-highlighted"), 2500);
      });
      extra.appendChild(div);
    }
  }

  for (const w of state.aiWarnings) {
    const div = document.createElement("div");
    div.className = "warn-banner inline is-visible";
    const text = document.createElement("div");
    text.className = "warn-text";
    text.textContent = w;
    div.appendChild(text);
    extra.appendChild(div);
  }

  const rows = $("match-rows");
  rows.innerHTML = "";
  for (const r of rfs) {
    const row = document.createElement("div");
    row.className = "table-row" + (r.needsConfirmation ? " is-flagged" : "");
    if (!r.matched || r.manualMatch) row.classList.add("has-assign"); // 誘導先の目印

    const main = document.createElement("div");
    main.className = "row-main";

    const stateCell = document.createElement("span");
    const pill = document.createElement("span");
    pill.className = "pill " + (!r.matched ? "pill-danger" : r.manualMatch ? "pill-accent" : r.needsConfirmation ? "pill-warn" : "pill-ok");
    pill.textContent = !r.matched ? "未一致" : r.manualMatch ? "手動割当" : r.needsConfirmation ? "確認" : "OK";
    stateCell.appendChild(pill);

    const suggestedCell = document.createElement("span");
    suggestedCell.className = "cell-suggested";
    if (r.matched) {
      suggestedCell.textContent = r.suggested;
    } else if (noAiData()) {
      // AIなしのリネームのみ＝元の名前のままメタデータ削除だけ行う（正常系）
      suggestedCell.textContent = r.suggested;
    } else {
      // Don't reuse the original name here — it looks like a match. Make the gap explicit.
      suggestedCell.classList.add("cell-empty");
      suggestedCell.textContent = "—（AIデータに該当なし）";
    }

    const originalCell = document.createElement("span");
    originalCell.className = "cell-original";
    originalCell.textContent = r.name;

    main.append(stateCell, suggestedCell, originalCell);
    row.appendChild(main);

    // Unmatched (or manually linked) rows get a control to link an AI entry by hand.
    // 割り当て候補が1件も無い未一致行は、使えないドロップダウンではなく1行の短い
    // 注記だけにする（送り忘れバナーへ誘導）。手動割当済みの行は従来どおりセレクトを出す。
    if (!r.matched || r.manualMatch) {
      if (assignCandidatesFor(r).length === 0 && !r.manualMatch) {
        const note = document.createElement("div");
        note.className = "row-assign-empty";
        note.textContent = "AIデータに該当なし（上の「送信忘れ？」の案内をご確認ください）";
        row.appendChild(note);
      } else {
        row.appendChild(buildAssignRow(r));
      }
    }

    rows.appendChild(row);
  }
}

// Assignment candidates for a row: orphan AI entries, plus the currently-assigned one.
function assignCandidatesFor(r) {
  const candidates = (state.orphanEntries || []).slice();
  const assignedName = state.manualMatches[r.path];
  if (assignedName && !candidates.some((e) => e.original_file_name === assignedName)) {
    const cur = (state.aiEntries || []).find((e) => e.original_file_name === assignedName);
    if (cur) candidates.unshift(cur);
  }
  return candidates;
}

// v3 pattern A: show the 証拠説明書 consistency result (green if the declared range
// matches the evidence files, warn otherwise). Hidden when there is no 証拠説明書.
function renderConsistency() {
  const box = $("consistency-box");
  box.innerHTML = "";
  const c = state.consistency;
  if (!c) return;

  const wrap = document.createElement("div");
  const ok = c.issues.length === 0;
  if (ok) {
    wrap.className = "ok-banner";
    const pill = document.createElement("span");
    pill.className = "pill pill-ok";
    pill.textContent = "整合";
    const txt = document.createElement("span");
    txt.className = "ok-text";
    txt.textContent = `証拠説明書${c.range ? `（${c.range}）` : ""}と証拠ファイルは整合しています。`;
    wrap.append(pill, txt);
  } else {
    wrap.className = "warn-banner inline is-visible consistency-warn";
    const pill = document.createElement("span");
    pill.className = "pill pill-warn-solid pill-nowrap";
    pill.textContent = "証拠説明書と不一致";
    const txt = document.createElement("div");
    txt.className = "warn-text";
    const lead = document.createElement("div");
    lead.className = "uw-lead";
    lead.textContent = `証拠説明書${c.range ? `（${c.range}）` : ""}と証拠ファイルに食い違いがあります:`;
    txt.appendChild(lead);
    for (const issue of c.issues) {
      const line = document.createElement("div");
      line.className = "uw-line";
      line.textContent = issue;
      txt.appendChild(line);
    }
    wrap.append(pill, txt);
  }
  box.appendChild(wrap);
}

// Builds the "手動で割り当て" control for one file row.
function buildAssignRow(r) {
  const wrap = document.createElement("div");
  wrap.className = "row-assign";

  const label = document.createElement("span");
  label.className = "assign-label";
  label.textContent = "AIデータを手動で割り当て:";

  const select = document.createElement("select");
  select.className = "assign-select";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = r.manualMatch ? "（割り当てを解除）" : "（未割り当て）";
  select.appendChild(none);

  // Candidates: orphan entries, plus the currently-assigned one (which is no longer
  // an orphan because it now matches this file).
  const candidates = assignCandidatesFor(r);
  const assignedName = state.manualMatches[r.path];

  for (const e of candidates) {
    const opt = document.createElement("option");
    opt.value = e.original_file_name;
    const bits = [e.original_file_name];
    if (e.evidence_number) bits.push(e.evidence_number);
    if (e.title) bits.push(e.title);
    opt.textContent = bits.join(" ／ ");
    if (e.original_file_name === assignedName) opt.selected = true;
    select.appendChild(opt);
  }

  if (!candidates.length) {
    none.textContent = "（割り当て可能なAIデータがありません）";
    select.disabled = true;
  }

  select.addEventListener("change", (ev) => {
    const val = ev.target.value;
    if (val) state.manualMatches[r.path] = val;
    else delete state.manualMatches[r.path];
    rematch();
  });

  wrap.append(label, select);
  return wrap;
}

// Recompute matches after a manual assignment and re-render the match screen.
function rematch() {
  state.matchKey = "";
  buildReviewFiles();
  renderMatch();
}

// Renderer-side mirror of pdf-engine deriveLabel (the engine is main-process
// only). Keep both in sync: "甲001" + branch -> "甲第1号証(の…)".
function deriveStampLabel(evidenceNumber, branch) {
  if (!evidenceNumber) return null;
  const m = /^(\D+)0*(\d+)$/.exec(String(evidenceNumber).trim());
  if (!m) return null;
  let s = `${m[1]}第${m[2]}号証`;
  const b = branch == null ? "" : String(branch).trim();
  if (b) s += `の${b}`;
  return s;
}

function evidenceGroupCount(num) {
  if (!num) return 0;
  return state.reviewFiles.filter((x) => x.evidenceNumber === num).length;
}

// Sets the editable input from state. Called only on (re)render, not while
// the user is typing, to avoid resetting the caret.
function renderEvidenceInfo(rf) {
  $("rf-evnum-input").value = rf.evidenceNumber || "";
  $("rf-branch-input").value = rf.branchRange || "";
  renderEvidenceDerived(rf);
}


// Both the picker and drop paths now return { accepted, rejected }; add the accepted
// files and warn about anything that cannot be submitted (wrong format, etc.).
function handleAddResult(res) {
  const accepted = (res && res.accepted) || [];
  const rejected = (res && res.rejected) || [];
  hideUnsupportedWarning();
  if (accepted.length) addFiles(accepted);
  if (rejected.length) renderUnsupportedWarning(rejected);
}

function hideUnsupportedWarning() {
  $("unsupported-warning").classList.remove("is-visible");
}

function renderUnsupportedWarning(rejected) {
  const textEl = $("unsupported-warning-text");
  textEl.innerHTML = "";
  const lead = document.createElement("div");
  lead.className = "uw-lead";
  lead.textContent = "次のファイルは提出できません:";
  textEl.appendChild(lead);
  // Group filenames by reason so repeated messages collapse into one line.
  const byReason = new Map();
  for (const r of rejected) {
    if (!byReason.has(r.reason)) byReason.set(r.reason, []);
    byReason.get(r.reason).push(r.name);
  }
  for (const [reason, names] of byReason) {
    const line = document.createElement("div");
    line.className = "uw-line";
    const nm = document.createElement("span");
    nm.className = "uw-names";
    nm.textContent = names.join("、");
    const rs = document.createElement("span");
    rs.className = "uw-reason";
    rs.textContent = reason;
    line.append(nm, rs);
    textEl.appendChild(line);
  }
  $("unsupported-warning").classList.add("is-visible");
}

// 添付ファイルの「実際のファイル名」を番号付きで並べた指示文。AIは添付の内部参照名
// （[source: N]）に引っ張られ実ファイル名を書けないことがあるため、これをチャット本文に貼って
// 直接渡すと確実。番号は添付順の目安（この順に添付すると [source: N] と対応が取れる）。
function buildFilenameListText() {
  const lines = state.files.map((f, i) => `${i + 1}: ${f.name}`);
  return "【添付ファイルの実際のファイル名】以下の順で添付します。整理データ(JSON)の "
    + "original_file_name には、各ファイルのこの名前を一字一句そのまま使ってください"
    + "（「[source: N]」等の内部参照名にしないこと）。\n" + lines.join("\n");
}
// 照合画面で人が対応すべきことがあるか: 読み込んだファイルがAIデータに無い（送り忘れ・表記ゆれ）、
// AIデータのファイルが読み込まれていない（読み込み忘れ）、証拠説明書との食い違い、
// AIからの注意・記号ずれ・PDF情報の読み取り失敗（state.aiWarnings に集約済み）。
// 「要確認」のファイルは確認画面で1件ずつ対応する仕組みがあるので、ここには含めない。
function matchHasIssues() {
  const orphans = state.orphanEntries || [];
  const unmatched = state.reviewFiles.filter((r) => !r.matched);
  const consistency = !!(state.consistency && state.consistency.issues.length);
  return orphans.length > 0 || unmatched.length > 0 || consistency || state.aiWarnings.length > 0;
}

// 照合ステップを飛ばして確認へ直行するか。
// リネームのみ＋AIデータなしのときは、照合する相手（AIデータ）が無い。
// それ以外でも、照合で対応すべきことが何も無ければ照合画面は素通りされるだけなので飛ばす
// （上の段の「照合」から戻って中身を見ることはできる）。
function skipMatchStep() {
  return noAiData() || !matchHasIssues();
}

// 読み込み後の行き先を決める。飛ばしたかどうかは、確認画面の「戻る」の行き先と案内文に使う
// （照合で問題を直してから確認へ進んだ人は、「戻る」で照合へ戻れるようにする）。
function enterMatchOrReview() {
  const skip = skipMatchStep();
  state.matchSkipped = skip;
  advanceStep(skip ? "review" : "match");
}

async function proceedToMatch() {
  await ensureMetadataLoaded();
  buildReviewFiles();
  enterMatchOrReview();
}
// ---------- 事務所の書き方メモ（firm-notes） ----------
// userData/firm-notes.txt に保存し、「AI用プロンプトをコピー」時にmain側で末尾へ連結する。
// 本体プロンプトはアプリ更新で保守されるので、事務所の工夫はここに書けば更新で消えない。
function closeFirmNotesModal() {
  $("firm-notes-overlay").hidden = true;
  $("firm-notes-status").textContent = "";
}

