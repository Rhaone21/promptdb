const { app, BrowserWindow, ipcMain, dialog, protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

// Register custom scheme before app is ready (required by Electron)
protocol.registerSchemesAsPrivileged([
    { scheme: "promptdb", privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

// Data directory: next to exe when packaged (portable), or in project/data when dev
function getDataDir() {
    if (app.isPackaged) {
        // electron-builder sets PORTABLE_EXECUTABLE_DIR for portable builds
        // This points to the actual folder where the .exe is located
        const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
        if (portableDir) return path.join(portableDir, "data");
        // macOS: keep data outside the .app bundle (app bundle is read-only / replaced on update)
        if (process.platform === "darwin") return path.join(app.getPath("userData"), "data");
        // Fallback (non-portable packaged builds)
        return path.join(path.dirname(process.execPath), "data");
    } else {
        return path.join(__dirname, "data");
    }
}

function getDbPath() {
    return path.join(getDataDir(), "db.json");
}

function getBackupDir() {
    return path.join(getDataDir(), "backups");
}

// One-time migration: copy data from old %APPDATA% location to new portable location
async function migrateFromAppData(dbPath) {
    try {
        await fsp.access(dbPath);
        return false; // new path already exists, no migration needed
    } catch (e) {
        if (e.code !== "ENOENT") return false;
    }

    const oldPath = path.join(app.getPath("userData"), "db.json");
    try {
        await fsp.access(oldPath);
        await fsp.mkdir(path.dirname(dbPath), { recursive: true });
        await fsp.copyFile(oldPath, dbPath);
        console.log("Migrated database from", oldPath, "to", dbPath);
        return true; // migration happened
    } catch (_) {
        return false; // no old data either, fresh start
    }
}

// Load database from file (async)
async function loadDatabase() {
    const dbPath = getDbPath();
    let migrated = false;
    if (app.isPackaged) {
        migrated = await migrateFromAppData(dbPath);
    }
    try {
        await fsp.access(dbPath);
        const raw = await fsp.readFile(dbPath, "utf-8");
        const data = JSON.parse(raw);
        if (migrated) data._migrated = true; // signal renderer to show toast
        return data;
    } catch (e) {
        if (e.code !== "ENOENT") console.error("Failed to load database:", e);
        return null;
    }
}

// ---- Settings (separate file) ----
function getSettingsPath() {
    return path.join(getDataDir(), "settings.json");
}

async function loadSettings() {
    try {
        const raw = await fsp.readFile(getSettingsPath(), "utf-8");
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

async function saveSettings(data) {
    try {
        await fsp.mkdir(getDataDir(), { recursive: true });
        await fsp.writeFile(getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Save database to file (async)
async function saveDatabase(data) {
    const dbPath = getDbPath();
    try {
        await fsp.mkdir(path.dirname(dbPath), { recursive: true });
        await fsp.writeFile(dbPath, JSON.stringify(data, null, 2), "utf-8");
        return { success: true, path: dbPath };
    } catch (e) {
        console.error("Failed to save database:", e);
        return { success: false, error: e.message };
    }
}

// Debounced backup: only run backup at most once every 30 seconds
let backupTimer = null;
let pendingBackupData = null;

function scheduleBackup(data) {
    pendingBackupData = data;
    if (backupTimer) return; // already scheduled
    backupTimer = setTimeout(async () => {
        backupTimer = null;
        if (pendingBackupData) {
            await rotateBackups(pendingBackupData);
            pendingBackupData = null;
        }
    }, 30000); // 30 seconds debounce
}

// Auto-backup: rotate up to 3 backups (async)
async function rotateBackups(data) {
    try {
        const backupDir = getBackupDir();
        await fsp.mkdir(backupDir, { recursive: true });

        // Shift existing backups: 2->3, 1->2
        for (let i = 3; i >= 2; i--) {
            const curr = path.join(backupDir, `backup_${i - 1}.json`);
            const next = path.join(backupDir, `backup_${i}.json`);
            try {
                await fsp.access(curr);
                await fsp.copyFile(curr, next);
            } catch (_) { /* file doesn't exist, skip */ }
        }
        // Write new backup as backup_1
        const backupPath = path.join(backupDir, "backup_1.json");
        await fsp.writeFile(backupPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
        console.error("Backup rotation failed:", e);
    }
}

let mainWindow;

function createWindow() {
    const isMac = process.platform === "darwin";

    const winOptions = {
        width: 1200,
        height: 800,
        minWidth: 620,
        minHeight: 480,
        title: "PromptDB",
        icon: path.join(__dirname, 'icons', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    };

    if (isMac) {
        // Native macOS "liquid glass": vibrancy lets the desktop blur through
        // translucent panels. Use native traffic lights inset into our custom titlebar.
        winOptions.titleBarStyle = "hiddenInset";
        winOptions.trafficLightPosition = { x: 14, y: 12 };
        winOptions.vibrancy = "under-window";
        winOptions.visualEffectState = "active";
        winOptions.transparent = true;
        winOptions.backgroundColor = "#00000000";
    } else {
        winOptions.frame = false;
        winOptions.transparent = false;
        winOptions.backgroundColor = "#0d0b14";
        winOptions.backgroundMaterial = "none";
    }

    mainWindow = new BrowserWindow(winOptions);

    mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
    // Serve local images via promptdb:// custom protocol
    protocol.handle("promptdb", async (request) => {
        const url = new URL(request.url);
        const filename = path.basename(decodeURIComponent(url.pathname));
        const filePath = path.join(getDataDir(), "images", filename);
        try {
            const data = await fsp.readFile(filePath);
            const ext = path.extname(filename).toLowerCase().slice(1);
            const mimeTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
            return new Response(data, { headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" } });
        } catch (_) {
            return new Response("Not found", { status: 404 });
        }
    });

    createWindow();

    // ---- IPC Handlers ----

    // Window controls
    ipcMain.handle("window:minimize", () => mainWindow.minimize());
    ipcMain.handle("window:maximize", () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.handle("window:close", () => mainWindow.close());
    ipcMain.handle("window:isMaximized", () => mainWindow.isMaximized());

    mainWindow.on("maximize", () => mainWindow.webContents.send("window:maximizeChanged", true));
    mainWindow.on("unmaximize", () => mainWindow.webContents.send("window:maximizeChanged", false));

    // Load database
    ipcMain.handle("db:load", async () => {
        return await loadDatabase();
    });

    // Save database
    ipcMain.handle("db:save", async (_event, data) => {
        const result = await saveDatabase(data);
        // Schedule debounced backup instead of immediate
        if (data && data.settings && data.settings.autoBackup) {
            scheduleBackup(data);
        }
        return result;
    });

    // Export database with images bundled as base64
    ipcMain.handle("db:exportBundled", async (_event, data) => {
        const today = new Date();
        const dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
        const result = await dialog.showSaveDialog(mainWindow, {
            title: "Export Database (dengan gambar)",
            defaultPath: `prompt-db-full_${dateStr}.json`,
            filters: [{ name: "JSON Files", extensions: ["json"] }],
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };

        try {
            // Embed local images as base64 into export
            const imagesDir = path.join(getDataDir(), "images");
            const exportData = JSON.parse(JSON.stringify(data)); // deep clone
            for (const p of (exportData.prompts || [])) {
                if (p.imageUrl && p.imageUrl.startsWith("img::")) {
                    const filename = p.imageUrl.slice(5);
                    try {
                        const imgBuf = await fsp.readFile(path.join(imagesDir, filename));
                        const ext = path.extname(filename).slice(1) || "jpeg";
                        p.imageUrl = `data:image/${ext};base64,` + imgBuf.toString("base64");
                    } catch (_) { /* image missing, skip */ }
                }
            }
            await fsp.writeFile(result.filePath, JSON.stringify(exportData, null, 2), "utf-8");
            return { success: true, path: result.filePath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Export database via native save dialog
    ipcMain.handle("db:export", async (_event, data) => {
        const today = new Date();
        const dateStr =
            today.getFullYear() +
            "-" +
            String(today.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(today.getDate()).padStart(2, "0");

        const result = await dialog.showSaveDialog(mainWindow, {
            title: "Export Database",
            defaultPath: `prompt-db_${dateStr}.json`,
            filters: [{ name: "JSON Files", extensions: ["json"] }],
        });

        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }

        try {
            await fsp.writeFile(result.filePath, JSON.stringify(data, null, 2), "utf-8");
            return { success: true, path: result.filePath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Import database via native open dialog
    ipcMain.handle("db:import", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Import Database",
            filters: [{ name: "JSON Files", extensions: ["json"] }],
            properties: ["openFile"],
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }

        try {
            let text = await fsp.readFile(result.filePaths[0], "utf-8");
            // Strip BOM if present
            if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
            const data = JSON.parse(text);
            return { success: true, data, path: result.filePaths[0] };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Get the database file path (for display)
    ipcMain.handle("db:getPath", () => {
        return getDbPath();
    });

    // Load settings
    ipcMain.handle("settings:load", async () => {
        return await loadSettings();
    });

    // Save settings
    ipcMain.handle("settings:save", async (_event, data) => {
        return await saveSettings(data);
    });

    // List available backup files
    ipcMain.handle("backup:list", async () => {
        const backupDir = getBackupDir();
        const results = [];
        for (let i = 1; i <= 3; i++) {
            const filePath = path.join(backupDir, `backup_${i}.json`);
            try {
                const stat = await fsp.stat(filePath);
                results.push({ slot: i, path: filePath, mtime: stat.mtime.toISOString(), size: stat.size });
            } catch (_) { /* backup doesn't exist */ }
        }
        return results;
    });

    // Restore a backup by slot number
    ipcMain.handle("backup:restore", async (_event, slot) => {
        const backupPath = path.join(getBackupDir(), `backup_${slot}.json`);
        try {
            const raw = await fsp.readFile(backupPath, "utf-8");
            const data = JSON.parse(raw);
            // Save backup as current db
            await fsp.writeFile(getDbPath(), JSON.stringify(data, null, 2), "utf-8");
            return { success: true, data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Save an image file to the images directory, return filename
    ipcMain.handle("image:save", async (_event, filename, buffer) => {
        try {
            const imagesDir = path.join(getDataDir(), "images");
            await fsp.mkdir(imagesDir, { recursive: true });
            const safeName = path.basename(filename);
            const filePath = path.join(imagesDir, safeName);
            await fsp.writeFile(filePath, Buffer.from(buffer));
            return { success: true, filename: safeName };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Delete an image file from the images directory
    ipcMain.handle("image:delete", async (_event, filename) => {
        try {
            const filePath = path.join(getDataDir(), "images", path.basename(filename));
            await fsp.unlink(filePath);
            return { success: true };
        } catch (_) {
            return { success: true }; // ignore if file doesn't exist
        }
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    // Flush pending backup before quitting
    if (pendingBackupData) {
        rotateBackups(pendingBackupData).finally(() => {
            if (process.platform !== "darwin") app.quit();
        });
    } else {
        if (process.platform !== "darwin") app.quit();
    }
});
