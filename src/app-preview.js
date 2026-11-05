// ---------------------------------------------------------------------------
// プレビュー（FB-11: PDF.js＋スタンプのオーバーレイ）
//
// src/app.js から分離（監査⑥）。関数の中身は移動しただけで変更していない。
// クラシックスクリプトなのでグローバルスコープを共有する（app.js から普通に呼べる）。
// このファイルは定義のみ。イベント配線は app.js 側に残している（読み込み順の意味を保つため）。
// ---------------------------------------------------------------------------

// ---------- FB-11: インタラクティブ・プレビュー（PDF.js＋スタンプオーバーレイ） ----------
// プレビュー対象は「スタンプ・回転を一切適用しないベースPDF」（既存パイプラインで生成）。
// スタンプはHTMLオーバーレイ、回転はPDF.jsのviewport回転で表現するので、位置・向き・押印の
// 変更は再生成なしで即時反映される。焼き込みは「承認して書き出す」時に pdf-engine が一度だけ
// 行う（＝焼き込み結果が正）。viewport回転は「合計回転の置き換え指定」であることをP0で実測済み。
const PV_EAGER_PAGES = 20; // ここまで即描画、以降はスクロールで遅延描画

const pvState = {
  task: null,      // pdfjs loading task（destroy用）
  doc: null,
  file: null,      // 表示中の state.previewFiles 要素
  pages: [],       // 1始まり: pvState.pages[n-1] = {n, wrap, canvas, overlay, ...}
  observer: null,  // 遅延描画
  stageW: 800,
  renderSeq: 0,    // ファイル切替時に古い非同期描画を打ち捨てる
};

function pvCleanup() {
  pvState.renderSeq++;
  if (pvState.observer) {
    pvState.observer.disconnect();
    pvState.observer = null;
  }
  if (pvState.task) {
    try { pvState.task.destroy(); } catch (_) {}
  }
  pvState.task = null;
  pvState.doc = null;
  pvState.file = null;
  pvState.pages = [];
  $("pv-scroll").innerHTML = "";
}

function closePreviewModal() {
  $("preview-modal-overlay").hidden = true;
  pvCleanup();
}

async function cancelPreview() {
  closePreviewModal();
  await window.api.discardPreview();
}

// 選択中プレビューファイルの背後にある rf 群（source順・ページオフセット付き）。
// main が written[].sources = [{srcPath, pages, startPage, pageCount}] を返す（元パスで返る）。
// 1つのPDFをページ範囲で枝番に分けたときは同じ元パスの rf が複数あるので、範囲でも見分ける。
function pvSourceMap(file) {
  const map = [];
  for (const si of (file && file.sources) || []) {
    const rf = state.reviewFiles.find((r) => r.path === si.srcPath && samePageRange(r.pageRange, si.pages)) || null;
    map.push({ rf, startPage: si.startPage, pageCount: si.pageCount });
  }
  return map;
}

// 絶対ページごとの回転補正（エンジンと同じ加算則）と、オーバーレイに載せるスタンプ参照。
function pvPageOps(file) {
  const rot = new Map(); // absPage -> 補正角
  const stamps = [];     // {rf, s, absPage}
  for (const src of pvSourceMap(file)) {
    if (!src.rf) continue;
    const isImg = isImageSrc(src.rf.path); // 画像は回転をベースPDFへ焼き込み済み → ライブ回転しない
    for (const s of src.rf.stamps || []) {
      if (!s) continue;
      const absPage = src.startPage + ((s.page ?? 1) - 1);
      if (absPage < src.startPage || absPage > src.startPage + src.pageCount - 1) continue;
      if (!isImg) rot.set(absPage, normalizeAngle((rot.get(absPage) || 0) + (s.rotate_degrees || 0)));
      stamps.push({ rf: src.rf, s, absPage, isImage: isImg });
    }
  }
  return { rot, stamps };
}

