const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisClap", {
  onDoubleClap: () => ipcRenderer.send("clap-wake"),
});
