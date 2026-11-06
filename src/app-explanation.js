// ---------------------------------------------------------------------------
// 証拠説明書のデータ組み立て
//
// src/app.js から分離。関数の中身は移動しただけで変更していない。
// 号証欄の表記・全角半角の使い分けは改正民訴法の公式ひな形に準拠（docs/CHANGELOG-old.md 3.5.0 参照）。
// ---------------------------------------------------------------------------

function explanationBaseName(rfs) {
  const range = evidenceRangeLabel(rfs);
  return range ? `証拠説明書(${range})` : "証拠説明書";
}

function explanationFileName() {
  return `${explanationBaseName(state.reviewFiles)}.docx`;
}

// Build the docx-engine data. The evidence TABLE comes from the reviewed files.
// The header (裁判所・事件番号・当事者・代理人) is filled from case{} ONLY when the AI
// could read it from the party's own pleadings (訴状/準備書面); otherwise it falls back
// to the firm template's ●● blanks. It must never come from evidence content (裁判例 etc.).
function buildExplanationData() {
  const ci = state.caseInfo || {};
  // Fields the lawyer must fill get a visible ●● marker when empty (matches the firm
  // template's blank convention; findable with Ctrl+F "●" in Word).
  const BLANK = "●●";
  const mk = (v) => (v && String(v).trim() ? v : BLANK);
  const rows = [];
  // One row per file = one row per 枝番 (乙041-1 / 乙041-2 are separate rows).
  // プレースホルダ（空き枠）も号証番号順に混ぜて、空行（●●）として出力する
  // （「後で来る証拠のために証拠説明書に空きを作っておく」用途）。
  const fileUnits = state.reviewFiles
    .filter((rf) => rf.evidenceNumber && parseEvidenceNumber(rf.evidenceNumber))
    .map((rf) => ({ kind: "file", rf, p: parseEvidenceNumber(rf.evidenceNumber), br: rf.branchRange }));
  const phUnits = state.placeholders
    .map((ph) => ({ kind: "ph", num: ph.num, branch: ph.branch, p: parseEvidenceNumber(ph.num), br: ph.branch }))
    .filter((u) => u.p);
  const units = [...fileUnits, ...phUnits].sort((a, b) => {
    if (a.p.sym !== b.p.sym) return a.p.sym.localeCompare(b.p.sym);
    if (a.p.num !== b.p.num) return a.p.num - b.p.num;
    return branchSortKey(a.br) - branchSortKey(b.br);
  });
  let symbol = "";
  for (const u of units) {
    if (u.kind === "ph") {
      if (!symbol && u.p) symbol = u.p.sym;
      rows.push({
        通常: true,
        号証: explanationEvidenceLabel(u.num, u.branch != null ? u.branch : null),
        標目: BLANK, 作成年月日: BLANK, 作成者: BLANK, 立証趣旨: BLANK, 備考: "",
      });
      continue;
    }
    const rf = u.rf;
    const p = u.p;
    if (p && !symbol) symbol = p.sym;
    // 写真・スクリーンショット・動画も公式ひな形どおり通常の6列で記載する。
    // 民訴規則148条（撮影対象・日時・場所の明示）は、標目=種別＋撮影対象（写真・動画は場所も）、
    // 作成年月日=撮影日時、作成者=撮影者で満たす（※3: もともとの作成者・作成日＝撮影者・撮影日）。
    const kind = rf.captureKind || "";
    const isCapture = kind === "写真" || kind === "スクリーンショット" || kind === "動画";
    const hasLocation = kind === "写真" || kind === "動画";
    // 実際にスタンプされる枝番（真の情報源）が2件以上あれば枝番ごとに行を分ける
    // （例: 請求書＋領収書の2枚組1ファイルに「の1」「の2」が別々に押されているケース）。
    // それ以外（0〜1件）は従来どおり branchRange を1行として使う（別ファイル方式・枝番なしはこれで正しい）。
    const stampBranches = branchesFromStamps(rf);
    const branchesForRows = stampBranches.length >= 2
      ? stampBranches
      : [rf.branchRange ? String(rf.branchRange).trim() : ""];
    // 原本/写しは公式ひな形どおり標目セル内へ（視認性のため改行して（原本）／（写し））。
    // 記載がない標目は「民訴法231条の2の電磁的記録として提出」の意味を持つ（定型注記が
    // テンプレに焼き込み済み）ため、空欄でも●●マーカーは付けない。
    const oc = String(rf.originalOrCopy || "").trim();
    let hyomoku;
    let createdDate;
    let author;
    if (isCapture) {
      // 標目 = 種別（＋2行目に撮影対象／撮影場所）。撮影日・撮影者は作成年月日・作成者欄へ。
      const parts = [];
      if ((rf.captureSubject || "").trim()) parts.push(`撮影対象：${toFullWidth(rf.captureSubject.trim())}`);
      if (hasLocation && (rf.captureLocation || "").trim()) parts.push(`撮影場所：${toFullWidth(rf.captureLocation.trim())}`);
      const base = toFullWidth(rf.docName || "") || kind;
      hyomoku = base + (parts.length ? `\n（${parts.join("／")}）` : "");
      createdDate = mk(toHalfWidth(rf.captureDatetime || rf.createdDate || "")); // 撮影日時
      author = mk(toFullWidth(rf.captureBy || rf.author || "")); // 撮影者
    } else {
      hyomoku = mk(toFullWidth(rf.docName || "")) + (oc ? `\n（${toFullWidth(oc)}）` : "");
      createdDate = mk(toHalfWidth(rf.createdDate || "")); // 半角和暦 (例 R8.7.2)
      author = mk(toFullWidth(rf.author || ""));
    }
    // 紙の書類をスキャンして電磁的記録（＝原本/写しの記載なし）として出すものは、公式ひな形の
    // 運用どおり備考に「紙を電子化」（元がデータの証拠・書証として出す証拠には書かない）。
    const bikou = !oc && rf.digitizedFromPaper ? "紙を電子化" : "";
    for (const branch of branchesForRows) {
      rows.push({
        通常: true, // 写真・スクショ・動画も通常の6列（結合行テンプレは廃止）
        号証: explanationEvidenceLabel(rf.evidenceNumber, branch || null),
        標目: hyomoku,
        作成年月日: createdDate,
        作成者: author,
        立証趣旨: mk(toFullWidth(rf.proofPurpose || "")),
        備考: bikou, // 空欄でよい項目はマーカーを付けない
      });
    }
  }
  // startsWith: series symbols like 甲A / 甲B (large corporate cases) still mean 原告
  const sideFromSym = symbol.startsWith("甲") ? "原告" : symbol.startsWith("乙") ? "被告" : "";
  const lawyers = Array.isArray(ci.lawyers)
    ? ci.lawyers.filter(Boolean).map(toFullWidth).join("　")
    : toFullWidth(ci.lawyers || "");
  // 訴訟なら原告/被告、申立てなら申立人/相手方。
  const party = ci.party || sideFromSym || "";
  // 新法対応ヘッダ: 「{裁判所}　{事件番号}」1行＋提出日＋提出者側・代理人のみ。
  // 事件名・当事者氏名・「御中」は公式ひな形に無いため書かない。
  return {
    事件番号: toFullWidth(ci.case_number) || "令和●年（●）第●号",
    提出日: "令和●年●月●日", // 提出日は弁護士が記入
    裁判所: toFullWidth(ci.court) || "●●裁判所",
    提出者側: party || "●●",
    代理人: lawyers || "●●　●●",
    証拠: rows,
  };
}


// Base name for a 証拠説明書 covering the batch: 証拠説明書(甲001～甲002). One range
// per 記号 (mixed batches don't happen in practice, but harmless to support).
// Used for BOTH the generated draft (pattern B) and renaming an existing 説明書
// file (pattern A) — the app derives it deterministically, never trusting the
// AI's suggested_base_name for this.
function evidenceRangeLabel(rfs) {
  const parsed = rfs.map((rf) => parseEvidenceNumber(rf.evidenceNumber)).filter(Boolean);
  // 空き枠（プレースホルダ）も範囲に含める（証拠説明書に空行が出るため）
  for (const ph of state.placeholders || []) {
    const p = parseEvidenceNumber(ph.num);
    if (p) parsed.push(p);
  }
  if (!parsed.length) return "";
  const bySym = new Map();
  for (const p of parsed) {
    if (!bySym.has(p.sym)) bySym.set(p.sym, []);
    bySym.get(p.sym).push(p.num);
  }
  const ranges = [];
  for (const [sym, nums] of bySym) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    ranges.push(min === max ? padEvidence(sym, min) : `${padEvidence(sym, min)}～${padEvidence(sym, max)}`);
  }
  return ranges.join("・");
}

