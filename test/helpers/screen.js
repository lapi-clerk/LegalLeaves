// 画面のスクリプト（src/app-*.js）を、窓なしで読み込む（test/validation.test.js と同じやり方）。
//
// 画面のスクリプトはクラシックスクリプト（require できない）なので、vm の上で index.html の順に
// そのまま評価し、画面の部品（document など）は何を呼ばれても受け流す代役にする。
// 取り出すのは画面に触れない関数だけ（判定・表記・出力の計画）。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC_DIR = path.join(__dirname, "..", "..", "src");

// どんなプロパティ参照・呼び出しも黙って受け流す代役
function permissive(name = "stub") {
  const fn = function () { return permissive(name); };
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => "";
      if (k === "toString") return () => "";
      if (typeof k === "symbol") return undefined;
      if (k === "length") return 0;
      if (k === "value" || k === "textContent" || k === "innerHTML") return "";
      if (k === "hidden" || k === "checked" || k === "disabled") return false;
      if (k === "files" || k === "children") return [];
      return permissive(name + "." + String(k));
    },
    set() { return true; },
    apply() { return permissive(name); },
    has() { return true; },
  });
}

// 戻り値: { ctx, get(式) }。ctx.関数名 で関数、get("state") で const/let の束縛を取り出す。
function loadScreen({ quiet = true } = {}) {
  const ctx = {
    console,
    window: permissive("window"),
    document: permissive("document"),
    navigator: { clipboard: permissive("clipboard") },
    localStorage: permissive("localStorage"),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, Number, String, Array, Object, Set, Map, RegExp, Error,
    IntersectionObserver: function () { return permissive("io"); },
    requestAnimationFrame: (f) => f && f(),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    Uint8Array, TextEncoder, TextDecoder, Blob: function () {}, URL: permissive("URL"),
  };
  ctx.window.api = permissive("api");
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(SRC_DIR, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => !/type\s*=\s*["']module["']/.test(attrs))
    .map((attrs) => (attrs.match(/src\s*=\s*["']([^"']+)["']/) || [])[1])
    .filter(Boolean);
  if (!scripts.length) throw new Error("index.html からスクリプトを読み取れませんでした");
  for (const rel of scripts) {
    const file = path.join(SRC_DIR, rel.replace(/^\.\//, ""));
    try {
      vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: path.basename(file) });
    } catch (e) {
      // 末尾の画面の初期化で落ちても、関数の宣言は既に載っている
      if (!quiet) console.log(`(note) ${path.basename(file)} 読み込み時の例外は無視:`, e.message.slice(0, 100));
    }
  }
  // 画面の描き直しは対象外（判定だけを動かす）
  vm.runInContext("renderReview = function () {}; renderMatch = function () {}; goStep = function (s) { state.step = s; };", ctx);
  return { ctx, get: (expr) => vm.runInContext(expr, ctx), SRC_DIR };
}

module.exports = { loadScreen };
