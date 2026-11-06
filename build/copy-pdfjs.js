// pdfjs-dist の必要2ファイルを src/vendor/pdfjs/ へコピーする（コミット対象）。
// レンダラーは file:// で読み込むため node_modules 直参照ではなくアプリ内に同梱する。
// 実行: node build/copy-pdfjs.js（pdfjs-dist を更新したら再実行してコミット）
//
// pdfjs-dist は「開発時だけ必要」な依存（devDependencies）。アプリが実行時に読むのは
// ここでコピーした src/vendor/pdfjs/ の2ファイルだけなので、配布物には pdfjs-dist 本体
// （と依存の @napi-rs/canvas のネイティブバイナリ）を含めない＝約70MBの削減。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build");
const DEST = path.join(__dirname, "..", "src", "vendor", "pdfjs");

if (!fs.existsSync(SRC)) {
  console.error("pdfjs-dist が見つかりません。開発用の依存を入れてから実行してください: npm install");
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
  console.log("copied", f);
}
