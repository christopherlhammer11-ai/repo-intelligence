import { spawn } from "node:child_process";
import path from "node:path";

import { app, BrowserWindow, dialog, shell } from "electron";

const DEFAULT_PORT = 3360;

let mainWindow = null;
let nextServerProcess = null;
let isQuitting = false;

app.setName("Repo Intelligence");

function resolveDesktopDataRoot() {
  return path.join(app.getPath("userData"), "local-data");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: "Repo Intelligence",
    backgroundColor: "#020617",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

async function bootApplication() {
  createMainWindow();

  const targetUrl = app.isPackaged
    ? await startBundledNextServer()
    : await waitForUrl(process.env.DEV_SERVER_URL ?? "http://127.0.0.1:3000");

  await mainWindow.loadURL(targetUrl);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

async function startBundledNextServer() {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const serverEntry = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    ".next",
    "standalone",
    "server.js",
  );
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    REPO_INTELLIGENCE_DATA_ROOT: resolveDesktopDataRoot(),
  };

  nextServerProcess = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "pipe",
  });

  nextServerProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[next] ${chunk}`);
  });

  nextServerProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[next] ${chunk}`);
  });

  nextServerProcess.on("exit", (code) => {
    nextServerProcess = null;

    if (code !== 0 && !isQuitting) {
      dialog.showErrorBox(
        "Repo Intelligence failed to start",
        "The bundled local server exited before the desktop app could load.",
      );
    }
  });

  return waitForUrl(`http://127.0.0.1:${port}`);
}

async function waitForUrl(url) {
  const timeoutAt = Date.now() + 45_000;

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url, { cache: "no-store" });

      if (response.ok) {
        return url;
      }
    } catch {
      // Keep polling until the server is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function stopBundledServer() {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill("SIGTERM");
  }
}

app.on("before-quit", () => {
  isQuitting = true;
  stopBundledServer();
});

app.whenReady().then(() => {
  void bootApplication().catch((error) => {
    dialog.showErrorBox(
      "Repo Intelligence could not launch",
      error instanceof Error ? error.message : "Unknown launch error.",
    );
    stopBundledServer();
    app.quit();
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootApplication();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
