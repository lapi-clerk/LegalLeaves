// ---------------------------------------------------------------------------
// 証拠番号まわり（記号・枝番の解析／全角半角／証拠説明書との整合／照合と出力プランの組み立て）
//
// src/app.js から分離。関数の中身は移動しただけで変更していない。
// 号証記号の実務ルール（片側のみ・刑事の弁検は枝番なし 等）は各関数のコメントを参照。
// ---------------------------------------------------------------------------

// Same, but with the extension stripped — the AI sometimes writes the wrong
// extension (e.g. .jpg for a .png), so match on the base name as a last resort.
function normKeyNoExt(name) {
  return normKey(String(name || "").replace(/\.[^.]+$/, ""));
}

// A default top-right stamp, used when a numbered evidence has no stamp yet.
// y=0.07 はタイムスタンプ帯（上端8〜19mm）の直下（TIMESTAMP_ZONE 参照）。
function defaultStamp() {
  return { page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: STAMP_SAFE_Y, anchor: "top-right" } };
}

// A stamp only matters if it draws a label or rotates. The AI sometimes emits a
// no-op entry per page (draw_label:false, rotate 0) — drop those so the review
// screen isn't flooded and no empty ops reach the engine.
function isMeaningfulStamp(s) {
  if (!s || typeof s !== "object") return false;
  const draws = s.draw_label !== false;
  const rot = ((Math.round((s.rotate_degrees || 0) / 90) * 90) % 360 + 360) % 360;
  return draws || rot !== 0;
}

