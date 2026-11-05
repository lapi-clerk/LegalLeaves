// テストが使う処理（PDF エンジン・壊れない書き込み）の呼び出し口。
//
// 処理の本体は Python 版（py/legalleaves）で、engine_cli 経由で呼ぶ。テストは v4（Electron 版）から
// 引き継いだもので、判定基準はそのまま（v5 への移行時に新旧の両方へ当てて同じ結果を確認済み）。
// 非同期で使っていた関数は async のまま、同期で使っていた関数（書き込み）は同期のまま包む。
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");

function pyCall(fn, params) {
  const py = process.env.LL_PYTHON || path.join(ROOT, "py", ".venv", "Scripts", "python.exe");
  const r = spawnSync(py, ["-m", "legalleaves.engine_cli"], {
    cwd: path.join(ROOT, "py"),
    input: JSON.stringify({ fn, params }),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`python engine failed: ${r.stderr || r.error}`);
  const out = JSON.parse(r.stdout);
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-engine-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  stampEvidence: async (params) => pyCall("stampEvidence", params),
  mergeAndStamp: async (params) => pyCall("mergeAndStamp", params),
  // 変換しなかったときは「同じバイト列」を返す（プレビューを壊さない約束）
  transcodeCCITTForPreview: async (bytes) => withTempDir((dir) => {
    const inPath = path.join(dir, "in.pdf");
    const outPath = path.join(dir, "out.pdf");
    fs.writeFileSync(inPath, Buffer.from(bytes));
    const r = pyCall("transcodeCCITTForPreview", { inPath, outPath });
    return r.same ? bytes : fs.readFileSync(outPath);
  }),
  // pdf-lib で作ったテスト用の文書を受け取り、保存して Python 側で調べる
  inspectActiveContent: async (doc) => {
    const bytes = Buffer.from(await doc.save());
    return withTempDir((dir) => {
      const p = path.join(dir, "doc.pdf");
      fs.writeFileSync(p, bytes);
      return pyCall("inspectActiveContent", { path: p });
    });
  },
  activeContentLabels: (keys) => pyCall("activeContentLabels", { keys }),
  writeFileAtomic: (destPath, text) => pyCall("writeAtomic", { destPath, text: String(text) }),
  copyFileAtomic: (srcPath, destPath) => pyCall("copyAtomic", { srcPath, destPath }),
};
