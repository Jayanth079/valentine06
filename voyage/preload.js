const { contextBridge, ipcRenderer } = require("electron");

function randomId() {
  return "req_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

contextBridge.exposeInMainWorld("voyage", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  exportData: (data) => ipcRenderer.invoke("data:export", data),
  importData: () => ipcRenderer.invoke("data:import"),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s) => ipcRenderer.invoke("settings:set", s),

  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  testAI: () => ipcRenderer.invoke("ai:test"),

  runAI: (payload, onDelta) => {
    const id = randomId();
    const listener = (_e, data) => {
      if (data.id === id && typeof onDelta === "function") onDelta(data.delta);
    };
    ipcRenderer.on("ai:delta", listener);
    return ipcRenderer
      .invoke("ai:run", { ...payload, id })
      .finally(() => ipcRenderer.removeListener("ai:delta", listener));
  },
});
