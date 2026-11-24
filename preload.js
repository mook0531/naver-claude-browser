// 렌더러(화면)에 안전하게 노출할 API
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  hasKey: () => ipcRenderer.invoke("settings:hasKey"),
  saveKey: (key) => ipcRenderer.invoke("settings:saveKey", key),
  ask: (requestId, messages, model) => ipcRenderer.invoke("claude:ask", { requestId, messages, model }),
  abort: (requestId) => ipcRenderer.invoke("claude:abort", requestId),
  // 탭
  getConfirm: () => ipcRenderer.invoke("prefs:confirm:get"),
  setConfirm: (on) => ipcRenderer.invoke("prefs:confirm:set", on),
  onConfirmChanged: (cb) => ipcRenderer.on("prefs:confirm", (_e, on) => cb(on)),
  bookmarks: {
    list: () => ipcRenderer.invoke("bm:list"),
    add: (title, url) => ipcRenderer.invoke("bm:add", title, url),
    remove: (url) => ipcRenderer.invoke("bm:remove", url),
    rename: (url, title) => ipcRenderer.invoke("bm:rename", url, title),
    menu: () => ipcRenderer.invoke("bm:menu"),
    openWindow: (url) => ipcRenderer.send("bm:open-window", url),
    onChanged: (cb) => ipcRenderer.on("bm:changed", (_e, list) => cb(list)),
  },
  allocTabId: () => ipcRenderer.sendSync("tab:alloc"),
  newWindow: () => ipcRenderer.send("win:new"),
  closeWindow: () => ipcRenderer.send("win:close"),
  registerTab: (id, webContentsId) => ipcRenderer.send("tab:register", id, webContentsId),
  tabActivated: (id) => ipcRenderer.send("tab:activated", id),
  tabClosed: (id) => ipcRenderer.send("tab:closed", id),
  onTabsOpen: (cb) => ipcRenderer.on("tabs:open", (_e, data) => cb(data)),
  onTabsShortcut: (cb) => ipcRenderer.on("tabs:shortcut", (_e, key) => cb(key)),
  onTabsCommand: (cb) => ipcRenderer.on("tabs:cmd", (_e, data) => cb(data)),
  tabsCommandDone: (reqId, result) => ipcRenderer.send("tabs:cmd-done", reqId, result),
  onMcpActivity: (cb) => ipcRenderer.on("mcp:activity", (_e, label) => cb(label)),
  onDelta: (cb) => ipcRenderer.on("claude:delta", (_e, data) => cb(data)),
});
