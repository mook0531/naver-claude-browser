// 렌더러(화면)에 안전하게 노출할 API
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  hasKey: () => ipcRenderer.invoke("settings:hasKey"),
  saveKey: (key) => ipcRenderer.invoke("settings:saveKey", key),
  ask: (requestId, messages, model) => ipcRenderer.invoke("claude:ask", { requestId, messages, model }),
  abort: (requestId) => ipcRenderer.invoke("claude:abort", requestId),
  onMcpActivity: (cb) => ipcRenderer.on("mcp:activity", (_e, label) => cb(label)),
  onDelta: (cb) => ipcRenderer.on("claude:delta", (_e, data) => cb(data)),
});
