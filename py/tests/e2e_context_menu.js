// 自己点検（selftest.py）用の手順: 5.5.0 右クリックのメニュー（コピー・貼り付け）と、
// 標目の違うファイルを 1 つにまとめるときの出力前チェックの知らせ。
// window.__ll.files: 見本の 4 つ（契約書.pdf・請求書.pdf・領収書.pdf・催告書.pdf）。
// クリップボードを使うので、終わったら元の中身に戻す。
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const st = (branch) => ({ page: 1, branch, draw_label: true, rotate_degrees: 0, position: { x: 0.93, y: 0.07, anchor: "top-right" } });
const ev = (name, num, br, title, q) => ({
  original_file_name: name, type: "証拠", evidence_number: num, branch_range: br, title,
  suggested_base_name: `${num}${br ? "_" + br : ""}_${title}`, needs_user_confirmation: !!q, confirmation_question: q || null, stamps: [st(br)],
});
const QUESTION = "ご依頼では「領収証」とのことでしたが、フォルダにあるのは「領収書」でした。同じ書類か、ご確認ください。";
const r = {};
const before = await window.api.readClipboardText();

await addFiles(window.__ll.files);
state.aiText = JSON.stringify({ schema_version: "2.0", files: [
  ev("契約書.pdf", "甲001", null, "契約書"), ev("請求書.pdf", "甲002", "1", "請求書"),
  ev("領収書.pdf", "甲002", "2", "領収書", QUESTION), ev("催告書.pdf", "甲003", null, "催告書"),
] });
validateAiJson();
update();
await proceedToMatch();
r.reachedReview = await waitFor(() => state.step === "review");

// 1) 確認事項の文を選んで右クリック → 「コピー」
state.selectedReview = state.reviewFiles.findIndex((f) => f.name === "領収書.pdf");
renderReview();
await sleep(300);
const all = [...document.querySelectorAll(".screen.is-active *")].filter((el) => el.children.length === 0 && el.textContent.includes("領収証"));
const target = all[0] || null;
r.questionShown = !!target;
const fire = (el, x = 200, y = 200) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
if (target) {
  const range = document.createRange();
  range.selectNodeContents(target);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  r.defaultPrevented = !fire(target);
  const menu = document.getElementById("ctx-menu");
  r.menuItemsOnText = menu ? [...menu.querySelectorAll(".ctx-menu-item")].map((b) => b.textContent) : null;
  r.menuInsideWindow = menu ? (menu.offsetLeft >= 0 && menu.offsetLeft + menu.offsetWidth <= window.innerWidth) : null;
  if (menu) menu.querySelector(".ctx-menu-item").click();
  await sleep(400);
  r.menuClosedAfterPick = !document.getElementById("ctx-menu");
  r.copied = await window.api.readClipboardText();
  r.copiedMatches = r.copied === String(target.textContent);
  sel.removeAllRanges();
}

// 2) 何も選ばずに右クリック → メニューは出ない
fire(document.querySelector(".screen.is-active"));
r.noMenuWithoutSelection = !document.getElementById("ctx-menu");

// 3) 入力欄で右クリック → 「貼り付け」。貼り付けると、手で打ったのと同じように反映される
const input = $("rf-docname");
r.inputFound = !!input;
if (input) {
  await window.api.writeClipboardText("（控え）");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  fire(input);
  const menu = document.getElementById("ctx-menu");
  r.menuItemsOnInput = menu ? [...menu.querySelectorAll(".ctx-menu-item")].map((b) => b.textContent) : null;
  const paste = menu && [...menu.querySelectorAll(".ctx-menu-item")].find((b) => b.textContent === "貼り付け");
  const valueBefore = input.value;
  if (paste) paste.click();
  await sleep(500);
  r.pasted = input.value === valueBefore + "（控え）";
  r.inputValue = input.value;
  // Esc で閉じる
  input.select();
  fire(input);
  r.menuItemsWithSelectionInInput = [...document.querySelectorAll("#ctx-menu .ctx-menu-item")].map((b) => b.textContent);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  r.closedByEscape = !document.getElementById("ctx-menu");
}

// 4) 出力前チェックの知らせ（標目の違うファイルを 1 つにまとめる）
r.outputIssues = computeOutputIssues().map((x) => x.text);

await window.api.writeClipboardText(before || "");
return r;
