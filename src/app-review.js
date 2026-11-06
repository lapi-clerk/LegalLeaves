// ---------------------------------------------------------------------------
// 「確認」画面（証拠一覧・ドラッグ並べ替え・スタンプ行・元ファイルプレビュー）と
// 「出力」「完了」画面の描画
//
// src/app.js から分離。関数の中身は移動しただけで変更していない。
// ---------------------------------------------------------------------------

// Renders the parts that depend on the evidence number (merge note + stamp
// labels). Called on render AND live as the number is edited.
function renderEvidenceDerived(rf) {
  // 証拠番号欄はキャレット保持のため renderReview() を通らない軽量更新パス
  // なので、「AIの値に戻す」ヒントもここで更新する（入力中に即時表示されるように）。
  renderAiOriginalHint("rf-evnum-orig", rf, "evidenceNumber", rf.evidenceNumber);
  renderNumMismatch(rf);
  const mergeNote = $("rf-merge-note");
  const num = rf.evidenceNumber;
  const groupN = evidenceGroupCount(num);
  mergeNote.innerHTML = "";
  if (groupN > 1) {
    mergeNote.hidden = false;
    const disabled = state.mergeDisabled.has(num);
    const text = document.createElement("span");
    text.className = "merge-text";
    text.textContent = disabled
      ? `別々に出力: 「${num}」の ${groupN}件を個別のPDFにします。`
      : `結合: 同じ番号「${num}」の ${groupN}件を1つの号証PDFにまとめます。`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "merge-toggle-btn";
    btn.textContent = disabled ? "1つに結合" : "別々に出力";
    btn.addEventListener("click", () => {
      if (disabled) state.mergeDisabled.delete(num);
      else state.mergeDisabled.add(num);
      renderEvidenceDerived(rf);
    });
    mergeNote.append(text, btn);
  } else {
    mergeNote.hidden = true;
  }

  const list = $("rf-stamp-list");
  list.innerHTML = "";
  const stamps = Array.isArray(rf.stamps) ? rf.stamps : [];
  if (!stamps.length) {
    if (rf.evidenceNumber) {
      // 「押印を追加」ボタンという別パラダイムを廃止。番号があるのにスタンプが無い
      // ときは、既定で「押印なし（draw_label:false）」のスタンプを実際に持たせ、
      // 既存の押印なし行と同じトグル行で表示する（トグルでオン/オフ）。出力結果は不変。
      const stamp = { page: 1, branch: null, draw_label: false, rotate_degrees: 0, position: { x: 0.93, y: STAMP_SAFE_Y, anchor: "top-right" } };
      rf.stamps = [stamp];
      list.appendChild(makeStampRow(rf, stamp));
    } else {
      const none = document.createElement("div");
      none.className = "stamp-row stamp-none";
      none.textContent = "押印・回転なし";
      list.appendChild(none);
    }
    return;
  }
  stamps.forEach((s) => list.appendChild(makeStampRow(rf, s)));
}

// mints提出後、各PDFの1ページ目上部に裁判所のタイムスタンプ帯が付される。
// 帯の位置と証拠番号の既定位置は src/timestamp-zone.js に集約した（唯一の定義場所）。
// ここでは TIMESTAMP_ZONE / STAMP_SAFE_Y / TS_*_PT / IMG_NUMBER_TOP_PT をそのまま使う。
// ※A4横・A3の帯の位置は未確認。詳細は timestamp-zone.js の冒頭を参照。

// 画像（写真・スクショ）判定と、そこに焼き込む回転角（最初の非0）。画像は白帯＋番号が
// 回転で崩れるため、回転はプレビューのベースPDFへ焼き込む（PDFは従来どおりライブ回転）。
function isImageSrc(p) {
  return /\.(jpe?g|png)$/i.test(String(p || ""));
}
function imageBakeRotation(stamps) {
  for (const s of stamps || []) {
    const r = normalizeAngle((s && (s.rotate_degrees ?? s.rotate)) || 0);
    if (r) return r;
  }
  return 0;
}

// 位置の5択セレクト（CORNER_OPTIONS/CORNER_POS）は撤去した。位置調整はタイムスタンプ帯の
// 「帯の直下へ移動」ボタン＋プレビューのドラッグに一本化（実務ではほぼ右上固定のため）。

// この押印が「出力PDFの1ページ目」に載るか（＝タイムスタンプ帯と同じページか）。
// 結合される号証は先頭ファイルの1ページ目だけが出力の1ページ目になる（buildOutputPlanと同じ判定）。
function stampOnOutputFirstPage(rf, s) {
  if ((s.page ?? 1) !== 1) return false;
  const num = rf.evidenceNumber;
  if (num && !state.renameOnly && !isAvName(rf.name) && !state.mergeDisabled.has(num)) {
    // 結合順（枝番昇順）と同じ判定を使う（buildOutputPlanと一致させる）
    return mergeGroupFor(num)[0] === rf;
  }
  return true;
}

// 押印位置がタイムスタンプ帯に重なりそうか（上端アンカーでゾーン下端 y1 より上は干渉扱い）。
function stampHitsTimestampZone(rf, s) {
  if (s.draw_label === false) return false;
  const pos = s.position || {};
  const anchor = pos.anchor || "top-right";
  if (!anchor.startsWith("top")) return false;
  const y = typeof pos.y === "number" ? pos.y : STAMP_SAFE_Y;
  return stampOnOutputFirstPage(rf, s) && y < TIMESTAMP_ZONE.y1;
}
// v5.2.2: 提出用ファイル名の番号と証拠番号の食い違いを欄の下に示し、合わせるボタンを出す
function numFixLabels(rf) {
  const mm = filenameNumberMismatch(rf);
  if (!mm) return null;
  // 正しいほうに合わせるボタンだけを出す（片方が番号として正しくないとき。filenameNumberMismatch の種類を参照）
  const fileLabel = mm.file ? numberLabelWithBranch(mm.file.num, mm.file.branch) : "";
  const mine = mm.kind === "badNumber" || mm.kind === "bothBad"
    ? rf.evidenceNumber : numberLabelWithBranch(rf.evidenceNumber, rf.branchRange);
  const notEvidence = "（証拠でなければ、種類を変えてください）";
  const initialNumbersLabel = (x) => {
    const o = x.initialNumbers;
    return [o.evidenceNumber ? numberLabelWithBranch(o.evidenceNumber, o.branchRange) : "番号なし", o.suggested || "名前なし"].join("・");
  };
  const numText = mm.numEmpty ? "証拠番号が空です" : `証拠番号（${mine}）が番号として正しくありません`;
  return {
    text: {
      number: `ファイル名の番号（${fileLabel}）と証拠番号（${mine}）が違います`,
      missing: mm.nameEmpty ? "提出用ファイル名が空です" : `ファイル名が証拠番号（${mine}）で始まっていません`,
      badNumber: `${numText}。ファイル名の番号は ${fileLabel} です`,
      bothBad: mm.numEmpty && mm.nameEmpty
        ? `証拠番号と提出用ファイル名が空です。証拠番号を入力してください${notEvidence}`
        : `${numText}。${mm.nameEmpty ? "提出用ファイル名も空" : "ファイル名にも正しい番号がない"}ので、証拠番号を入力してください${mm.numEmpty ? notEvidence : ""}`,
      nameEmpty: "提出用ファイル名が空です",
    }[mm.kind],
    // 合わせる先が無いとき・ファイル名が空のときは、注意（オレンジ）ではなくエラー（赤）で示す
    error: mm.kind === "bothBad" || !!mm.nameEmpty,
    // 両方とも正しくないとき（合わせる先が無い）は、そのファイルだけ最初の値に戻せる（5.2.4 の試用で要望）
    reset: mm.kind === "bothBad" && canResetNumbers(rf) ? `最初の値に戻す（${initialNumbersLabel(rf)}）` : null,
    number: mm.kind === "number" || mm.kind === "badNumber" ? `証拠番号を${fileLabel}にする` : null,
    name: mm.kind === "number" || mm.kind === "missing" ? `ファイル名を${numberPrefix(rf.evidenceNumber, rf.branchRange)}で始める`
      : mm.kind === "nameEmpty" && String(rf.docName || "").trim() ? "ファイル名を標目から作る" : null,
  };
}
// 番号・枝番・ファイル名の欄を入力している間は出さない（1文字ごとに出たり消えたりし、途中の「甲0」で
// 「甲000で始める」のような誤った案内になるため。5.2.2 の試用で指摘）。Enter か欄を離れたときに出す。
const NUM_EDIT_FIELDS = ["rf-evnum-input", "rf-branch-input", "rf-suggested"];
function numFieldEditing() {
  return NUM_EDIT_FIELDS.includes(document.activeElement && document.activeElement.id);
}
// 一覧の行の印（5.2.5: 一覧では「甲000」がふつうの番号のように見えていた）。
// "error"（赤・エラー）／"warn"（オレンジ・要修正）／null。入力中の選択ファイルは、確定した時点の印のまま
function numMarkFor(rf) {
  const l = numFixLabels(rf);
  return l ? (l.error ? "error" : "warn") : null;
}
function numMarkForRow(rf, index) {
  if (index === state.selectedReview && numFieldEditing()) return rf._numMark === undefined ? null : rf._numMark;
  return numMarkFor(rf);
}
function setEvBadge(badge, attention, mark) {
  badge.className = "ev-badge" + (mark === "error" ? " is-error" : mark === "warn" || attention ? " is-attention" : "");
  badge.textContent = mark === "error" ? "エラー" : mark === "warn" ? "要修正" : attention ? "要確認" : "確認済";
}
// 一覧を作り直さずに、選んでいるファイルの行の印だけを直す（欄を離れた瞬間に一覧を作り直すと、
// 一覧の行を押したクリックが消えてしまうため）
function refreshRowNumMark(rf) {
  const i = state.reviewFiles.indexOf(rf);
  const badge = document.querySelector(`#review-list .ev-row[data-index="${i}"] .ev-badge`);
  if (badge) setEvBadge(badge, needsAttention(rf), rf._numMark);
}
// 入力中は、知らせを消さずに薄くして残す（消すと下の欄が上にずれ、入力している欄が動いたように見えるため。
// 5.2.4 の試用で指摘）。Enter か欄を離れたとき（確定）に中身を更新する。
let numMismatchShownFor = null;
function renderNumMismatch(rf) {
  const box = $("rf-num-mismatch");
  if (rf && numFieldEditing() && numMismatchShownFor === rf) {
    box.classList.add("is-stale");
    return;
  }
  numMismatchShownFor = rf;
  box.classList.remove("is-stale");
  const l = rf ? numFixLabels(rf) : null;
  if (rf) {
    rf._numMark = l ? (l.error ? "error" : "warn") : null;
    refreshRowNumMark(rf);
  }
  box.hidden = !l;
  if (!l) return;
  box.classList.toggle("is-error", !!l.error);
  $("rf-num-mismatch-text").textContent = l.text;
  $("rf-fix-number").hidden = !l.number;
  $("rf-fix-number").textContent = l.number || "";
  $("rf-fix-name").hidden = !l.name;
  $("rf-fix-name").textContent = l.name || "";
  $("rf-fix-reset").hidden = !l.reset;
  $("rf-fix-reset").textContent = l.reset || "";
}
// ボタンで合わせた後の画面の更新（確認画面・出力画面の両方から使う）
function applyNumFix(rf, which) {
  const done = which === "number" ? applyNumberFromFilename(rf)
    : which === "reset" ? resetNumbersToInitial(rf) : applyFilenameFromNumber(rf);
  if (done) prunePlaceholders();
  return done;
}

// v5.2.1: 向きを直すボタン（確認画面のプレビューの上と、出力前プレビューで共通）。
// rotate_degrees は AI との約束どおり「時計回り」の角度。右に90°＝+90、左に90°＝+270。
// 号証のスタンプすべてに同じ角度を入れる（スタンプが無ければ回転だけのスタンプを1ページ目に足す。
// 出力前プレビューの setPreviewRotate と同じ扱い）。回るのはスタンプのあるページ（ふつうは1ページ目）。
function rotationLabel(deg) {
  return { 0: "元の向き", 90: "右に90°回転", 180: "180°回転", 270: "左に90°回転" }[normalizeAngle(deg)];
}
function filesRotation(rfs) {
  for (const rf of rfs) for (const s of rf.stamps || []) if (s) return normalizeAngle(s.rotate_degrees ?? s.rotate ?? 0);
  return 0;
}
function setFilesRotation(rfs, deg) {
  const d = normalizeAngle(deg);
  for (const rf of rfs) {
    if (!rf.stamps || !rf.stamps.length) {
      rf.stamps = [{ page: 1, branch: null, draw_label: false, rotate_degrees: d, position: { x: 0.93, y: STAMP_SAFE_Y, anchor: "top-right" } }];
    } else {
      rf.stamps = rf.stamps.map((s) => ({ ...s, rotate_degrees: d }));
    }
  }
}
// ボタンの押下 → 新しい角度（data-rot が "reset" なら 0）
function nextRotation(current, rotAttr) {
  return rotAttr === "reset" ? 0 : normalizeAngle(current + Number(rotAttr));
}
// 状態の表示（prefix: "rf" | "preview"）。pagesNote は「1ページ目だけ回る」などの補足
function renderRotState(prefix, deg, pagesNote) {
  const el = $(`${prefix}-rot-state`);
  el.textContent = `向き: ${rotationLabel(deg)}${deg && pagesNote ? pagesNote : ""}`;
  el.classList.toggle("is-rotated", !!deg);
  $(`${prefix}-rot-reset`).hidden = !deg;
}
// 確認画面で回せるファイルか（出力前プレビューの previewStampTargets と同じ範囲＝号証番号のある証拠）
function canRotateInReview(rf) {
  return !!rf && !state.renameOnly && !!rf.evidenceNumber && !isAvName(rf.name);
}
// 確認画面: そのページに効く回転（時計回り）
function stampRotationForPage(rf, n) {
  const s = (rf.stamps || []).find((x) => x && (x.page ?? 1) === n && normalizeAngle(x.rotate_degrees ?? x.rotate ?? 0));
  return s ? normalizeAngle(s.rotate_degrees ?? s.rotate) : 0;
}
async function rotateInReview(rotAttr) {
  const rf = state.reviewFiles[state.selectedReview];
  if (!canRotateInReview(rf)) return;
  setFilesRotation([rf], nextRotation(filesRotation([rf]), rotAttr));
  renderEvidenceDerived(rf);
  if (!$("rf-source-preview").hidden) await openSourcePreview(rf);
}
// 画像を時計回りに回した表示用の URL（ブラウザは向きの情報を反映して描くので、見えている向きから回る）
async function rotatedImageUrl(url, deg) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const swap = deg === 90 || deg === 270;
  const cv = document.createElement("canvas");
  cv.width = swap ? h : w;
  cv.height = swap ? w : h;
  const g = cv.getContext("2d");
  g.translate(cv.width / 2, cv.height / 2);
  g.rotate((deg * Math.PI) / 180);
  g.drawImage(img, -w / 2, -h / 2);
  const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.9));
  return URL.createObjectURL(blob);
}