async function showPreviewFile(i) {
  state.selectedPreview = i;
  Array.from($("preview-file-list").children).forEach((el, idx) => {
    el.classList.toggle("is-active", idx === i);
  });
  renderPreviewStampControls();
  const file = state.previewFiles[i];
  pvCleanup();
  if (!file) return;
  const seq = pvState.renderSeq;
  const scroll = $("pv-scroll");
  if (!window.pdfjsLib) {
    scroll.textContent = "プレビュー部品（PDF.js）を読み込めませんでした。出力自体には影響ありません。";
    return;
  }
  const bytes = await window.api.readPreviewBytes(file.path);
  if (seq !== pvState.renderSeq) return; // 別ファイルへ切替済み
  if (!bytes || !bytes.length) return;
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
  pvState.task = task;
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (seq === pvState.renderSeq) scroll.textContent = "PDFを表示できませんでした。";
    return;
  }
  if (seq !== pvState.renderSeq) {
    try { task.destroy(); } catch (_) {}
    return;
  }
  pvState.doc = doc;
  pvState.file = file;
  pvState.stageW = Math.max(320, scroll.clientWidth - 36);

  const { rot } = pvPageOps(file);
  pvState.observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      pvState.observer.unobserve(en.target);
      pvRenderPage(Number(en.target.dataset.page));
    }
  }, { root: scroll, rootMargin: "600px" });

  for (let n = 1; n <= doc.numPages; n++) {
    const wrap = document.createElement("div");
    wrap.className = "pv-page";
    wrap.dataset.page = String(n);
    const canvas = document.createElement("canvas");
    canvas.className = "pv-canvas";
    const overlay = document.createElement("div");
    overlay.className = "pv-overlay";
    wrap.append(canvas, overlay);
    scroll.appendChild(wrap);
    pvState.pages.push({
      n, wrap, canvas, overlay,
      rendered: false, scale: 1, cssW: 0, cssH: 0,
      rotExtra: rot.get(n) || 0,
      chain: Promise.resolve(),
    });
  }
  for (let n = 1; n <= Math.min(doc.numPages, PV_EAGER_PAGES); n++) {
    if (seq !== pvState.renderSeq) return;
    await pvRenderPage(n);
  }
  for (let n = PV_EAGER_PAGES + 1; n <= doc.numPages; n++) {
    pvState.observer.observe(pvState.pages[n - 1].wrap);
  }
}

// 同じcanvasへの多重render防止のため、ページごとに直列化する。
function pvRenderPage(n) {
  const entry = pvState.pages[n - 1];
  if (!entry) return Promise.resolve();
  entry.chain = entry.chain.then(() => pvRenderPageNow(n)).catch(() => {});
  return entry.chain;
}

async function pvRenderPageNow(n) {
  const seq = pvState.renderSeq;
  const entry = pvState.pages[n - 1];
  if (!entry || !pvState.doc) return;
  const page = await pvState.doc.getPage(n);
  if (seq !== pvState.renderSeq) return;
  // viewport回転 = 元PDFの/Rotate + ユーザー補正（置き換え指定・P0実測）。
  // これによりキャンバスは常に「補正後の正立紙面」＝AI契約の正規化座標系と一致し、
  // オーバーレイの座標計算から回転が消える。
  const rotation = normalizeAngle(page.rotate + entry.rotExtra);
  const m = await renderPdfPage(page, entry.canvas, { width: pvState.stageW, rotation, maxScale: 1.5 });
  if (seq !== pvState.renderSeq) return;
  entry.wrap.style.width = `${m.cssW}px`;
  entry.scale = m.scale;
  entry.cssW = m.cssW;
  entry.cssH = m.cssH;
  entry.rendered = true;
  entry.imageFailed = await pvPageImageBlank(page, entry.canvas); // CCITTFax等でpdf.jsが描けないページの検出
  pvLayoutOverlay(n);
}

// pdf.js が画像を描けず真っ白になったページを検出する（白黒FAX圧縮=CCITTFax、JBIG2 等で
// まれに起こる。出力側の一般ビューアは描けるので出力は正常）。画像ありなのにキャンバスが
// 真っ白なら「描画失敗」とみなし、白紙で不安にさせず注記を出すために使う。
// しきい値: 描けなかったときは画像の部分に何も描かれない＝ほぼ 0%。一方、正しく描けた
// 文字の少ないページ（最終ページの「以上」と署名だけ等）でも濃い画素は 0.1〜1% ほどある。
// 旧しきい値 0.5% ではこうしたページを誤って「描けなかった」と判定していた（v5 の実機確認で発覚）。
const PV_BLANK_MAX_RATIO = 0.0001; // 濃い画素が 0.01% 以下なら「描けていない」
async function pvPageImageBlank(page, canvas) {
  try {
    const OPS = window.pdfjsLib && window.pdfjsLib.OPS;
    if (!OPS) return false;
    const opl = await page.getOperatorList();
    const hasImg = opl.fnArray.some((fn) =>
      fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject ||
      fn === OPS.paintImageXObjectRepeat || fn === OPS.paintInlineImageXObject);
    if (!hasImg) return false;
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const total = data.length / 4;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 248 || data[i + 1] < 248 || data[i + 2] < 248) {
        if (++nonWhite > total * PV_BLANK_MAX_RATIO) return false; // 何か描かれている＝正常に描けている
      }
    }
    return true; // 画像ありなのにほぼ真っ白＝pdf.jsが描けていない
  } catch (_) {
    return false; // 判定できないときは注記しない（誤検出を避ける）
  }
}