// Strip programmer jargon (JSON field names) the AI may leak into a confirmation
// question, so lawyers see plain Japanese.
function cleanConfirmText(t) {
  return String(t || "")
    .replace(/[（(][^（()）]*draw_label[^（()）]*[）)]/gi, "") // remove （draw_label: false）
    .replace(/[^。\n]*draw_label[^。\n]*。/gi, "") // remove a whole clause still mentioning it
    .replace(/[^。\n]*draw_label[^。\n]*/gi, "") // ...even without a trailing period
    .replace(/[ 　]{2,}/g, " ")
    .trim();
}
// 一括バーの見出し用に長い確認文を省略する。
function clipText(s, n) {
  s = String(s || "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// "甲001" -> { sym:"甲", num:1 }; null if it doesn't parse.
function parseEvidenceNumber(s) {
  const m = /^(\D+)0*(\d+)$/.exec(String(s || "").trim());
  return m ? { sym: m[1], num: parseInt(m[2], 10) } : null;
}
function padEvidence(sym, num) {
  return `${sym}${String(num).padStart(3, "0")}`;
}
// 刑事事件の号証（弁号証・検号証）は枝番を使わない実務ルール（各証拠に独立番号）。記号だけで
// 明確に刑事と判るのは弁・検のみ（甲/乙は民事・刑事どちらもあり得るので民事扱いのまま枝番可）。
// これらの号証では枝番の入力・分割・ドラッグ入れ子・ファイル名からの枝番抽出を無効化する。
const CRIMINAL_SYMBOLS = "弁検";
function isCriminalSymbol(sym) {
  const s = String(sym || "").trim();
  return !!s && CRIMINAL_SYMBOLS.includes(s.charAt(0));
}
function isCriminalEvidenceNum(evNum) {
  const p = parseEvidenceNumber(evNum);
  return p ? isCriminalSymbol(p.sym) : isCriminalSymbol(evNum);
}
// 証拠番号欄の入力を「号証番号」と「枝番」に分ける。"弁3-1"/"弁003-1"/"弁3の1"/"甲A3-1" などを
// 受け付け、{ num:"弁003", branch:"1", hasBranch:true } を返す。区切り（- ‐ － の / ／）が無ければ
// hasBranch:false・branch:null（呼び手は既存の枝番を触らない）。番号として読めなければ null。
function parseEvidenceInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = /^(\D+?)\s*0*(\d+)\s*([-‐－の/／]\s*0*(\d+)?)?$/.exec(s);
  if (!m) return null;
  const sym = m[1].trim();
  const branchOk = !isCriminalSymbol(sym); // 刑事（弁/検）は枝番なし
  return {
    num: `${sym}${String(parseInt(m[2], 10)).padStart(3, "0")}`,
    hasBranch: branchOk && !!m[3],
    branch: branchOk && m[4] ? String(parseInt(m[4], 10)) : null,
  };
}
// 号証記号として認める文字（十干＋刑事の弁・検）。系列記号（甲A 等）も許容。
const EVIDENCE_SYMBOLS = "甲乙丙丁戊己庚辛壬癸弁検";
// ファイル名の先頭が号証番号（弁3-3 / 甲5 / 乙12-2 / 甲A3 等）ならそれを返す。AIによっては元の
// ファイル名を受け取れず（Gemini等は添付を「[source: N]」や空欄で扱う）、号証番号を読めずに勝手に
// 甲へ振り直してしまう。アプリは本物のファイル名を持つので、これで号証番号を確定する。誤検出を避ける
// ため、先頭が既知の号証記号＋数字のときだけ対象にする（「報告書3」「契約書」等は号証にしない）。
function parseEvidenceFromFilename(name) {
  const base = String(name || "").replace(/\.[^.]+$/, "").trim()
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)); // 全角数字→半角
  const re = new RegExp(`^([${EVIDENCE_SYMBOLS}](?:[A-Za-zＡ-Ｚａ-ｚ])?)\\s*0*(\\d+)(?:\\s*[-‐－の／/]\\s*0*(\\d+))?`);
  const m = re.exec(base);
  if (!m) return null;
  return {
    num: `${m[1]}${String(parseInt(m[2], 10)).padStart(3, "0")}`,
    branch: !isCriminalSymbol(m[1]) && m[3] ? String(parseInt(m[3], 10)) : null, // 刑事（弁/検）は枝番なし
  };
}
// ファイル名から、先頭の号証番号と区切り（_ - スペース等）を除いた残り＝標目の候補を返す。
// 「甲1の2_領収書.pdf」→「領収書」、「乙12-2 LINE.pdf」→「LINE」。号証番号が無ければ拡張子を除いた名前。
function titleFromFilename(name) {
  const base = String(name || "").replace(/\.[^.]+$/, "").trim();
  const half = base.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
  const re = new RegExp(`^([${EVIDENCE_SYMBOLS}](?:[A-Za-zＡ-Ｚａ-ｚ])?)\\s*0*(\\d+)(?:\\s*[-‐－の／/]\\s*0*(\\d+))?[\\s_＿\\-‐－・.]*`);
  const m = re.exec(half);
  if (!m) return base;
  const rest = base.slice(m[0].length).trim(); // 長さは全角→半角でも変わらない（1文字ずつ置き換え）
  return rest || base;
}
// 証拠説明書など裁判文書コンテンツの慣行: 英数字・スペース・括弧は全角（日付だけ半角）。
// 氏名の姓名の間の全角スペース自体は、単語境界をアプリが推測できないためAI/プロンプト側の
// 責務（assets/ai-prompt.md）。ここでは半角で来た値の「幅」だけを矯正する。
function toFullWidth(s) {
  return String(s || "")
    .replace(/[0-9A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/ /g, "　");
}
function toHalfWidth(s) {
  return String(s || "").replace(/[０-９Ａ-Ｚａ-ｚ．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}
// ファイル名の慣行: 表示幅を抑えるため、英数字・括弧は半角（AIが全角で書いてくることがあるため矯正）。
// ＿（全角アンダーバー U+FF3F）も同じ -0xFEE0 規則で _ になる（取りこぼしていた）。
function toHalfWidthFilenamePart(s) {
  return String(s || "")
    .replace(/[０-９Ａ-Ｚａ-ｚ＿]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/　/g, " ");
}
// 号証 label for the 証拠説明書 table: 公式ひな形（フェーズ3・shouko_setsumeisho_f3.xlsx）準拠。
// 英数字は半角・3桁ゼロ埋め・枝番は半角ハイフン。裁判文書コンテンツ＝全角の一般則の
// 例外で、号証欄だけは公式が「英数字は半角」と明示している。
// e.g. ("乙041","1") -> "乙041-1"  ("甲005",null) -> "甲005"
function explanationEvidenceLabel(evidenceNumber, branch) {
  const p = parseEvidenceNumber(evidenceNumber);
  if (!p) return toHalfWidth(evidenceNumber || "");
  let s = padEvidence(p.sym, p.num);
  const b = branch == null ? "" : toHalfWidth(String(branch).trim());
  if (b) s += `-${b}`;
  return s;
}
// 枝番の並び順のキー。範囲（"1～2"）は先頭の数字で並べる
// （数字以外を全部消すと "1～2" が 12 になり、の3 より後ろへ並んでしまう）。
function branchSortKey(br) {
  const m = toHalfWidth(String(br || "")).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
// True per-page branch source of truth (rf.branchRange is just a file-level display
// summary and can itself be a range like "1〜3" — see docs/ai-contract.md). When a
// single file's stamps carry 2+ distinct branches (e.g. an invoice+receipt combo PDF
// stamped 「の1」「の2」on different pages), the 証拠説明書 needs one row per branch,
// not one row for the whole file.
function branchesFromStamps(rf) {
  if (!Array.isArray(rf.stamps)) return [];
  const set = new Set();
  for (const s of rf.stamps) {
    const b = s && s.branch != null ? String(s.branch).trim() : "";
    if (b) set.add(b);
  }
  return [...set].sort((a, b) => branchSortKey(a) - branchSortKey(b));
}
// ---------- 1つのPDFにまとめてスキャンした枝番を、ページ範囲で分ける ----------
// rf.pageRange = [from, to]（1始まり・両端含む）。null なら元ファイルの全ページ。
function samePageRange(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);
}
function pageRangeLabel(rf) {
  if (!rf || !rf.pageRange) return "";
  const [from, to] = rf.pageRange;
  return from === to ? `${from}ページ目` : `${from}〜${to}ページ目`;
}
// 「1-3, 4-5, 6」→ [[1,3],[4,5],[6,6]]。全角・「〜」「～」「、」も受け付ける。
// 1ページ目から最後のページまで、すき間・重なり無しで2つ以上に分けていることを確かめる
// （ページの取りこぼしや二重出力を防ぐ）。total が分からなければ最後の確認だけ省く。
function parsePageRanges(text, total) {
  const src = toHalfWidth(String(text || "")).replace(/[〜～~ー－―−‐]/g, "-");
  const parts = src.split(/[,、，\s]+/).filter(Boolean);
  if (!parts.length) return { error: "ページの範囲を入力してください（例: 1-3, 4-5）。" };
  const ranges = [];
  for (const p of parts) {
    const m = p.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return { error: `「${p}」をページの範囲として読めません（例: 1-3）。` };
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    if (from < 1 || to < from) return { error: `「${p}」は、ページの範囲として正しくありません。` };
    ranges.push([from, to]);
  }
  if (ranges.length < 2) return { error: "2つ以上に分けてください（例: 1-3, 4-5）。" };
  if (ranges[0][0] !== 1) return { error: "1ページ目から始めてください。" };
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] !== ranges[i - 1][1] + 1) {
      return { error: `${ranges[i - 1][1]}ページ目の次は${ranges[i - 1][1] + 1}ページ目から始めてください（抜けや重なりがあります）。` };
    }
  }
  const last = ranges[ranges.length - 1][1];
  if (total && last !== total) {
    return { error: last < total
      ? `このPDFは全${total}ページです。最後の枝番は${total}ページ目まで含めてください。`
      : `このPDFは全${total}ページです。${total}ページ目より後ろは指定できません。` };
  }
  return { ranges };
}
// AIがページごとに別々の枝番を割り当てていれば（stamps[].branch が2種類以上）、
// そこから入力欄の初期値を作る（例: 1ページ目＝の1、4ページ目＝の2、全5ページ → "1-3, 4-5"）。
function pageRangesFromStamps(rf) {
  const firstPage = new Map(); // branch -> そのbranchが最初に出るページ
  for (const s of rf.stamps || []) {
    if (!s || s.branch == null || String(s.branch).trim() === "") continue;
    const b = String(s.branch).trim();
    const pg = Number(s.page) || 1;
    if (!firstPage.has(b) || pg < firstPage.get(b)) firstPage.set(b, pg);
  }
  const starts = [...new Set(firstPage.values())].sort((a, b) => a - b);
  if (starts.length < 2 || starts[0] !== 1 || !rf.pageCount) return "";
  return starts.map((st, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : rf.pageCount;
    return st === end ? String(st) : `${st}-${end}`;
  }).join(", ");
}

