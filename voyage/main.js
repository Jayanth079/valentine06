const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;

// ---------- paths ----------
const userDataDir = () => app.getPath("userData");
const dataFile = () => path.join(userDataDir(), "voyage-data.json");
const configFile = () => path.join(userDataDir(), "voyage-config.json");

// ---------- config (API key encrypted with OS keychain/DPAPI) ----------
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  // 0600: even the plaintext fallback must not be world-readable
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
}

function storeApiKey(key) {
  const cfg = readConfig();
  if (!key) {
    delete cfg.apiKeyEnc;
    delete cfg.apiKeyPlain;
    writeConfig(cfg);
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    cfg.apiKeyEnc = safeStorage.encryptString(key).toString("base64");
    delete cfg.apiKeyPlain;
  } else {
    cfg.apiKeyPlain = key; // fallback only if OS encryption is unavailable
  }
  writeConfig(cfg);
}

function loadApiKey() {
  const cfg = readConfig();
  if (cfg.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, "base64"));
    } catch {
      return null;
    }
  }
  return cfg.apiKeyPlain || null;
}

// ---------- Claude API ----------
const MODEL = "claude-opus-5";

let AnthropicSDK = null;
function getClient() {
  const key = loadApiKey();
  if (!key) return null;
  if (!AnthropicSDK) {
    AnthropicSDK = require("@anthropic-ai/sdk");
  }
  const Anthropic = AnthropicSDK.Anthropic || AnthropicSDK.default || AnthropicSDK;
  return new Anthropic({ apiKey: key });
}

function extractSources(content) {
  const sources = [];
  const seen = new Set();
  for (const block of content || []) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item && item.url && !seen.has(item.url)) {
          seen.add(item.url);
          sources.push({ url: item.url, title: item.title || item.url });
        }
      }
    }
  }
  return sources;
}

// IPC results are structured objects, never thrown errors:
// Electron strips custom properties (like err.code) off thrown errors in
// ipcMain.handle, so the renderer could never distinguish NO_API_KEY.
ipcMain.handle("ai:run", async (event, payload) => {
  const { id, system, prompt, useWebSearch } = payload;
  const client = getClient();
  if (!client) return { ok: false, code: "NO_API_KEY", message: "No API key configured. Open Settings and paste your Anthropic API key." };

  const tools = useWebSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }]
    : undefined;

  let messages = [{ role: "user", content: prompt }];
  let fullText = "";
  let sources = [];
  let finalStop = null;

  const MAX_CONTINUATIONS = 6;
  try {
    // Server-side tools can pause the turn; continue up to MAX_CONTINUATIONS times.
    for (let i = 0; i < MAX_CONTINUATIONS; i++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages,
        ...(tools ? { tools } : {}),
      });

      stream.on("text", (delta) => {
        fullText += delta;
        if (!event.sender.isDestroyed()) {
          event.sender.send("ai:delta", { id, delta });
        }
      });

      const final = await stream.finalMessage();
      sources = sources.concat(extractSources(final.content));
      finalStop = final.stop_reason;

      if (final.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: final.content }];
        continue;
      }
      break;
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (err && err.status === 401) return { ok: false, code: "BAD_KEY", message: "The API key was rejected (401). Check it in Settings." };
    if (err && err.status === 429) return { ok: false, code: "RATE_LIMIT", message: "Rate limited (429). Wait a minute and try again." };
    return { ok: false, code: "API_ERROR", message: msg, partial: fullText };
  }

  return {
    ok: true,
    text: fullText,
    sources,
    stopReason: finalStop,
    truncated: finalStop === "max_tokens",
    refusal: finalStop === "refusal",
    exhausted: finalStop === "pause_turn", // still paused after MAX_CONTINUATIONS
  };
});

ipcMain.handle("ai:test", async () => {
  const client = getClient();
  if (!client) return { ok: false, code: "NO_API_KEY", message: "No API key saved yet." };
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    });
    const text = res.content.find((b) => b.type === "text");
    return { ok: true, reply: text ? text.text : "", model: res.model };
  } catch (err) {
    if (err && err.status === 401) return { ok: false, code: "BAD_KEY", message: "Key rejected (401) — double-check it." };
    return { ok: false, code: "API_ERROR", message: err && err.message ? err.message : String(err) };
  }
});

// ---------- data persistence ----------
ipcMain.handle("data:load", async () => {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), "utf8"));
  } catch {
    return null;
  }
});

ipcMain.handle("data:save", async (_e, data) => {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const tmp = dataFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, dataFile());
  return true;
});

ipcMain.handle("data:export", async (_e, data) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: "Export Voyage data",
    defaultPath: `voyage-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), "utf8");
  return true;
});

ipcMain.handle("data:import", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Import Voyage data",
    filters: [{ name: "JSON", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(res.filePaths[0], "utf8")) };
  } catch (err) {
    return { ok: false, message: "That file is not valid JSON — is it really a Voyage backup?" };
  }
});

// ---------- settings ----------
ipcMain.handle("settings:get", async () => {
  const cfg = readConfig();
  return {
    hasApiKey: Boolean(cfg.apiKeyEnc || cfg.apiKeyPlain),
    counsellorName: cfg.counsellorName || "",
    academicYear: cfg.academicYear || "",
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
});

ipcMain.handle("settings:set", async (_e, { apiKey, counsellorName, academicYear }) => {
  if (apiKey !== undefined) storeApiKey(apiKey);
  const cfg = readConfig();
  if (counsellorName !== undefined) cfg.counsellorName = counsellorName;
  if (academicYear !== undefined) cfg.academicYear = academicYear;
  writeConfig(cfg);
  return true;
});

ipcMain.handle("shell:openExternal", async (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0F1722",
    icon: path.join(__dirname, "assets", "icon.png"),
    title: "Voyage",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