// オーバーレイ（タイムスタンプ帯＋スタンプ）をそのページに敷き直す。
function pvLayoutOverlay(n) {
  const entry = pvState.pages[n - 1];
  if (!entry || !entry.rendered || !pvState.file) return;
  const overlay = entry.overlay;
  overlay.innerHTML = "";
  overlay.style.width = `${entry.cssW}px`;
  overlay.style.height = `${entry.cssH}px`;

  // pdf.jsが描けない画像（白黒スキャン=CCITTFax等）のページは白紙になるので、出力には
  // 正しく含まれる旨を注記する（白紙で「壊れた？」と誤解させない）。
  if (entry.imageFailed) {
    const note = document.createElement("div");
    note.className = "pv-unrenderable-note";
    note.textContent = "この画像はプレビューでは表示できませんでした（白黒スキャンなど）。出力ファイルには正しく含まれます。";
    overlay.appendChild(note);
  }

  // FB-6: 裁判所タイムスタンプ帯（mints提出後に出力1ページ目へ付される・実測値）を半透明表示。
  // 帯は用紙上端からの物理位置なので pt 基準で描く（横向き画像ページ等でも正しい位置になる）。
  if (n === 1) {
    const sc = entry.scale; // px per pt
    const z = document.createElement("div");
    z.className = "pv-zone";
    z.style.left = `${TS_LEFT_PT * sc}px`;
    z.style.top = `${TS_TOP_PT * sc}px`;
    z.style.width = `${entry.cssW - (TS_LEFT_PT + TS_RIGHT_MARGIN_PT) * sc}px`;
    z.style.height = `${(TS_BOTTOM_PT - TS_TOP_PT) * sc}px`;
    z.title = "mints提出後、ここに裁判所のタイムスタンプが付されます（実測位置）";
    const zl = document.createElement("span");
    zl.className = "pv-zone-label";
    zl.textContent = "裁判所タイムスタンプ帯";
    z.appendChild(zl);
    overlay.appendChild(z);
  }

  const { stamps } = pvPageOps(pvState.file);
  for (const ref of stamps) {
    if (ref.absPage !== n || ref.s.draw_label === false) continue;
    const label = deriveStampLabel(ref.rf.evidenceNumber, ref.s.branch ?? null);
    if (!label) continue;
    const el = document.createElement("div");
    el.className = "pv-stamp";
    el.textContent = label;
    const fontPt = ref.s.font_size_pt || 18; // 焼き込み既定と同じ18pt（pt→px = pt×scale）
    el.style.fontSize = `${fontPt * entry.scale}px`;
    overlay.appendChild(el);
    pvPositionStamp(el, ref.s, entry, ref.isImage);
    pvMakeDraggable(el, ref.s, entry, ref.isImage);
  }
}

function pvLayoutAllOverlays() {
  for (const e of pvState.pages) if (e.rendered) pvLayoutOverlay(e.n);
}

