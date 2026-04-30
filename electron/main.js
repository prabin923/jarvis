/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, shell, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let clapWindow = null;  // Hidden background window for clap detection
let tray = null;
let nextServer = null;
let clapDetectionEnabled = true;
const PORT = 3000;
const DEV_URL = `http://localhost:${PORT}`;

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "J.A.R.V.I.S.",
    icon: path.join(__dirname, "../public/jarvis-icon.png"),
    titleBarStyle: "hiddenInset",  // macOS native-looking title bar
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: "#0a0a0f",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
    },
  });

  // Elegant show once ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Load the Next.js dev server
  mainWindow.loadURL(DEV_URL);

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Minimize to tray instead of quitting
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function activateMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

function wakeJarvisVoice() {
  activateMainWindow();

  if (!mainWindow) return;

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.executeJavaScript(
        "document.dispatchEvent(new CustomEvent('jarvis-clap-wake'))",
        true
      );
    });
  } else {
    mainWindow.webContents.executeJavaScript(
      "document.dispatchEvent(new CustomEvent('jarvis-clap-wake'))",
      true
    );
  }
}

// ─── Background Clap Detection Window ───
function createClapListener() {
  clapWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload-clap.js"),
    },
  });

  clapWindow.loadFile(path.join(__dirname, "clap-listener.html"));

  // Grant mic permission automatically for the hidden window
  clapWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "media") {
      callback(true);  // Auto-grant mic access for clap detection
    } else {
      callback(false);
    }
  });

  clapWindow.on("closed", () => {
    clapWindow = null;
  });

  console.log("👏 Background clap detection started");
}

// Handle clap-wake IPC from the hidden listener
ipcMain.on("clap-wake", () => {
  if (!clapDetectionEnabled) return;

  console.log("👏 Double-clap detected — waking JARVIS!");

  if (mainWindow) {
    wakeJarvisVoice();

    // Flash the window to grab attention
    mainWindow.once("focus", () => {
      mainWindow.flashFrame(false);
    });
    mainWindow.flashFrame(true);
  } else {
    // Window was fully closed — recreate it
    wakeJarvisVoice();
  }
});

function createTray() {
  // Create a simple tray icon (cyan circle)
  const trayIcon = nativeImage.createFromBuffer(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" fill="#0a0a0f" stroke="#00d4ff" stroke-width="2"/>
        <circle cx="11" cy="11" r="4" fill="#00d4ff"/>
      </svg>`
    )
  );

  tray = new Tray(trayIcon);
  tray.setTitle("JARVIS");
  tray.setToolTip("J.A.R.V.I.S. — Advanced AI System");

  const buildTrayMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open JARVIS",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: "separator" },
      {
        label: clapDetectionEnabled ? "👏 Clap Detection: ON" : "👏 Clap Detection: OFF",
        click: () => {
          clapDetectionEnabled = !clapDetectionEnabled;
          console.log(`👏 Clap detection ${clapDetectionEnabled ? "enabled" : "disabled"}`);

          if (clapDetectionEnabled && !clapWindow) {
            createClapListener();
          } else if (!clapDetectionEnabled && clapWindow) {
            clapWindow.close();
            clapWindow = null;
          }

          // Rebuild menu to update label
          buildTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit JARVIS",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  buildTrayMenu();

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    // Start Next.js dev server
    const npxPath = process.platform === "win32" ? "npx.cmd" : "npx";
    const serverProcess = spawn(npxPath, ["next", "dev", "--port", String(PORT)], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, BROWSER: "none" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    nextServer = serverProcess;

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        started = true;
        resolve(); // resolve anyway after timeout
      }
    }, 15000);

    serverProcess.stdout.on("data", (data) => {
      const output = data.toString();
      console.log("[Next.js]", output);
      if (!started && (output.includes("Ready") || output.includes("ready") || output.includes(`localhost:${PORT}`) || output.includes("started"))) {
        started = true;
        clearTimeout(timeout);
        // Give it a moment to fully initialize
        setTimeout(resolve, 1500);
      }
    });

    serverProcess.stderr.on("data", (data) => {
      const output = data.toString();
      console.error("[Next.js]", output);
      // Next.js sometimes prints ready message to stderr
      if (!started && (output.includes("Ready") || output.includes("ready") || output.includes(`localhost:${PORT}`))) {
        started = true;
        clearTimeout(timeout);
        setTimeout(resolve, 1500);
      }
    });

    serverProcess.on("error", (err) => {
      console.error("Failed to start Next.js:", err);
      if (!started) {
        started = true;
        reject(err);
      }
    });

    serverProcess.on("exit", (code) => {
      console.log(`Next.js server exited with code ${code}`);
      if (!started) {
        started = true;
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

app.whenReady().then(async () => {
  // Register global shortcut to summon JARVIS
  globalShortcut.register("CommandOrControl+Shift+J", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });

  console.log("🚀 Starting J.A.R.V.I.S. ...");
  console.log("🔄 Launching Next.js server...");

  try {
    await startNextServer();
    console.log("✅ Next.js server ready");
  } catch (err) {
    console.error("⚠️  Could not confirm server start, trying anyway...", err);
  }

  createWindow();
  createTray();

  // Start background clap detection
  if (clapDetectionEnabled) {
    createClapListener();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();

  // Close clap listener
  if (clapWindow) {
    clapWindow.close();
    clapWindow = null;
  }

  // Kill the Next.js server
  if (nextServer) {
    console.log("🛑 Shutting down Next.js server...");
    nextServer.kill("SIGTERM");
    nextServer = null;
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep running in tray (clap detection stays active)
  if (process.platform !== "darwin") {
    app.quit();
  }
});