// One editable stamp: 押印 on/off toggle（回転は状態の表示だけ）.
function makeStampRow(rf, s) {
  const drawing = s.draw_label !== false;
  const row = document.createElement("div");
  row.className = "stamp-row stamp-row-edit";

  const page = document.createElement("span");
  page.className = "stamp-page";
  page.textContent = `p.${s.page ?? 1}`;

  const label = document.createElement("span");
  label.className = "stamp-label";
  if (drawing) {
    const text = deriveStampLabel(rf.evidenceNumber, s.branch ?? null);
    label.textContent = text || "(番号未確定)";
    if (!text) label.classList.add("is-flagged");
  } else {
    // 押印なしのときの行ラベル。回転が付いていればそれも添える。
    const curRotForLabel = ((Math.round((s.rotate_degrees || 0) / 90) * 90) % 360 + 360) % 360;
    label.textContent = curRotForLabel ? "押印なし（回転あり）" : "押印なし";
    label.classList.add("stamp-off");
  }

  const controls = document.createElement("div");
  controls.className = "stamp-controls";

  const toggle = document.createElement("button");
  toggle.type = "button";
  // 「押印する（有効）＝緑／なし＝赤系」。メタデータの「維持=緑」クラスを流用した際に
  // 対応が逆（押す=赤）になっていた配色を是正。
  toggle.className = "meta-toggle stamp-toggle" + (drawing ? " is-keep" : "");
  toggle.title = "押印する／しない";
  const knob = document.createElement("span");
  knob.className = "meta-knob";
  knob.textContent = drawing ? "押印" : "押印なし"; // 「なし」→「押印なし」
  toggle.appendChild(knob);
  toggle.addEventListener("click", () => { s.draw_label = !drawing; renderEvidenceDerived(rf); });

  // 位置セレクトは撤去（帯の直下ボタン＋プレビューのドラッグに一本化）。
  // v5.2.1: 回転のプルダウンも撤去し、プレビューの上のボタン（↺ ↻ 180°）に一本化。ここでは状態だけ示す。
  controls.append(toggle);
  const curRot = normalizeAngle(s.rotate_degrees ?? s.rotate ?? 0);
  if (curRot) {
    const note = document.createElement("span");
    note.className = "stamp-rot-note";
    note.textContent = rotationLabel(curRot);
    controls.append(note);
  }
  row.append(page, label, controls);

  // 出力1ページ目の上端アンカー押印がタイムスタンプ帯に入っていたら警告＋ワンクリック退避
  // （勝手には動かさない。人が確定する）。
  if (stampHitsTimestampZone(rf, s)) {
    const warn = document.createElement("div");
    warn.className = "stamp-zone-warn";
    const msg = document.createElement("span");
    msg.textContent = "⚠ mintsのタイムスタンプ帯（1ページ目・上端8〜19mm）と重なるおそれのある位置です。";
    const fix = document.createElement("button");
    fix.type = "button";
    fix.className = "zone-fix-btn";
    fix.textContent = "帯の直下（上端約21mm）へ移動";
    fix.addEventListener("click", () => {
      const pos = s.position || {};
      s.position = { x: typeof pos.x === "number" ? pos.x : 0.93, y: STAMP_SAFE_Y, anchor: pos.anchor || "top-right" };
      renderEvidenceDerived(rf);
    });
    warn.append(msg, fix);
    row.appendChild(warn);
  }
  return row;
}

// makeAddStampRow（「＋押印を追加」ボタン）は廃止。番号があるのにスタンプが無い場合も
// renderEvidenceDerived内で既定の「押印なし」トグル行として統一表示するようにした。

// A flagged file is resolved when: (choice files) every binary choice has been picked;
// (other files) the 確認しました box is ticked.
function fileResolved(rf) {
  // AIが author_alt を出しつつ needs_user_confirmation=false にすることがあるため、
  // 二択（押印・作成者）の有無を needsConfirmation より先に判定する。未解決の二択が
  // 残っているファイルを「確認済み」と表示してしまうバグの修正。
  // rename-only hides the choice widgets, so the checkbox is the only resolver there
  const hasChoice = !state.renameOnly && (!!rf.stampAsk || !!rf.authorAlt);
  if (hasChoice) {
    const stampOk = !rf.stampAsk || rf.stampDecided;
    const authorOk = !rf.authorAlt || rf.authorDecided;
    return stampOk && authorOk;
  }
  if (!rf.needsConfirmation) return true;
  return !!rf.userConfirmed;
}
// 「このファイルに答えるべき問いがあるか」。needsConfirmation（AIの確認フラグ）に加え、
// 二択（押印・作成者）が存在するファイルも対象（AIがフラグを立て忘れても取りこぼさない）。
function fileNeedsResolution(rf) {
  return !!rf.needsConfirmation || (!state.renameOnly && (!!rf.stampAsk || !!rf.authorAlt));
}
function needsAttention(rf) {
  return fileNeedsResolution(rf) && !fileResolved(rf);
}

// ---------- 確認画面の元ファイルプレビュー ----------
// 確認事項の判断のためにPDFを別アプリで開き直さなくて済むよう、選択中ファイルの
// 「元ファイルそのもの」をカード内に表示する（再生成なし）。PDFは同梱PDF.jsで直接
// 描画する＝Chromium内蔵ビュワーのサムネイル欄・ツールバーが幅を取る問題がない。
// Office・音声・動画などインライン表示できない形式はOSの既定アプリで開く。
const srcPv = { task: null, seq: 0, observer: null, opening: null };

function clearSourcePreview() {
  srcPv.seq++;
  if (srcPv.observer) {
    srcPv.observer.disconnect();
    srcPv.observer = null;
  }
  if (srcPv.task) {
    try { srcPv.task.destroy(); } catch (_) {}
    srcPv.task = null;
  }
  if (sourcePreviewUrl) {
    URL.revokeObjectURL(sourcePreviewUrl);
    sourcePreviewUrl = null;
  }
  sourcePreviewPath = null;
  $("rf-source-preview").hidden = true;
  $("rf-rot-bar").hidden = true;
  const pages = $("rf-source-pages");
  pages.innerHTML = "";
  pages.hidden = true;
  const img = $("rf-source-img");
  img.removeAttribute("src");
  img.hidden = true;
  $("rf-source-preview-btn").textContent = "元ファイルを見る";
  // 横長レイアウト（プレビューを右カラムに）も解除
  const card = document.querySelector(".review-card");
  if (card) card.classList.remove("has-src-preview");
}

async function toggleSourcePreview() {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  state.sourcePreviewTouched = true; // 一度でも押したら、窓を狭めても自動では閉じない
  if (!$("rf-source-preview").hidden && sourcePreviewPath === rf.path) {
    clearSourcePreview();
    state.autoSourcePreview = false; // 利用者が閉じたら、広い画面でもこのあとは自動で開かない
    return;
  }
  state.autoSourcePreview = true;
  await openSourcePreview(rf);
}

// 窓の大きさが変わったとき（実機確認での要望）:
//  - 狭い → 広い: 自動表示の条件（利用者が閉じていない）を満たせば開く
//  - 広い → 狭い: 利用者が一度もプレビューのボタンを押していなければ閉じる（自動で開いたものは自動で閉じる）
function onPreviewWidthChange(isWide) {
  if (state.step !== "review") return;
  if (isWide) autoOpenSourcePreview();
  else if (!state.sourcePreviewTouched && !$("rf-source-preview").hidden) clearSourcePreview();
}

// 広い画面（一覧｜内容｜プレビューの3列が並ぶ幅）では、選んだファイルのプレビューを自動で開く。
// PDF・画像だけ（Word 等は別のアプリが開いてしまうので自動では開かない）。
const WIDE_PREVIEW_QUERY = "(min-width: 1560px)";
function autoOpenSourcePreview() {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf || !state.autoSourcePreview || state.step !== "review") return;
  if (!window.matchMedia || !window.matchMedia(WIDE_PREVIEW_QUERY).matches) return;
  if (!/\.(pdf|png|jpe?g)$/i.test(rf.name)) return;
  if (sourcePreviewPath === rf.path || srcPv.opening === rf.path) return; // 表示中・開いている途中
  srcPv.opening = rf.path;
  openSourcePreview(rf).finally(() => { if (srcPv.opening === rf.path) srcPv.opening = null; });
}