// 正規化座標(x,y)+anchor → CSS left/top（キャンバスは正立紙面なので回転項なし）。
// 画像は番号の縦位置を帯直下の物理位置(IMG_NUMBER_TOP_PT)へ固定（横位置xのみ調整可）。
// エンジンの fixImageOp と同じ扱いにして、プレビューと出力を一致させる。
function pvPositionStamp(el, s, entry, isImage) {
  const pos = s.position || {};
  const anchor = isImage ? "top-right" : (pos.anchor || "top-right");
  const x = (typeof pos.x === "number" ? pos.x : 0.93) * entry.cssW;
  const y = isImage
    ? IMG_NUMBER_TOP_PT * entry.scale
    : (typeof pos.y === "number" ? pos.y : STAMP_SAFE_Y) * entry.cssH;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = x;
  let top = y;
  if (anchor === "center") {
    left = x - w / 2;
    top = y - h / 2;
  } else {
    if (anchor.includes("right")) left = x - w;
    if (anchor.includes("bottom")) top = y - h;
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

// ドラッグで位置調整 → pointerup で正規化して rf.stamps[].position に書き戻す
// （anchorは維持・x,yのみ更新。契約の余白ルール 0.03〜0.95 にクランプ）。
// 画像は縦位置を帯直下へ固定するため、ドラッグ後も pvPositionStamp が縦を戻す（横のみ反映）。
function pvMakeDraggable(el, s, entry, isImage) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;
    el.classList.add("is-dragging");
    const move = (ev) => {
      el.style.left = `${startLeft + (ev.clientX - startX)}px`;
      el.style.top = `${startTop + (ev.clientY - startY)}px`;
    };
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.classList.remove("is-dragging");
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      const anchor = (s.position && s.position.anchor) || "top-right";
      let px = left;
      let py = top;
      if (anchor === "center") {
        px = left + w / 2;
        py = top + h / 2;
      } else {
        if (anchor.includes("right")) px = left + w;
        if (anchor.includes("bottom")) py = top + h;
      }
      const x = Math.min(0.95, Math.max(0.03, px / entry.cssW));
      const y = Math.min(0.95, Math.max(0.03, py / entry.cssH));
      s.position = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, anchor };
      pvPositionStamp(el, s, entry, isImage); // クランプ結果を見た目にも反映（画像は縦を帯直下へ戻す）
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

// 向き変更後: 補正角が変わったページだけ再描画（PDFは読み込み済みなので速い）
async function pvApplyRotations() {
  if (!pvState.file || !pvState.doc) return;
  const { rot } = pvPageOps(pvState.file);
  for (const e of pvState.pages) {
    const extra = rot.get(e.n) || 0;
    if (extra === e.rotExtra) continue;
    e.rotExtra = extra;
    if (e.rendered) await pvRenderPage(e.n); // 未描画ページは描画時に反映される
  }
}

// The evidence review-file(s) behind a preview file, matched by 号証番号.
function previewStampTargets(file) {
  if (state.renameOnly || !file || !file.evidenceNumber) return [];
  return state.reviewFiles.filter((rf) => rf.evidenceNumber === file.evidenceNumber && !isAvName(rf.name));
}

// Show 押印 controls in the preview: a per-号証 toggle for the selected file plus a
// batch-wide one — users most often notice an existing stamp here, not on review.
function renderPreviewStampControls() {
  const wrap = $("preview-stamp-controls");
  const anyStampable = !state.renameOnly && state.previewFiles.length > 0 && bulkStampTargets().length > 0;
  if (!anyStampable) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const file = state.previewFiles[state.selectedPreview];
  const targets = previewStampTargets(file);
  const perWrap = $("preview-this-stamp");
  if (targets.length) {
    perWrap.hidden = false;
    const willStamp = targets.some((rf) => (rf.stamps || []).some((s) => s && s.draw_label !== false));
    $("preview-this-label").textContent = `この号証（${file.evidenceNumber}）の押印:`;
    $("preview-stamp-new").classList.toggle("is-active", willStamp);
    $("preview-stamp-done").classList.toggle("is-active", !willStamp);
    renderRotState("preview", filesRotation(targets), "");
  } else {
    perWrap.hidden = true;
  }
}

// normalize to 0/90/180/270 (renderer copy of the engine's rule)
function normalizeAngle(a) {
  return ((Math.round((Number(a) || 0) / 90) * 90) % 360 + 360) % 360;
}

// スタンプ変更はオーバーレイの敷き直しだけ（PDF再生成なし・即時）。
function setPreviewStamp(mode) {
  const targets = previewStampTargets(state.previewFiles[state.selectedPreview]);
  if (!targets.length) return;
  for (const rf of targets) applyStampMode(rf, mode);
  renderPreviewStampControls();
  pvLayoutAllOverlays();
}
// 表示中プレビューファイルが画像sourceを含むか（含むなら回転はベースPDF焼き込み＝再生成が要る）。
function previewFileHasImage(file) {
  return ((file && file.sources) || []).some((si) => isImageSrc(si.srcPath));
}

// 表示中の1ファイルだけベースPDFを作り直す（画像の回転焼き込み反映用）。全ファイル再生成は
// 重い（大きな写真が多いと顕著）ので、回転した号証の出力だけを既存プレビューフォルダへ作り直す。
// buildOutputPlan() を都度読むので、直前の rf.stamps 変更が確実に反映される。
async function regeneratePreviewFile() {
  const idx = state.selectedPreview;
  const old = state.previewFiles[idx];
  if (!old) return;
  const plan = buildBasePlan(buildOutputPlan());
  // 表示中ファイルに対応する出力を号証番号で対応付け（AV除外でindexがずれても安全）。
  const output = plan.find((o) => old.evidenceNumber && o.evidenceNumber === old.evidenceNumber)
    || plan.find((o) => o.destName && o.destName === old.name)
    || plan[idx];
  if (!output) return;
  const res = await window.api.regeneratePreviewFile({ output, oldPath: old.path });
  if (res && res.file) {
    state.previewFiles[idx] = res.file;
    await showPreviewFile(idx); // その1ファイルだけ再読込・再描画
  }
}

// Manual orientation fix from the preview (AI sometimes misses a rotated scan).
// Sets the correction angle on the 号証's stamp(s); if there are none, adds a
// rotation-only stamp on page 1 so the page still gets rotated.
// PDFはviewport回転の再計算だけで即時。画像は白帯が回転で崩れるためベースPDFへ焼き込む＝再生成する。
async function setPreviewRotate(deg) {
  const file = state.previewFiles[state.selectedPreview];
  const targets = previewStampTargets(file);
  if (!targets.length) return;
  setFilesRotation(targets, deg);
  renderPreviewStampControls();
  if (previewFileHasImage(file)) await regeneratePreviewFile();
  else await pvApplyRotations();
}
// v5.2.1: 出力前プレビューで証拠説明書の中身を見せるか。作る設定で、立証趣旨が1つでも書かれているとき
// （AIが書いたものでも、確認画面で書いたものでも）。以前（v3.10）の Word→PDF に変換して見せるプレビューは
// 重いので撤去した（docs/ux-review.md UX-18）。ここでは組み立てたデータを表にするだけなので軽い。
function explanationPreviewAvailable() {
  return !!state.generateExplanation && !state.renameOnly && !state.explanationExists && hasEvidenceFiles()
    && state.reviewFiles.some((rf) => rf.evidenceNumber && String(rf.proofPurpose || "").trim());
}
function showExplanationPreview() {
  state.selectedPreview = -1;
  const items = Array.from($("preview-file-list").children);
  items.forEach((el) => el.classList.toggle("is-active", el.classList.contains("preview-file-expl")));
  renderPreviewStampControls();
  pvCleanup();
  const data = buildExplanationData();
  const page = document.createElement("div");
  page.className = "expl-pv-page";
  const line = (cls, text) => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    page.append(d);
  };
  line("expl-pv-court", `${data.裁判所}　${data.事件番号}`);
  line("expl-pv-title", "証拠説明書");
  line("expl-pv-right", data.提出日);
  line("expl-pv-right", `${data.提出者側}代理人弁護士　　${data.代理人}`);
  line("expl-pv-note", "※「標目」欄に原本・写しの記載がないものは、民事訴訟法231条の2の電磁的記録として提出するものである。");
  const table = document.createElement("table");
  table.className = "expl-pv-table";
  const cols = ["号証", "標目", "作成年月日", "作成者", "立証趣旨", "備考"];
  const head = table.createTHead().insertRow();
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    head.append(th);
  }
  const body = table.createTBody();
  for (const r of data.証拠) {
    const tr = body.insertRow();
    for (const c of cols) {
      const td = tr.insertCell();
      td.textContent = r[c] || "";
      if (String(r[c] || "").includes("●●")) td.classList.add("is-blank");
    }
  }
  page.append(table);
  line("expl-pv-note", "画面で見やすくした表です。実際の書式は作成される Word（裁判所のひな形どおり）で確かめてください。●● は未入力です。");
  $("pv-scroll").replaceChildren(page);
}

