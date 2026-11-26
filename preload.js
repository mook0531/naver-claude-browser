// 렌더러(위쪽 화면: 탭 막대·주소창·북마크·대화창)에 안전하게 노출할 API
// 페이지 자체는 main 프로세스가 탭마다 WebContentsView로 띄운다.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // 앱 안 대화창 (Claude API)
  hasKey: () => ipcRenderer.invoke("settings:hasKey"),
  saveKey: (key) => ipcRenderer.invoke("settings:saveKey", key),
  ask: (requestId, messages, model) => ipcRenderer.invoke("claude:ask", { requestId, messages, model }),
  abort: (requestId) => ipcRenderer.invoke("claude:abort", requestId),
  onDelta: (cb) => ipcRenderer.on("claude:delta", (_e, data) => cb(data)),

  // 확인 창 설정
  getConfirm: () => ipcRenderer.invoke("prefs:confirm:get"),
  setConfirm: (on) => ipcRenderer.invoke("prefs:confirm:set", on),
  onConfirmChanged: (cb) => ipcRenderer.on("prefs:confirm", (_e, on) => cb(on)),

  // 북마크
  bookmarks: {
    list: () => ipcRenderer.invoke("bm:list"),                           // 폴더가 있는 트리
    add: (title, url, folderId) => ipcRenderer.invoke("bm:add", title, url, folderId), // 새 항목 id
    remove: (id) => ipcRenderer.invoke("bm:remove", id),
    removeUrl: (url) => ipcRenderer.invoke("bm:remove-url", url),
    rename: (id, title) => ipcRenderer.invoke("bm:rename", id, title),
    newFolder: (title, parentId) => ipcRenderer.invoke("bm:new-folder", title, parentId),
    move: (id, folderId) => ipcRenderer.invoke("bm:move", id, folderId),
    open: (url, mode) => ipcRenderer.send("bm:open", url, mode),
    folderPopup: (id, x, y) => ipcRenderer.invoke("bm:folder-popup", id, x, y),
    menu: (id) => ipcRenderer.invoke("bm:menu", id),
    barMenu: () => ipcRenderer.invoke("bm:bar-menu"),
    chooseFolder: (id, x, y) => ipcRenderer.invoke("bm:choose-folder", id, x, y),
    openWindow: (url) => ipcRenderer.send("bm:open-window", url),
    importChrome: () => ipcRenderer.invoke("bm:import-chrome"),
    onChanged: (cb) => ipcRenderer.on("bm:changed", (_e, tree) => cb(tree)),
  },


  // 탭과 이동
  tabs: {
    getState: () => ipcRenderer.invoke("tabs:get"),
    onState: (cb) => ipcRenderer.on("tabs:state", (_e, s) => cb(s)),
    create: (url, opts) => ipcRenderer.send("tabs:create", url, opts),
    activate: (id) => ipcRenderer.send("tabs:activate", id),
    close: (id) => ipcRenderer.send("tabs:close", id),
    setBounds: (b) => ipcRenderer.send("tabs:bounds", b),
    extract: () => ipcRenderer.invoke("tabs:extract"),
  },
  nav: (op, arg) => ipcRenderer.send("nav", op, arg),
  suggest: (q) => ipcRenderer.invoke("suggest", q),
  overlay: (open) => ipcRenderer.invoke("ui:overlay", open),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  naverApi: {
    status: () => ipcRenderer.invoke("naverapi:status"),
    save: (id, secret) => ipcRenderer.invoke("naverapi:save", id, secret),
    test: () => ipcRenderer.invoke("naverapi:test"),
    exportKeyFile: () => ipcRenderer.invoke("naverapi:export"),
  },
  newWindow: () => ipcRenderer.send("win:new"),
  onFocusAddress: (cb) => ipcRenderer.on("ui:focus-address", () => cb()),
  onTabsShortcut: (cb) => ipcRenderer.on("tabs:shortcut", (_e, key) => cb(key)),
  onMcpActivity: (cb) => ipcRenderer.on("mcp:activity", (_e, label) => cb(label)),
});