async function openSourcePreview(rf) {
  clearSourcePreview();
  const res = await window.api.readSourceBytes(rf.path);
  if (rf !== state.reviewFiles[state.selectedReview]) return; // 読み込み中に別のファイルへ切り替えた
  if (!res || !res.bytes || !res.bytes.length) {
    // インライン非対応（Office・音声・動画）→ 外部アプリで開く（案Cフォールバック）
    await window.api.openSourceFile(rf.path);
    return;
  }
  sourcePreviewPath = rf.path;
  $("rf-source-preview").hidden = false;
  $("rf-source-preview-btn").textContent = "プレビューを閉じる";
  // 16:9等の横長画面ではプレビューを右カラムへ（CSSのメディアクエリ側で発効。
  // 縦長・画面分割時はクラスが付いていても従来どおり縦積みになる）
  const card = document.querySelector(".review-card");
  if (card) card.classList.add("has-src-preview");

  const rotatable = canRotateInReview(rf);
  $("rf-rot-bar").hidden = !rotatable;
  if (res.ext !== ".pdf") {
    const mime = res.ext === ".png" ? "image/png" : "image/jpeg";
    sourcePreviewUrl = URL.createObjectURL(new Blob([res.bytes], { type: mime }));
    const rot = rotatable ? imageBakeRotation(rf.stamps) : 0;
    if (rotatable) renderRotState("rf", rot, "");
    if (rot) {
      const seq = srcPv.seq;
      const turned = await rotatedImageUrl(sourcePreviewUrl, rot);
      if (seq !== srcPv.seq) { URL.revokeObjectURL(turned); return; }
      URL.revokeObjectURL(sourcePreviewUrl);
      sourcePreviewUrl = turned;
    }
    const img = $("rf-source-img");
    img.src = sourcePreviewUrl;
    img.hidden = false;
    return;
  }

  const pagesEl = $("rf-source-pages");
  pagesEl.hidden = false;
  if (!window.pdfjsLib) {
    pagesEl.textContent = "プレビュー部品（PDF.js）を読み込めませんでした。";
    return;
  }
  const seq = srcPv.seq;
  const task = pdfjsLib.getDocument({ data: new Uint8Array(res.bytes) });
  srcPv.task = task;
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (seq === srcPv.seq) pagesEl.textContent = "PDFを表示できませんでした。";
    return;
  }
  if (seq !== srcPv.seq) {
    try { task.destroy(); } catch (_) {}
    return;
  }
  if (rotatable) {
    const pages = [...new Set((rf.stamps || []).map((s) => s.page ?? 1))].sort((a, b) => a - b);
    renderRotState("rf", filesRotation([rf]),
      doc.numPages > pages.length ? `（${pages.map((p) => `${p}ページ目`).join("・")}）` : "");
  }
  const width = Math.max(280, pagesEl.clientWidth - 24);
  const slots = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const slot = document.createElement("div");
    slot.className = "source-page-slot";
    slot.dataset.page = String(n);
    slot.style.minHeight = `${Math.floor(width * 1.35)}px`; // 描画前の高さ確保（遅延描画用）
    pagesEl.appendChild(slot);
    slots.push(slot);
  }
  const fill = async (n) => {
    if (seq !== srcPv.seq) return;
    const page = await doc.getPage(n);
    if (seq !== srcPv.seq) return;
    const cv = document.createElement("canvas");
    cv.className = "source-page-canvas";
    // 回していなければ rotation 省略＝元PDFの/Rotateどおり。回したページはその分を足して表示する（v5.2.1）
    const extra = rotatable ? stampRotationForPage(rf, n) : 0;
    await renderPdfPage(page, cv, extra ? { width, rotation: normalizeAngle((page.rotate || 0) + extra) } : { width });
    if (seq !== srcPv.seq) return;
    const slot = slots[n - 1];
    slot.style.minHeight = "";
    slot.replaceChildren(cv);
    // pdf.jsが描けない画像（白黒スキャン=CCITTFax等）のページは真っ白になるので注記する
    if (await pvPageImageBlank(page, cv)) {
      if (seq !== srcPv.seq) return;
      const note = document.createElement("div");
      note.className = "pv-unrenderable-note";
      note.textContent = "この画像はプレビューでは表示できませんでした（白黒スキャンなど）。出力ファイルには正しく含まれます。";
      slot.appendChild(note);
    }
  };
  const EAGER = 5;
  for (let n = 1; n <= Math.min(doc.numPages, EAGER); n++) await fill(n);
  if (doc.numPages > EAGER && seq === srcPv.seq) {
    srcPv.observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        srcPv.observer.unobserve(en.target);
        fill(Number(en.target.dataset.page));
      }
    }, { root: $("rf-source-preview"), rootMargin: "500px" });
    for (let n = EAGER + 1; n <= doc.numPages; n++) srcPv.observer.observe(slots[n - 1]);
  }
}
// ---------- 号証番号順のファイル一覧 ----------
// 確認画面のファイル切替を、横並びチップから号証番号順の縦リストに置き換えたもの。
// 同じ号証番号のファイル（枝番）は1グループにまとめ、枝番の昇順で入れ子表示する
// （並び順は結合PDFのページ順＝mergeGroupFor と同じ基準）。証拠番号を持たないファイルは
// 末尾の「証拠以外」セクションへ。将来ここにプレースホルダ（Phase2）とドラッグ振り直し
// （Phase3）を足す前提の構造にしてある。
// 号証番号（"甲003"）を並べる共通比較: 記号→番号の昇順。パースできないものは文字列比較。
function evidenceNumberSort(a, b) {
  const pa = parseEvidenceNumber(a);
  const pb = parseEvidenceNumber(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  if (pa.sym !== pb.sym) return pa.sym.localeCompare(pb.sym);
  return pa.num - pb.num;
}

function buildEvidenceListModel() {
  const groups = new Map(); // evidenceNumber -> [{rf, index}]
  const others = [];
  state.reviewFiles.forEach((rf, index) => {
    if (!rf.evidenceNumber) {
      others.push({ rf, index });
      return;
    }
    if (!groups.has(rf.evidenceNumber)) groups.set(rf.evidenceNumber, []);
    groups.get(rf.evidenceNumber).push({ rf, index });
  });
  const ordered = [...groups.entries()]
    .map(([num, items]) => ({
      num,
      items: items.slice().sort((a, b) => branchSortKey(a.rf.branchRange) - branchSortKey(b.rf.branchRange)),
    }))
    .sort((a, b) => evidenceNumberSort(a.num, b.num));
  return { groups: ordered, others };
}

// 一覧に見えている順（号証番号順→証拠以外）の reviewFiles インデックス列。
// 「次の要確認ファイル」を画面の並び順で探すのに使う。
function orderedReviewIndices() {
  const { groups, others } = buildEvidenceListModel();
  const idx = [];
  for (const g of groups) for (const it of g.items) idx.push(it.index);
  for (const it of others) idx.push(it.index);
  return idx;
}

// 「要確認のみ表示」中に、現在のファイルが確認済み（要確認でなくなった）ら、画面順で次の
// 要確認ファイルへ選択を移す。全件表示中・まだ未解決・他に要確認が無いときは動かさない。
function advanceToNextAttention() {
  if (state.showAllReview) return;
  const cur = state.selectedReview;
  const curRf = state.reviewFiles[cur];
  if (!curRf || needsAttention(curRf)) return; // まだ未解決なら移動しない
  const order = orderedReviewIndices();
  const pos = order.indexOf(cur);
  for (let step = 1; step <= order.length; step++) {
    const idx = order[(pos + step) % order.length];
    if (idx !== cur && needsAttention(state.reviewFiles[idx])) {
      state.selectedReview = idx;
      return;
    }
  }
}

// プレースホルダ関連。1件は {num:"甲003", branch:null|"2"}。
// branch=null は号証レベルの空き枠、branch="2" は甲003の中の枝番レベルの空き枠。
function usedEvidenceNumbers() {
  const s = new Set();
  for (const rf of state.reviewFiles) if (rf.evidenceNumber) s.add(rf.evidenceNumber);
  return s;
}
// 種類を「証拠」にしたのに番号が無いファイルへ振る「次の証拠番号」を推定する。号証記号は
// 片側のみが原則なので、既存の採番済み証拠の記号＋最大番号+1 を返す。採番済み証拠が
// 1件も無い（記号が分からない）ときは null（呼び手は番号欄へ誘導する）。
function nextEvidenceNumberSuggestion() {
  let sym = null;
  let maxNum = 0;
  for (const rf of state.reviewFiles) {
    const p = parseEvidenceNumber(rf.evidenceNumber);
    if (!p) continue;
    if (sym == null) sym = p.sym;
    if (p.sym === sym && p.num > maxNum) maxNum = p.num;
  }
  for (const ph of state.placeholders) { // 予約中の空き枠も既存扱いにして重複を避ける
    const p = parseEvidenceNumber(ph.num);
    if (p && p.sym === sym && p.num > maxNum) maxNum = p.num;
  }
  return sym ? padEvidence(sym, maxNum + 1) : null;
}
function hasPlaceholder(num, branch) {
  const b = branch == null ? null : String(branch);
  return state.placeholders.some((ph) => ph.num === num && (ph.branch == null ? null : String(ph.branch)) === b);
}
// ファイル（同じ番号／同じ番号＋枝番）が現れたプレースホルダは「埋まった」ので取り除く（自動消化）。
function prunePlaceholders() {
  if (!state.placeholders.length) return;
  state.placeholders = state.placeholders.filter((ph) => {
    if (ph.branch == null) {
      return !state.reviewFiles.some((rf) => rf.evidenceNumber === ph.num);
    }
    return !state.reviewFiles.some((rf) =>
      rf.evidenceNumber === ph.num && branchSortKey(rf.branchRange) === branchSortKey(ph.branch));
  });
}
// v5.2.0: 確認画面の「証拠説明書の内容（任意）」。証拠説明書を作れるとき（番号のある証拠・リネームのみでない・
// 既存の証拠説明書を使う場合でない）だけ出す。写真・スクリーンショット・動画は、作成者・作成年月日の欄が
// 撮影者・撮影日になる（証拠説明書の組み立て＝app-explanation.js と同じ使い分け）。
function explanationFieldKeys(rf) {
  const capture = !!(rf.captureKind && String(rf.captureKind).trim());
  return capture
    ? { author: "captureBy", date: "captureDatetime", authorLabel: "撮影者", dateLabel: "撮影日（例: R7.10.16）" }
    : { author: "author", date: "createdDate", authorLabel: "作成者", dateLabel: "作成年月日（例: R7.9.1）" };
}
function renderExplanationFields(rf) {
  const box = $("rf-expl-fields");
  const show = !!rf && !state.renameOnly && !state.explanationExists && !!rf.evidenceNumber && !isAvName(rf.name);
  box.hidden = !show;
  if (!show) return;
  const k = explanationFieldKeys(rf);
  $("rf-author-label").textContent = k.authorLabel;
  $("rf-created-label").textContent = k.dateLabel;
  $("rf-author-input").value = rf[k.author] || "";
  $("rf-created-input").value = rf[k.date] || "";
  $("rf-orig-select").value = ["原本", "写し"].includes(rf.originalOrCopy) ? rf.originalOrCopy : "";
  $("rf-purpose-input").value = rf.proofPurpose || "";
}

// 証拠番号・枝番を手で書き換えた後の追従（v5 の実機確認で、番号を書き換えても提出用ファイル名が古い
// 番号のまま残り「甲003_…pdf に甲第4号証」という食い違ったファイルができると分かった）。
//  1) 提出用ファイル名の先頭の番号（甲003_ / 甲003_2_）を新しい番号に差し替える。
//     利用者が名前を手で変えていて先頭が古い番号でなければ、触らない
//  2) 書き換えで途中の番号が空いたら、挿入したときと同じく「後で追加予定」の空き枠にする
//     （例: 甲003 を 甲004 にすると甲003 が空き枠）。空いた番号より後ろに証拠が無い（いちばん後ろの番号を
//     下へ直しただけ。例: 甲004 → 甲003）ときは、打ち間違いの訂正とみなして作らない
function numberPrefix(num, branch) {
  if (!num) return "";
  const b = branch == null ? "" : toHalfWidthFilenamePart(String(branch).trim());
  return b ? `${num}_${b}` : num;
}
function afterEvidenceNumberEdited(rf, oldNum, oldBranch) {
  const oldPrefix = numberPrefix(oldNum, oldBranch);
  // 番号として正しくない値（「甲0」など）には追従させない（ファイル名まで「甲000_」になり、
  // 正しいほうに合わせる手がかりが無くなるため。5.2.2 の試用で指摘）
  const newPrefix = isValidEvidenceNumber(rf.evidenceNumber) ? numberPrefix(rf.evidenceNumber, rf.branchRange) : "";
  if (oldPrefix && newPrefix && oldPrefix !== newPrefix && rf.suggested) {
    const s = rf.suggested;
    if (s.startsWith(oldPrefix + "_") || s.startsWith(oldPrefix + ".")) {
      rf.suggested = newPrefix + s.slice(oldPrefix.length);
    }
  } else if (!oldPrefix && newPrefix && rf.suggested && !rf.suggested.startsWith(newPrefix)) {
    rf.suggested = suggestedForTitle(rf, rf.docName); // 番号が無かったファイルに番号を付けた
  }
  // 正しくない番号にしたとき（「甲0」など入力の誤り）は、元の番号を空き枠にしない（すぐ直すため）
  if (oldNum && oldNum !== rf.evidenceNumber && isValidEvidenceNumber(rf.evidenceNumber)) addGapPlaceholderIfInside(oldNum);
  prunePlaceholders();
}
function addGapPlaceholderIfInside(num) {
  const p = parseEvidenceNumber(num);
  if (!p || p.num < 1) return; // 「甲000」のような正しくない番号は空き枠にしない（5.2.4 の試用で残っていた）
  if (state.reviewFiles.some((r) => r.evidenceNumber === num) || hasPlaceholder(num, null)) return;
  const later = state.reviewFiles.some((r) => {
    const q = parseEvidenceNumber(r.evidenceNumber);
    return q && q.sym === p.sym && q.num > p.num;
  });
  if (later) state.placeholders.push({ num, branch: null });
}
// 1ファイル分の行。selectedならハイライト、要確認ならバッジ。クリックでカードを切り替える。
// dragInfo を渡すとPhase3のドラッグ並べ替え対象になる。
function makeEvidenceRow({ rf, index }, sel, { branchLabel = "", showTitle = true, dragInfo = null } = {}) {
  const attention = needsAttention(rf);
  const row = document.createElement("button");
  row.type = "button";
  row.className = "ev-row" + (index === sel ? " is-active" : "") + (attention ? " needs-confirm" : "");
  row.dataset.index = String(index);
  if (dragInfo) attachEvDrag(row, dragInfo);

  const head = document.createElement("span");
  head.className = "ev-head";
  head.textContent = branchLabel || (rf.evidenceNumber || rf.kind || "—");
  row.append(head);

  const body = document.createElement("span");
  body.className = "ev-body";
  if (showTitle && rf.docName) {
    const title = document.createElement("span");
    title.className = "ev-title";
    title.textContent = rf.docName;
    body.append(title);
  }
  const file = document.createElement("span");
  file.className = "ev-file";
  file.textContent = rf.pageRange ? `${rf.name}（${pageRangeLabel(rf)}）` : rf.name;
  body.append(file);
  row.append(body);

  const badge = document.createElement("span");
  setEvBadge(badge, attention, numMarkForRow(rf, index));
  row.append(badge);

  row.addEventListener("click", () => {
    state.selectedReview = index;
    renderReview();
  });
  return row;
}

// 「後で追加予定」の空き枠の行（号証レベル／枝番レベル共通）。
// branch が null なら号証全体の空き枠、"2" なら枝番の空き枠（グループ内に入れ子表示）。
function makePlaceholderRow(num, branch) {
  const isBranch = branch != null;
  const box = document.createElement("div");
  box.className = "ev-group ev-placeholder" + (isBranch ? " ev-placeholder-branch" : "");
  const row = document.createElement("div");
  row.className = "ev-ph-row";
  // Phase3: 空き枠も並べ替え対象（枝番の空き枠は枝番レベル、号証の空き枠は号証レベル）
  attachEvDrag(row, isBranch ? { level: "branch", num, branch } : { level: "num", num });
  const head = document.createElement("span");
  head.className = "ev-head";
  head.textContent = isBranch ? `の${branch}` : num;
  const label = document.createElement("span");
  label.className = "ev-ph-label";
  label.textContent = "後で追加予定（ファイル未読み込み）";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ev-ph-remove";
  remove.title = "この枠を削除";
  remove.setAttribute("aria-label", `${isBranch ? num + "の" + branch : num} の枠を削除`);
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    state.placeholders = state.placeholders.filter((ph) =>
      !(ph.num === num && (ph.branch == null ? null : String(ph.branch)) === (isBranch ? String(branch) : null)));
    // 枝番の空き枠を消して枝番が1件だけになったら、単独の号証に戻す
    if (isBranch) normalizeBranches();
    renderReview();
    // 枠を消したら空いた番号／枝番。以降があれば「詰めますか？」を提案（挿入の取り消しになる）。
    if (isBranch) void offerCloseBranchGap(num, branchSortKey(branch));
    else { const p = parseEvidenceNumber(num); if (p) void offerCloseGap(p.sym, p.num); }
  });
  row.append(head, label, remove);
  box.append(row);
  return box;
}

function makeEvidenceGroupBox(g, sel, visible, branchPlaceholders) {
  const items = g.items.filter(visible);
  // 空き枠（プレースホルダ）は自分で作った保留中の操作なので、「要確認のみ表示」でも常に見せる
  // （でないと間違えて挿入したとき×で消せなくなる）。
  const phs = branchPlaceholders || [];
  if (!items.length && !phs.length) return null;
  const box = document.createElement("div");
  box.className = "ev-group";
  // 枝番の入れ子表示は、ファイル＋枝番の空き枠を合わせて2件以上あるとき
  if (g.items.length + phs.length >= 2) {
    const headRow = document.createElement("div");
    headRow.className = "ev-group-head";
    const num = document.createElement("span");
    num.className = "ev-group-num";
    num.textContent = g.num;
    const title = document.createElement("span");
    title.className = "ev-group-title";
    title.textContent = (g.items[0] && g.items[0].rf.docName) || "";
    headRow.append(num, title);
    const mergeable = g.items.filter((it) => !isAvName(it.rf.name)).length;
    if (!state.renameOnly && mergeable >= 2) {
      const note = document.createElement("span");
      const merged = !state.mergeDisabled.has(g.num);
      note.className = "ev-group-merge" + (merged ? "" : " is-split");
      note.textContent = merged ? `結合: ${mergeable}件を1つのPDFに` : `別々に出力: ${mergeable}件`;
      headRow.append(note);
    }
    attachEvDrag(headRow, { level: "num", num: g.num }); // ヘッダをつかんで号証ごと並べ替え
    box.append(headRow);
    // ファイル行と枝番の空き枠を、枝番の昇順でまとめて並べる。枝番はグループ内で並べ替え可能。
    const branchRows = [
      ...items.map((it) => ({ key: branchSortKey(it.rf.branchRange), el: makeEvidenceRow(it, sel, { branchLabel: it.rf.branchRange ? `の${it.rf.branchRange}` : "（枝番なし）", showTitle: false, dragInfo: it.rf.branchRange != null ? { level: "branch", num: g.num, branch: it.rf.branchRange } : null }) })),
      ...phs.map((ph) => ({ key: branchSortKey(ph.branch), el: makePlaceholderRow(g.num, ph.branch) })),
    ].sort((a, b) => a.key - b.key);
    for (const br of branchRows) box.append(br.el);
  } else {
    box.append(makeEvidenceRow(items[0], sel, { dragInfo: { level: "num", num: g.num } }));
  }
  return box;
}