function renderPreviewModal(errors) {
  const list = $("preview-file-list");
  list.innerHTML = "";
  state.previewFiles.forEach((f, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-file" + (i === state.selectedPreview ? " is-active" : "");
    const name = document.createElement("div");
    name.className = "pf-name";
    name.textContent = f.name;
    btn.appendChild(name);
    if (f.evidenceNumber || f.size != null) {
      const num = document.createElement("div");
      num.className = "pf-num";
      // v5.2.0: 大きさも出す（アップロードの上限を超えるものは目立たせる）
      num.textContent = [f.evidenceNumber, f.size != null ? formatMB(f.size) : ""].filter(Boolean).join("・");
      if (f.size != null && f.size > UPLOAD_LIMIT_MB * 1024 * 1024) num.classList.add("pf-over-limit");
      btn.appendChild(num);
    }
    btn.addEventListener("click", () => showPreviewFile(i));
    list.appendChild(btn);
  });
  // v5.2.1: 証拠説明書（下書き）の中身も、一覧の最後から確かめられるようにする（表で見せるだけ。Word 変換はしない）
  if (explanationPreviewAvailable()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-file preview-file-expl";
    const name = document.createElement("div");
    name.className = "pf-name";
    name.textContent = "証拠説明書（下書き）";
    const sub = document.createElement("div");
    sub.className = "pf-num";
    sub.textContent = "書く内容の確認（Word で作ります）";
    btn.append(name, sub);
    btn.addEventListener("click", showExplanationPreview);
    list.appendChild(btn);
  }

  const errEl = $("preview-errors");
  errEl.innerHTML = "";
  if (errors && errors.length) {
    errEl.hidden = false;
    errors.forEach((e) => {
      const d = document.createElement("div");
      d.textContent = `${e.name ? e.name + ": " : ""}${e.message}`;
      errEl.appendChild(d);
    });
  } else {
    errEl.hidden = true;
  }

  $("preview-hint").textContent = state.previewFiles.length
    ? `${state.previewFiles.length}件のファイルを確認できます。`
    : "作成されるファイルがありません。";
  $("preview-commit-btn").disabled = !state.previewFiles.length;
  renderPreviewStampControls();
}