// ファイル単位の枝番（rf.branchRange）をスタンプ側の枝番（＝印字ラベルの「の◯」）へ揃える。
// AIがページごとに別々の枝番を割り当てたファイル（2種類以上）は、ページの対応を壊さないよう触らない。
// 回転だけのスタンプにも同じ枝番を入れる（ラベルを押さないので見た目は変わらない）。
function setStampBranch(rf, branch) {
  if (!rf || !Array.isArray(rf.stamps) || !rf.stamps.length) return;
  if (branchesFromStamps(rf).length > 1) return;
  for (const s of rf.stamps) if (s) s.branch = branch;
}

// v3 pattern A: cross-check the 証拠説明書's declared number range against the evidence
// files actually present. Returns null when there is no 証拠説明書 to check against.
// 号証番号の範囲を1つずつ回す突き合わせの上限（実務の最大想定より十分大きい値）。
const MAX_EVIDENCE_RANGE_SCAN = 2000;
// 警告文に番号を並べるときの表示上限（長大な一覧で画面が重くならないように）。
function listForMessage(items, max = 50) {
  if (items.length <= max) return items.join("、");
  return `${items.slice(0, max).join("、")} …ほか${items.length - max}件`;
}
function computeConsistency(reviewFiles, ee) {
  if (!ee || !ee.exists) return null;
  const first = parseEvidenceNumber(ee.first_evidence_number);
  const last = parseEvidenceNumber(ee.last_evidence_number);

  // distinct base evidence numbers among the evidence files we actually have
  const present = new Map(); // "甲|1" -> "甲001"
  for (const rf of reviewFiles) {
    const p = parseEvidenceNumber(rf.evidenceNumber);
    if (p) present.set(`${p.sym}|${p.num}`, rf.evidenceNumber);
  }

  const issues = [];
  let range = null;
  if (first && last && first.sym === last.sym && first.num <= last.num) {
    range = `${ee.first_evidence_number}〜${ee.last_evidence_number}`;
    // 番号の幅ぶんだけ回すループなので、AIが「甲1〜甲999999999」のような
    // 異常な範囲を出すと画面が固まる。実務の最大想定より十分大きい上限で打ち切る。
    if (last.num - first.num + 1 > MAX_EVIDENCE_RANGE_SCAN) {
      issues.push(`証拠説明書の番号範囲（${range}）が広すぎるため、不足・範囲外の突き合わせはスキップしました。番号の記載をご確認ください。`);
      return { fileName: ee.file_name || null, range, issues };
    }
    const missing = [];
    for (let n = first.num; n <= last.num; n++) {
      if (!present.has(`${first.sym}|${n}`)) missing.push(padEvidence(first.sym, n));
    }
    if (missing.length) issues.push(`証拠説明書は ${range} を記載していますが、次の証拠ファイルが見当たりません: ${listForMessage(missing)}`);
    const extra = [];
    for (const [key, label] of present) {
      const [s, nStr] = key.split("|");
      const n = parseInt(nStr, 10);
      if (s !== first.sym || n < first.num || n > last.num) extra.push(label);
    }
    if (extra.length) issues.push(`証拠説明書の範囲外の証拠ファイルがあります: ${listForMessage([...new Set(extra)])}`);
  } else if (ee.first_evidence_number || ee.last_evidence_number) {
    issues.push("証拠説明書の番号範囲を読み取れなかったため、範囲の突き合わせはスキップしました。");
  }

  return { fileName: ee.file_name || null, range, issues };
}

// 原告・申立人が出すのは甲号証、被告・相手方が出すのは乙号証。記号がねじれている
// ときは、たいてい「乙号証で準備して」のような指示の言い間違い（実務で頻出）なので警告する。
// 甲A・甲B のような系列記号は startsWith で正しい側として扱う。
function computePartySymbolWarnings(reviewFiles, ci) {
  const party = ci && ci.party;
  const expected =
    party === "原告" || party === "申立人" ? "甲" :
    party === "被告" || party === "相手方" ? "乙" : null;
  if (!expected) return [];
  const wrong = [];
  for (const rf of reviewFiles) {
    const p = parseEvidenceNumber(rf.evidenceNumber);
    if (p && !p.sym.startsWith(expected) && !wrong.includes(rf.evidenceNumber)) {
      wrong.push(rf.evidenceNumber);
    }
  }
  if (!wrong.length) return [];
  return [
    `提出者側は「${party}」のため、証拠番号は通常「${expected}」号証です（甲A・甲Bなどの系列も同様）。` +
    `異なる記号の番号が含まれています: ${wrong.join("、")} — 号証記号の指定間違い（言い間違い）でないかご確認ください。`,
  ];
}

