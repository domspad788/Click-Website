/* Electron main process — wraps the static dashboard in a desktop window. */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b1020",
    title: "Investment Dashboard",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));

  // Open external links (e.g. tickers in browser) in the user's default browser
  // rather than inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// macOS convention: keep the app running with no windows open until the user
// quits explicitly via Cmd+Q. Re-create a window on dock click.
app.whenReady().then(() => {
  createWindow();

  // Strip the default menu on Windows/Linux. macOS keeps its standard menu so
  // copy/paste/zoom shortcuts stay available.
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
