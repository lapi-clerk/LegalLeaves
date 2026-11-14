// 自己点検（selftest.py）用の手順: 5.5.0 横向きの紙では、タイムスタンプ帯を右端に縦向きに見せる。
//   縦の紙: 上端 8〜19mm・左 31mm〜右端から 11mm（これまでどおり）
//   横の紙: 右端から 8〜19mm・上端 31mm〜下端から 11mm（A4縦で測った値からの換算。timestamp-zone.js の【A4横】）
// window.__ll.files: 写真（JPEG・横長）1つ。プレビューで右に 90°回すと縦の紙になるので、両方の向きを見られる。
const st = { page: 1, branch: null, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } };
const AI = {
  schema_version: "2.0", evidence_explanation: { exists: false }, case: {},
  files: [{ original_file_name: window.__ll.files[0].name, type: "証拠", evidence_number: "甲004", title: "写真",
    suggested_base_name: "甲004_写真", confidence: "high", needs_user_confirmation: false, stamps: [st] }],
  warnings: [],
};
const MM = 2.8346; // 1mm あたりの pt
async function snapshot(tag) {
  for (let n = 1; n <= pvState.pages.length; n++) await pvRenderPage(n);
  const e = pvState.pages[0];
  const zone = e.overlay.querySelector(".pv-zone");
  const stamp = e.overlay.querySelector(".pv-stamp");
  const mm = (px) => Number((px / e.scale / MM).toFixed(1));
  const box = (el) => el && {
    left: mm(el.offsetLeft), top: mm(el.offsetTop),
    right: mm(e.cssW - el.offsetLeft - el.offsetWidth), bottom: mm(e.cssH - el.offsetTop - el.offsetHeight),
  };
  const z = box(zone);
  const s = box(stamp);
  const overlap = !!(zone && stamp) &&
    stamp.offsetLeft < zone.offsetLeft + zone.offsetWidth && zone.offsetLeft < stamp.offsetLeft + stamp.offsetWidth &&
    stamp.offsetTop < zone.offsetTop + zone.offsetHeight && zone.offsetTop < stamp.offsetTop + stamp.offsetHeight;
  // 写真の置かれた範囲（白でない画素の範囲。番号の文字を拾わないよう、上端から 30mm より下だけを見る）
  const cv = e.canvas;
  const k = cv.width / e.cssW;
  const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
  const y0 = Math.ceil(30 * MM * e.scale * k);
  let minX = cv.width, maxX = -1, minY = cv.height, maxY = -1;
  for (let y = y0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const j = (y * cv.width + x) * 4;
      if (d[j] < 248 || d[j + 1] < 248 || d[j + 2] < 248) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const photo = maxX < 0 ? null : {
    left: mm(minX / k), top: mm(minY / k), right: mm((cv.width - 1 - maxX) / k), bottom: mm((cv.height - 1 - maxY) / k),
  };
  return {
    tag,
    photoFromEdgesMm: photo, // 写真の、紙の左・上・右・下の端からの距離（横の紙では右が 19mm より大きければ帯の内側）
    photoClearOfZone: !!(photo && z) && (e.cssW > e.cssH ? photo.right > z.right + (mm(zone.offsetWidth)) : photo.top > z.top + mm(zone.offsetHeight)),
    pageMm: `${Math.round(mm(e.cssW))}x${Math.round(mm(e.cssH))}`,
    orientation: e.cssW > e.cssH ? "横" : "縦",
    zoneIsLandscape: zone ? zone.classList.contains("is-landscape") : null,
    zoneFromEdgesMm: z,   // 帯の、紙の左・上・右・下の端からの距離
    stampFromEdgesMm: s,  // 押す番号の、同じ距離
    stampOverlapsZone: overlap,
    zoneTitle: zone ? zone.title : null,
    labelWritingMode: zone ? getComputedStyle(zone.querySelector(".pv-zone-label")).writingMode : null,
  };
}

const r = { steps: [] };
await addFiles(window.__ll.files);
state.aiText = JSON.stringify(AI);
validateAiJson();
update();
await proceedToMatch();
advanceStep("export");
await openPreview(buildOutputPlan());
await showPreviewFile(0);
r.steps.push(await snapshot("横の紙"));
await setPreviewRotate("90");
r.steps.push(await snapshot("右に90度回した後（縦の紙）"));
return r;
