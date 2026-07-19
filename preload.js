const { contextBridge, ipcRenderer } = require("electron");

// Expose platform so the renderer/CSS can apply OS-native styling (macOS liquid glass)
contextBridge.exposeInMainWorld("platformApi", { os: process.platform });

// Tag <html> with the platform as early as possible for CSS scoping
window.addEventListener("DOMContentLoaded", () => {
    document.documentElement.setAttribute("data-platform", process.platform);
});

contextBridge.exposeInMainWorld("dbApi", {
    // Load the database from disk
    load: () => ipcRenderer.invoke("db:load"),

    // Save the database to disk
    save: (data) => ipcRenderer.invoke("db:save", data),

    // Export database via native save dialog
    exportDb: (data) => ipcRenderer.invoke("db:export", data),

    // Import database via native open dialog
    importDb: () => ipcRenderer.invoke("db:import"),

    // Get the path where the db is stored
    getDbPath: () => ipcRenderer.invoke("db:getPath"),

    // Save an image file, returns { success, filename }
    saveImage: (filename, buffer) => ipcRenderer.invoke("image:save", filename, buffer),

    // Delete an image file by name
    deleteImage: (filename) => ipcRenderer.invoke("image:delete", filename),

    // Load settings from settings.json
    loadSettings: () => ipcRenderer.invoke("settings:load"),

    // Save settings to settings.json
    saveSettings: (data) => ipcRenderer.invoke("settings:save", data),

    // Export database with images bundled as base64
    exportBundled: (data) => ipcRenderer.invoke("db:exportBundled", data),

    // List backup files
    listBackups: () => ipcRenderer.invoke("backup:list"),

    // Restore a backup by slot (1-3)
    restoreBackup: (slot) => ipcRenderer.invoke("backup:restore", slot),
});

contextBridge.exposeInMainWorld("winApi", {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onMaximizeChanged: (cb) => ipcRenderer.on("window:maximizeChanged", (_e, val) => cb(val)),
});
