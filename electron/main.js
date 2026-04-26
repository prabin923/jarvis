const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let tray = null;
let nextServer = null;
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

function createTray() {
  // Create a simple tray icon (cyan circle)
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r="9" fill="#0a0a0f" stroke="#00d4ff" stroke-width="2"/>
        <circle cx="11" cy="11" r="4" fill="#00d4ff"/>
      </svg>`
    )
  );

  // Fallback: use a template image for macOS
  const trayIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setTitle("JARVIS");
  tray.setToolTip("J.A.R.V.I.S. — Advanced AI System");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open JARVIS",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
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
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
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
    }
  });

  console.log("🚀 Starting J.A.R.V.I.S. ...");
  console.log("🔄 Launching Next.js server...");

  try {
    await startNextServer();
    console.log("✅ Next.js server ready");
  } catch (err) {
    console.error("⚠️  Could not confirm server start, trying anyway...");
  }

  createWindow();
  createTray();
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

  // Kill the Next.js server
  if (nextServer) {
    console.log("🛑 Shutting down Next.js server...");
    nextServer.kill("SIGTERM");
    nextServer = null;
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep running in tray
  if (process.platform !== "darwin") {
    app.quit();
  }
});