// FB-11: プレビューには「スタンプ・回転を一切適用しないベースPDF」を作らせる
// （deep copyで各sourceのstampsを[]に。結合・Office変換・画像A4化・正規化はそのまま効く）。
// ただし画像だけは例外: 回転をライブ適用すると白帯が横へ逃げて番号が崩れるため、回転のみ
// ベースPDFへ焼き込む（ラベルは従来どおりオーバーレイ）。→ プレビューは回転後の正立紙面になる。
function buildBasePlan(outputs) {
  return outputs.map((o) => ({
    ...o,
    sources: (o.sources || []).map((s) => {
      if (isImageSrc(s.srcPath)) {
        const deg = imageBakeRotation(s.stamps);
        return {
          ...s,
          stamps: deg
            ? [{ page: 1, branch: null, draw_label: false, rotate_degrees: deg, position: { x: 0.93, y: STAMP_SAFE_Y, anchor: "top-right" } }]
            : [],
        };
      }
      return { ...s, stamps: [] };
    }),
  }));
}

async function openPreview(outputs) {
  const btn = $("export-next-btn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "プレビュー生成中...";
  try {
    const res = await window.api.generatePreview({ outputs: buildBasePlan(outputs) });
    state.previewFiles = res.files || [];
    state.selectedPreview = 0;
    renderPreviewModal(res.errors || []);
    $("preview-modal-overlay").hidden = false;
    if (state.previewFiles.length) {
      await showPreviewFile(0);
    } else {
      pvCleanup();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function closeHelpModal() {
  $("help-modal-overlay").hidden = true;
}


// PDF.jsの1ページを canvas へ描画する共通処理（FB-11プレビューとFB-15確認画面プレビューで共用）。
// rotation は「合計回転の置き換え指定」（省略時は元PDFの/Rotateどおり）。内部解像度はdevicePixelRatio対応。
async function renderPdfPage(page, canvas, { width, rotation, maxScale } = {}) {
  const vp1 = page.getViewport(rotation == null ? { scale: 1 } : { scale: 1, rotation });
  let scale = width / vp1.width;
  if (maxScale) scale = Math.min(maxScale, scale);
  const vp = page.getViewport(rotation == null ? { scale } : { scale, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = `${Math.floor(vp.width)}px`;
  canvas.style.height = `${Math.floor(vp.height)}px`;
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
  return { scale, cssW: Math.floor(vp.width), cssH: Math.floor(vp.height) };
}

