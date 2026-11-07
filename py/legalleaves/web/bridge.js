// LegalLeaves（Python＋pywebview 版）: 画面の window.api を Python 側へつなぐ橋渡し。
//
// 画面のコード（src/app-*.js）は Electron 版と共通で、window.api.〇〇() を呼ぶ。
// Electron 版では preload.js がこれを用意していた。ここでは同じ名前・同じ戻り値で、
// pywebview の呼び出し（window.pywebview.api）と、PDF のバイト列の受け取り（同じ127.0.0.1上の
// 小さな窓口・合言葉つき）に振り分ける。
//
// このファイルはアプリの画面（src/index.html）を配るときにだけ差し込まれる（Electron 版には影響しない）。
(function () {
  "use strict";

  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  window.addEventListener("pywebviewready", () => readyResolve());
  if (window.pywebview && window.pywebview.api) readyResolve();

  let token = null;
  async function call(name, ...args) {
    await ready;
    return window.pywebview.api[name](...args);
  }
  async function getToken() {
    if (!token) token = await call("session_token");
    return token;
  }
  async function fetchBytes(kind, path) {
    const res = await fetch(`/bytes/${kind}?path=${encodeURIComponent(path)}`, {
      headers: { "X-LL-Token": await getToken() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), ext: res.headers.get("X-LL-Ext") || "" };
  }

  // --- ドラッグ＆ドロップ ---
  // ブラウザの File からはファイルの場所（パス）が分からない。WebView2 は、ドロップの最中に
  // ファイルを Python 側へ渡すと場所を教えてくれる（pywebview と同じ仕組み）。
  // 画面側の処理より先に（捕捉段階で）渡しておき、そのあと画面が呼ぶ api で受け取る。
  window.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return; // 一覧の並べ替え（文字のドラッグ）は対象外
    try {
      window.chrome.webview.postMessageWithAdditionalObjects("FilesDropped", dt.files);
    } catch (_) { /* 渡せなかったときは、受け取り側で「場所が分からない」として扱う */ }
  }, true);

  window.api = {
    getInitialOutputState: () => call("get_initial_output_state"),
    selectPdfFiles: () => call("select_pdf_files"),
    selectOutputFolder: (currentPath) => call("select_output_folder", currentPath || ""),
    registerDroppedPdfFiles: (files) => call("register_dropped_files", (files || []).length),
    resolveDroppedOutputPath: (file) => (file ? call("resolve_dropped_output_path") : null),
    readClipboardText: () => call("read_clipboard_text"),
    writeClipboardText: (text) => call("write_clipboard_text", String(text || "")),
    copyPrompt: (renameOnly) => call("copy_prompt", !!renameOnly),
    openLastOutputDir: () => call("open_last_output_dir"),
    readPdfMetadata: (filePaths) => call("read_pdf_metadata", filePaths || []),
    createSubmissionFiles: (payload) => call("create_submission_files", payload),
    getProgress: () => call("get_progress"),
    generatePreview: (payload) => call("generate_preview", payload),
    regeneratePreviewFile: (payload) => call("regenerate_preview_file", payload),
    readPreviewBytes: async (filePath) => {
      const r = await fetchBytes("preview", filePath);
      return r ? r.bytes : null;
    },
    discardPreview: () => call("discard_preview"),
    setPreviewEnabled: (enabled) => call("set_preview_enabled", !!enabled),
    quitApp: (hasUnsavedWork) => call("quit_app", { hasUnsavedWork: !!hasUnsavedWork }),
    setDirty: (dirty) => call("set_dirty", !!dirty),
    openCaseFile: () => call("open_case_file"),
    readSourceBytes: async (filePath) => {
      const r = await fetchBytes("source", filePath);
      return r ? { ext: r.ext, bytes: r.bytes } : null;
    },
    openSourceFile: (filePath) => call("open_source_file", filePath),
    readFirmNotes: () => call("read_firm_notes"),
    writeFirmNotes: (text) => call("write_firm_notes", String(text ?? "")),
    getAppDataInfo: () => call("get_app_data_info"),
    openAppDataDir: () => call("open_app_data_dir"),
    deleteAppDataItem: (key) => call("delete_app_data_item", key),
    confirmDialog: (opts) => call("confirm_dialog", opts || {}),
    deleteAllAppData: () => call("delete_all_app_data"),
  };
})();