function buildReviewFiles() {
  // 「AIを使わずに進む」かどうかが変われば作り直す（同じなら、確認画面での手直しを残す）
  const key = state.files.map((f) => f.path).join("|") + " " + state.aiText + " " + JSON.stringify(state.manualMatches) +
    " " + (state.noAi ? "noai" : "");
  if (state.matchKey === key && state.reviewFiles.length) return;
  state.matchKey = key;

  let aiFiles = [];
  let aiWarnings = [];
  let evidenceExplanation = null;
  let caseInfo = null;
  try {
    const parsed = JSON.parse(state.aiText);
    // validateAiJson で弾いているが、案件ファイル復元など別経路もあるので
    // ここでも「オブジェクトである要素」だけを使う（files:[null] で落ちないように）。
    aiFiles = Array.isArray(parsed.files)
      ? parsed.files.filter((f) => f && typeof f === "object" && !Array.isArray(f))
      : [];
    aiWarnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    evidenceExplanation = parsed.evidence_explanation || null;
    caseInfo = parsed.case || null;
  } catch (e) {
    // invalid JSON shouldn't reach here (proceed button is gated), fall back to no matches
  }
  state.caseInfo = caseInfo;
  state.explanationExists = !!(evidenceExplanation && evidenceExplanation.exists);

  const byName = new Map(aiFiles.map((f) => [f.original_file_name, f]));
  const byNameNorm = new Map(aiFiles.map((f) => [normKey(f.original_file_name), f]));
  const byNameNoExt = new Map(aiFiles.map((f) => [normKeyNoExt(f.original_file_name), f]));
  const matchedEntries = new Set(); // AI entries (by original_file_name) that matched a file

  const reviewFiles = state.files.map((f) => {
    const metadata = (f.metaFields || []).map((m) => ({ key: m.key, val: m.value, action: "delete" }));
    const officeMeta = f.officeMeta || null; // Word文書の個人情報削除フラグ検査結果
    const activeContent = f.activeContent || null; // PDFの能動的コンテンツ（検出のみ・削除はしない）
    const overA3 = f.overA3 || null; // A3を超えるページの寸法（出力時はA3へ縮小）
    // user-forced link first, then exact filename, normalized (space / full-half-
    // width), then ignoring the extension (AI may write .jpg for a .png).
    const forcedName = state.manualMatches[f.path];
    const forced = forcedName ? byName.get(forcedName) : null;
    const entry = forced || byName.get(f.name) || byNameNorm.get(normKey(f.name)) || byNameNoExt.get(normKeyNoExt(f.name));
    if (entry) {
      matchedEntries.add(entry.original_file_name);
      const baseName = entry.suggested_base_name || entry.title || f.name.replace(/\.[^.]+$/, "");
      const kind = KIND_OPTIONS.includes(entry.type) ? entry.type : "その他";
      const rawStamps = Array.isArray(entry.stamps) ? entry.stamps : [];
      const aiStamps = rawStamps.filter(isMeaningfulStamp);
      // Stamp resolution:
      //  - meaningful AI stamps -> use them.
      //  - AI gave stamps but they were all no-ops (e.g. draw_label:false because the
      //    number is ALREADY on the page) -> respect it, DON'T re-stamp.
      //  - AI gave no stamps at all for numbered evidence (v1-style JSON) -> default (#6).
      const stamps = aiStamps.length
        ? aiStamps
        : (rawStamps.length === 0 && entry.evidence_number ? [defaultStamp()] : []);
      // A flagged numbered evidence with no drawing stamp = "is the number already on
      // the page?" -> offer a 押す/押さない choice that also resolves the confirmation.
      const hasDrawing = stamps.some((s) => s && s.draw_label !== false);
      const stampAsk = !!entry.evidence_number && !!entry.needs_user_confirmation && !hasDrawing;
      return {
        path: f.path,
        name: f.name,
        matched: true,
        manualMatch: !!forced,
        needsConfirmation: !!entry.needs_user_confirmation,
        confirmText: cleanConfirmText(entry.confirmation_question),
        kind,
        docName: entry.title || baseName,
        suggested: `${toHalfWidthFilenamePart(baseName)}${submitExtFor(f.name)}`,
        metadata,
        officeMeta,
        activeContent,
        overA3,
        pageCount: f.pageCount || null,
        evidenceNumber: entry.evidence_number || null,
        branchRange: entry.branch_range || null,
        stamps,
        stampAsk,
        stampDecided: false,
        userConfirmed: false,
        // v3-A: when the 証拠説明書 標目 and the file content disagree, keep both so the
        // review screen can offer a "説明書 / ファイル" toggle. Default = 説明書 (title).
        titleExplanation: entry.title || baseName,
        titleFromFile: (entry.title_from_file && entry.title_from_file.trim()) || null,
        titleSource: "explanation",
        authorDecided: false,
        // v3 phase 2 (generate 証拠説明書 when none exists): per-file draft fields.
        author: entry.author || "", // resolved 作成者 (starts as the role name / primary)
        authorPrimary: entry.author || "",
        authorAlt: (entry.author_alt && entry.author_alt.trim()) || null,
        authorSource: "primary",
        createdDate: entry.created_date || "",
        proofPurpose: entry.proof_purpose || "",
        originalOrCopy: entry.original_or_copy || "",
        // 紙をスキャンして電磁的記録として出すものは備考欄に「紙を電子化」と書く（公式ひな形の運用）
        digitizedFromPaper: entry.digitized_from_paper === true,
        captureKind: entry.capture_kind || "", // 写真 / スクリーンショット / ""
        captureSubject: entry.capture_subject || "",
        captureDatetime: entry.capture_datetime || "",
        captureLocation: entry.capture_location || "",
        captureBy: entry.capture_by || "",
      };
    }
    // リネームのみモードでAIデータが無いのは正常な使い方（メタデータ削除のみ）
    // なので、要確認扱いにしない。「AIを使わずに進む」も同じ（要確認は下でファイル名を見て決める）。
    const noAi = noAiData();
    return {
      path: f.path,
      name: f.name,
      matched: false,
      needsConfirmation: !noAi,
      confirmText: noAi ? "" : "AIの整理データに対応する項目が見つかりませんでした。内容をご確認のうえ手動で入力してください。",
      kind: "その他",
      // 「AIを使わずに進む」では、ファイル名の号証番号の後ろ（甲1の2_領収書 → 領収書）を標目にする
      docName: noAi && !state.renameOnly ? titleFromFilename(f.name) : f.name.replace(/\.[^.]+$/, ""),
      suggested: `${f.name.replace(/\.[^.]+$/, "")}${submitExtFor(f.name)}`,
      metadata,
      officeMeta,
      activeContent,
      overA3,
      pageCount: f.pageCount || null,
      evidenceNumber: null,
      branchRange: null,
      stamps: [],
      userConfirmed: false,
    };
  });

  // AIによっては元のファイル名を受け取れない（Gemini等は添付を「[source: N]」や空欄で扱い、
  // 号証番号を読めず既定の甲へ振り直す）。アプリは本物のファイル名を持つので、ファイル名の先頭に
  // 号証番号（弁3-3 等）があればそれを正とする。証拠説明書がある場合は説明書が番号の正なので触らない。
  if (!state.explanationExists) {
    for (const rf of reviewFiles) {
      const fromName = parseEvidenceFromFilename(rf.name);
      if (!fromName) continue;
      rf.evidenceNumber = fromName.num;
      rf.branchRange = fromName.branch; // ファイル名に枝番が無ければ null（＝枝番なし）
      if (!rf.kind || rf.kind === "その他") rf.kind = "証拠";
      if (!Array.isArray(rf.stamps) || rf.stamps.length === 0) rf.stamps = [defaultStamp()];
      if (rf.branchRange != null) setStampBranch(rf, rf.branchRange);
      rf.suggested = suggestedForTitle(rf, rf.docName);
    }
  }

  // 「AIを使わずに進む」（少数の追加用）: ファイル名に号証番号があるものは上でそのまま証拠になる。
  // 号証番号が無いものだけ要確認にして、種類・番号を手で入れてもらう（証拠でないなら確認済みにするだけ）。
  if (noAiData() && !state.renameOnly) {
    for (const rf of reviewFiles) {
      if (rf.matched) continue;
      rf.needsConfirmation = !rf.evidenceNumber;
      rf.confirmText = rf.evidenceNumber ? "" :
        "ファイル名に号証番号がありません。証拠なら「証拠番号」に番号を入れてください（例: 甲1-2）。" +
        "証拠でなければ種類を選び、確認済みにしてください。";
    }
  }

  // 刑事の号証（弁号証・検号証）は枝番を使わない実務ルール（甲/乙は民事・刑事どちらもあり得るので対象外）。
  // プロンプトでも指示済みだが、AIが枝番を付けてきても・説明書ありで上書きしない経路でも、念のため落とす。
  for (const rf of reviewFiles) {
    if (isCriminalEvidenceNum(rf.evidenceNumber)) {
      rf.branchRange = null;
      if (Array.isArray(rf.stamps)) for (const s of rf.stamps) if (s) s.branch = null;
    }
  }

  // A3を超える証拠は出力時にA3へ縮小される＝図面などは読み取りに支障が出うる。
  // 読み込み画面のバナーだけでは見落として素通りしてしまう（実機report）ため、確認画面でも
  // 「要確認」にして、チェックを入れるまで出力へ進めないようにする（既存の確認の仕組みに乗せる）。
  // リネームのみモードは、すでに完成したファイルを扱う運用なので対象外。
  if (!state.renameOnly) {
    for (const rf of reviewFiles) {
      if (!rf.overA3) continue;
      const note = `このファイルはA3を超えています（約${rf.overA3.wmm}×${rf.overA3.hmm}mm）。`
        + `mintsの提出物はA4・A3のみのため、出力時はA3に縮小して収めます。`
        + `図面など縮小すると読み取りに支障がある場合は、紙での提出、または「記録外」としての`
        + `アップロード（サイズ制限なし）をご検討ください。`;
      rf.needsConfirmation = true;
      rf.confirmText = rf.confirmText ? `${note}

${rf.confirmText}` : note;
    }
  }

  // Pattern A: an EXISTING 証拠説明書 file gets its submission name derived from the
  // batch's evidence-number range (証拠説明書(甲001～甲002).pdf) — the AI's
  // suggested_base_name tends to be a bare 「証拠説明書」.
  const expBase = explanationBaseName(reviewFiles);
  for (const rf of reviewFiles) {
    if (rf.kind === "証拠説明書") rf.suggested = `${expBase}${submitExtFor(rf.name)}`;
  }

  // AI（照合直後）の値のスナップショット。手動編集で上書きされても
  // フィールド単位で「AIの値に戻す」ができるよう、以後不変で保持する。
  for (const rf of reviewFiles) {
    if (rf.matched) {
      rf.aiOriginal = {
        kind: rf.kind,
        docName: rf.docName,
        suggested: rf.suggested,
        evidenceNumber: rf.evidenceNumber,
      };
    }
  }

  state.aiEntries = aiFiles;
  // Orphans = submittable AI entries with no matching file. the banner
  // for these is now built case-by-case in renderMatch (読み込み忘れ / 送信忘れ / 手動割当)
  // rather than as a flat per-orphan warning here.
  state.orphanEntries = aiFiles.filter(
    (entry) => !matchedEntries.has(entry.original_file_name) && isSubmittableName(entry.original_file_name)
  );

  const metaErrors = state.files
    .filter((f) => f.metaError)
    .map((f) => `「${f.name}」のPDF情報を読み取れませんでした: ${f.metaError}`);

  // v5.2.4: 確認画面を開いたときの番号・枝番・提出用ファイル名（AIを使わないときも）。番号とファイル名の
  // 両方が正しくなくなったとき、そのファイルだけ「最初の値に戻す」ために使う（以後は変えない）。
  for (const rf of reviewFiles) {
    rf.initialNumbers = { evidenceNumber: rf.evidenceNumber, branchRange: rf.branchRange, suggested: rf.suggested };
  }
  // v5.4.4: 音声・動画は、ファイルの中の撮影・録音日時を作成年月日（撮影日・録音日）の下書きにする。
  // v5.4.6: 写真も、EXIF の撮影日時（DateTimeOriginal）から同じように下書きにする。
  // 提出用からはこの情報を消すので、その前に読んだものを使う。AI の値や手で入れた値があればそちらを優先する。
  for (const rf of reviewFiles) {
    const src = state.files.find((f) => f.path === rf.path);
    rf.captureMeta = (src && src.captureMeta) || null;
    if (!(isAvName(rf.name) || isPhotoName(rf.name)) || !rf.captureMeta || !rf.captureMeta.recordedAt) continue;
    const draft = toWarekiShort(rf.captureMeta.recordedAt);
    const key = explanationFieldKeys(rf).date;
    if (draft && !String(rf[key] || "").trim()) {
      rf[key] = draft;
      rf.dateDraftFromFile = draft;
    }
  }

  state.reviewFiles = reviewFiles;
  state.consistency = computeConsistency(reviewFiles, evidenceExplanation);
  state.aiWarnings = aiWarnings
    .map((w) => (typeof w === "string" ? w : (w && w.message) || JSON.stringify(w)))
    .concat(metaErrors, computePartySymbolWarnings(reviewFiles, caseInfo));

  const firstConfirm = reviewFiles.findIndex((rf) => rf.needsConfirmation);
  state.selectedReview = firstConfirm >= 0 ? firstConfirm : 0;
  // 要確認があるときは既定で「要確認のみ表示」（絞り込み）。全件確認済みなら
  // 絞ると空になるので全件表示のまま。ただし一覧が左の欄に並ぶ広い画面（styles.css の 1180px 以上）では、
  // 一覧が内容を押し下げないので最初から全件を表示する（並べ替え・挿入にすぐ使えるように）。
  const wide = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(min-width: 1180px)").matches;
  state.showAllReview = firstConfirm < 0 || !!wide;
}