// ---------- ドラッグで並べ替え（位置＝番号を振り直す） ----------
function clearDropIndicators() {
  document.querySelectorAll("#review-list .ev-drop-before, #review-list .ev-drop-after, #review-list .ev-drop-onto")
    .forEach((el) => el.classList.remove("ev-drop-before", "ev-drop-after", "ev-drop-onto"));
}
// 同じ号証記号どうしか（甲の枝番に乙は入れない）。
function sameEvidenceSymbol(a, b) {
  const pa = parseEvidenceNumber(a);
  const pb = parseEvidenceNumber(b);
  return !!pa && !!pb && pa.sym === pb.sym;
}
// ドロップ位置から before / after / onto（＝上に載せる＝枝番化）を決める。
// 行の中央帯（28〜72%）で、かつネスト可能なときだけ onto。
function evDropMode(e, el, canNest) {
  const rect = el.getBoundingClientRect();
  const rel = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
  if (canNest && rel >= 0.28 && rel <= 0.72) return "onto";
  return rel > 0.5 ? "after" : "before";
}
// 行/ヘッダをドラッグ元・ドロップ先にする。info={level, num[, branch]}。
function attachEvDrag(el, info) {
  el.setAttribute("draggable", "true");
  el.classList.add("ev-draggable");
  el.title = "ドラッグで並べ替え";
  // このターゲットに現在のドラッグを落とせるか＋落とし方を返す。{ kind, mode } or null。
  //  - 号証→号証: 並べ替え(before/after) または 上に載せる(onto=枝番化・同記号)
  //  - 枝番→同じ号証の枝番行: 枝番の並べ替え
  //  - 枝番→号証行（同記号）: 枝番の解除（その号証の前後へ独立した号証として出す）
  const dropPlan = (e) => {
    const d = evDrag;
    if (!d) return null;
    if (d.level === "num") {
      if (info.level !== "num") return null;
      // 刑事（弁/検）は枝番を使わないので、重ねて枝番化させない
      const canNest = d.num !== info.num && sameEvidenceSymbol(d.num, info.num) && !isCriminalEvidenceNum(info.num);
      return { kind: "num", mode: evDropMode(e, el, canNest) };
    }
    // d.level === "branch"
    if (info.level === "branch") {
      if (d.num !== info.num) return null; // 別号証の枝番行へは落とさない
      return { kind: "branch", mode: evDropMode(e, el, false) };
    }
    if (info.level === "num") {
      if (!sameEvidenceSymbol(d.num, info.num)) return null; // 枝番解除は同記号の号証列でだけ
      return { kind: "unnest", mode: evDropMode(e, el, false) };
    }
    return null;
  };
  el.addEventListener("dragstart", (e) => {
    evDrag = info;
    el.classList.add("ev-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", info.num + (info.branch || "")); } catch (_) {}
    e.stopPropagation();
  });
  el.addEventListener("dragend", () => { evDrag = null; el.classList.remove("ev-dragging"); clearDropIndicators(); });
  el.addEventListener("dragover", (e) => {
    const plan = dropPlan(e);
    if (!plan) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    el.classList.add(plan.mode === "onto" ? "ev-drop-onto" : plan.mode === "after" ? "ev-drop-after" : "ev-drop-before");
  });
  el.addEventListener("drop", (e) => {
    const plan = dropPlan(e);
    if (!plan) return;
    e.preventDefault();
    e.stopPropagation();
    const d = evDrag;
    clearDropIndicators();
    if (plan.kind === "num") {
      if (plan.mode === "onto") mergeAsBranch(d.num, info.num);
      else reorderNumUnit(d.num, info.num, plan.mode === "after");
    } else if (plan.kind === "branch") {
      reorderBranch(info.num, d.branch, info.branch, plan.mode === "after");
    } else { // unnest
      unnestBranch(d.num, d.branch, info.num, plan.mode === "after");
    }
  });
}

// 号証番号を「新しい並び順」に合わせて記号ごとに1,2,3…へ振り直す（衝突回避のため一旦退避）。
function applyRenumber(mapping) {
  for (const rf of state.reviewFiles) {
    if (rf.evidenceNumber && mapping.has(rf.evidenceNumber)) rf._newNum = mapping.get(rf.evidenceNumber);
  }
  for (const rf of state.reviewFiles) {
    if (rf._newNum) { rf.evidenceNumber = rf._newNum; delete rf._newNum; rf.suggested = suggestedForTitle(rf, rf.docName); }
  }
  state.mergeDisabled = new Set([...state.mergeDisabled].map((n) => mapping.get(n) || n));
  state.placeholders = state.placeholders.map((ph) => mapping.has(ph.num) ? { num: mapping.get(ph.num), branch: ph.branch } : ph);
  const expBase = explanationBaseName(state.reviewFiles);
  for (const rf of state.reviewFiles) if (rf.kind === "証拠説明書") rf.suggested = `${expBase}${submitExtFor(rf.name)}`;
}
function reorderNumUnit(draggedNum, targetNum, after) {
  if (draggedNum === targetNum) return;
  const { groups } = buildEvidenceListModel();
  const numPh = state.placeholders.filter((ph) => ph.branch == null).map((ph) => ph.num);
  let units = [...new Set([...groups.map((g) => g.num), ...numPh])].sort(evidenceNumberSort);
  units = units.filter((n) => n !== draggedNum);
  let idx = units.indexOf(targetNum);
  if (idx < 0) return;
  if (after) idx++;
  units.splice(idx, 0, draggedNum);
  // 記号ごとに位置順で 1,2,3… を割り当てる
  const counters = {};
  const mapping = new Map();
  for (const num of units) {
    const p = parseEvidenceNumber(num);
    if (!p) continue;
    counters[p.sym] = (counters[p.sym] || 0) + 1;
    mapping.set(num, padEvidence(p.sym, counters[p.sym]));
  }
  applyRenumber(mapping);
  renderReview();
}
function reorderBranch(num, draggedBranch, targetBranch, after) {
  const dragged = String(branchSortKey(draggedBranch));
  const target = String(branchSortKey(targetBranch));
  if (dragged === target) return;
  let branches = [
    ...state.reviewFiles.filter((rf) => rf.evidenceNumber === num && rf.branchRange != null).map((rf) => String(branchSortKey(rf.branchRange))),
    ...state.placeholders.filter((ph) => ph.num === num && ph.branch != null).map((ph) => String(branchSortKey(ph.branch))),
  ];
  branches = [...new Set(branches)].sort((a, b) => Number(a) - Number(b));
  branches = branches.filter((b) => b !== dragged);
  let idx = branches.indexOf(target);
  if (idx < 0) return;
  if (after) idx++;
  branches.splice(idx, 0, dragged);
  const mapping = new Map();
  branches.forEach((b, i) => mapping.set(b, String(i + 1)));
  for (const rf of state.reviewFiles) {
    if (rf.evidenceNumber === num && rf.branchRange != null) {
      const nb = mapping.get(String(branchSortKey(rf.branchRange)));
      if (nb) rf._newBranch = nb;
    }
  }
  for (const rf of state.reviewFiles) {
    if (rf._newBranch) {
      rf.branchRange = rf._newBranch;
      setStampBranch(rf, rf._newBranch);
      rf.suggested = suggestedForTitle(rf, rf.docName);
      delete rf._newBranch;
    }
  }
  state.placeholders = state.placeholders.map((ph) => {
    if (ph.num === num && ph.branch != null) {
      const nb = mapping.get(String(branchSortKey(ph.branch)));
      if (nb) return { num, branch: nb };
    }
    return ph;
  });
  renderReview();
}

// 号証番号を「一覧の並び順（＝番号順）」で記号ごとに 1,2,3… へ振り直す。
// ネスト（枝番化）で号証が1つ消えたあとの欠番を詰めるのに使う。
function renumberUnitsBySymbol() {
  const { groups } = buildEvidenceListModel();
  const numPh = state.placeholders.filter((ph) => ph.branch == null).map((ph) => ph.num);
  const units = [...new Set([...groups.map((g) => g.num), ...numPh])].sort(evidenceNumberSort);
  const counters = {};
  const mapping = new Map();
  for (const num of units) {
    const p = parseEvidenceNumber(num);
    if (!p) continue;
    counters[p.sym] = (counters[p.sym] || 0) + 1;
    const nn = padEvidence(p.sym, counters[p.sym]);
    if (nn !== num) mapping.set(num, nn);
  }
  if (mapping.size) applyRenumber(mapping);
}

// ドラッグした号証ユニットを、別の号証の「上に載せて」その枝番として取り込む。
// target の既存枝番の後ろに dragged のファイルを足し、枝番を 1,2,3… に振り直す。
// dragged 号証は消えるので、残りの号証番号を位置順に詰め直す（甲6→甲5 等）。
function mergeAsBranch(draggedNum, targetNum) {
  if (!draggedNum || !targetNum || draggedNum === targetNum) return;
  if (!sameEvidenceSymbol(draggedNum, targetNum)) return; // 記号違いはまとめない
  const bySort = (a, b) => branchSortKey(a.branchRange) - branchSortKey(b.branchRange);
  const targetFiles = state.reviewFiles.filter((rf) => rf.evidenceNumber === targetNum).sort(bySort);
  const draggedFiles = state.reviewFiles.filter((rf) => rf.evidenceNumber === draggedNum).sort(bySort);
  if (!targetFiles.length || !draggedFiles.length) return;
  // target の枝番→dragged の順に並べ、全ファイルを targetNum の枝番 1..N にする
  [...targetFiles, ...draggedFiles].forEach((rf, i) => {
    rf.evidenceNumber = targetNum;
    rf.branchRange = String(i + 1);
    setStampBranch(rf, rf.branchRange);
    rf.suggested = suggestedForTitle(rf, rf.docName);
  });
  // dragged 号証に紐づく空き枠（プレースホルダ）は取り込み対象外なので落とす
  state.placeholders = state.placeholders.filter((ph) => ph.num !== draggedNum);
  renumberUnitsBySymbol(); // 消えた号証の欠番を詰める
  renderReview();
}

// 指定号証の枝番を現在の順で 1,2,3… に詰める。残りが1件（＋空き枠なし）になったら枝番を外す。
function compactBranches(num) {
  const files = state.reviewFiles
    .filter((rf) => rf.evidenceNumber === num && rf.branchRange != null)
    .sort((a, b) => branchSortKey(a.branchRange) - branchSortKey(b.branchRange));
  const phs = state.placeholders
    .filter((ph) => ph.num === num && ph.branch != null)
    .sort((a, b) => branchSortKey(a.branch) - branchSortKey(b.branch));
  if (files.length + phs.length <= 1) {
    // 単独になった→枝番を外す（甲3の1 → 甲3）。空き枠だけ残ってもここで落とす。
    for (const rf of files) {
      rf.branchRange = null;
      setStampBranch(rf, null);
      rf.suggested = suggestedForTitle(rf, rf.docName);
    }
    state.placeholders = state.placeholders.filter((ph) => !(ph.num === num && ph.branch != null));
    return;
  }
  const items = [...files.map((rf) => ({ rf, k: branchSortKey(rf.branchRange) })),
                 ...phs.map((ph) => ({ ph, k: branchSortKey(ph.branch) }))]
    .sort((a, b) => a.k - b.k);
  items.forEach((it, i) => {
    const nb = String(i + 1);
    if (it.rf) {
      it.rf.branchRange = nb;
      setStampBranch(it.rf, nb);
      it.rf.suggested = suggestedForTitle(it.rf, it.rf.docName);
    } else {
      it.ph.branch = nb;
    }
  });
}

// 枝番を解除して独立した号証にする。対象ファイルを号証列（targetNum の前後）へ出し、
// 元の号証の残り枝番を詰め（単独なら枝番解除）、号証番号を位置順に振り直す。
function unnestBranch(sourceNum, branch, targetNum, after) {
  const sp = parseEvidenceNumber(sourceNum);
  if (!sp) return;
  const bkey = branchSortKey(branch);
  const file = state.reviewFiles.find(
    (rf) => rf.evidenceNumber === sourceNum && rf.branchRange != null && branchSortKey(rf.branchRange) === bkey);
  if (!file) return;
  // 1) 対象を一旦「同記号の大きな仮番号」の独立ユニットにして号証列へ隔離
  const tmp = padEvidence(sp.sym, 900000);
  file.evidenceNumber = tmp;
  file.branchRange = null;
  setStampBranch(file, null);
  file.suggested = suggestedForTitle(file, file.docName);
  // 2) 元号証の残り枝番を詰める（単独なら枝番解除）
  compactBranches(sourceNum);
  // 3) 仮ユニットを targetNum の前後へ挿し込み、号証番号を位置順に振り直す
  reorderNumUnit(tmp, targetNum, after);
}

// v5.2.1: 2つの号証番号の間で抜けている番号（同じ記号のときだけ）。刑事の弁・検も同じ扱い。
function evidenceGapBetween(a, b) {
  const pa = parseEvidenceNumber(a);
  const pb = parseEvidenceNumber(b);
  if (!pa || !pb || pa.sym !== pb.sym || pb.num - pa.num < 2) return [];
  const out = [];
  for (let n = pa.num + 1; n < pb.num && out.length < 200; n++) out.push(padEvidence(pa.sym, n));
  return out;
}
function gapRangeLabel(nums) {
  const short = nums.map((n) => shortNumberLabel(n));
  return short.length <= 3 ? short.join("・") : `${short[0]}〜${short[short.length - 1]}`;
}
function makeGapRow(nums) {
  const row = document.createElement("div");
  row.className = "ev-gap";
  const label = document.createElement("span");
  label.className = "ev-gap-label";
  label.textContent = `${gapRangeLabel(nums)} は今回のファイルにありません`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ev-gap-btn";
  btn.textContent = "後で追加予定にする";
  btn.title = "空き枠にします（証拠説明書には空行で出ます）。前に提出済みの番号なら、このままで構いません";
  btn.addEventListener("click", () => {
    for (const n of nums) if (!hasPlaceholder(n, null)) state.placeholders.push({ num: n, branch: null });
    renderReview();
  });
  row.append(label, btn);
  return row;
}

