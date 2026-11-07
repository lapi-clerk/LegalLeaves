// ---------------------------------------------------------------------------
// 画面の共有状態と基盤（$ ヘルパ・state・定数・ファイル受け取り・AI出力の検証）
//
// src/app.js から分離。関数の中身は移動しただけで変更していない。
// クラシックスクリプトなのでグローバルスコープを共有する。**このファイルを最初に読む**
// （state などの束縛を他ファイルより先に用意するため）。
// ---------------------------------------------------------------------------

const STEP_ORDER = ["start", "match", "review", "export", "done"];
const KIND_OPTIONS = ["主張系", "証拠説明書", "証拠", "関連事件の申立", "その他"];
const META = {
  start: ["読み込み", "ファイルをドラッグ＆ドロップし、AIの整理データをセットします。"],
  match: ["照合", "ファイル一覧とAIの整理データを突き合わせます。"],
  review: ["確認", "確認が必要な項目とPDF情報を見ます。"],
  export: ["出力", "提出用ファイルの保存先フォルダを選びます。"],
  done: ["完了", "作成された提出用ファイルを確認します。"],
};

const state = {
  step: "start",
  maxReachedIndex: 0,
  aiText: "",
  aiJsonError: "",
  aiCardCollapsed: false, // 正常受領時に生JSONを畳んで受領カードを見せる
  makeSubfolder: true,
  outputFolder: "",
  recentFolders: [],
  files: [], // { path, name, type, metaFields: null|[{key,value}], metaError }
  reviewFiles: [], // { path, name, matched, needsConfirmation, confirmText, kind, docName, suggested, metadata:[{key,val,action}] }
  aiWarnings: [],
  matchKey: "",
  selectedReview: 0,
  showAllReview: false,
  writeResult: null,
  lastOutputDir: "",
  previewEnabled: true,
  previewFiles: [],
  selectedPreview: 0,
  mergeDisabled: new Set(), // evidence_numbers the user chose NOT to merge
  manualMatches: {}, // file path -> AI entry original_file_name (user-assigned link)
  orphanEntries: [], // submittable AI entries with no matching file (assign candidates)
  aiEntries: [], // all parsed AI file entries (for the manual-assign dropdown)
  consistency: null, // v3 pattern-A: 証拠説明書 vs actual evidence files check result
  excludedFiles: [], // 確認画面の「ファイルごと除外」で外したファイル（「編集をすべて取り消す」で復元）
  matchSkipped: false, // 照合で対応すべきことが無く、照合画面を飛ばして確認へ来たか
  splitPagesFor: null, // 「ページで枝番に分ける」入力欄を開いたときの対象（別ファイルへ切り替えたら閉じる）
  placeholders: [], // 「後で追加予定」の空き号証番号（例 "甲002"）。セッション内のみ・ファイルにその番号が付くと自動で消える
  renameOnly: false, // rename-only mode: copy files to submission names, no processing
  autoSourcePreview: true, // 広い画面で元ファイルのプレビューを自動で開くか（利用者が閉じたら false）
  sourcePreviewTouched: false, // 利用者がプレビューのボタンを一度でも押したか（押していなければ窓を狭めると自動で閉じる）
  noAi: false, // 「AIを使わずに進む」: AIの整理データなしで、ファイル名の号証番号から証拠番号を決める（少数の追加用）
  caseInfo: null, // parsed case{} (court, number, parties, lawyers) for generation
  explanationExists: false, // whether the AI reported an existing 証拠説明書
  generateExplanation: false, // user opted to generate a 証拠説明書 draft (pattern B)
};

