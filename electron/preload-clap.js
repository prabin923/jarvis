/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisClap", {
  onDoubleClap: () => ipcRenderer.send("clap-wake"),
});