function renderEvidenceList(sel) {
  const listEl = $("review-list");
  listEl.innerHTML = "";
  prunePlaceholders();
  const { groups, others } = buildEvidenceListModel();
  // 「要確認のみ表示」の絞り込み（従来のチップと同じくファイル単位で効かせる）
  const visible = (item) => state.showAllReview || needsAttention(item.rf);

  // グループ（ファイル）と号証レベルの空き枠を号証番号順にマージ。
  // 枝番レベルの空き枠はグループへ渡して入れ子表示。空き枠は保留中の操作なので、
  // 「要確認のみ表示」でも常に見せる（間違えて挿入したとき×で消せるように）。
  const numPlaceholders = state.placeholders.filter((ph) => ph.branch == null);
  const groupNums = new Set(groups.map((g) => g.num));
  const entries = groups.map((g) => ({ num: g.num, type: "group", g }));
  for (const ph of numPlaceholders) {
    if (!groupNums.has(ph.num)) entries.push({ num: ph.num, type: "placeholder" });
  }
  entries.sort((a, b) => evidenceNumberSort(a.num, b.num));

  let prev = null;
  for (const e of entries) {
    // v5.2.1: 番号の抜け（甲1の次が甲4 など）を、その位置に薄い行で示す。後から追加する分だけを
    // 読み込んだとき（甲2・甲3 は前に提出済み）もあるので、自動では空き枠にしない（証拠説明書に空行が出るため）。
    // 「後で追加予定にする」を押したときだけ空き枠にする。
    const gap = prev ? evidenceGapBetween(prev, e.num) : [];
    if (gap.length) listEl.append(makeGapRow(gap));
    prev = e.num;
    if (e.type === "placeholder") {
      listEl.append(makePlaceholderRow(e.num, null));
      continue;
    }
    const branchPh = state.placeholders.filter((ph) => ph.branch != null && ph.num === e.g.num);
    const box = makeEvidenceGroupBox(e.g, sel, visible, branchPh);
    if (box) listEl.append(box);
  }

  const otherItems = others.filter(visible);
  if (otherItems.length) {
    const label = document.createElement("div");
    label.className = "ev-others-label";
    label.textContent = "証拠以外";
    listEl.append(label);
    const box = document.createElement("div");
    box.className = "ev-group";
    for (const it of otherItems) box.append(makeEvidenceRow(it, sel));
    listEl.append(box);
  }

  if (!listEl.children.length) {
    const empty = document.createElement("div");
    empty.className = "ev-empty";
    empty.textContent = "表示するファイルがありません。";
    listEl.append(empty);
  }

  // 要確認だけを表示しているときは、隠れている件数と「並べ替え・挿入は全件表示で」を示す
  // （実機確認で、全件表示にしないと並べ替えできることが分からないとの指摘があった）
  const hiddenCount = state.showAllReview ? 0 : state.reviewFiles.filter((r) => !needsAttention(r)).length;
  if (hiddenCount > 0) {
    const note = document.createElement("div");
    note.className = "ev-hidden-note";
    note.textContent = `ほか ${hiddenCount}件（確認済み）は表示していません。並べ替え・挿入は「全件を表示」にしてから行えます。`;
    listEl.append(note);
  }
}

function renderReview() {
  const rfs = state.reviewFiles;

  if (!rfs.length) {
    $("review-list").innerHTML = "";
    $("rf-name").textContent = "(対象のファイルがありません)";
    $("rf-badge").textContent = "";
    $("rf-badge").className = "pill";
    $("rf-warn-banner").classList.remove("is-visible");
    $("rf-kind").value = KIND_OPTIONS[0];
    $("rf-docname").value = "";
    $("rf-docname").classList.remove("is-flagged");
    $("rf-docname-tag").hidden = true;
    $("rf-suggested").value = "";
    $("rf-meta-rows").innerHTML = "";
    $("rf-delete-count").textContent = "削除 0件";
    $("rf-evnum-input").value = "";
    $("rf-evnum-input").classList.remove("is-flagged");
    $("rf-evnum-tag").hidden = true;
    $("rf-branch-input").value = "";
    $("rf-branch-field").hidden = true;
    $("rf-confirm-check-wrap").hidden = true;
    $("rf-conflict-resolve").hidden = true;
    $("rf-author-resolve").hidden = true;
    $("rf-stamp-resolve").hidden = true;
    $("bulk-stamp-bar").hidden = true;
    $("bulk-author-bar").hidden = true;
    $("insert-bar").hidden = true;
    $("rf-merge-note").hidden = true;
    $("rf-stamp-list").innerHTML = "";
    $("review-progress").hidden = true;
    $("review-next-btn").disabled = false;
    return;
  }

  // 照合を飛ばして来たときは、その旨を一言だけ示す（リネームのみ・AIデータなしは照合の相手が無いので出さない）
  const note = $("review-match-note");
  note.hidden = !state.matchSkipped || noAiData();
  if (!note.hidden) {
    note.textContent = `照合では問題がなかったため、確認画面へ進みました（${rfs.length}件のファイルがすべてAIの整理データと対応しています）。`;
  }

  if (state.selectedReview >= rfs.length) state.selectedReview = 0;
  const sel = state.selectedReview;
  const rf = rfs[sel];

  // 別のファイルへ切り替わったら開いていた元ファイルプレビューを閉じる
  if (sourcePreviewPath && (!rf || sourcePreviewPath !== rf.path)) clearSourcePreview();

  $("toggle-all-icon").textContent = state.showAllReview ? "−" : "+";
  $("toggle-all-label").textContent = state.showAllReview ? "要確認のみ表示" : "全件を表示";

  renderEvidenceList(sel);
  autoOpenSourcePreview(); // 広い画面では選んだファイルのプレビューを自動で開く

  // rename-only: keep the metadata (deletion) panel, but the evidence/stamp section
  // doesn't apply (no stamping in this mode).
  $("rf-meta-col").hidden = false;
  $("rf-evidence-block").hidden = state.renameOnly;

  // Bulk 押印 control. Shown for ANY batch with 2+ numbered evidences — not only when
  // the AI flagged them — because the AI can MISS an existing stamped number entirely
  // (double-stamp risk); the user must be able to declare "全部押印済み" in one click.
  const stampTargets = bulkStampTargets();
  const stampAskFiles = stampTargets.filter((r) => r.stampAsk);
  const bulkBar = $("bulk-stamp-bar");
  if (!state.renameOnly && stampTargets.length >= 2) {
    bulkBar.hidden = false;
    const pending = stampAskFiles.filter((r) => !r.stampDecided).length;
    const willStamp = (r) => (r.stamps || []).some((s) => s && s.draw_label !== false);
    const allNew = pending === 0 && stampTargets.every(willStamp);
    const allDone = pending === 0 && stampTargets.every((r) => !willStamp(r));
    bulkBar.classList.toggle("is-resolved", pending === 0);
    $("bulk-stamp-new").classList.toggle("is-active", allNew);
    $("bulk-stamp-done").classList.toggle("is-active", allDone);
    // 未回答が1件だけなら一括ボタンは冗長（個別選択と重複）なので隠して誘導だけにする
    const singleAsk = pending === 1 && stampAskFiles.length === 1;
    $("bulk-stamp-new").hidden = singleAsk;
    $("bulk-stamp-done").hidden = singleAsk;
    $("bulk-stamp-text").textContent = singleAsk
      ? "号証番号の押印の未回答が1件あります（下のカードの「号証番号の押印」で選択してください）"
      : pending > 0
        ? `号証番号の押印を確認したい証拠が ${stampAskFiles.length}件あります（未回答 ${pending}件）。一括で回答できます:`
        : `号証番号の押印（証拠 ${stampTargets.length}件）: 一括で切り替えられます。既に番号が押された証拠一式を取り込んだ場合は「すべて既に押印済み」を選んでください:`;
  } else {
    bulkBar.hidden = true;
  }

  // 作成者表記（役割名/実名）の一括適用バー。選択肢を持つファイルが2件以上のときだけ。
  const authorTargets = bulkAuthorTargets();
  const authorBar = $("bulk-author-bar");
  if (authorTargets.length >= 2) {
    authorBar.hidden = false;
    const pending = authorTargets.filter((r) => !r.authorDecided).length;
    const allRole = pending === 0 && authorTargets.every((r) => r.authorSource === "primary");
    const allName = pending === 0 && authorTargets.every((r) => r.authorSource === "alt");
    authorBar.classList.toggle("is-resolved", pending === 0);
    $("bulk-author-role").classList.toggle("is-active", allRole);
    $("bulk-author-name").classList.toggle("is-active", allName);
    $("bulk-author-text").textContent = pending > 0
      ? `作成者の表記を確認したい証拠が ${authorTargets.length}件あります（未選択 ${pending}件）。一括で選べます:`
      : `作成者の表記（証拠 ${authorTargets.length}件）: 役割名（原告／被告等）か実名（会社名・個人名）かを一括で切り替えられます:`;
  } else {
    authorBar.hidden = true;
  }

  // 「確認しました」チェックで解決する確認が2件以上あるとき、まとめて確認済みにできる。
  // （原本・写しの別のように、同じ確認がすべての証拠に付くことがある＝1件ずつ潰すのは手間）。
  const pendingConfirm = bulkConfirmTargets().filter((r) => !r.userConfirmed);
  const confirmBar = $("bulk-confirm-bar");
  if (pendingConfirm.length >= 2) {
    confirmBar.hidden = false;
    const texts = new Set(pendingConfirm.map((r) => (r.confirmText || "").trim()).filter(Boolean));
    const same = texts.size === 1 ? [...texts][0] : "";
    $("bulk-confirm-text").textContent = same
      ? `同じ確認が ${pendingConfirm.length}件あります（「${clipText(same, 42)}」）。内容を確認できたら、まとめて確認済みにできます:`
      : `内容を確認するだけの項目が ${pendingConfirm.length}件あります。確認できたら、まとめて確認済みにできます:`;
    $("bulk-confirm-all").textContent = `まとめて確認済みにする（${pendingConfirm.length}件）`;
  } else {
    confirmBar.hidden = true;
  }
  // 「証拠の挿入」は号証番号を持つファイルを選んでいるときだけ出す。
  // 枝番付きを選んでいるときは枝番レベルの挿入、単独なら号証レベルの挿入＋「枝番に分ける」。
  const showInsert = !state.renameOnly && !!rf.evidenceNumber;
  $("insert-bar").hidden = !showInsert;
  // 別のファイルへ切り替えたら、開いていたページ範囲の入力欄は閉じる
  if (state.splitPagesFor !== rf) closeSplitPagesForm();
  state.splitPagesFor = rf;
  if (showInsert) {
    const isBranch = rf.branchRange != null;
    // 単独のときだけ「甲1の1にする」（あとで甲1の2を足す予定のとき）。刑事（弁/検）は枝番を使わないので出さない。
    // 実機確認で「枝番に分ける」と「ページで枝番に分ける」の違いが分かりにくいとの指摘があり、押すと何が起きるか
    // そのまま分かるよう、実際の番号を入れた名前にした。
    $("rf-split-branch").hidden = isBranch || isCriminalEvidenceNum(rf.evidenceNumber);
    const shortNum = shortNumberLabel(rf.evidenceNumber);
    $("rf-split-branch").textContent = `${shortNum}の1にする`;
    $("rf-split-branch").title = `あとで${shortNum}の2を追加する予定のとき、この証拠を${shortNum}の1にしておきます` +
      `（${shortNum}の2の空き枠ができます）`;
    // 1つのPDFに複数の枝番がまとめてスキャンされているとき用（2ページ以上のPDFだけ）
    $("rf-split-pages").hidden = !canSplitByPages(rf);
    $("rf-unsplit-pages").hidden = !rf.pageRange;
    $("insert-bar-pages").hidden = $("rf-split-pages").hidden && $("rf-unsplit-pages").hidden;
    $("insert-bar-label").textContent = isBranch
      ? "選択中の枝番の前後に、枝番を割り込ませる（空き枠を作る）:"
      : "選択中の証拠に、別の証拠を割り込ませる（空き枠を作る）:";
    $("insert-bar-hint").textContent = isBranch
      ? "選択中の枝番の位置に空き枠ができ、以降の枝番は自動で繰り下がります。空き枠は証拠説明書に空行として出力されます。"
      : `空き枠より後ろに証拠があれば番号は自動で1つ繰り下がります。あとで枝番を足す予定なら「${shortNumberLabel(rf.evidenceNumber)}の1にする」でこの証拠を枝番付きにできます。空き枠は証拠説明書に空行として出力されます。`;
  }

  const attention = needsAttention(rf);
  $("rf-name").textContent = rf.pageRange ? `${rf.name}（${pageRangeLabel(rf)}）` : rf.name;
  const badge = $("rf-badge");
  badge.textContent = attention ? "要確認" : "確認済み";
  badge.className = "pill " + (attention ? "pill-warn-solid" : "pill-ok");

  const warnBanner = $("rf-warn-banner");
  warnBanner.classList.toggle("is-visible", attention);
  const confirmText = attention ? rf.confirmText || "内容をご確認ください。" : "";
  const confirmTextEl = $("rf-confirm-text");
  confirmTextEl.textContent = confirmText;
  // 作成者・撮影情報・立証趣旨などは証拠説明書の下書き用フィールドで、この画面に
  // 入力欄が無い。AIの確認文が「設定する必要があります」等と書くと「ここで設定できるはず」と
  // 誤解されるため、Word側で記入する運用であることを固定文で補足する（アプリ内で選択できる
  // 作成者の二択（authorAlt）が出ているときは、その場で解決できるので出さない）。
  const explFieldAsk = attention && !state.renameOnly && !rf.authorAlt &&
    /作成者|撮影|立証趣旨|作成年月日/.test(confirmText);
  if (explFieldAsk) {
    const note = document.createElement("div");
    note.className = "expl-field-note";
    note.textContent = "※ 作成者・撮影情報・立証趣旨などはこの画面では入力せず、出力時に生成される証拠説明書（Word）の該当欄で記入・修正します。内容を確認したら下のチェックで先へ進めます。";
    confirmTextEl.appendChild(note);
  }

  // When there's a binary decision (作成者 or 押印), the choice buttons ARE the
  // confirmation, so hide the generic checkbox and let picking resolve it.
  const hasChoice = !state.renameOnly && (!!rf.authorAlt || !!rf.stampAsk);
  const checkWrap = $("rf-confirm-check-wrap");
  checkWrap.hidden = !rf.needsConfirmation || hasChoice;
  checkWrap.classList.toggle("is-confirmed", !!rf.userConfirmed);
  $("rf-confirm-check").checked = !!rf.userConfirmed;
  $("rf-confirm-check-text").textContent = rf.userConfirmed
    ? "確認済みにしました（クリックで取り消し）"
    : "この内容を確認しました（確認済みにする）";

  // Conflict toggle: 証拠説明書 vs file content disagree on the 標目 — let the user pick.
  const conflictWrap = $("rf-conflict-resolve");
  if (rf.titleFromFile) {
    conflictWrap.hidden = false;
    const src = rf.titleSource || "explanation";
    const btnE = $("rf-use-explanation");
    const btnF = $("rf-use-file");
    btnE.textContent = `説明書: ${rf.titleExplanation}`;
    btnF.textContent = `ファイル: ${rf.titleFromFile}`;
    btnE.classList.toggle("is-active", src === "explanation");
    btnF.classList.toggle("is-active", src === "file");
  } else {
    conflictWrap.hidden = true;
  }

  // Author toggle (証拠説明書 generation): role name (被告代理人) vs the actual name.
  // Not in rename-only (no 証拠説明書 generation there; the checkbox resolves instead).
  const authorWrap = $("rf-author-resolve");
  if (rf.authorAlt && !state.renameOnly) {
    authorWrap.hidden = false;
    const btnP = $("rf-author-primary");
    const btnA = $("rf-author-alt");
    btnP.textContent = rf.authorPrimary || "（空欄）";
    btnA.textContent = rf.authorAlt;
    // no pre-selection: highlight only after the user picks
    btnP.classList.toggle("is-active", rf.authorDecided && rf.authorSource === "primary");
    btnA.classList.toggle("is-active", rf.authorDecided && rf.authorSource === "alt");
    // 未選択のあいだは「選ばないと次へ進めない」ことを行内で明示（バッジ＋橙ハイライト＋説明）
    authorWrap.classList.toggle("is-undecided", !rf.authorDecided);
    $("rf-author-required").hidden = !!rf.authorDecided;
    $("rf-author-hint").hidden = !!rf.authorDecided;
  } else {
    authorWrap.hidden = true;
  }

  // Stamp choice: 新規に押す vs 既に押印済み（押さない）. Neither is pre-selected — the user
  // must actively pick, which resolves the confirmation.
  const stampWrap = $("rf-stamp-resolve");
  if (rf.stampAsk && !state.renameOnly) {
    stampWrap.hidden = false;
    const willStamp = (rf.stamps || []).some((s) => s && s.draw_label !== false);
    $("rf-stamp-new").classList.toggle("is-active", rf.stampDecided && willStamp);
    $("rf-stamp-done").classList.toggle("is-active", rf.stampDecided && !willStamp);
    stampWrap.classList.toggle("is-undecided", !rf.stampDecided);
    $("rf-stamp-required").hidden = !!rf.stampDecided;
    $("rf-stamp-hint").hidden = !!rf.stampDecided;
  } else {
    stampWrap.hidden = true;
  }

  // Point the 要確認 flag at the field the question is actually about: the evidence
  // number for numbered evidence, otherwise the document name.
  const flagNum = attention && !!rf.evidenceNumber;
  const flagDoc = attention && !flagNum;
  $("rf-kind").value = KIND_OPTIONS.includes(rf.kind) ? rf.kind : "その他";
  // 証拠は「証拠説明書の標目」＝この欄の実際の用途を短く示す。証拠以外は「文書名」
  $("rf-docname-label").textContent = rf.kind === "証拠" ? "証拠説明書の標目" : "文書名";
  $("rf-docname").value = rf.docName;
  $("rf-docname").classList.toggle("is-flagged", flagDoc);
  $("rf-docname-tag").hidden = !flagDoc;
  $("rf-evnum-input").classList.toggle("is-flagged", flagNum);
  $("rf-evnum-tag").hidden = !flagNum;
  $("rf-suggested").value = rf.suggested;
  renderNumMismatch(rf);
  renderExplanationFields(rf);

  // 現在値がAIの元の値と異なるフィールドにだけ差分ヒント＋「AIの値に戻す」を表示
  renderAiOriginalHint("rf-kind-orig", rf, "kind", rf.kind);
  renderAiOriginalHint("rf-docname-orig", rf, "docName", rf.docName);
  renderAiOriginalHint("rf-suggested-orig", rf, "suggested", rf.suggested);
  renderAiOriginalHint("rf-evnum-orig", rf, "evidenceNumber", rf.evidenceNumber);

  // 証拠番号つきのファイルにだけ「この証拠を外す」導線を出す
  $("rf-exclude-row").hidden = state.renameOnly || !rf.evidenceNumber;
  // 枝番編集欄も証拠番号つきのファイルにだけ出す
  // 刑事（弁/検）は枝番を使わないので枝番の編集欄も出さない
  $("rf-branch-field").hidden = state.renameOnly || !rf.evidenceNumber || isCriminalEvidenceNum(rf.evidenceNumber);
  // 「証拠」なのに番号が空＝証拠一覧に並ばない状態を明示し、番号入力を促す
  $("rf-evnum-hint").hidden = state.renameOnly || !(rf.kind === "証拠" && !rf.evidenceNumber);

  const metaRows = $("rf-meta-rows");
  metaRows.innerHTML = "";
  rf.metadata.forEach((m) => {
    const row = document.createElement("div");
    row.className = "meta-row";

    const info = document.createElement("div");
    const key = document.createElement("div");
    key.className = "meta-key";
    key.textContent = m.key;
    const val = document.createElement("div");
    val.className = "meta-val";
    val.textContent = m.val;
    info.append(key, val);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "meta-toggle" + (m.action === "keep" ? " is-keep" : "");
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", m.action === "keep" ? "true" : "false");
    toggle.title = "削除／維持を切り替え";
    const knob = document.createElement("span");
    knob.className = "meta-knob";
    knob.textContent = m.action === "keep" ? "維持" : "削除";
    toggle.appendChild(knob);
    toggle.addEventListener("click", () => {
      m.action = m.action === "keep" ? "delete" : "keep";
      renderReview();
    });

    row.append(info, toggle);
    metaRows.appendChild(row);
  });

  // Word文書に「保存時に個人情報を削除」設定が無ければ、Word直接PDF化での情報漏れを警告
  // （削除操作は不要＝LegalLeaves経由の出力では常に消える。気づきのための表示のみ）。
  if (rf.officeMeta && rf.officeMeta.removePersonalInfo === false) {
    const warn = document.createElement("div");
    warn.className = "office-meta-warn";
    const lead = document.createElement("div");
    lead.className = "office-meta-lead";
    lead.textContent = "⚠ このWordファイルは「保存時に個人情報を削除」が未設定です";
    const body = document.createElement("div");
    body.className = "office-meta-body";
    body.textContent = "LegalLeaves以外の方法（Wordで直接PDF化など）で提出すると、作成者欄などにWordのユーザー名が入るおそれがあります。LegalLeavesで出力すればメタデータは削除されます。";
    warn.append(lead, body);
    const found = [];
    if (rf.officeMeta.creator) found.push(`作成者: ${rf.officeMeta.creator}`);
    if (rf.officeMeta.lastModifiedBy) found.push(`最終更新者: ${rf.officeMeta.lastModifiedBy}`);
    if (rf.officeMeta.title) found.push(`タイトル: ${rf.officeMeta.title}`);
    if (found.length) {
      const info = document.createElement("div");
      info.className = "office-meta-found";
      info.textContent = `（Wordに残っている情報 — ${found.join(" ／ ")}）`;
      warn.append(info);
    }
    metaRows.appendChild(warn);
  }

  // PDF内の能動的コンテンツ（JavaScript・埋め込みファイル・入力フォーム等）を知らせる。
  // メタデータ削除では消えない要素なので、把握したうえで提出するかを弁護士が判断できるようにする。
  // **削除はしない**（証拠の中身を変えないため）。
  if (Array.isArray(rf.activeContent) && rf.activeContent.length) {
    const box = document.createElement("div");
    box.className = "office-meta-warn";
    const lead = document.createElement("div");
    lead.className = "office-meta-lead";
    lead.textContent = "⚠ このPDFには、文書情報以外の要素が含まれています";
    const body = document.createElement("div");
    body.className = "office-meta-body";
    body.textContent = "メタデータ削除では消えません（証拠の内容を変えないため、LegalLeavesは削除しません）。相手方から受け取ったPDFの場合は、内容をご確認のうえ提出の可否をご判断ください。";
    const list = document.createElement("div");
    list.className = "office-meta-found";
    list.textContent = `（含まれるもの — ${rf.activeContent.join(" ／ ")}）`;
    box.append(lead, body, list);
    metaRows.appendChild(box);
  }

  $("rf-delete-count").textContent = `削除 ${rf.metadata.filter((m) => m.action === "delete").length}件`;
  renderEvidenceInfo(rf);
  renderReviewProgress();
}