// 裁判所のシステムへ一度にアップロードできる合計の大きさ（MB）。現行の mints は 200MB。
// TreeeS へ切り替わって上限が変わったら、ここだけを直す。
const UPLOAD_LIMIT_MB = 200;
function formatMB(bytes) {
  if (bytes == null) return "";
  if (bytes < 100 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`; // 0.0MB と出さない
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)}MB` : `${(Math.round(mb * 10) / 10).toFixed(1)}MB`;
}

// AIの整理データを使わずに進めている状態か（照合する相手が無い）。
// リネームのみモード（メタデータ削除だけ）と、「AIを使わずに進む」（ファイル名の号証番号を使う）の2通り。
function noAiData() {
  return !state.aiText.trim() && (state.renameOnly || state.noAi);
}

// 確認画面の「プレビューを見る」インラインプレビュー
let sourcePreviewUrl = null;
let sourcePreviewPath = null;

// 一覧のドラッグ並べ替え中の対象。{level:"num", num} または {level:"branch", num, branch}
let evDrag = null;


function $(id) {
  return document.getElementById(id);
}

function guessType(name) {
  const n = name || "";
  if (n.includes("訴状") || n.includes("準備書面") || n.includes("答弁")) return "主張";
  if (n.includes("説明書")) return "説明";
  if (n.includes("号証") || n.includes("甲") || n.includes("乙")) return "証拠";
  if (/\.(jpe?g|png)$/i.test(n)) return "画像";
  if (AUDIO_RE.test(n)) return "音声";
  if (VIDEO_RE.test(n)) return "動画";
  if (/\.(docx?|rtf)$/i.test(n)) return "Word";
  if (/\.xlsx?$/i.test(n)) return "Excel";
  if (/\.pptx?$/i.test(n)) return "PPT";
  if (/\.pdf$/i.test(n)) return "PDF";
  return "—";
}

// v5.4.0: 音声・動画。.mp3・.mp4 はそのまま、ほかの形式は出力時に .mp3・.mp4 へ変換する（py/legalleaves/media.py と同じ一覧）
const AUDIO_RE = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?|amr)$/i;
const VIDEO_RE = /\.(mp4|mov|avi|wmv|mkv|m4v|flv|webm|3gp|3g2|mpeg|mpg|mts|m2ts|ts|vob)$/i;
// Output: audio -> .mp3, video -> .mp4; everything else -> .pdf.
function outputExtFor(name) {
  const n = String(name || "");
  if (AUDIO_RE.test(n)) return ".mp3";
  if (VIDEO_RE.test(n)) return ".mp4";
  return ".pdf";
}
function isAvName(name) {
  const n = String(name || "");
  return AUDIO_RE.test(n) || VIDEO_RE.test(n);
}
// .mp3・.mp4 以外の音声・動画（出力時に変換する）
function needsAvConversion(name) {
  return isAvName(name) && !/\.(mp3|mp4)$/i.test(String(name || ""));
}
// Submission extension. Rename-only mostly keeps the original extension, EXCEPT
// Office/RTF: rename-only converts those to PDF (metadata removal), so
// the submission name must say .pdf too — otherwise renameOnlyDest() appends the
// real extension and produces 「訴状.docx.pdf」 (a double extension).
function submitExtFor(name) {
  if (state.renameOnly) {
    const ext = String(name || "").match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
    if (isAvName(name)) return outputExtFor(name); // 名前だけ整えるときも、音声・動画は .mp3・.mp4 にする
    return /^\.(docx?|xlsx?|pptx?|rtf)$/.test(ext) ? ".pdf" : ext;
  }
  return outputExtFor(name);
}
// Extensions the app can actually take in (matches the picker / drop filter). AI
// entries pointing at anything else (e.g. a duplicate .wav) can't have a file here.
const SUBMITTABLE_RE = /\.(pdf|jpe?g|png|docx?|xlsx?|pptx?|rtf)$/i;
function isSubmittableName(name) {
  return SUBMITTABLE_RE.test(String(name || "")) || isAvName(name);
}

function walkEntry(entry, out) {
  return new Promise((resolve) => {
    if (!entry) {
      resolve();
      return;
    }
    if (entry.isFile) {
      entry.file(
        (file) => {
          out.push(file);
          resolve();
        },
        () => resolve()
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (!entries.length) {
            resolve();
            return;
          }
          for (const child of entries) await walkEntry(child, out);
          readBatch();
        }, () => resolve());
      };
      readBatch();
    } else {
      resolve();
    }
  });
}

async function collectFilesFromDataTransfer(dataTransfer) {
  const out = [];
  const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length) {
    for (const entry of entries) await walkEntry(entry, out);
  } else if (dataTransfer && dataTransfer.files) {
    out.push(...Array.from(dataTransfer.files));
  }
  return out;
}

