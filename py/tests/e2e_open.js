// 自己点検（selftest.py）用の手順: 5.5.0 確認画面から開く入口（--open）。
// 起動の引数で渡したフォルダと整理データが、人が「ファイルを入れる → 貼り付ける → 照合して進む」をしたのと
// 同じ状態で開くか。外から開いたことの知らせが出るか。書き出しまでは進まないか。
// 整理データの形式に誤りがあるときは、読み込み画面で止まり、いつもの誤りの文が出るか。
// 動かし方: LL_SELFTEST_OUT などを付けて、python -m legalleaves --open <整理データ.json> --files <フォルダ>
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const waitFor = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
};
const r = {};
// 受け取りと「照合して進む」が済むのを待つ（誤りのあるデータでは、読み込み画面のまま誤りの文が出る）
r.settled = await waitFor(() => state.openedFrom && (state.step !== "start" || state.aiJsonError));
await sleep(500);
r.step = state.step;
r.openedFrom = state.openedFrom;
r.noteShown = !$("outside-open-note").hidden;
r.note = $("outside-open-note").textContent;
r.files = state.files.map((f) => f.name);
r.aiJsonError = state.aiJsonError;
r.aiTextLength = state.aiText.length;
r.textareaFilled = $("ai-textarea").value === state.aiText;
r.toMatchDisabled = $("to-match-btn").disabled;
r.reviewFiles = (state.reviewFiles || []).map((f) => ({
  name: f.name, matched: f.matched, num: f.evidenceNumber, branch: f.branchRange, suggested: f.suggested,
}));
r.outputFolder = state.outputFolder || "";
r.lastOutputDir = state.lastOutputDir || "";
r.screen = (document.querySelector(".screen.is-active") || { dataset: {} }).dataset.screen || null;
return r;
