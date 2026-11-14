// 判定の「答えの表」（test/tables/*.json）を、いまの画面の判定（src/app-*.js）に通す。
//
// 表は「入力と、期待する結果」を並べたもの。同じ表を Python 側（py/legalleaves/core/）にも通すことで、
// 判定を Python へ移すときに結果が変わっていないことを確かめる（表が正・実装が合わせる）。
//
//   node test/tables.test.js            表と今の結果を比べる
//   node test/tables.test.js --write    今の結果を表の expect に書き込む（判定をわざと変えたときだけ使う。
//                                       書き込んだ後は git diff で、変わった結果を人が必ず確かめる）
//
// 表の形は test/tables/README.md を参照。
const fs = require("fs");
const path = require("path");
const { section, check, report } = require("./helpers/assert");
const { loadScreen } = require("./helpers/screen");

const WRITE = process.argv.includes("--write");
const TABLE_DIR = path.join(__dirname, "tables");
const WAVE_DASH = "〜"; // 禁止の波ダッシュ（見た目は全角チルダ U+FF5E と同じ）

const { ctx, get } = loadScreen();
const S = get("state");

// 表の中の省略記法を実際の値に広げる（大きな入力を表に直接書かないため）:
//   {"$repeat": ["あ", 1001]} → "あ" を 1001 個つなげた文字列
//   {"$array": [<値>, 300]}   → <値> を 300 個並べた配列
function expand(v) {
  if (Array.isArray(v)) return v.map(expand);
  if (v && typeof v === "object") {
    if (Array.isArray(v.$repeat)) return String(v.$repeat[0]).repeat(v.$repeat[1]);
    if (Array.isArray(v.$array)) return Array.from({ length: v.$array[1] }, () => expand(v.$array[0]));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
  }
  return v;
}
// 結果を JSON にできる形へそろえる（undefined の項目は消え、undefined の値は null になる）
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = (v) => { const s = JSON.stringify(v); return s.length > 300 ? s.slice(0, 300) + "…" : s; };

// 画面の状態を、表の 1 件を動かす前の形に戻す
function resetState(st = {}) {
  S.files = [];
  S.aiText = "";
  S.aiJsonError = "";
  S.manualMatches = {};
  S.noAi = false;
  S.renameOnly = false;
  S.mergeDisabled = new Set();
  S.placeholders = [];
  S.reviewFiles = [];
  S.matchKey = "";
  S.caseInfo = null;
  S.explanationExists = false;
  S.consistency = null;
  S.aiWarnings = [];
  S.orphanEntries = [];
  S.aiEntries = [];
  for (const [k, v] of Object.entries(st)) S[k] = k === "mergeDisabled" ? new Set(v) : v;
}

// ---- 関数の表: { fn, args, expect }（state を付けると、呼ぶ前に画面の状態をその値にする） ----
function runFunctionCase(c) {
  resetState(expand(c.state || {}));
  const fn = ctx[c.fn];
  if (typeof fn !== "function") throw new Error(`関数 ${c.fn} が見つかりません`);
  return plain(fn(...expand(c.args || [])));
}

// ---- 流れの表: 読み込んだファイルと AI の整理データ（または確認画面の一覧）から、判定の結果一式を作る ----
function runFlowCase(c) {
  const input = expand(c.input || {});
  resetState(input.settings || {});
  const out = {};
  if (input.reviewFiles) {
    // 確認画面で人が手直しした後の状態を、そのまま与える
    S.reviewFiles = input.reviewFiles;
    S.caseInfo = input.caseInfo || null;
    S.explanationExists = !!input.explanationExists;
  } else {
    S.files = input.files || [];
    S.aiText = input.aiText != null ? input.aiText : (input.ai != null ? JSON.stringify(input.ai) : "");
    ctx.validateAiJson();
    out.aiJsonError = S.aiJsonError;
    if (S.aiJsonError) return plain(out);
    ctx.buildReviewFiles();
    out.reviewFiles = S.reviewFiles;
    out.orphanEntries = S.orphanEntries.map((e) => e.original_file_name);
    out.consistency = S.consistency;
    out.aiWarnings = S.aiWarnings;
    out.caseInfo = S.caseInfo;
    out.explanationExists = S.explanationExists;
  }
  out.mismatches = S.reviewFiles.map((rf) => ctx.filenameNumberMismatch(rf));
  out.outputIssues = ctx.computeOutputIssues();
  out.outputPlan = ctx.buildOutputPlan();
  out.explanationFileName = ctx.explanationFileName();
  out.explanationData = ctx.buildExplanationData();
  return plain(out);
}

// 結果の中の文字列を全部たどる
function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

let changed = 0;
for (const file of fs.readdirSync(TABLE_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const full = path.join(TABLE_DIR, file);
  const table = JSON.parse(fs.readFileSync(full, "utf8"));
  section(`${file} — ${table.title || ""}`);
  const noWave = new Set(table.no_wave_dash || []); // 結果に禁止の波ダッシュが入ってはいけない関数・項目
  for (const c of table.cases) {
    const label = c.name || `${c.fn}(${short(c.args)})`;
    let actual;
    try {
      actual = table.kind === "flow" ? runFlowCase(c) : runFunctionCase(c);
    } catch (e) {
      check(label, false, "例外: " + e.message);
      continue;
    }
    if (WRITE) {
      if (!same(c.expect, actual)) changed++;
      c.expect = actual;
    } else {
      check(label, same(c.expect, actual), `期待 ${short(c.expect)} / 実際 ${short(actual)}`);
    }
    // 外へ出る値（ファイル名・証拠説明書）に禁止の波ダッシュが入らないこと。
    // known_wave_dash を付けた件は「いまは入ってしまう」と分かっているもの（直すまでの印）。
    const target = table.kind === "flow"
      ? [...noWave].map((k) => actual && actual[k])
      : (noWave.has(c.fn) ? actual : null);
    const leaked = strings(target).some((s) => s.includes(WAVE_DASH));
    if (c.known_wave_dash) check(`${label}: 禁止の波ダッシュが入る（既知・未修正）`, leaked, "入らなくなりました。known_wave_dash を外してください");
    else if (leaked) check(`${label}: 禁止の波ダッシュ（U+301C）が結果に入っている`, false, short(target));
  }
  // 見た目が同じ 2 つの文字（禁止の波ダッシュ U+301C・全角チルダ U+FF5E）は、表の中では \u の形で書き、
  // 目で区別できるようにする
  const text = JSON.stringify(table, null, 2).replace(/[〜～]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16));
  if (WRITE) fs.writeFileSync(full, text + "\n", "utf8");
}

if (WRITE) {
  console.log(`\n表に今の結果を書き込みました（変わった件数: ${changed}）。git diff で中身を確かめてください。`);
} else {
  report();
}