// Show how many flagged files remain unchecked, and block the output step until the
// user has ticked every 要確認 file off.
function renderReviewProgress() {
  const rfs = state.reviewFiles;
  const flagged = rfs.filter((r) => fileNeedsResolution(r)).length; // 二択持ちも母数に含める
  const remaining = rfs.filter((r) => needsAttention(r)).length;
  const nextBtn = $("review-next-btn");
  nextBtn.disabled = remaining > 0;
  nextBtn.title = remaining > 0 ? "要確認のファイルをすべて確認済みにすると進めます。" : "";
  // 上部の同機能ボタン（下部の「次へ」がスクロールしないと見えない対策）を同期
  const topBtn = $("review-next-top-btn");
  topBtn.disabled = nextBtn.disabled;
  topBtn.title = nextBtn.title;
  topBtn.textContent = remaining > 0 ? `出力前チェックへ（残り${remaining}件）` : "出力前チェックへ";
  const el = $("review-progress");
  if (!flagged) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (remaining) {
    el.textContent = `要確認 残り ${remaining}件（全${flagged}件）を確認してください`;
    el.className = "review-progress is-remaining";
  } else {
    el.textContent = `要確認 ${flagged}件すべて確認済み`;
    el.className = "review-progress is-done";
  }
}

// Audio/video are rename-only and excluded from the stamp preview, so preview only
// makes sense when at least one non-AV output (PDF/image/Office) exists.
function hasPreviewableOutput() {
  return state.reviewFiles.some((rf) => !isAvName(rf.name));
}

function renderExport() {
  $("output-folder-path").textContent = state.outputFolder || "(未選択)";

  const list = $("recent-folder-list");
  list.innerHTML = "";
  state.recentFolders.forEach((p) => {
    const active = p === state.outputFolder;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recent-folder" + (active ? " is-active" : "");
    const icon = document.createElement("span");
    icon.className = "recent-icon";
    icon.textContent = "📁";
    const path = document.createElement("span");
    path.className = "recent-path";
    path.textContent = p;
    const check = document.createElement("span");
    check.className = "recent-check";
    check.textContent = "選択中";
    btn.append(icon, path, check);
    btn.addEventListener("click", () => {
      state.outputFolder = p;
      renderExport();
    });
    list.appendChild(btn);
  });

  $("make-subfolder-checkbox").checked = state.makeSubfolder;
  // リネームのみモードはプレビュー対象（押印・結合）が無いので、チェックしても
  // 何も起きない「作成前にプレビューで確認する」行ごと隠す
  $("preview-toggle-row").hidden = state.renameOnly;
  $("preview-toggle-checkbox").checked = state.previewEnabled;
  $("export-next-btn").textContent = state.previewEnabled && !state.renameOnly && hasPreviewableOutput() ? "プレビューして作成" : "提出用ファイルを作成";
  $("export-next-btn").disabled = !state.outputFolder || !state.reviewFiles.length;

  // サブフォルダを作る場合、実際にファイルが置かれるフォルダを明示する
  const finalPathEl = $("output-final-path");
  if (state.outputFolder && state.makeSubfolder) {
    finalPathEl.hidden = false;
    finalPathEl.textContent = `実際の保存先: ${state.outputFolder}\\提出用ファイル（同名ファイルがある場合は「 (2)」等の連番が付きます）`;
  } else {
    finalPathEl.hidden = true;
  }

  // Offer to generate a 証拠説明書 draft only when there is evidence but no existing
  // 証拠説明書, and we're not in rename-only mode.
  const canGenerate = !state.renameOnly && !state.explanationExists && hasEvidenceFiles();
  $("gen-expl-toggle").hidden = !canGenerate;
  if (!canGenerate) state.generateExplanation = false;
  $("gen-expl-checkbox").checked = state.generateExplanation;
  // Pattern A: an existing 証拠説明書 was read -> make it explicit that we don't generate.
  $("expl-existing-note").hidden = !(state.explanationExists && hasEvidenceFiles() && !state.renameOnly);

  // 証拠説明書を生成するとき、未入力（●●）の残数を出力前に表示する。
  // 未入力があればPDFは作らずWordのみになる旨も添える（プレビューは廃止）。
  const blankNote = $("expl-blank-note");
  if (canGenerate && state.generateExplanation) {
    const blanks = explanationBlankCount();
    blankNote.hidden = false;
    blankNote.textContent = blanks > 0
      ? `証拠説明書に未入力（●●）が ${blanks}件あります。Wordファイルのみ作成します（埋めてから提出用PDFを作成してください）。`
      : "証拠説明書は未入力（●●）がありません。Wordと提出用PDFを作成します。";
  } else {
    blankNote.hidden = true;
  }

  renderExportSummary();
  renderOutputCheck();
}

