// でたらめな入力を、画面の判定（src/app-*.js）と Python の判定（py/legalleaves/core）の両方に流して比べる。
//
// 答えの表（test/tables/*.json）は「表にある入力」しか縛れない。表に無い入力で 2 つの判定がずれていないかを、
// ここで確かめる（判定を変えたとき・Python 側を書き足したときに走らせる）。食い違いが出たら、その入力を表に足す。
//
//   node test/compare-random.js           既定の種で 17,700 件
//   node test/compare-random.js 777       種を変える（別の入力になる）
//
// 画面の結果を一時フォルダに表の形で書き出し、py/tests/tables_check.py に渡して比べる。npm test には入れていない。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ll-compare-"));
const { loadScreen } = require("./helpers/screen");
const { ctx, get } = loadScreen();
const S = get("state");

let seed = parseInt(process.argv[2], 10) || 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ATOMS = ["甲", "乙", "丙", "弁", "検", "戊", "A", "b", "Ａ", "ｂ", "0", "1", "2", "3", "9", "00", "０", "１", "２", "１２",
  "_", "＿", "-", "‐", "－", "の", "/", "／", " ", "　", "\t", ".", "．", "・", "～", "〜", "~", "（", "）", "(", ")",
  "契約書", "写真", "領収書", "年", "通目", ".pdf", ".PDF", ".jpg", ".docx", ".mp3", ".MOV", ".wav", "㈱", "①", "ｶﾞ", "é", "😀", "\n", ",", "、"];
const str = (max = 8) => { let s = ""; const n = Math.floor(rnd() * max); for (let i = 0; i < n; i++) s += pick(ATOMS); return s; };
const numStr = () => pick(["甲", "乙", "弁", "甲A", "丙"]) + pick(["0", "00", "000", "1", "001", "2", "003", "12", "１"]);
const branch = () => pick([null, null, "1", "2", "3", "1～2", "1〜3", "２", "", " 2 ", "前", 2]);
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

const reset = (st = {}) => {
  Object.assign(S, { files: [], aiText: "", aiJsonError: "", manualMatches: {}, noAi: false, renameOnly: false,
    mergeDisabled: new Set(), placeholders: [], reviewFiles: [], matchKey: "", caseInfo: null, explanationExists: false,
    consistency: null, aiWarnings: [], orphanEntries: [], aiEntries: [] });
  for (const [k, v] of Object.entries(st)) S[k] = k === "mergeDisabled" ? new Set(v) : v;
};

const cases = [];
const one = ["toFullWidth", "toHalfWidth", "toHalfWidthFilenamePart", "parseEvidenceNumber", "isValidEvidenceNumber",
  "shortNumberLabel", "isCriminalEvidenceNum", "parseEvidenceInput", "parseEvidenceFromFilename", "titleFromFilename",
  "numberFromSuggested", "branchSortKey", "normKey", "normKeyNoExt", "outputExtFor", "isAvName", "needsAvConversion",
  "isPhotoName", "isSubmittableName", "cleanConfirmText", "toWarekiShort"];
for (let i = 0; i < 6000; i++) {
  const fn = pick(one);
  const arg = rnd() < 0.5 ? str() : numStr() + str(5);
  reset();
  cases.push({ fn, args: [arg], expect: plain(ctx[fn](arg)) });
}
for (let i = 0; i < 1500; i++) {
  const a = [numStr(), branch()];
  for (const fn of ["numberPrefix", "deriveStampLabel", "explanationEvidenceLabel"]) { reset(); cases.push({ fn, args: a, expect: plain(ctx[fn](...a)) }); }
  const t = [str(6), pick([null, 0, 3, 5, 10])];
  reset(); cases.push({ fn: "parsePageRanges", args: t, expect: plain(ctx.parsePageRanges(...t)) });
  const st = { renameOnly: rnd() < 0.5 };
  const rf = { name: str(4) + pick([".pdf", ".docx", ".mp4", ".jpg", ""]), evidenceNumber: pick([null, numStr()]), branchRange: branch() };
  const title = str(4);
  reset(st); cases.push({ fn: "suggestedForTitle", args: [rf, title], state: st, expect: plain(ctx.suggestedForTitle(rf, title)) });
  const group = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ branchRange: branch(), docName: str(3), suggested: pick([str(4) + ".pdf", str(4), ""]) }));
  const num = numStr();
  reset(); cases.push({ fn: "mergeDestName", args: [num, group], expect: plain(ctx.mergeDestName(num, group)) });
  reset(); cases.push({ fn: "outputDestName", args: [num, group], expect: plain(ctx.outputDestName(num, group)) });
}