function actionsFromMetadata(metadata) {
  return Object.fromEntries((metadata || []).map((m) => [m.key, m.action]));
}

// Group review files into output jobs. Evidence files sharing an evidence_number
// merge into one 号証 PDF (branch order = file order; the AI is told to order
// them); everything else is one output per file.
// Court-recommended merge name: 号証番号_枝番範囲_タイトル (e.g. 乙041_1～2_LINEトーク画面).
// Single-branch groups still get the range slot (just one number).
function mergeDestName(num, group) {
  const branches = group
    .map((g) => (g.branchRange == null ? "" : toHalfWidthFilenamePart(String(g.branchRange).trim())))
    .filter(Boolean);
  const title = toHalfWidthFilenamePart((group[0].docName || "").trim());
  let base = num;
  if (branches.length) {
    const range = branches.length > 1 ? `${branches[0]}～${branches[branches.length - 1]}` : branches[0];
    base = `${num}_${range}`;
  }
  return `${base}${title ? "_" + title : ""}.pdf`;
}

// 号証の出力ファイル名。1ファイルだけの号証は、確認画面の「提出用ファイル名」欄のとおりに保存する
// （欄に「この名前で保存されます」と書いてあるのに、以前は番号と標目から作り直した名前で保存していた。
// v5.2.0 で、画面に見えている名前と実際の名前を一致させた）。結合する号証は従来どおり番号から作る。
function outputDestName(num, group) {
  const single = group.length === 1 ? String(group[0].suggested || "").trim() : "";
  if (single) return /\.pdf$/i.test(single) ? single : single.replace(/\.[^.\\/]+$/, "") + ".pdf";
  return mergeDestName(num, group);
}