// v5.2.0: 出力前の食い違いチェックの表示。問題が無ければ1行だけ、あれば枠で一覧（押すとそのファイルへ）。
function renderOutputCheck() {
  const el = $("output-check");
  el.innerHTML = "";
  el.className = "output-check";
  if (state.renameOnly || !state.reviewFiles.length) return;
  const issues = computeOutputIssues();
  if (!issues.length) {
    el.classList.add("is-ok");
    el.textContent = "出力前チェック: 番号とファイル名の食い違いはありません。";
    return;
  }
  el.classList.add("has-issues");
  const head = document.createElement("div");
  head.className = "output-check-head";
  head.textContent = `出力前チェック: 食い違いが ${issues.length}件あります（このまま作成もできます）`;
  el.appendChild(head);
  for (const it of issues) {
    const line = document.createElement("div");
    line.className = "output-check-line";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "output-check-item";
    row.textContent = it.text;
    row.title = "押すと確認画面のそのファイルへ移ります";
    row.addEventListener("click", () => {
      state.selectedReview = it.index;
      state.showAllReview = true; // 確認済みのファイルでも一覧に出るように
      goStep("review");
    });
    line.appendChild(row);
    // v5.2.2: ファイル名の番号の食い違いは、確認画面に戻らずにその場で合わせられる
    const rf = state.reviewFiles[it.index];
    const l = it.fix && rf ? numFixLabels(rf) : null;
    if (l && l.error) row.classList.add("is-error");
    if (l) {
      const acts = document.createElement("span");
      acts.className = "num-mismatch-actions";
      for (const [which, label] of [["number", l.number], ["name", l.name], ["reset", l.reset]]) {
        if (!label) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "num-fix-btn";
        b.textContent = label;
        b.addEventListener("click", () => { if (applyNumFix(rf, which)) renderExport(); });
        acts.appendChild(b);
      }
      line.appendChild(acts);
    }
    el.appendChild(line);
  }
}

// 生成予定の証拠説明書データ内に残る未入力マーカー（●●）の数。Word/PDF変換を
// 伴わない軽い処理なので、出力画面で常時計算してよい。
function explanationBlankCount() {
  try {
    return (JSON.stringify(buildExplanationData()).match(/●●/g) || []).length;
  } catch (_) {
    return 0;
  }
}

// 「作成」を押すと何が行われるかの事前サマリ（実際の出力計画から集計する）
function renderExportSummary() {
  const el = $("export-summary");
  el.innerHTML = "";
  if (!state.reviewFiles.length) return;
  const outputs = buildOutputPlan();
  const parts = [];
  // 証拠説明書はWord必ず＋（未入力が無ければ）PDF。未入力ありならdocxのみ＝1ファイル。
  const willGenExpl = state.generateExplanation && !state.renameOnly && !state.explanationExists && hasEvidenceFiles();
  const explCount = willGenExpl ? (explanationBlankCount() > 0 ? 1 : 2) : 0;
  parts.push(`作成予定: ${outputs.length + explCount}ファイル`);
  if (!state.renameOnly) {
    const stamped = state.reviewFiles.filter((rf) =>
      rf.evidenceNumber && (rf.stamps || []).some((s) => s && s.draw_label !== false)
    ).length;
    if (stamped) parts.push(`証拠番号を押印: ${stamped}件`);
    const converted = state.reviewFiles.filter((rf) => /\.(docx?|xlsx?|pptx?|rtf|png|jpe?g)$/i.test(rf.name)).length;
    if (converted) parts.push(`PDFへ変換: ${converted}件`);
    const merged = outputs.filter((o) => (o.sources || []).length >= 2).length;
    if (merged) parts.push(`結合: ${merged}組`);
  }
  const metaDeletes = state.reviewFiles.reduce(
    (n, rf) => n + (rf.metadata || []).filter((m) => m.action === "delete").length, 0
  );
  if (metaDeletes) parts.push(`メタデータ削除: ${metaDeletes}項目`);
  // 未入力（●●）が残っていればPDFは作らずWordのみ
  if (explCount) {
    parts.push(explanationBlankCount() > 0 ? "証拠説明書: Wordのみ作成（未入力あり）" : "証拠説明書: Word＋PDFを作成");
  }
  for (const p of parts) {
    const span = document.createElement("span");
    span.className = "export-summary-item";
    span.textContent = p;
    el.appendChild(span);
  }
}

function hasEvidenceFiles() {
  return state.reviewFiles.some((rf) => rf.evidenceNumber);
}

// 証拠説明書の閲覧専用プレビュー（openExplPreview等）は廃止した。代わりに出力画面で
// 未入力（●●）残数を表示し、未入力があればPDF化を省いてWordのみ出力する（main.js側で判定）。

function renderDone() {
  const result = state.writeResult || { written: [], errors: [], outputDir: state.outputFolder };
  const okCount = (result.written || []).length;
  const ngCount = (result.errors || []).length;

  // 成功／一部失敗／全件失敗で見出し・色を出し分ける（固定見出しだと失敗を見逃す）
  const mark = $("done-mark");
  const heading = $("done-heading");
  if (ngCount === 0) {
    mark.textContent = "完了";
    mark.className = "completion-mark";
    heading.textContent = `${okCount}件のファイルを作成しました`;
  } else if (okCount > 0) {
    mark.textContent = "一部失敗";
    mark.className = "completion-mark is-partial";
    heading.textContent = `${okCount}件を作成しましたが、${ngCount}件は作成できませんでした`;
  } else {
    mark.textContent = "失敗";
    mark.className = "completion-mark is-failed";
    heading.textContent = "ファイルを作成できませんでした";
  }

  // 実際に作成されたフォルダ（サブフォルダ込み）を一覧の上に表示
  const dest = $("done-dest");
  const dir = result.outputDir || state.outputFolder;
  dest.hidden = !dir;
  dest.textContent = dir ? `保存先: ${dir}` : "";

  const list = $("done-list");
  list.innerHTML = "";
  for (const w of result.written) {
    const div = document.createElement("div");
    div.textContent = w.size != null ? `${w.name}（${formatMB(w.size)}）` : w.name;
    if (w.size != null && w.size > UPLOAD_LIMIT_MB * 1024 * 1024) div.className = "done-over-limit";
    list.appendChild(div);
  }
  renderUploadSizeNote(result.written || []);

  const errEl = $("done-errors");
  errEl.innerHTML = "";
  if (ngCount) {
    errEl.className = "done-errors";
    for (const e of result.errors) {
      const div = document.createElement("div");
      div.textContent = `${e.name}: ${e.message}`;
      errEl.appendChild(div);
    }
  }

  // 案件ファイルは提出フォルダではなくアプリ内（userData/cases）に保存される
  const cf = $("done-casefile");
  if (result.caseFileSaved) {
    cf.hidden = false;
    cf.textContent = `作業の保存: 再開用の案件ファイルをアプリ内に保存しました（提出フォルダには含まれません）\n${result.caseFileSaved}`;
  } else {
    cf.hidden = true;
  }

  state.lastOutputDir = dir;
}


// v5.2.0: 出力したファイルの合計の大きさと、アップロードの上限（UPLOAD_LIMIT_MB）の案内。
// 上限を超えるときは「何回かに分けて」を、1ファイルで超えるものは別に知らせる（容量を減らす処理はしない）。
function renderUploadSizeNote(written) {
  const el = $("done-size-note");
  const sized = written.filter((w) => w.size != null);
  if (!sized.length) { el.hidden = true; return; }
  const limit = UPLOAD_LIMIT_MB * 1024 * 1024;
  const total = sized.reduce((n, w) => n + w.size, 0);
  const over = sized.filter((w) => w.size > limit);
  const lines = [];
  el.className = "done-size-note";
  if (over.length) {
    el.classList.add("is-warn");
    lines.push(`次のファイルは1つで${UPLOAD_LIMIT_MB}MBを超えているため、このままではアップロードできません。` +
      `分割するか、スキャンの解像度を下げるなどして容量を小さくしてください: ${over.map((w) => w.name).join("、")}`);
  } else if (total > limit) {
    el.classList.add("is-warn");
    const times = Math.ceil(total / limit);
    lines.push(`mints では一度にアップロードできるのは${UPLOAD_LIMIT_MB}MBまでです。` +
      `何回かに分けてアップロードしてください（目安: ${times}回以上）。`);
  } else {
    lines.push(`mints の一度のアップロードの上限（${UPLOAD_LIMIT_MB}MB）以内です。一度にアップロードできます。`);
  }
  const head = document.createElement("div");
  head.className = "done-size-total";
  head.textContent = `合計 ${formatMB(total)}`;
  const sub = document.createElement("div");
  sub.className = "done-size-sub";
  sub.textContent = lines.join("　");
  el.replaceChildren(head, sub);
  el.hidden = false;
}

// Suggested (提出用) name for a chosen 標目: 号証(_枝番)_標目 when numbered, else just 標目.
// 枝番（branchRange）を落とすと、同一号証の枝番違いが同名になってしまう
// （「別々に出力」やAVでは rf.suggested がそのまま出力名になる）。mergeDestName と同じ
// 「号証番号_枝番_タイトル」の並びで組み立てる。
function suggestedForTitle(rf, title) {
  const ext = submitExtFor(rf.name); // rename-only keeps the source extension (no .pdf.docx doubling)
  const t = toHalfWidthFilenamePart(title || "");
  const branch = rf.branchRange == null ? "" : toHalfWidthFilenamePart(String(rf.branchRange).trim());
  const prefix = rf.evidenceNumber ? (branch ? `${rf.evidenceNumber}_${branch}` : rf.evidenceNumber) : "";
  const base = prefix && t ? `${prefix}_${t}` : (t || rf.name.replace(/\.[^.]+$/, ""));
  return `${base}${ext}`;
}
function setTitleSource(src) {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf || !rf.titleFromFile) return;
  rf.titleSource = src;
  const title = src === "file" ? rf.titleFromFile : rf.titleExplanation;
  rf.docName = title;
  rf.suggested = suggestedForTitle(rf, title);
  renderReview();
}
// 作成者表記を1ファイルに適用（役割名 primary / 実名 alt）。
function applyAuthorSource(rf, src) {
  if (!rf || !rf.authorAlt) return;
  rf.authorSource = src;
  rf.author = src === "alt" ? rf.authorAlt : rf.authorPrimary;
  rf.authorDecided = true; // an explicit pick resolves this choice
}
function setAuthorSource(src) {
  applyAuthorSource(state.reviewFiles[state.selectedReview], src);
  advanceToNextAttention(); // 二択を選び切って要確認でなくなったら次の要確認へ
  renderReview();
}
// 作成者表記の一括適用。実名は役割ごとに文字列が異なるので、各ファイルが元々持つ
// authorAlt/authorPrimaryをそのまま使う（「役割名か実名か」の種類だけを一括で揃える）。
function bulkAuthorTargets() {
  return state.reviewFiles.filter((r) => r.authorAlt && !state.renameOnly);
}
function applyBulkAuthor(src) {
  for (const rf of bulkAuthorTargets()) applyAuthorSource(rf, src);
  renderReview();
}
// 「確認しました」チェックで解決する確認（＝二択を持たない要確認ファイル）を対象に、
// まとめて確認済みにする。二択（押印・作成者）は実際の選択が要るので対象外。
function bulkConfirmTargets() {
  return state.reviewFiles.filter((rf) => {
    const hasChoice = !state.renameOnly && (!!rf.stampAsk || !!rf.authorAlt);
    return !!rf.needsConfirmation && !hasChoice;
  });
}
// 新規に押す / 既に押印済み（押さない）.
function applyStampMode(rf, mode) {
  if (mode === "new") {
    if (!rf.stamps || !rf.stamps.length) rf.stamps = [defaultStamp()];
    else rf.stamps = rf.stamps.map((s) => ({ ...s, draw_label: true }));
  } else {
    rf.stamps = (rf.stamps || []).map((s) => ({ ...s, draw_label: false })); // keep rotation, no label
  }
  rf.stampDecided = true;
}
function setStampChoice(mode) {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf) return;
  applyStampMode(rf, mode);
  advanceToNextAttention(); // 押印の二択を選び切って要確認でなくなったら次の要確認へ
  renderReview();
}
// Numbered, stampable evidence (audio/video can't carry a stamp).
function bulkStampTargets() {
  return state.reviewFiles.filter((r) => r.evidenceNumber && !isAvName(r.name));
}

// Bulk-set 押印 for every numbered evidence at once — covers both "answer all the
// AI's questions" and "the AI missed that everything is already stamped".
function applyBulkStamp(mode) {
  for (const rf of bulkStampTargets()) applyStampMode(rf, mode);
}
// 号証番号のシフト（共通処理）: 同記号で fromNum 以上の番号を delta だけずらす。
// ファイルの証拠番号・提出用ファイル名・結合設定・プレースホルダ・証拠説明書名をまとめて追従。
function applyEvidenceShift(sym, fromNum, delta) {
  for (const rf of state.reviewFiles) {
    const q = parseEvidenceNumber(rf.evidenceNumber);
    if (q && q.sym === sym && q.num >= fromNum) {
      rf.evidenceNumber = padEvidence(sym, q.num + delta);
      rf.suggested = suggestedForTitle(rf, rf.docName);
    }
  }
  state.mergeDisabled = new Set([...state.mergeDisabled].map((n) => {
    const q = parseEvidenceNumber(n);
    return (q && q.sym === sym && q.num >= fromNum) ? padEvidence(sym, q.num + delta) : n;
  }));
  state.placeholders = state.placeholders.map((ph) => {
    const q = parseEvidenceNumber(ph.num);
    return (q && q.sym === sym && q.num >= fromNum) ? { num: padEvidence(sym, q.num + delta), branch: ph.branch } : ph;
  });
  const expBase = explanationBaseName(state.reviewFiles);
  for (const rf of state.reviewFiles) {
    if (rf.kind === "証拠説明書") rf.suggested = `${expBase}${submitExtFor(rf.name)}`;
  }
}

// 枝番のシフト（同じ号証番号の中で fromBranch 以上の枝番を delta だけずらす）。
// ファイルの branchRange・スタンプ枝番・提出用ファイル名と、枝番プレースホルダを追従。
function applyBranchShift(num, fromBranch, delta) {
  for (const rf of state.reviewFiles) {
    if (rf.evidenceNumber !== num || rf.branchRange == null) continue;
    const b = branchSortKey(rf.branchRange);
    if (b >= fromBranch) {
      const nb = String(b + delta);
      rf.branchRange = nb;
      setStampBranch(rf, nb);
      rf.suggested = suggestedForTitle(rf, rf.docName);
    }
  }
  state.placeholders = state.placeholders.map((ph) => {
    if (ph.num === num && ph.branch != null && branchSortKey(ph.branch) >= fromBranch) {
      return { num, branch: String(branchSortKey(ph.branch) + delta) };
    }
    return ph;
  });
}