// 流れ: でたらめなファイル名と AI の整理データ
const flows = [];
const fname = () => (rnd() < 0.7 ? pick(["甲", "乙", "弁", "甲A"]) + pick(["1", "01", "2", "3", "０３", "0"]) + pick(["", "_", "-2", "の1", "_2_", "_1", " "]) : "") + pick(["契約書", "写真", "領収書", "メモ", "証拠説明書", ""]) + pick([".pdf", ".jpg", ".docx", ".mp3", ".mov", ".PDF"]);
for (let i = 0; i < 1200; i++) {
  const names = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 5) }, fname))];
  const files = names.map((n) => {
    const f = { path: "C:/x/" + n, name: n };
    if (rnd() < 0.2) f.pageCount = 5;
    if (rnd() < 0.15) f.overA3 = { wmm: 420, hmm: 594.5 };
    if (rnd() < 0.2) f.captureMeta = { recordedAt: pick(["2025-11-18T01:12", "2018-03-02", "x"]) };
    if (rnd() < 0.2) f.metaFields = [{ key: "Author", value: "a" }];
    if (rnd() < 0.1) f.metaError = "壊れています";
    return f;
  });
  const settings = {};
  const mode = pick(["ai", "ai", "noAi", "renameOnly", "renameOnlyAi"]);
  if (mode === "noAi") settings.noAi = true;
  if (mode.startsWith("renameOnly")) settings.renameOnly = true;
  if (rnd() < 0.2) settings.mergeDisabled = [numStr()];
  if (rnd() < 0.2) settings.placeholders = [{ num: numStr(), branch: pick([null, "2", "5"]) }];
  const input = { files, settings };
  if (mode === "ai" || mode === "renameOnlyAi") {
    const ai = { files: names.filter(() => rnd() < 0.85).map((n) => {
      const e = { original_file_name: rnd() < 0.8 ? n : n.replace(".", " .").toUpperCase(), type: pick(["証拠", "主張系", "証拠説明書", "その他", "なぞ"]) };
      if (rnd() < 0.7) e.title = pick(["契約書", "ＬＩＮＥ（画面）", "写真 1", ""]);
      if (rnd() < 0.5) e.suggested_base_name = str(4);
      if (rnd() < 0.7) e.evidence_number = numStr();
      if (rnd() < 0.4) e.branch_range = branch();
      if (rnd() < 0.5) e.stamps = Array.from({ length: Math.floor(rnd() * 3) }, () => pick([null, { page: 1, draw_label: false, rotate_degrees: 0 }, { page: 2, branch: pick(["1", "2", null]), rotate_degrees: pick([0, 90, 45, 44, -90, 360]) }, { page: 1 }]));
      if (rnd() < 0.3) e.needs_user_confirmation = true;
      if (rnd() < 0.3) e.confirmation_question = "番号は押しますか（draw_label: false）。確認してください。";
      if (rnd() < 0.3) e.capture_kind = pick(["写真", "動画", "スクリーンショット", "録音"]);
      if (rnd() < 0.3) e.capture_subject = "現場 1";
      if (rnd() < 0.3) e.capture_location = "東京";
      if (rnd() < 0.3) e.created_date = pick(["R6.4.12", "Ｒ６．４．１２", ""]);
      if (rnd() < 0.3) e.author = pick(["原告", "山田 太郎", ""]);
      if (rnd() < 0.2) e.author_alt = " 山田 ";
      if (rnd() < 0.2) e.title_from_file = pick([" 別の標目 ", ""]);
      if (rnd() < 0.3) e.original_or_copy = pick(["原本", "写し", ""]);
      if (rnd() < 0.2) e.digitized_from_paper = true;
      if (rnd() < 0.3) e.proof_purpose = "事実A(1)";
      return e;
    }) };
    if (rnd() < 0.3) ai.evidence_explanation = { exists: rnd() < 0.7, first_evidence_number: numStr(), last_evidence_number: numStr(), file_name: pick(["証拠説明書.pdf", ""]) };
    if (rnd() < 0.4) ai.case = { party: pick(["原告", "被告", "申立人", "", "第三者"]), court: pick(["東京地方裁判所", ""]), case_number: pick(["令和6年(ワ)第1号", ""]), lawyers: pick([["山田 太郎", "", "鈴木"], "佐藤 A", null]) };
    if (rnd() < 0.3) ai.warnings = ["注意", { message: "m" }, { a: 1 }];
    if (rnd() < 0.1) ai.files.push({ original_file_name: "読み込み忘れ.pdf", type: "証拠" });
    input.ai = ai;
  }
  reset(settings);
  const o = {};
  S.files = files; S.aiText = input.ai ? JSON.stringify(input.ai) : "";
  ctx.validateAiJson();
  o.aiJsonError = S.aiJsonError;
  if (!S.aiJsonError) {
    ctx.buildReviewFiles();
    Object.assign(o, { reviewFiles: S.reviewFiles, orphanEntries: S.orphanEntries.map((e) => e.original_file_name), consistency: S.consistency,
      aiWarnings: S.aiWarnings, caseInfo: S.caseInfo, explanationExists: S.explanationExists,
      mismatches: S.reviewFiles.map((rf) => ctx.filenameNumberMismatch(rf)), outputIssues: ctx.computeOutputIssues(),
      outputPlan: ctx.buildOutputPlan(), explanationFileName: ctx.explanationFileName(), explanationData: ctx.buildExplanationData() });
  }
  flows.push({ name: "flow#" + i + " " + mode, input, expect: plain(o) });
}
fs.writeFileSync(path.join(out, "fn.json"), JSON.stringify({ title: "でたらめな入力（関数）", kind: "function", cases }));
fs.writeFileSync(path.join(out, "flow.json"), JSON.stringify({ title: "でたらめな入力（流れ）", kind: "flow", cases: flows }));
console.log(`画面の結果を書き出しました（関数 ${cases.length} 件・流れ ${flows.length} 件）。Python と比べます。`);
const py = process.env.LL_PYTHON || path.join(root, "py", ".venv", "Scripts", "python.exe");
const r = spawnSync(py, [path.join(root, "py", "tests", "tables_check.py"), out], { stdio: "inherit" });
fs.rmSync(out, { recursive: true, force: true });
process.exit(r.status === null ? 1 : r.status);
