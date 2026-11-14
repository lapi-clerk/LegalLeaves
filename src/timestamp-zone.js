// ---------------------------------------------------------------------------
// 裁判所タイムスタンプ帯の位置と、証拠番号の既定位置（この2つの唯一の定義場所）
//
// mintsへ提出すると、裁判所側で各ファイルの1ページ目の上部に「タイムスタンプ帯」が
// 付く。証拠番号がこれと重なると読めなくなるため、番号は帯の下に置く必要がある。
//
// このファイルは main プロセス（pdf-engine.js から require）と
// レンダラー（index.html で最初に読み込むクラシックスクリプト）の**両方**から使う。
// 数値を変えるときは必ずここだけを変えること。
//
// ===========================================================================
// 【実測できている範囲】A4縦のみ（利用者の実提出で計測）
//   ・帯が付くのは「アップロードした各ファイルの1ページ目」のみ
//     （枝番を結合した号証なら、結合後の先頭ページのみ）
//   ・上端から 8〜19mm
//   ・左 31mm 〜 右端から 11mm
//
// 【A4横】利用者の実提出での観察（2026-11-12 に聞いた。数値は測っていない）
//   ・帯は、時計回りに 90 度回した形で、紙の**右端**に縦向きに付く
//     （≒先に A4縦とみなして帯を付け、全体を時計回りに 90 度回した形）
//   ・この見立てどおりなら: 右端から 8〜19mm、上端から 31mm 〜 下端から 11mm
//   ・**数値は A4縦からの換算**で、横の紙では測っていない。timestampZoneRectPt() がこの換算をする
//
// 【未確認】A3縦・A3横
//   これらの用紙で提出した実績がまだ無く、帯がどこに入るか分かっていない。
//   いまは、縦なら A4縦と同じ長さの位置、横なら A4横と同じ長さの位置に描いている（決めつけないこと）。
//
//   → 測り方と必要な数値は docs/timestamp-band-measurement.md にまとめてある。
// ===========================================================================
//
// 【この定数を変えると効く場所】
//   ・pdf-engine.js  placeLabel / IMG_NUMBER_TOP_PT … 出力PDFへの実際の焼き込み位置
//   ・src/app-review.js  stampHitsTimestampZone     … 確認画面の干渉警告
//   ・src/app-preview.js 帯の半透明表示・画像の番号位置
//   ・src/app-evidence.js / app-output.js           … 既定スタンプの生成
// ---------------------------------------------------------------------------

// A4縦の実測値を、用紙高さ・幅に対する割合で表したもの（従来からの表現）。
const TIMESTAMP_ZONE = { x0: 0.148, y0: 0.027, x1: 0.948, y1: 0.064 };

// 上端アンカーの既定y。帯の直下（0.07 ≒ A4縦の上端20.8mm）。
// 旧既定 0.05 は帯のど真ん中で、実際に番号が読めなくなっていた。
const STAMP_SAFE_Y = 0.07;

// 帯・番号位置は「用紙上端からの物理量(pt)」でも保持する。帯は提出後に物理的な位置へ
// 付くので、割合のままだと見た目の高さが変わるページ（横向き等）でずれる可能性がある。
// ※ここでpt化しているのは A4縦の実測値。他の用紙での妥当性は未確認（上記の【未確認】参照）。
const A4_PT = { w: 595.28, h: 841.89 };
const TS_TOP_PT = TIMESTAMP_ZONE.y0 * A4_PT.h;                 // 帯 上端 ≈22.7pt（8mm）
const TS_BOTTOM_PT = TIMESTAMP_ZONE.y1 * A4_PT.h;              // 帯 下端 ≈53.9pt（19mm）
const TS_LEFT_PT = TIMESTAMP_ZONE.x0 * A4_PT.w;                // 帯 左端 ≈88.1pt（31mm）
const TS_RIGHT_MARGIN_PT = (1 - TIMESTAMP_ZONE.x1) * A4_PT.w;  // 帯 右余白 ≈31pt（11mm）
const IMG_NUMBER_TOP_PT = STAMP_SAFE_Y * A4_PT.h;              // 画像の番号ボックス上端 ≈58.9pt（20.8mm）

// 帯の場所（pt。左上が原点）。横向きのページ（幅 > 高さ）では、右端に縦向きに付く（上の【A4横】）。
// 表示用。確認画面の「帯と重なりそう」の知らせは、まだ縦のページの形（上端）だけを見ている。
function timestampZoneRectPt(pageW, pageH) {
  if (pageW > pageH) {
    return {
      landscape: true,
      left: pageW - TS_BOTTOM_PT,
      top: TS_LEFT_PT,
      width: TS_BOTTOM_PT - TS_TOP_PT,
      height: pageH - TS_LEFT_PT - TS_RIGHT_MARGIN_PT,
    };
  }
  return {
    landscape: false,
    left: TS_LEFT_PT,
    top: TS_TOP_PT,
    width: pageW - TS_LEFT_PT - TS_RIGHT_MARGIN_PT,
    height: TS_BOTTOM_PT - TS_TOP_PT,
  };
}

// Node（main プロセス）から require されたときだけエクスポートする。
// レンダラーではクラシックスクリプトとして読み込まれ、上の定数がそのままグローバルになる。
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TIMESTAMP_ZONE, STAMP_SAFE_Y, A4_PT,
    TS_TOP_PT, TS_BOTTOM_PT, TS_LEFT_PT, TS_RIGHT_MARGIN_PT, IMG_NUMBER_TOP_PT, timestampZoneRectPt,
  };
}
