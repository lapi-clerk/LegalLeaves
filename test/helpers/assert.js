// テスト用の最小ヘルパ（依存を増やさないため自前）。失敗が1件でもあれば終了コード1。
let pass = 0;
let fail = 0;
const failures = [];

function section(title) {
  console.log("\n=== " + title + " ===");
}

function check(label, cond, extra = "") {
  if (cond) {
    pass++;
    console.log("  OK   " + label);
  } else {
    fail++;
    failures.push(label);
    console.log("  FAIL " + label + (extra ? " -> " + extra : ""));
  }
}

function report() {
  console.log(`\n===== ${pass} PASS / ${fail} FAIL =====`);
  if (fail) {
    console.log("失敗: " + failures.join(" / "));
    process.exit(1);
  }
}

module.exports = { section, check, report };