// ---------- 提出用ファイル名の先頭の番号と証拠番号の食い違い（v5.2.2） ----------
// 証拠番号を書き換えるとファイル名は自動で追従するが、逆（ファイル名→証拠番号）は自動にしない
// （入力の途中で番号が動き、空き枠や結合が勝手に起きるため。どちらが正しいかは人が決める）。
// 食い違いを示し、ボタンを押したときだけ片方に合わせる。
//
// ファイル名の先頭の番号を読む。アプリが作る「甲003_2_標目」（枝番は _ 区切り）と、
// 人が付ける「甲3の2_標目」「甲3-2 標目」の両方を読む。{ num, branch, length（番号部分＋区切りの長さ） }
function numberFromSuggested(name) {
  const half = String(name || "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
  const re = new RegExp(`^([${EVIDENCE_SYMBOLS}](?:[A-Za-zＡ-Ｚａ-ｚ])?)\\s*0*(\\d+)(?:(?:_|\\s*[-‐－の／/]\\s*)0*(\\d+)(?=[_\\s＿.・]|$))?[\\s_＿\\-‐－・]*`);
  const m = re.exec(half);
  if (!m) return null;
  return {
    num: `${m[1]}${String(parseInt(m[2], 10)).padStart(3, "0")}`,
    branch: !isCriminalSymbol(m[1]) && m[3] ? String(parseInt(m[3], 10)) : null,
    length: m[0].length, // 全角→半角は1文字ずつなので長さは元の名前と同じ
  };
}
// 1ファイルだけの号証で、提出用ファイル名が保存名になるものだけを見る（結合する号証は番号から名前を作る）。
function suggestedIsOutputName(rf) {
  return !state.renameOnly && !!rf && !!rf.evidenceNumber && !isAvName(rf.name)
    && (state.mergeDisabled.has(rf.evidenceNumber) || mergeGroupFor(rf.evidenceNumber).length <= 1);
}
// 食い違いの種類: null（合っている・対象外）／{ kind: "number", file: {num, branch} }（別の番号）／
// { kind: "missing" }（先頭に番号が無い）。枝番が「1～2」などの範囲のときは号証番号だけを比べる。
// 片方が番号として成り立たない（「甲0」「甲」、ファイル名の「甲000_」や番号なし）ときは、正しいほうに合わせる
// ボタンだけを出せるよう、種類を分ける（5.2.2 の試用で要望）:
//   number    … 両方とも正しい番号で、食い違う（両方のボタン）
//   badNumber … 証拠番号が正しくない・ファイル名の番号は正しい（証拠番号を合わせるボタンだけ）
//   missing   … ファイル名に正しい番号が無い・証拠番号は正しい（ファイル名を合わせるボタンだけ）
//   bothBad   … どちらも正しくない（合わせる先が無いので、知らせるだけ）
function isValidEvidenceNumber(num) {
  const p = parseEvidenceNumber(num);
  return !!p && p.num >= 1;
}
//   nameEmpty … 証拠以外のファイルで、提出用ファイル名が空（標目から作るボタン）
// 空の欄も扱う（5.2.3 の試用で、両方とも消したときに何も出なかった）。numEmpty・nameEmpty で文言を変える。
function filenameNumberMismatch(rf) {
  if (state.renameOnly || !rf || isAvName(rf.name)) return null;
  const numEmpty = !String(rf.evidenceNumber || "").trim();
  const nameEmpty = !String(rf.suggested || "").trim();
  if (numEmpty && rf.kind !== "証拠") return nameEmpty ? { kind: "nameEmpty", nameEmpty } : null;
  if (!numEmpty && !suggestedIsOutputName(rf)) return null; // 結合する号証は番号から名前を作る
  const ownOk = isValidEvidenceNumber(rf.evidenceNumber);
  const f = numberFromSuggested(rf.suggested);
  const fileOk = !!f && isValidEvidenceNumber(f.num);
  if (!ownOk && !fileOk) return { kind: "bothBad", numEmpty, nameEmpty };
  if (!ownOk) return { kind: "badNumber", file: { num: f.num, branch: f.branch }, numEmpty };
  if (!fileOk) return { kind: "missing", nameEmpty };
  const mine = rf.branchRange == null ? null : toHalfWidthFilenamePart(String(rf.branchRange).trim());
  const simpleBranch = mine == null || /^\d+$/.test(mine);
  const sameBranch = !simpleBranch || (f.branch == null ? null : f.branch) === (mine == null ? null : String(parseInt(mine, 10)));
  if (f.num === rf.evidenceNumber && sameBranch) return null;
  return { kind: "number", file: { num: f.num, branch: simpleBranch ? f.branch : rf.branchRange } };
}
function numberLabelWithBranch(num, branch) {
  return `${shortNumberLabel(num)}${branch != null && branch !== "" ? "の" + branch : ""}`;
}
// ボタン①: 証拠番号（と枝番）をファイル名の番号に合わせる
function applyNumberFromFilename(rf) {
  const mm = filenameNumberMismatch(rf);
  if (!mm || (mm.kind !== "number" && mm.kind !== "badNumber")) return false;
  const oldNum = rf.evidenceNumber;
  const oldBranch = rf.branchRange;
  rf.evidenceNumber = mm.file.num;
  rf.branchRange = mm.file.branch;
  if (Array.isArray(rf.stamps) && rf.stamps.length === 0) rf.stamps = [defaultStamp()];
  setStampBranch(rf, rf.branchRange);
  // 空いた番号の空き枠など（ファイル名は既に新しい番号）。元の番号が正しくなかったときは空きも無い
  if (mm.kind === "number") afterEvidenceNumberEdited(rf, oldNum, oldBranch);
  return true;
}
// ボタン②: ファイル名の先頭の番号を証拠番号に合わせる（標目の部分はそのまま残す）
function applyFilenameFromNumber(rf) {
  const mm = filenameNumberMismatch(rf);
  if (!mm || (mm.kind !== "number" && mm.kind !== "missing" && mm.kind !== "nameEmpty")) return false; // 証拠番号が正しくないときは合わせない
  if (mm.kind === "nameEmpty") {
    if (!String(rf.docName || "").trim()) return false;
    rf.suggested = suggestedForTitle(rf, rf.docName);
    return true;
  }
  const name = String(rf.suggested || "");
  const f = numberFromSuggested(name);
  const rest = f ? name.slice(f.length) : name;
  const prefix = numberPrefix(rf.evidenceNumber, rf.branchRange);
  rf.suggested = !rest.trim() || rest.startsWith(".") ? suggestedForTitle(rf, rf.docName) : `${prefix}_${rest}`;
  return true;
}

// 「最初の値に戻す」: 証拠番号・枝番・提出用ファイル名を、確認画面を開いたときの値に戻す（そのファイルだけ）。
// 戻せるのは、最初の値が今と違い、番号とファイル名の食い違いが無い（＝戻すと直る）ときだけ。
function canResetNumbers(rf) {
  const o = rf && rf.initialNumbers;
  if (!o) return false;
  const same = o.evidenceNumber === rf.evidenceNumber && o.branchRange === rf.branchRange && o.suggested === rf.suggested;
  if (same) return false;
  const probe = Object.assign({}, rf, { evidenceNumber: o.evidenceNumber, branchRange: o.branchRange, suggested: o.suggested });
  const mm = filenameNumberMismatch(probe);
  return !mm || mm.kind === "number"; // 最初から食い違っていたもの（番号どうし）は戻してもボタンで合わせられる
}
function resetNumbersToInitial(rf) {
  if (!canResetNumbers(rf)) return false;
  const o = rf.initialNumbers;
  rf.evidenceNumber = o.evidenceNumber;
  rf.branchRange = o.branchRange;
  rf.suggested = o.suggested;
  if (rf.evidenceNumber && Array.isArray(rf.stamps) && rf.stamps.length === 0) rf.stamps = [defaultStamp()];
  setStampBranch(rf, rf.branchRange);
  return true;
}

// ---------- 出力前の食い違いチェック（v5.2.0） ----------
// 書き出す前に、番号まわりの食い違いを決まった規則で拾う（判定はプログラム・確定は人）。
// 書き出しは止めない（出力画面に知らせるだけ）。戻り値: [{ index: 該当ファイルの reviewFiles 番号, text }]
function computeOutputIssues() {
  if (state.renameOnly) return [];
  const issues = [];
  const rfs = state.reviewFiles;
  const label = (rf) => `${shortNumberLabel(rf.evidenceNumber)}${rf.branchRange != null ? "の" + rf.branchRange : ""}`;

  // 1) 1ファイルだけの号証: 提出用ファイル名の先頭の番号と、押す番号が合っているか
  for (let i = 0; i < rfs.length; i++) {
    const rf = rfs[i];
    if (rf.kind === "証拠" && !rf.evidenceNumber) {
      // ファイル名に番号があれば、その番号に合わせるボタンを出す（fix）
      issues.push({ index: i, fix: true, text: `「${rf.name}」は証拠ですが、証拠番号がありません（番号は押されません）` });
      continue;
    }
    const mm = filenameNumberMismatch(rf); // 結合する号証・AV は対象外（番号から名前を作る）
    if (!mm) continue;
    const name = String(rf.suggested || "");
    const text = {
      number: `${label(rf)}：提出用ファイル名「${name}」の番号が、押す番号（${deriveStampLabel(rf.evidenceNumber, rf.branchRange)}）と合っていません`,
      missing: mm.nameEmpty ? `${label(rf)}：提出用ファイル名が空です` : `${label(rf)}：提出用ファイル名「${name}」が号証番号（${numberPrefix(rf.evidenceNumber, rf.branchRange)}）で始まっていません`,
      badNumber: `「${rf.name}」：証拠番号「${rf.evidenceNumber}」が番号として正しくありません（ファイル名の番号は ${numberLabelWithBranch(mm.file && mm.file.num, mm.file && mm.file.branch)}）`,
      bothBad: `「${rf.name}」：証拠番号「${rf.evidenceNumber}」が番号として正しくありません（ファイル名にも正しい番号がありません）`,
      nameEmpty: `「${rf.name}」：提出用ファイル名が空です`,
    }[mm.kind];
    issues.push({ index: i, fix: true, text });
  }

  // 2) 同じ号証の中: 枝番の重なり・枝番あり／なしの混在・途中の抜け
  const byNum = new Map();
  rfs.forEach((rf, i) => {
    if (!rf.evidenceNumber || isAvName(rf.name)) return;
    if (!byNum.has(rf.evidenceNumber)) byNum.set(rf.evidenceNumber, []);
    byNum.get(rf.evidenceNumber).push({ rf, i });
  });
  for (const [num, items] of byNum) {
    const shortNum = shortNumberLabel(num);
    if (items.length > 1) {
      const noBranch = items.filter((x) => x.rf.branchRange == null);
      if (noBranch.length && noBranch.length < items.length) {
        issues.push({ index: noBranch[0].i, text: `${shortNum}：枝番のあるファイルと無いファイルが混ざっています（「${noBranch[0].rf.name}」に枝番がありません）` });
      } else if (noBranch.length > 1) {
        issues.push({ index: noBranch[1].i, text: `${shortNum}：枝番の無いファイルが${noBranch.length}つあります（どれにも「${deriveStampLabel(num, null)}」が押されます）` });
      }
    }
    const seen = new Map();
    for (const { rf, i } of items) {
      if (rf.branchRange == null) continue;
      const k = branchSortKey(rf.branchRange);
      if (seen.has(k)) issues.push({ index: i, text: `${shortNum}の${k} が2つあります（「${seen.get(k)}」と「${rf.name}」）` });
      else seen.set(k, rf.name);
    }
    const keys = [...seen.keys()].concat(
      state.placeholders.filter((p) => p.num === num && p.branch != null).map((p) => branchSortKey(p.branch)));
    if (keys.length >= 2) {
      const min = Math.min(...keys);
      const max = Math.max(...keys);
      const missing = [];
      for (let k = min + 1; k < max; k++) if (!keys.includes(k)) missing.push(`${shortNum}の${k}`);
      if (missing.length) issues.push({ index: items[0].i, text: `${shortNum}：${missing.join("・")} がありません（枝番が飛んでいます）` });
    }
  }

  // 3) 同じ名前のファイルが2つできる（2つ目には「 (2)」が付いてしまう）
  const names = new Map();
  for (const o of buildOutputPlan()) {
    const key = String(o.destName || "").toLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
  }
  for (const [key, n] of names) {
    if (n < 2) continue;
    const i = rfs.findIndex((rf) => String(rf.suggested || "").toLowerCase() === key);
    issues.push({ index: Math.max(0, i), text: `同じ名前のファイル「${key}」が${n}つできます（2つ目以降には「 (2)」などが付きます）` });
  }
  return issues;
}
// 「甲001」→「甲1」
function shortNumberLabel(num) {
  const p = parseEvidenceNumber(num);
  return p ? `${p.sym}${p.num}` : String(num || "");
}

// 同一号証の結合グループ。読み込み順ではなく枝番の昇順で並べる
// （後から途中の枝番のファイルを追加しても、結合PDFのページ順が正しくなる。
// 枝番なし同士はsortの安定性で読み込み順を維持＝従来挙動と同じ）。
function mergeGroupFor(num) {
  return state.reviewFiles
    .filter((x) => x.evidenceNumber === num && !isAvName(x.name))
    .sort((a, b) => branchSortKey(a.branchRange) - branchSortKey(b.branchRange));
}

function buildOutputPlan() {
  const rfs = state.reviewFiles;
  const outputs = [];
  const emitted = new Set();
  for (const rf of rfs) {
    const num = rf.evidenceNumber;
    // audio/video are never merged; the user can also disable merge per number.
    // rename-only never merges (plain copy, one output per file).
    if (num && !state.renameOnly && !isAvName(rf.name) && !state.mergeDisabled.has(num)) {
      if (emitted.has(num)) continue;
      emitted.add(num);
      const group = mergeGroupFor(num);
      outputs.push({
        evidenceNumber: num,
        destName: outputDestName(num, group),
        sources: group.map((g) => ({
          srcPath: g.path,
          pages: g.pageRange || null, // ページ範囲で分けた枝番は、その範囲だけを使う
          stamps: g.stamps,
          metadataActions: actionsFromMetadata(g.metadata),
        })),
      });
    } else {
      // Not merged (AV / rename-only / merge disabled) — but the evidence number must
      // survive: the stamp label is derived from it, so null here would silently skip
      // the 号証 stamp on 「別々に出力」 files.
      outputs.push({
        evidenceNumber: rf.evidenceNumber || null,
        destName: rf.suggested,
        sources: [{
          srcPath: rf.path,
          pages: rf.pageRange || null,
          stamps: rf.stamps,
          metadataActions: actionsFromMetadata(rf.metadata),
        }],
      });
    }
  }
  return outputs;
}