// main から返るファイル情報を state.files の1件へ反映する。
// 取り込み経路が2つある（addFiles＝読み込み時／ensureMetadataLoaded＝未取得の再試行）ため、
// ここに集約する。**別々に書くと片方だけ項目が抜ける**（実際にA3超の警告が
// addFiles側で overA3 を渡しておらず、警告が一度も出ていなかった）。
function mergeMetaResult(f, r) {
  if (!r) return f;
  return {
    ...f,
    metaFields: r.fields || [],
    metaError: r.error || null,
    officeMeta: r.officeMeta || null,   // Wordの個人情報削除フラグ
    activeContent: r.activeContent || null, // 能動的コンテンツ（検出のみ）
    overA3: r.overA3 || null,           // A3を超えるページの寸法
    pageCount: r.pageCount || null,     // PDFのページ数（ページ範囲で枝番に分けるときに使う）
    captureMeta: r.captureMeta || null, // 写真・音声・動画の撮影・録音日時（機器の記録）と撮影場所の有無（消す前に読む）
  };
}

// "2025-11-18T01:12" → "R7.11.18"（証拠説明書の作成年月日と同じ半角の和暦）。読めなければ ""。
// 令和は 2019-05-01 から。それより前は平成（H31.4.30 まで）。
// 写真（.jpg・.png）か。撮影日の下書き・欄の名前に使う
function isPhotoName(name) {
  return /\.(jpe?g|png)$/i.test(String(name || ""));
}
function toWarekiShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const y = +m[1], mo = +m[2], d = +m[3];
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const key = y * 10000 + mo * 100 + d;
  if (key >= 20190501) return `R${y - 2018}.${mo}.${d}`;
  if (key >= 19890108) return `H${y - 1988}.${mo}.${d}`;
  return "";
}

async function addFiles(items) {
  const existing = new Set(state.files.map((f) => f.path));
  const fresh = items.filter((it) => it.path && !existing.has(it.path) && isSubmittableName(it.name));
  if (!fresh.length) return;
  const added = fresh.map((it) => ({ path: it.path, name: it.name, type: guessType(it.name), metaFields: null, metaError: null }));
  state.files = [...state.files, ...added];
  update();
  try {
    const results = await window.api.readPdfMetadata(added.map((f) => f.path));
    const byPath = new Map(results.map((r) => [r.path, r]));
    state.files = state.files.map((f) => {
      return mergeMetaResult(f, byPath.get(f.path));
    });
  } catch (e) {
    // metadata stays unresolved (null); ensureMetadataLoaded() will retry on proceed
  }
  update();
}

async function ensureMetadataLoaded() {
  const pending = state.files.filter((f) => f.metaFields === null);
  if (!pending.length) return;
  try {
    const results = await window.api.readPdfMetadata(pending.map((f) => f.path));
    const byPath = new Map(results.map((r) => [r.path, r]));
    state.files = state.files.map((f) => {
      if (f.metaFields !== null) return f;
      return mergeMetaResult(f, byPath.get(f.path));
    });
    renderStart(); // A3超の警告など、読み込み後の情報を反映
  } catch (e) {
    // leave unresolved; buildReviewFiles() treats null as empty metadata
  }
}

function validateAiJson() {
  const text = state.aiText.trim();
  if (!text) {
    state.aiJsonError = "";
    return;
  }
  // 桁違いに大きな貼り付け（誤操作・細工）でJSON.parseが固まるのを防ぐ
  if (text.length > 10 * 1024 * 1024) {
    state.aiJsonError = "貼り付けられたデータが大きすぎます（10MBまで）。AIの整理データ(JSON)だけを貼り付けてください。";
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    state.aiJsonError = "JSONの形式が正しくありません。AIの出力をそのまま貼り付けてください。";
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.files)) {
    state.aiJsonError = "データの形式が正しくありません(filesが見つかりません)。";
    return;
  }
  const limitError = checkAiLimits(parsed);
  if (limitError) {
    state.aiJsonError = limitError;
    return;
  }
  state.aiJsonError = "";
}