// 号証番号を fromText 以降にずらす（+1=空ける／-1=詰める）。offerCloseGap から使う内部関数。
function shiftEvidenceNumbers(fromText, delta) {
  const from = parseEvidenceNumber(fromText);
  if (!from) return;
  const hasTargets = state.reviewFiles.some((rf) => {
    const q = parseEvidenceNumber(rf.evidenceNumber);
    return q && q.sym === from.sym && q.num >= from.num;
  });
  if (!hasTargets) return;
  if (delta < 0 && from.num + delta < 1) return;
  applyEvidenceShift(from.sym, from.num, delta);
  renderReview();
}

// 号証レベルの空き枠。その番号が既にファイルで埋まっているときだけ以降を
// 1つ繰り下げて割り込ませる。空いている番号（末尾・欠番）はそのまま空き枠を置く。
function insertSlotAt(sym, num) {
  const slot = padEvidence(sym, num);
  if (usedEvidenceNumbers().has(slot)) applyEvidenceShift(sym, num, 1);
  if (!hasPlaceholder(slot, null)) state.placeholders.push({ num: slot, branch: null });
  renderReview();
}
// 枝番レベルの空き枠（甲003の中の枝番）。その枝番が埋まっていれば以降の枝番を繰り下げる。
function insertBranchSlot(num, branchNum) {
  const occupied = state.reviewFiles.some((rf) => rf.evidenceNumber === num && branchSortKey(rf.branchRange) === branchNum)
    || state.placeholders.some((ph) => ph.num === num && ph.branch != null && branchSortKey(ph.branch) === branchNum);
  if (occupied) applyBranchShift(num, branchNum, 1);
  if (!hasPlaceholder(num, String(branchNum))) state.placeholders.push({ num, branch: String(branchNum) });
  renderReview();
}
// 単独の証拠を枝番付きにする（甲003 → 甲003の1、甲003の2の空き枠を作る）。
function splitIntoBranches() {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf || !rf.evidenceNumber || rf.branchRange != null) return;
  rf.branchRange = "1";
  setStampBranch(rf, "1");
  rf.suggested = suggestedForTitle(rf, rf.docName);
  if (!hasPlaceholder(rf.evidenceNumber, "2")) state.placeholders.push({ num: rf.evidenceNumber, branch: "2" });
  renderReview();
}
// ---------- 1つのPDFにまとめてスキャンした枝番を、ページ範囲で分ける ----------
// 例: 甲3（全5ページ）を「1-3, 4-5」で分ける → 甲3の1（1〜3ページ目）・甲3の2（4〜5ページ目）。
// 分けたものは一覧では別ファイルと同じ扱い（並べ替え・枝番の解除・標目の編集）になり、
// 出力時は元PDFから該当ページだけを切り出して、同じ号証番号どうしで1つのPDFに結合する。
function canSplitByPages(rf) {
  return !!rf && !state.renameOnly && !!rf.evidenceNumber && !isCriminalEvidenceNum(rf.evidenceNumber)
    && !rf.pageRange && /\.pdf$/i.test(rf.name) && (rf.pageCount || 0) >= 2;
}
function openSplitPagesForm() {
  const rf = state.reviewFiles[state.selectedReview];
  if (!canSplitByPages(rf)) return;
  $("split-pages-label").textContent = `各枝番のページ（全${rf.pageCount}ページ。例: 1-3, 4-${rf.pageCount}）`;
  $("split-pages-input").value = pageRangesFromStamps(rf);
  $("split-pages-error").hidden = true;
  $("split-pages-form").hidden = false;
  $("split-pages-input").focus();
}
function closeSplitPagesForm() {
  $("split-pages-form").hidden = true;
  $("split-pages-error").hidden = true;
}
function submitSplitPagesForm() {
  const rf = state.reviewFiles[state.selectedReview];
  if (!canSplitByPages(rf)) { closeSplitPagesForm(); return; }
  const res = parsePageRanges($("split-pages-input").value, rf.pageCount);
  if (res.error) {
    $("split-pages-error").textContent = res.error;
    $("split-pages-error").hidden = false;
    return;
  }
  closeSplitPagesForm();
  splitByPages(state.selectedReview, res.ranges);
}
// 元のスタンプのうち範囲内のものを、範囲の中でのページ番号に付け替える。
// 番号を押すのは各枝番の先頭ページだけ（契約: 複数ページにまたがる枝番は先頭ページに1回）。
// 範囲の途中にあった番号のスタンプは回転だけにする（同じ枝番が2回押されないように）。
function stampsForPageRange(stamps, from, to, branch, willStamp) {
  const out = [];
  for (const s of stamps || []) {
    const pg = (s && Number(s.page)) || 1;
    if (!s || pg < from || pg > to) continue;
    const c = JSON.parse(JSON.stringify(s));
    c.page = pg - from + 1;
    c.branch = branch;
    if (c.page !== 1) c.draw_label = false;
    out.push(c);
  }
  if (willStamp) {
    const first = out.find((s) => s.page === 1);
    if (!first) out.unshift({ ...defaultStamp(), branch });
    else first.draw_label = true;
  }
  return out;
}
// 枝番の表記（"2" / "1～3" / "1-3"）を {start, end} にする。無ければ null。
function branchSpan(br) {
  if (br == null) return null;
  const m = toHalfWidth(String(br)).match(/(\d+)(?:\s*[〜～~\-－ー]\s*(\d+))?/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : start;
  return end >= start ? { start, end } : { start, end: start };
}
function splitByPages(index, ranges) {
  const rf = state.reviewFiles[index];
  if (!rf || ranges.length < 2) return;
  const num = rf.evidenceNumber;
  // 枝番なしなら の1 から。すでに枝番付き（例: の2）なら、そこから順に使い、後ろの枝番は繰り下げる。
  // AIが1ファイル分の範囲（例 "1～2"）を入れていれば、その範囲は既にこのファイルの枝番なので、
  // 範囲を超える分だけ繰り下げる（branchSortKey は "1～2" を 12 と読むので使わない）。
  const span = branchSpan(rf.branchRange);
  const base = span ? span.start : 1;
  const held = span ? span.end - span.start + 1 : 0;
  if (span && ranges.length !== held) applyBranchShift(num, span.end + 1, ranges.length - held);
  const willStamp = !(rf.stamps || []).length || rf.stamps.some((s) => s && s.draw_label !== false);
  const pieces = ranges.map(([from, to], i) => {
    const branch = String(base + i);
    const piece = JSON.parse(JSON.stringify(rf));
    delete piece.initialNumbers; // 分けた枝番には「最初の値」が無い（戻すのは「ページの分け方を元に戻す」で）
    piece.pageRange = [from, to];
    piece.branchRange = branch;
    piece.stamps = stampsForPageRange(rf.stamps, from, to, branch, willStamp);
    piece.suggested = suggestedForTitle(piece, piece.docName);
    return piece;
  });
  // 枝番の空き枠（「枝番に分ける」で作った の2 など）は、分けた枝番と重なるので取り除く
  const used = new Set(pieces.map((p) => p.branchRange));
  state.placeholders = state.placeholders.filter((ph) => !(ph.num === num && ph.branch != null && used.has(String(ph.branch))));
  state.reviewFiles.splice(index, 1, ...pieces);
  state.selectedReview = index;
  renderReview();
}
// ページ範囲で分けた枝番を、元の1つのPDFへ戻す（同じ元ファイル・同じ号証番号の分割をまとめる）。
// 戻した後は先頭の枝番を使い、空いた枝番は詰める。枝番が1つだけになれば枝番なしへ戻す。
function unsplitPages() {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf || !rf.pageRange) return;
  const num = rf.evidenceNumber;
  const pieces = state.reviewFiles
    .filter((r) => r.path === rf.path && r.pageRange && r.evidenceNumber === num)
    .sort((a, b) => a.pageRange[0] - b.pageRange[0]);
  const first = pieces[0];
  const keys = pieces.map((p) => branchSortKey(p.branchRange));
  const willStamp = pieces.some((p) => (p.stamps || []).some((s) => s && s.draw_label !== false));
  const merged = JSON.parse(JSON.stringify(first));
  merged.pageRange = null;
  merged.branchRange = first.branchRange;
  merged.stamps = [];
  for (const p of pieces) {
    for (const s of p.stamps || []) {
      if (!s) continue;
      const c = JSON.parse(JSON.stringify(s));
      c.page = (Number(s.page) || 1) + p.pageRange[0] - 1;
      c.branch = first.branchRange;
      if (c.page !== 1) c.draw_label = false;
      merged.stamps.push(c);
    }
  }
  if (willStamp && !merged.stamps.some((s) => s.page === 1)) merged.stamps.unshift({ ...defaultStamp(), branch: first.branchRange });
  state.reviewFiles = state.reviewFiles
    .filter((r) => !pieces.includes(r) || r === first)
    .map((r) => (r === first ? merged : r));
  // 消えた枝番の分だけ、後ろの枝番を詰める（大きい方から1つずつ）
  for (const k of keys.slice(1).sort((a, b) => b - a)) applyBranchShift(num, k + 1, -1);
  merged.suggested = suggestedForTitle(merged, merged.docName);
  normalizeBranches();
  state.selectedReview = Math.max(0, state.reviewFiles.indexOf(merged));
  renderReview();
}
// ---------- AIの値に戻す（フィールド単位＋全体） ----------
// アンドゥではなく「AI照合直後のスナップショット(rf.aiOriginal)へ直接戻す」単純な初期化。
function restoreAiOriginal(key) {
  const rf = state.reviewFiles[state.selectedReview];
  if (!rf || !rf.aiOriginal) return;
  const v = rf.aiOriginal[key];
  if (key === "evidenceNumber") {
    rf.evidenceNumber = v || null;
    // 通常の手入力と同じ副作用: 番号が付いたのにスタンプが無ければ既定スタンプを付与
    if (rf.evidenceNumber && Array.isArray(rf.stamps) && rf.stamps.length === 0) {
      rf.stamps = [defaultStamp()];
    }
  } else if (key === "kind") {
    rf.kind = v;
    if (rf.kind === "証拠説明書") {
      rf.suggested = `${explanationBaseName(state.reviewFiles)}${submitExtFor(rf.name)}`;
    }
  } else if (key === "docName") {
    rf.docName = v;
  } else if (key === "suggested") {
    rf.suggested = v;
  }
  renderReview();
}
// 枝番グループが1件だけになったら（枝番の空き枠も無ければ）、その枝番を外して
// 単独の号証に戻す。甲3の1・甲3の2があって甲3の2を外したら、甲3の1ではなく甲3にする。
// 除外・番号外し・枝番の空き枠削除の後にだけ呼ぶ（AIデータや未読み込みの相方は触らない）。
function normalizeBranches() {
  const byNum = new Map();
  for (const rf of state.reviewFiles) {
    if (!rf.evidenceNumber) continue;
    if (!byNum.has(rf.evidenceNumber)) byNum.set(rf.evidenceNumber, []);
    byNum.get(rf.evidenceNumber).push(rf);
  }
  for (const [num, files] of byNum) {
    const hasBranchPh = state.placeholders.some((ph) => ph.num === num && ph.branch != null);
    // 残ったのが「の1」のときだけ外す。「の2」以降が1つだけ残るのは、前回提出した甲3の1に追加で甲3の2を
    // 出す場合（「AIを使わずに進む」で追加分だけ読み込んだとき等）なので、枝番を外すと番号が変わってしまう。
    if (files.length === 1 && !hasBranchPh && files[0].branchRange != null && branchSortKey(files[0].branchRange) === 1) {
      const rf = files[0];
      rf.branchRange = null;
      setStampBranch(rf, null);
      rf.suggested = suggestedForTitle(rf, rf.docName);
    }
  }
}

// ---------- この証拠を外す（番号が空いたら繰り上げをワンクリック提案） ----------
// 空いた番号より後ろの証拠があれば、詰めるかどうかを人に確認する（自動・無言では詰めない
// ＝「後で同じ番号に別の証拠を入れたい」ケースを壊さないため）。
async function offerCloseGap(sym, num) {
  // 同じ番号の別ファイル（枝番グループの相方）が残っていれば番号は空いていない
  const stillUsed = state.reviewFiles.some((r) => {
    const p = parseEvidenceNumber(r.evidenceNumber);
    return p && p.sym === sym && p.num === num;
  });
  if (stillUsed) return;
  const later = state.reviewFiles
    .map((r) => parseEvidenceNumber(r.evidenceNumber))
    .filter((p) => p && p.sym === sym && p.num > num);
  if (!later.length) return;
  const min = Math.min(...later.map((p) => p.num));
  const max = Math.max(...later.map((p) => p.num));
  const range = min === max ? padEvidence(sym, min) : `${padEvidence(sym, min)}〜${padEvidence(sym, max)}`;
  const ok = await window.api.confirmDialog({
    message: `${padEvidence(sym, num)} が空きました。以降の証拠（${range}）を繰り上げて詰めますか？\n` +
        `（あとで別の証拠を ${padEvidence(sym, num)} に入れる予定なら「キャンセル」＝欠番のまま残します）`,
    okLabel: "実行する",
  });
  if (ok) shiftEvidenceNumbers(padEvidence(sym, num + 1), -1);
}

// 枝番の空き枠を消したとき、その枝番より後ろの枝番があれば繰り上げて詰めるか確認する。
async function offerCloseBranchGap(num, branch) {
  const stillUsed = state.reviewFiles.some((rf) => rf.evidenceNumber === num && branchSortKey(rf.branchRange) === branch)
    || state.placeholders.some((ph) => ph.num === num && ph.branch != null && branchSortKey(ph.branch) === branch);
  if (stillUsed) return;
  const later = state.reviewFiles.some((rf) => rf.evidenceNumber === num && rf.branchRange != null && branchSortKey(rf.branchRange) > branch)
    || state.placeholders.some((ph) => ph.num === num && ph.branch != null && branchSortKey(ph.branch) > branch);
  if (!later) return;
  const ok = await window.api.confirmDialog({
    message: `${num}の${branch} が空きました。以降の枝番を繰り上げて詰めますか？\n` +
        `（あとで別の証拠を ${num}の${branch} に入れる予定なら「キャンセル」）`,
    okLabel: "実行する",
  });
  if (ok) applyBranchShift(num, branch + 1, -1);
  renderReview();
}