// 外部AIの出力は「信頼できない入力」として扱う。JSONとして読めても、
// 件数・文字列長・数値が極端だと、照合ループやDOM生成・PDFへの命令生成でUIが固まったり
// メモリを食い潰したりする（全体10MBのサイズ上限だけでは、CPU負荷や配列件数の防御にならない）。
// 上限は実務の最大想定（1バッチ数百件・1ファイル数百ページ）より十分大きく取り、
// 正常なデータを誤って弾かないようにしている。
const AI_LIMITS = {
  files: 1000,      // 1回の提出バッチのファイル数
  stamps: 500,      // 1ファイルあたりの押印・回転指示の数
  warnings: 200,    // 警告の件数
  name: 1000,       // ファイル名・タイトル・証拠番号など
  text: 4000,       // 立証趣旨・確認事項など長めの文章欄
  pageNo: 100000,   // ページ番号（実ページ数との突き合わせはPDFエンジン側で厳密に行う）
};
// 文字列として長すぎる項目を1つ返す（無ければ null）
function overlongField(obj, keys, cap) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > cap) return k;
  }
  return null;
}
const AI_BROKEN_HINT = "AIの整理データが壊れている可能性があります。AIの出力をそのまま貼り付け直してください。";
function checkAiLimits(parsed) {
  if (parsed.files.length > AI_LIMITS.files) {
    return `ファイルの件数が多すぎます（${parsed.files.length}件・${AI_LIMITS.files}件まで）。${AI_BROKEN_HINT}`;
  }
  if (Array.isArray(parsed.warnings) && parsed.warnings.length > AI_LIMITS.warnings) {
    return `警告の件数が多すぎます（${AI_LIMITS.warnings}件まで）。${AI_BROKEN_HINT}`;
  }
  for (let i = 0; i < parsed.files.length; i++) {
    const f = parsed.files[i];
    const where = `${i + 1}件目のファイル`;
    if (!f || typeof f !== "object" || Array.isArray(f)) {
      return `データの形式が正しくありません（${where}の情報が読み取れません）。${AI_BROKEN_HINT}`;
    }
    const longName = overlongField(f, ["original_file_name", "suggested_base_name", "title", "evidence_number", "branch_range", "author", "created_date"], AI_LIMITS.name);
    if (longName) return `${where}の項目が長すぎます（${AI_LIMITS.name}文字まで）。${AI_BROKEN_HINT}`;
    const longText = overlongField(f, ["proof_purpose", "confirmation_question", "capture_subject", "capture_location", "capture_by", "capture_datetime"], AI_LIMITS.text);
    if (longText) return `${where}の文章が長すぎます（${AI_LIMITS.text}文字まで）。${AI_BROKEN_HINT}`;
    if (f.stamps != null && !Array.isArray(f.stamps)) {
      return `データの形式が正しくありません（${where}の押印指示が読み取れません）。${AI_BROKEN_HINT}`;
    }
    if (Array.isArray(f.stamps)) {
      if (f.stamps.length > AI_LIMITS.stamps) {
        return `${where}の押印指示が多すぎます（${f.stamps.length}件・${AI_LIMITS.stamps}件まで）。${AI_BROKEN_HINT}`;
      }
      for (const s of f.stamps) {
        if (s == null) continue; // 空要素は後段で無視する（isMeaningfulStamp）
        if (typeof s !== "object" || Array.isArray(s)) {
          return `データの形式が正しくありません（${where}の押印指示が読み取れません）。${AI_BROKEN_HINT}`;
        }
        if (s.page != null && (typeof s.page !== "number" || !Number.isFinite(s.page) || s.page < 1 || s.page > AI_LIMITS.pageNo)) {
          return `${where}のページ番号が正しくありません。${AI_BROKEN_HINT}`;
        }
      }
    }
  }
  return null;
}

// AIの元の値と現在値が異なるフィールドにだけヒントを表示する
function renderAiOriginalHint(id, rf, key, current) {
  const el = $(id);
  const orig = rf && rf.aiOriginal ? rf.aiOriginal[key] : undefined;
  const differs = orig !== undefined && String(orig ?? "") !== String(current ?? "");
  el.hidden = !differs;
  if (differs) {
    el.querySelector(".ai-orig-value").textContent = `AIの値: ${orig || "（空欄）"}`;
  }
}

// 受領カードのサマリ（バリデーション通過済みの aiText を前提とする）
function aiReceiptSummary() {
  try {
    const parsed = JSON.parse(state.aiText.trim());
    const files = Array.isArray(parsed.files) ? parsed.files : [];
    const evid = files.filter((f) => f && f.type === "証拠").length;
    const confirms = files.filter((f) => f && f.needs_user_confirmation === true).length;
    const parts = [`ファイル${files.length}件分`];
    if (evid) parts.push(`証拠${evid}件`);
    if (confirms) parts.push(`要確認${confirms}件`);
    return parts.join("・");
  } catch (e) {
    return "";
  }
}

// Normalize a filename for tolerant matching — AI often reformats spaces or
// full/half-width chars, which would break an exact string compare. Whitespace
// is removed entirely (AI frequently adds/drops spaces, e.g. "甲 42" vs "甲42").
function normKey(name) {
  return String(name || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

