(async function () {
    // ---- Utilities ----

    function nowIso() { return new Date().toISOString(); }

    function formatDate(isoString) {
        const d = new Date(isoString);
        const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    function pad2(n) { return String(n).padStart(2, "0"); }
    function formatDateYYYYMMDD(d) {
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    function uuidV4() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        const bytes = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
    }

    function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

    function escapeHtml(s) {
        return String(s)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    // ---- Database Layer (File-based via IPC) ----

    function normalizeDb(db, options) {
        const allowCreateDefaults = options && options.allowCreateDefaults;
        const safeArray = (v) => Array.isArray(v) ? v : [];
        const safeString = (v) => typeof v === "string" ? v : "";

        const out = {
            prompts: safeArray(db.prompts).filter(x => x && typeof x === "object"),
            tags: safeArray(db.tags).filter(x => x && typeof x === "object"),
            folders: safeArray(db.folders).filter(x => x && typeof x === "object"),
            settings: (db.settings && typeof db.settings === "object") ? db.settings : {}
        };

        if (allowCreateDefaults) {
            if (!out.settings || typeof out.settings !== "object") out.settings = {};
            if (!["dark", "light", "oled"].includes(out.settings.theme)) out.settings.theme = "dark";
            if (typeof out.settings.autoBackup !== "boolean") out.settings.autoBackup = true;
        }

        const folderIds = new Set();
        out.folders = out.folders.map((f, index) => {
            const id = safeString(f.id) || uuidV4();
            folderIds.add(id);
            return {
                id,
                name: safeString(f.name) || ("Folder " + (index + 1)),
                icon: safeString(f.icon) || "📁",
                order: (typeof f.order === "number" ? f.order : index + 1)
            };
        });

        const tagIds = new Set();
        out.tags = out.tags.map((t, index) => {
            const id = safeString(t.id) || uuidV4();
            tagIds.add(id);
            return {
                id,
                name: safeString(t.name) || ("Tag " + (index + 1)),
                color: safeString(t.color) || "#1F8EF1"
            };
        });

        if (allowCreateDefaults && out.folders.length === 0) {
            const id = uuidV4();
            out.folders.push({ id, name: "Inbox", icon: "📥", order: 1 });
            folderIds.add(id);
        }

        const defaultFolderId = out.folders[0]?.id || "";

        out.prompts = out.prompts.map((p) => {
            const id = safeString(p.id) || uuidV4();
            const title = safeString(p.title);
            const content = safeString(p.content);
            const folderId = safeString(p.folderId);
            const tags = safeArray(p.tags).map(x => safeString(x)).filter(Boolean);
            const normalizedTags = tags.filter(tid => tagIds.has(tid));
            const normalizedFolderId = folderIds.has(folderId) ? folderId : defaultFolderId;
            const createdAt = safeString(p.createdAt) || nowIso();
            const updatedAt = safeString(p.updatedAt) || createdAt;

            return {
                id, title, content,
                tags: normalizedTags,
                folderId: normalizedFolderId,
                imageUrl: safeString(p.imageUrl),
                pinned: p.pinned === true,
                createdAt, updatedAt
            };
        });

        out.prompts = out.prompts.filter(p => p && typeof p.id === "string" && p.id.length > 0);
        out.folders.sort((a, b) => (a.order - b.order));
        return out;
    }

    function seedDb() {
        const folders = [
            { id: uuidV4(), name: "Inbox", icon: "📥", order: 1 },
            { id: uuidV4(), name: "Kerja", icon: "💼", order: 2 },
            { id: uuidV4(), name: "Belajar", icon: "📚", order: 3 },
            { id: uuidV4(), name: "Arsip", icon: "🗂️", order: 4 },
        ];

        const tags = [
            { id: uuidV4(), name: "Ringkas", color: "#1F8EF1" },
            { id: uuidV4(), name: "Kreatif", color: "#9B59B6" },
            { id: uuidV4(), name: "Coding", color: "#2ECC71" },
            { id: uuidV4(), name: "Email", color: "#F39C12" },
            { id: uuidV4(), name: "Analisis", color: "#E67E22" },
            { id: uuidV4(), name: "Indonesia", color: "#E74C3C" },
        ];

        const byTag = Object.fromEntries(tags.map(t => [t.name, t.id]));
        const byFolder = Object.fromEntries(folders.map(f => [f.name, f.id]));
        const t0 = nowIso();

        const prompts = [
            {
                id: uuidV4(),
                title: "Email follow-up setelah interview",
                content: "Tulis email follow-up yang sopan setelah interview kerja. Nada: profesional, hangat. Sertakan ucapan terima kasih dan ringkasan singkat ketertarikan terhadap posisi.",
                tags: [byTag["Email"], byTag["Indonesia"]],
                folderId: byFolder["Kerja"],
                imageUrl: "", createdAt: t0, updatedAt: t0
            },
            {
                id: uuidV4(),
                title: "Ringkas artikel jadi poin penting",
                content: "Ringkas teks berikut menjadi 5 poin utama. Gunakan bahasa Indonesia yang jelas. Tampilkan juga 2 implikasi praktis dari poin-poin tersebut.",
                tags: [byTag["Ringkas"], byTag["Analisis"], byTag["Indonesia"]],
                folderId: byFolder["Belajar"],
                imageUrl: "", createdAt: t0, updatedAt: t0
            },
            {
                id: uuidV4(),
                title: "Buat ide konten kreatif 7 hari",
                content: "Buat 7 ide konten harian untuk topik: produktivitas. Setiap ide harus punya hook 1 kalimat, outline 3 bullet, dan CTA. Target audiens: pekerja kantor.",
                tags: [byTag["Kreatif"], byTag["Indonesia"]],
                folderId: byFolder["Inbox"],
                imageUrl: "", createdAt: t0, updatedAt: t0
            },
            {
                id: uuidV4(),
                title: "Refactor kode: cek kualitas",
                content: "Berperan sebagai reviewer. Beri saran refactor, naming, dan potensi bug. Jelaskan trade-off dan dampak ke maintainability. Sertakan contoh perbaikan.",
                tags: [byTag["Coding"], byTag["Analisis"]],
                folderId: byFolder["Kerja"],
                imageUrl: "", createdAt: t0, updatedAt: t0
            },
            {
                id: uuidV4(),
                title: "Template prompt: brainstorming fitur",
                content: "Brainstorm 10 fitur untuk aplikasi prompt database offline. Prioritaskan MVP, jelaskan value pengguna, dan risiko implementasi untuk tiap fitur.",
                tags: [byTag["Analisis"], byTag["Kreatif"]],
                folderId: byFolder["Belajar"],
                imageUrl: "", createdAt: t0, updatedAt: t0
            },
            {
                id: uuidV4(),
                title: "Prompt kosong (contoh gambar)",
                content: "Isi prompt ini bebas. Kamu bisa menambah gambar via upload agar tetap offline.",
                tags: [byTag["Indonesia"]],
                folderId: byFolder["Inbox"],
                imageUrl: "", createdAt: t0, updatedAt: t0
            }
        ];

        return normalizeDb({
            prompts, tags, folders,
            settings: { theme: "dark", autoBackup: true }
        }, { allowCreateDefaults: true });
    }

    async function loadDb() {
        const raw = await window.dbApi.load();
        if (raw && typeof raw === "object") {
            const migrated = raw._migrated;
            delete raw._migrated;
            const normalized = normalizeDb(raw, { allowCreateDefaults: true });
            if (migrated) {
                // Show migration toast after DOM is ready
                setTimeout(() => showToast("Data Dimigrate", "Data lama ditemukan dan berhasil dipindahkan ke lokasi portable.", "success", 5000), 500);
            }
            return normalized;
        }
        // First run: seed with defaults
        const seeded = seedDb();
        await window.dbApi.save(seeded);
        return seeded;
    }

    async function saveDb(dbData, options) {
        const normalized = normalizeDb(dbData, { allowCreateDefaults: true });
        await window.dbApi.save(normalized);
        return normalized;
    }

    // ---- Initialize DB & Settings ----
    let db = await loadDb();

    // Load settings from settings.json, fall back to db.settings for migration
    async function loadAppSettings() {
        const fromFile = await window.dbApi.loadSettings();
        if (fromFile && typeof fromFile === "object") return fromFile;
        // Migrate from db.settings
        const migrated = db.settings || {};
        await window.dbApi.saveSettings(migrated);
        return migrated;
    }

    async function saveAppSettings(s) {
        await window.dbApi.saveSettings(s);
    }

    let appSettings = await loadAppSettings();
    if (!appSettings.theme || !["dark", "light", "oled"].includes(appSettings.theme)) appSettings.theme = "dark";
    if (typeof appSettings.autoBackup !== "boolean") appSettings.autoBackup = true;

    // ---- UI State ----
    let state = {
        selectedFolderId: "ALL",
        selectedTagIds: new Set(),
        tagFilterMode: "AND",
        searchQuery: "",
        sortOrder: "updatedDesc",
        selectMode: false,
        selectedPromptIds: new Set(),
        editingPromptId: null,
        editingTagId: null,
        editingFolderId: null,
        viewMode: "grid", // "grid" | "list"
    };

    // ---- Elements ----
    const root = document.getElementById("root");
    const folderListEl = document.getElementById("folderList");
    const tagFilterBarEl = document.getElementById("tagFilterBar");
    const promptGridEl = document.getElementById("promptGrid");
    const emptyStateEl = document.getElementById("emptyState");
    const gridTitleEl = document.getElementById("gridTitle");
    const gridSubtitleEl = document.getElementById("gridSubtitle");
    const dbPathHintEl = document.getElementById("dbPathHint");

    const searchInputEl = document.getElementById("searchInput");
    const clearSearchButtonEl = document.getElementById("clearSearchButton");

    const exportButtonEl = document.getElementById("exportButton");
    const exportBundledButtonEl = document.getElementById("exportBundledButton");
    const importButtonEl = document.getElementById("importButton");
    const restoreBackupButtonEl = document.getElementById("restoreBackupButton");

    const fabButtonEl = document.getElementById("fabButton");

    // Prompt Modal
    const promptModalOverlayEl = document.getElementById("promptModalOverlay");
    const promptModalTitleEl = document.getElementById("promptModalTitle");
    const closePromptModalEl = document.getElementById("closePromptModal");
    const cancelPromptButtonEl = document.getElementById("cancelPromptButton");
    const savePromptButtonEl = document.getElementById("savePromptButton");
    const deletePromptButtonEl = document.getElementById("deletePromptButton");
    const duplicatePromptButtonEl = document.getElementById("duplicatePromptButton");
    const promptModalMetaEl = document.getElementById("promptModalMeta");
    const promptTitleInputEl = document.getElementById("promptTitleInput");
    const promptContentInputEl = document.getElementById("promptContentInput");
    const contentCounterEl = document.getElementById("contentCounter");
    const promptFolderSelectEl = document.getElementById("promptFolderSelect");
    const promptImageUrlInputEl = document.getElementById("promptImageUrlInput");
    const promptImageUploadEl = document.getElementById("promptImageUpload");
    const clearImageButtonEl = document.getElementById("clearImageButton");
    const imagePreviewBlockEl = document.getElementById("imagePreviewBlock");
    const imagePreviewThumbEl = document.getElementById("imagePreviewThumb");
    const imagePreviewNameEl = document.getElementById("imagePreviewName");
    const imageUploadBlockEl = document.getElementById("imageUploadBlock");
    const promptTagSelectorEl = document.getElementById("promptTagSelector");

    function updateImagePreview() {
        const url = promptImageUrlInputEl.value;
        if (url && url.startsWith("img::")) {
            const filename = url.slice(5);
            const short = filename.length > 24 ? filename.slice(0, 10) + "…" + filename.slice(-10) : filename;
            imagePreviewThumbEl.src = resolveImageUrl(url);
            imagePreviewNameEl.textContent = short;
            imagePreviewBlockEl.style.display = "flex";
            imageUploadBlockEl.style.display = "none";
        } else {
            imagePreviewBlockEl.style.display = "none";
            imageUploadBlockEl.style.display = "block";
        }
    }

    // Tag Modal
    const tagModalOverlayEl = document.getElementById("tagModalOverlay");
    const newPromptButtonEl = document.getElementById("newPromptButton");
    const selectModeButtonEl = document.getElementById("selectModeButton");
    const bulkActionBarEl = document.getElementById("bulkActionBar");
    const bulkCountEl = document.getElementById("bulkCount");
    const bulkSelectAllButtonEl = document.getElementById("bulkSelectAllButton");
    const bulkMoveSelectEl = document.getElementById("bulkMoveSelect");
    const bulkDeleteButtonEl = document.getElementById("bulkDeleteButton");
    const bulkCancelButtonEl = document.getElementById("bulkCancelButton");
    const closeTagModalEl = document.getElementById("closeTagModal");
    const closeTagModal2El = document.getElementById("closeTagModal2");
    const tagNameInputEl = document.getElementById("tagNameInput");
    const tagColorInputEl = document.getElementById("tagColorInput");
    const addOrUpdateTagButtonEl = document.getElementById("addOrUpdateTagButton");
    const resetTagFormButtonEl = document.getElementById("resetTagFormButton");
    const tagListEl = document.getElementById("tagList");

    // Folder Modal
    const folderModalOverlayEl = document.getElementById("folderModalOverlay");
    const folderModalTitleEl = document.getElementById("folderModalTitle");
    const closeFolderModalEl = document.getElementById("closeFolderModal");
    const cancelFolderButtonEl = document.getElementById("cancelFolderButton");
    const saveFolderButtonEl = document.getElementById("saveFolderButton");
    const deleteFolderButtonEl = document.getElementById("deleteFolderButton");
    const folderModalMetaEl = document.getElementById("folderModalMeta");
    const folderNameInputEl = document.getElementById("folderNameInput");
    const folderIconInputEl = document.getElementById("folderIconInput");
    const addFolderButtonEl = document.getElementById("addFolderButton");

    const themeToggleEl = document.getElementById("themeToggle");
    const autoBackupToggleEl = document.getElementById("autoBackupToggle");
    const toastHostEl = document.getElementById("toastHost");

    // View toggle
    const viewGridBtn = document.getElementById("viewGrid");
    const viewListBtn = document.getElementById("viewList");

    // Titlebar controls
    const btnMinimize = document.getElementById("btnMinimize");
    const btnMaximize = document.getElementById("btnMaximize");
    const btnClose = document.getElementById("btnClose");

    // ---- Modal helpers ----
    function openModal(overlayEl) {
        overlayEl._returnFocus = document.activeElement;
        overlayEl.classList.add("open");
        overlayEl.setAttribute("aria-hidden", "false");
        // Focus first form input in body (skip header buttons)
        const firstInput = overlayEl.querySelector('.modalBody input:not([type="hidden"]):not(.hiddenFileInput), .modalBody textarea, .modalBody select');
        if (firstInput) requestAnimationFrame(() => firstInput.focus());
    }

    function closeModal(overlayEl) {
        overlayEl.classList.remove("open");
        overlayEl.setAttribute("aria-hidden", "true");
        if (overlayEl._returnFocus && typeof overlayEl._returnFocus.focus === "function") {
            overlayEl._returnFocus.focus();
        }
        overlayEl._returnFocus = null;
    }

    // ---- Helpers ----
    function getFolderById(id) { return db.folders.find(f => f.id === id) || null; }
    function getTagById(id) { return db.tags.find(t => t.id === id) || null; }

    function getSelectedFolderName() {
        if (state.selectedFolderId === "ALL") return "Semua Prompt";
        const f = getFolderById(state.selectedFolderId);
        return f ? (f.icon + " " + f.name) : "Folder";
    }

    const themeIcons = {
        dark: ICO.ico('moon', 16),
        light: ICO.ico('sun', 16),
        oled: ICO.ico('oled', 16)
    };
    function setTheme(theme) {
        appSettings.theme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        root.setAttribute("data-theme", theme);
        themeToggleEl.innerHTML = themeIcons[theme] || ICO.ico('moon', 16);
        themeToggleEl.title = `Tema: ${theme} (klik untuk ganti)`;
        saveAppSettings(appSettings);
    }

    function setAutoBackup(enabled) {
        appSettings.autoBackup = !!enabled;
        autoBackupToggleEl.classList.toggle("on", !!enabled);
        saveAppSettings(appSettings);
    }

    function showToast(title, text, type = "success", duration = 3000) {
        const id = "t_" + Date.now() + Math.floor(Math.random() * 1000);
        const el = document.createElement("div");
        el.className = "toast " + type;
        el.id = id;
        el.innerHTML = `
      <div class="toastBody">
        <div class="toastTitle">${escapeHtml(title)}</div>
        <div class="toastText">${escapeHtml(text)}</div>
      </div>
      <div class="toastActions">
        <button class="toastButton" onclick="document.getElementById('${id}').remove()">OK</button>
      </div>
    `;
        toastHostEl.appendChild(el);
        if (duration > 0) setTimeout(() => { if (document.getElementById(id)) document.getElementById(id).remove(); }, duration);
    }

    // ---- Sidebar Rendering ----
    function renderSidebar() {
        const foldersSorted = [...db.folders].sort((a, b) => a.order - b.order);
        const allActive = state.selectedFolderId === "ALL";
        let html = "";

        const countAll = db.prompts.length;
        html += renderFolderRow({ id: "ALL", name: "All Prompts", icon: "🗂️", order: -Infinity }, { isAll: true, active: allActive, count: countAll });
        for (const f of foldersSorted) {
            const count = db.prompts.filter(p => p.folderId === f.id).length;
            html += renderFolderRow(f, { isAll: false, active: state.selectedFolderId === f.id, count });
        }
        folderListEl.innerHTML = html;

        // Click handlers
        const items = folderListEl.querySelectorAll("[data-folder-id]");
        items.forEach(el => {
            el.addEventListener("click", (ev) => {
                if (ev.target && ev.target.closest && ev.target.closest("[data-folder-action]")) return;
                state.selectedFolderId = el.getAttribute("data-folder-id");
                renderAll();
            });

            el.addEventListener("dragover", (ev) => { ev.preventDefault(); el.classList.add("dropTarget"); });
            el.addEventListener("dragleave", () => el.classList.remove("dropTarget"));
            el.addEventListener("drop", (ev) => {
                ev.preventDefault();
                el.classList.remove("dropTarget");
                const promptId = ev.dataTransfer.getData("text/prompt-id");
                const targetFolderId = el.getAttribute("data-folder-id");
                if (!promptId || targetFolderId === "ALL") return;
                movePromptToFolder(promptId, targetFolderId);
            });
        });

        // Folder reorder drag
        let draggingFolderId = null;
        folderListEl.querySelectorAll("[data-folder-draggable='1']").forEach(el => {
            el.addEventListener("dragstart", ev => {
                const fid = el.getAttribute("data-folder-id");
                // Only start folder drag when dragging from handle or folder item itself (not a prompt drag)
                draggingFolderId = fid;
                ev.dataTransfer.setData("text/folder-id", fid);
                ev.dataTransfer.effectAllowed = "move";
                el.classList.add("dragging");
            });
            el.addEventListener("dragend", () => { el.classList.remove("dragging"); draggingFolderId = null; });
            el.addEventListener("dragover", ev => {
                if (!draggingFolderId) return; // ignore prompt drags
                ev.preventDefault();
                el.classList.add("folderDropTarget");
            });
            el.addEventListener("dragleave", () => el.classList.remove("folderDropTarget"));
            el.addEventListener("drop", async ev => {
                el.classList.remove("folderDropTarget");
                const fromId = ev.dataTransfer.getData("text/folder-id");
                const toId = el.getAttribute("data-folder-id");
                if (!fromId || fromId === toId) return;
                ev.stopPropagation(); // prevent prompt-drop handler
                const fromFolder = db.folders.find(f => f.id === fromId);
                const toFolder = db.folders.find(f => f.id === toId);
                if (!fromFolder || !toFolder) return;
                // Swap order values
                const tmp = fromFolder.order;
                fromFolder.order = toFolder.order;
                toFolder.order = tmp;
                db.folders.sort((a, b) => a.order - b.order);
                // Reassign order 1..n to keep clean
                db.folders.forEach((f, i) => { f.order = i + 1; });
                db = await saveDb(db, { reason: "reorderFolder" });
                renderSidebar();
            });
        });

        folderListEl.querySelectorAll("[data-folder-action='edit']").forEach(btn => {
            btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openFolderModal(btn.getAttribute("data-folder-id")); });
        });
        folderListEl.querySelectorAll("[data-folder-action='delete']").forEach(btn => {
            btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); confirmDeleteFolder(btn.getAttribute("data-folder-id")); });
        });
    }

    function renderFolderRow(folder, opts) {
        const activeClass = opts.active ? "active" : "";
        const actionHtml = opts.isAll ? "" : `
      <div class="folderActions">
        <div class="miniButton" data-folder-action="edit" data-folder-id="${escapeHtml(folder.id)}" title="Edit folder">${ICO.ico('edit', 14)}</div>
        <div class="miniButton" data-folder-action="delete" data-folder-id="${escapeHtml(folder.id)}" title="Hapus folder">${ICO.ico('trash', 14)}</div>
      </div>
    `;
        const draggable = opts.isAll ? "" : `draggable="true" data-folder-draggable="1"`;
        const dragHandle = opts.isAll ? "" : `<div class="dragHandle" title="Seret untuk mengurutkan">${ICO.ico('menu', 14)}</div>`;
        return `
      <div class="folderItem ${activeClass}" data-folder-id="${escapeHtml(folder.id)}" title="${escapeHtml(folder.name)}" ${draggable}>
        ${dragHandle}
        <div class="folderIcon">${escapeHtml(folder.icon)}</div>
        <div class="folderMeta">
          <div class="folderName">${escapeHtml(folder.name)}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="folderCount">${opts.count}</span>
            ${actionHtml}
          </div>
        </div>
      </div>
    `;
    }

    // ---- Tag Filter Bar ----
    function renderTagFilterBar() {
        let html = "";
        const hasAny = state.selectedTagIds.size > 0;
        html += `<div class="chip ${hasAny ? "selected" : ""}" data-filter-clear="1" title="Klik untuk reset filter tag" style="display:flex;align-items:center;gap:5px;">${ICO.ico('tag', 14)} Filter Tag${hasAny ? " (" + state.selectedTagIds.size + ")" : ""}</div>`;

        for (const t of db.tags) {
            const selected = state.selectedTagIds.has(t.id);
            html += `
        <div class="chip ${selected ? "selected" : ""}" data-tag-filter="${escapeHtml(t.id)}" title="Klik untuk filter tag">
          <span class="chipDot" style="background:${escapeHtml(t.color)};"></span>
          <span>${escapeHtml(t.name)}</span>
        </div>
      `;
        }
        if (state.selectedTagIds.size > 1) {
            const mode = state.tagFilterMode;
            html += `<div class="chip chipToggle ${mode === "OR" ? "selected" : ""}" data-tag-mode="1" title="AND: harus punya semua tag | OR: cukup salah satu">${mode === "AND" ? "AND" : "OR"}</div>`;
        }
        html += `<div class="chip" data-open-tags="1" title="Kelola tag" style="display:flex;align-items:center;gap:5px;">${ICO.ico('setting', 14)} Kelola Tag</div>`;

        tagFilterBarEl.innerHTML = html;

        tagFilterBarEl.querySelectorAll("[data-tag-filter]").forEach(el => {
            el.addEventListener("click", () => {
                const tagId = el.getAttribute("data-tag-filter");
                if (state.selectedTagIds.has(tagId)) state.selectedTagIds.delete(tagId);
                else state.selectedTagIds.add(tagId);
                renderAll();
            });
        });

        const clearEl = tagFilterBarEl.querySelector("[data-filter-clear='1']");
        if (clearEl) {
            clearEl.addEventListener("click", () => {
                if (state.selectedTagIds.size > 0) { state.selectedTagIds.clear(); renderAll(); }
            });
        }

        const modeEl = tagFilterBarEl.querySelector("[data-tag-mode='1']");
        if (modeEl) modeEl.addEventListener("click", () => {
            state.tagFilterMode = state.tagFilterMode === "AND" ? "OR" : "AND";
            renderAll();
        });

        const manageEl = tagFilterBarEl.querySelector("[data-open-tags='1']");
        if (manageEl) manageEl.addEventListener("click", openTagModal);
    }

    // ---- Prompt Grid ----
    function renderPromptGrid() {
        const q = state.searchQuery.toLowerCase().trim();
        const fId = state.selectedFolderId;
        const sTags = state.selectedTagIds;

        let filtered = db.prompts.filter(p => {
            if (fId !== "ALL" && p.folderId !== fId) return false;
            if (q && !p.title.toLowerCase().includes(q) && !p.content.toLowerCase().includes(q)) return false;
            if (sTags.size > 0) {
                if (state.tagFilterMode === "AND") {
                    for (const tid of sTags) { if (!p.tags.includes(tid)) return false; }
                } else {
                    let match = false;
                    for (const tid of sTags) { if (p.tags.includes(tid)) { match = true; break; } }
                    if (!match) return false;
                }
            }
            return true;
        });

        const sortFns = {
            updatedDesc: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
            updatedAsc:  (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt),
            createdDesc: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
            createdAsc:  (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
            titleAsc:    (a, b) => a.title.localeCompare(b.title),
            titleDesc:   (a, b) => b.title.localeCompare(a.title),
        };
        filtered.sort(sortFns[state.sortOrder] || sortFns.updatedDesc);
        // Pinned prompts always on top
        filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

        if (filtered.length === 0) {
            promptGridEl.style.display = "none";
            emptyStateEl.style.display = "block";
            fabButtonEl.classList.add("pulse");
        } else {
            promptGridEl.style.display = "grid";
            promptGridEl.classList.toggle("listView", state.viewMode === "list");
            emptyStateEl.style.display = "none";
            fabButtonEl.classList.remove("pulse");

            let html = "";
            filtered.forEach((p, cardIndex) => {
                const folder = getFolderById(p.folderId);
                const folderName = folder ? folder.name : "Unknown";
                const tagsHtml = p.tags.map(tid => {
                    const t = getTagById(tid);
                    if (!t) return "";
                    return `<div class="tagChip tagChipFilter" data-filter-tag-id="${escapeHtml(tid)}" title="Filter tag: ${escapeHtml(t.name)}"><span class="chipDot" style="background:${escapeHtml(t.color)}"></span>${escapeHtml(t.name)}</div>`;
                }).join("");

                const imgHtml = p.imageUrl ? `<div class="cardImage"><img src="${escapeHtml(resolveImageUrl(p.imageUrl))}" /></div>` : "";

                const isSelected = state.selectedPromptIds.has(p.id);
                const checkboxHtml = state.selectMode
                    ? `<div class="cardCheckbox ${isSelected ? "checked" : ""}" data-prompt-action="select" data-prompt-id="${escapeHtml(p.id)}">
                         ${isSelected ? "✓" : ""}
                       </div>`
                    : "";
                html += `
          <div class="card ${isSelected ? "cardSelected" : ""}" draggable="${!state.selectMode}" data-prompt-id="${escapeHtml(p.id)}" style="--card-i:${Math.min(cardIndex, 8)}">
            ${checkboxHtml}
            ${imgHtml}
            <div class="cardBody">
              <div class="cardTopRow">
                <h3 class="cardTitle">${p.pinned ? `<span class="pinBadge" title="Dipin">${ICO.ico('bookmark', 13)}</span>` : ""}${highlightText(p.title, q)}</h3>
                <div class="cardActions">
                  <button class="miniButton" data-prompt-action="copy" data-prompt-id="${escapeHtml(p.id)}" title="Copy konten" aria-label="Copy konten">${ICO.ico('copy', 15)}</button>
                  <button class="miniButton cardMenuTrigger" data-prompt-action="menu" data-prompt-id="${escapeHtml(p.id)}" title="Opsi lainnya" aria-label="Opsi lainnya" aria-haspopup="true">•••</button>
                </div>
              </div>
              <div class="cardPreview">${highlightText(p.content.substring(0, 200), q)}${p.content.length > 200 ? "…" : ""}</div>
              ${tagsHtml ? `<div class="tagRow">${tagsHtml}</div>` : ""}
              <div style="margin-top:auto; font-size:12px; color:var(--text-secondary); display:flex; justify-content:space-between; align-items:center; padding-top:4px;">
                <span style="display:flex;align-items:center;gap:4px;">${ICO.ico('folder', 12)} ${escapeHtml(folderName)}</span>
                <span>${formatDate(p.updatedAt)}</span>
              </div>
            </div>
            <div class="cardMenu" data-card-menu="${escapeHtml(p.id)}">
              <button class="cardMenuItem" data-prompt-action="pin" data-prompt-id="${escapeHtml(p.id)}">${ICO.ico('bookmark', 15)}${p.pinned ? "Lepas Pin" : "Pin"}</button>
              <button class="cardMenuItem" data-prompt-action="edit" data-prompt-id="${escapeHtml(p.id)}">${ICO.ico('edit', 15)}Edit</button>
              <button class="cardMenuItem" data-prompt-action="duplicate" data-prompt-id="${escapeHtml(p.id)}">${ICO.ico('duplicate', 15)}Duplikat</button>
              <div class="cardMenuDivider"></div>
              <button class="cardMenuItem cardMenuItemDanger" data-prompt-action="delete" data-prompt-id="${escapeHtml(p.id)}">${ICO.ico('trash', 15)}Hapus</button>
            </div>
          </div>
        `;
            }); // end forEach
            promptGridEl.innerHTML = html;

            promptGridEl.querySelectorAll(".card").forEach(el => {
                el.addEventListener("dragstart", ev => {
                    ev.dataTransfer.setData("text/prompt-id", el.getAttribute("data-prompt-id"));
                    ev.dataTransfer.effectAllowed = "move";
                    el.classList.add("dragging");
                });
                el.addEventListener("dragend", () => el.classList.remove("dragging"));

                // 3D tilt on hover
                el.addEventListener("mouseenter", () => {
                    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
                    el.style.transition = "transform 80ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease";
                });
                el.addEventListener("mousemove", (ev) => {
                    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
                    if (el.classList.contains("dragging")) return;
                    const rect = el.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    const dx = (ev.clientX - cx) / (rect.width / 2);
                    const dy = (ev.clientY - cy) / (rect.height / 2);
                    el.style.transform = `perspective(700px) rotateX(${-dy * 3}deg) rotateY(${dx * 4}deg) translateY(-4px)`;
                });
                el.addEventListener("mouseleave", () => {
                    el.style.transition = "";
                    el.style.transform = "";
                });

                el.querySelectorAll("[data-filter-tag-id]").forEach(chip => {
                    chip.addEventListener("click", ev => {
                        ev.stopPropagation();
                        const tid = chip.getAttribute("data-filter-tag-id");
                        if (state.selectedTagIds.has(tid)) state.selectedTagIds.delete(tid);
                        else state.selectedTagIds.add(tid);
                        renderAll();
                    });
                });

                // Copy button (primary action)
                el.querySelector("[data-prompt-action='copy']").addEventListener("click", ev => {
                    ev.stopPropagation();
                    const pid = el.getAttribute("data-prompt-id");
                    const p = db.prompts.find(x => x.id === pid);
                    if (p) navigator.clipboard.writeText(p.content).then(() => showToast("Dicopy!", "Konten disalin ke clipboard.", "success"));
                });

                // "..." menu trigger
                el.querySelector("[data-prompt-action='menu']").addEventListener("click", ev => {
                    ev.stopPropagation();
                    const pid = el.getAttribute("data-prompt-id");
                    const menu = el.querySelector(`[data-card-menu="${pid}"]`);
                    const isOpen = menu.classList.contains("open");
                    // close all other menus first
                    document.querySelectorAll(".cardMenu.open").forEach(m => m.classList.remove("open"));
                    if (!isOpen) menu.classList.add("open");
                });

                // Menu item actions
                el.querySelectorAll(".cardMenuItem").forEach(btn => {
                    btn.addEventListener("click", async ev => {
                        ev.stopPropagation();
                        const action = btn.getAttribute("data-prompt-action");
                        const pid = btn.getAttribute("data-prompt-id");
                        const p = db.prompts.find(x => x.id === pid);
                        btn.closest(".cardMenu").classList.remove("open");
                        if (!p) return;
                        if (action === "pin") {
                            p.pinned = !p.pinned;
                            db = await saveDb(db, { reason: "pinPrompt" });
                            renderPromptGrid();
                        } else if (action === "edit") {
                            openPromptModal(pid);
                        } else if (action === "duplicate") {
                            const now = nowIso();
                            const copy = { ...p, id: uuidV4(), title: p.title + " (copy)", pinned: false, createdAt: now, updatedAt: now };
                            db.prompts.push(copy);
                            db = await saveDb(db, { reason: "duplicatePrompt" });
                            renderAll();
                            showToast("Diduplikat", `"${copy.title}" berhasil dibuat.`, "success");
                        } else if (action === "delete") {
                            const deleted = db.prompts.find(x => x.id === pid);
                            db.prompts = db.prompts.filter(x => x.id !== pid);
                            renderAll();
                            let undone = false;
                            const toastId = "t_" + Date.now();
                            const toastEl = document.createElement("div");
                            toastEl.className = "toast warning";
                            toastEl.id = toastId;
                            toastEl.innerHTML = `<div class="toastBody"><div class="toastTitle">Dihapus</div><div class="toastText">"${escapeHtml(deleted.title || "Tanpa judul")}"</div></div><div class="toastActions"><button class="toastButton" id="${toastId}_undo">Undo</button></div>`;
                            toastHostEl.appendChild(toastEl);
                            document.getElementById(toastId + "_undo").addEventListener("click", () => {
                                undone = true;
                                db.prompts.push(deleted);
                                renderAll();
                                toastEl.remove();
                            });
                            setTimeout(async () => {
                                toastEl.remove();
                                if (!undone) {
                                    if (deleted.imageUrl && deleted.imageUrl.startsWith("img::")) await window.dbApi.deleteImage(deleted.imageUrl.slice(5));
                                    db = await saveDb(db, { reason: "deletePrompt" });
                                }
                            }, 5000);
                        }
                    });
                });
                if (state.selectMode) {
                    const selectBtn = el.querySelector("[data-prompt-action='select']");
                    if (selectBtn) {
                        selectBtn.addEventListener("click", ev => {
                            ev.stopPropagation();
                            const pid = el.getAttribute("data-prompt-id");
                            if (state.selectedPromptIds.has(pid)) state.selectedPromptIds.delete(pid);
                            else state.selectedPromptIds.add(pid);
                            renderPromptGrid();
                        });
                    }
                    el.addEventListener("click", () => {
                        const pid = el.getAttribute("data-prompt-id");
                        if (state.selectedPromptIds.has(pid)) state.selectedPromptIds.delete(pid);
                        else state.selectedPromptIds.add(pid);
                        renderPromptGrid();
                    });
                } else {
                    el.addEventListener("click", () => openPromptModal(el.getAttribute("data-prompt-id")));
                }
            });
        }

        // Update bulk bar with entrance animation
        if (state.selectMode) {
            bulkActionBarEl.style.display = "flex";
            bulkActionBarEl.offsetHeight; // force reflow so animation replays
            bulkActionBarEl.classList.add("entering");
        } else {
            bulkActionBarEl.style.display = "none";
            bulkActionBarEl.classList.remove("entering");
        }
        if (state.selectMode) {
            bulkCountEl.textContent = `${state.selectedPromptIds.size} dipilih`;
            // Populate move-to select
            bulkMoveSelectEl.innerHTML = `<option value="">Pindah ke…</option>` +
                db.folders.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.icon + " " + f.name)}</option>`).join("");
        }
        selectModeButtonEl.classList.toggle("primary", state.selectMode);

        gridTitleEl.textContent = getSelectedFolderName();
        gridSubtitleEl.textContent = filtered.length;
    }

    async function movePromptToFolder(promptId, targetFolderId) {
        const p = db.prompts.find(x => x.id === promptId);
        if (p && p.folderId !== targetFolderId) {
            p.folderId = targetFolderId;
            p.updatedAt = nowIso();
            db = await saveDb(db, { reason: "movePrompt" });
            renderAll();
            showToast("Dipindahkan", "Prompt dipindah ke folder baru.", "success");
        }
    }

    function renderAll() {
        renderSidebar();
        renderTagFilterBar();
        renderPromptGrid();
    }

    // ---- Prompt Modal ----
    let promptModalSelectedTags = new Set();

    function openPromptModal(promptId = null) {
        state.editingPromptId = promptId;
        promptModalSelectedTags.clear();

        promptFolderSelectEl.innerHTML = db.folders.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.icon)} ${escapeHtml(f.name)}</option>`).join("");

        if (promptId) {
            const p = db.prompts.find(x => x.id === promptId);
            promptModalTitleEl.textContent = "Edit Prompt";
            promptTitleInputEl.value = p.title;
            promptContentInputEl.value = p.content;
            promptFolderSelectEl.value = p.folderId;
            promptImageUrlInputEl.value = p.imageUrl || "";
            p.tags.forEach(t => promptModalSelectedTags.add(t));
            deletePromptButtonEl.style.display = "block";
            duplicatePromptButtonEl.style.display = "block";
            promptModalMetaEl.textContent = `Dibuat: ${formatDate(p.createdAt)}`;
        } else {
            promptModalTitleEl.textContent = "Tambah Prompt";
            promptTitleInputEl.value = "";
            promptContentInputEl.value = "";
            promptFolderSelectEl.value = state.selectedFolderId === "ALL" ? (db.folders[0]?.id || "") : state.selectedFolderId;
            promptImageUrlInputEl.value = "";
            deletePromptButtonEl.style.display = "none";
            duplicatePromptButtonEl.style.display = "none";
            promptModalMetaEl.textContent = "Prompt baru belum disimpan.";
        }

        promptImageUploadEl.value = "";
        renderPromptModalTags();
        updateContentCounter();
        updateImagePreview();
        openModal(promptModalOverlayEl);
    }

    function renderPromptModalTags() {
        let html = "";
        for (const t of db.tags) {
            const sel = promptModalSelectedTags.has(t.id);
            html += `
        <div class="tagSelectable ${sel ? "selected" : ""}" data-tag-select="${escapeHtml(t.id)}">
          <span class="chipDot" style="background:${escapeHtml(t.color)}"></span>
          ${escapeHtml(t.name)}
        </div>
      `;
        }
        promptTagSelectorEl.innerHTML = html;
        promptTagSelectorEl.querySelectorAll("[data-tag-select]").forEach(el => {
            el.addEventListener("click", () => {
                const tid = el.getAttribute("data-tag-select");
                if (promptModalSelectedTags.has(tid)) promptModalSelectedTags.delete(tid);
                else promptModalSelectedTags.add(tid);
                renderPromptModalTags();
            });
        });
    }

    async function savePrompt() {
        const title = promptTitleInputEl.value.trim();
        const content = promptContentInputEl.value.trim();
        const folderId = promptFolderSelectEl.value;
        const imageUrl = promptImageUrlInputEl.value.trim();

        if (!title || !content) {
            showToast("Error", "Judul dan Isi tidak boleh kosong", "warning");
            return;
        }

        const tags = Array.from(promptModalSelectedTags);
        const tNow = nowIso();

        if (state.editingPromptId) {
            const p = db.prompts.find(x => x.id === state.editingPromptId);
            if (p) {
                // Delete old image file if it was replaced or removed
                if (p.imageUrl && p.imageUrl.startsWith("img::") && p.imageUrl !== imageUrl) {
                    window.dbApi.deleteImage(p.imageUrl.slice(5));
                }
                p.title = title; p.content = content; p.folderId = folderId;
                p.imageUrl = imageUrl; p.tags = tags; p.updatedAt = tNow;
            }
        } else {
            db.prompts.push({
                id: uuidV4(), title, content, folderId, imageUrl, tags,
                createdAt: tNow, updatedAt: tNow
            });
        }

        db = await saveDb(db, { reason: "savePrompt" });
        closeModal(promptModalOverlayEl);
        renderAll();
        showToast("Tersimpan", "Prompt berhasil disimpan.", "success");
    }

    async function deletePrompt() {
        if (!state.editingPromptId) return;
        const promptId = state.editingPromptId;
        const deleted = db.prompts.find(p => p.id === promptId);
        if (!deleted) return;

        // Remove from memory and close modal immediately
        db.prompts = db.prompts.filter(p => p.id !== promptId);
        closeModal(promptModalOverlayEl);
        renderAll();

        // Show toast with Undo button — delay actual save by 5s
        let undone = false;
        const toastId = "t_" + Date.now();
        const toastEl = document.createElement("div");
        toastEl.className = "toast warning";
        toastEl.id = toastId;
        toastEl.innerHTML = `
          <div class="toastBody">
            <div class="toastTitle">Prompt Dihapus</div>
            <div class="toastText">"${escapeHtml(deleted.title || "Tanpa judul")}"</div>
          </div>
          <div class="toastActions">
            <button class="toastButton" id="${toastId}_undo">Undo</button>
          </div>
        `;
        toastHostEl.appendChild(toastEl);

        document.getElementById(toastId + "_undo").addEventListener("click", () => {
            undone = true;
            db.prompts.push(deleted);
            db.prompts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderAll();
            toastEl.remove();
            showToast("Dibatalkan", "Prompt dipulihkan.", "success");
        });

        setTimeout(async () => {
            if (undone) return;
            toastEl.remove();
            // Delete associated image file if stored locally
            if (deleted.imageUrl && deleted.imageUrl.startsWith("img::")) {
                await window.dbApi.deleteImage(deleted.imageUrl.slice(5));
            }
            db = await saveDb(db, { reason: "deletePrompt" });
        }, 5000);
    }

    // Convert imageUrl stored in db to a displayable src
    // img::filename.jpg → promptdb://images/filename.jpg
    // data:... or http:// → returned as-is (legacy / external)
    // Wrap matched query terms in <mark> for search highlight
    function highlightText(text, query) {
        if (!query) return escapeHtml(text);
        const escapedText = escapeHtml(text);
        const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return escapedText.replace(new RegExp(escapedQuery, "gi"),
            match => `<mark class="searchHighlight">${match}</mark>`);
    }

    function resolveImageUrl(imageUrl) {
        if (!imageUrl) return "";
        if (imageUrl.startsWith("img::")) return "promptdb://images/" + imageUrl.slice(5);
        return imageUrl; // legacy base64 or external URL
    }

    async function duplicatePrompt() {
        if (!state.editingPromptId) return;
        const src = db.prompts.find(p => p.id === state.editingPromptId);
        if (!src) return;
        const now = nowIso();
        const copy = { ...src, id: uuidV4(), title: src.title + " (copy)", pinned: false, createdAt: now, updatedAt: now };
        db.prompts.push(copy);
        db = await saveDb(db, { reason: "duplicatePrompt" });
        closeModal(promptModalOverlayEl);
        renderAll();
        showToast("Diduplikat", `"${copy.title}" berhasil dibuat.`, "success");
    }

    function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsArrayBuffer(file);
        });
    }

    // ---- Folder Modal ----
    function openFolderModal(folderId = null) {
        state.editingFolderId = folderId;
        if (folderId) {
            const f = getFolderById(folderId);
            folderModalTitleEl.textContent = "Edit Folder";
            folderNameInputEl.value = f.name;
            folderIconInputEl.value = f.icon;
            deleteFolderButtonEl.style.display = "block";
            folderModalMetaEl.textContent = `Folder ID: ${f.id}`;
        } else {
            folderModalTitleEl.textContent = "Tambah Folder";
            folderNameInputEl.value = "";
            folderIconInputEl.value = "📁";
            deleteFolderButtonEl.style.display = "none";
            folderModalMetaEl.textContent = "Folder baru.";
        }
        openModal(folderModalOverlayEl);
    }

    async function saveFolder() {
        const name = folderNameInputEl.value.trim();
        const icon = folderIconInputEl.value.trim() || "📁";
        if (!name) { showToast("Error", "Nama folder wajib diisi", "warning"); return; }
        const dupFolder = db.folders.find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== state.editingFolderId);
        if (dupFolder) { showToast("Error", "Folder dengan nama ini sudah ada", "warning"); return; }

        if (state.editingFolderId) {
            const f = getFolderById(state.editingFolderId);
            if (f) { f.name = name; f.icon = icon; }
        } else {
            db.folders.push({ id: uuidV4(), name, icon, order: db.folders.length + 1 });
        }
        db = await saveDb(db, { reason: "saveFolder" });
        closeModal(folderModalOverlayEl);
        renderAll();
    }

    async function confirmDeleteFolder(folderId) {
        const f = getFolderById(folderId);
        if (!f) return;
        const count = db.prompts.filter(p => p.folderId === folderId).length;
        if (count > 0) { showToast("Gagal", `Kosongkan folder ini dulu (${count} prompt)`, "warning"); return; }
        if (confirm(`Hapus folder "${f.name}"?`)) {
            db.folders = db.folders.filter(x => x.id !== folderId);
            if (state.selectedFolderId === folderId) state.selectedFolderId = "ALL";
            db = await saveDb(db, { reason: "deleteFolder" });
            renderAll();
            if (folderModalOverlayEl.classList.contains("open")) closeModal(folderModalOverlayEl);
        }
    }

    // ---- Tag Modal ----
    function openTagModal() {
        state.editingTagId = null;
        tagNameInputEl.value = "";
        tagColorInputEl.value = "#1F8EF1";
        addOrUpdateTagButtonEl.textContent = "Tambah Tag";
        renderTagList();
        openModal(tagModalOverlayEl);
    }

    function renderTagList() {
        tagListEl.innerHTML = db.tags.map(t => {
            const count = db.prompts.filter(p => p.tags.includes(t.id)).length;
            return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--outline); border-radius:10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="chipDot" style="background:${escapeHtml(t.color)}"></div>
            <div style="font-size:13px; font-weight:600;">${escapeHtml(t.name)} <span class="muted" style="font-weight:400; font-size:11px;">(${count})</span></div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="miniButton" data-edit-tag="${escapeHtml(t.id)}">${ICO.ico('edit', 14)}</button>
            <button class="miniButton" data-delete-tag="${escapeHtml(t.id)}">${ICO.ico('trash', 14)}</button>
          </div>
        </div>
      `;
        }).join("");

        tagListEl.querySelectorAll("[data-edit-tag]").forEach(btn => {
            btn.addEventListener("click", () => {
                const t = getTagById(btn.getAttribute("data-edit-tag"));
                if (t) {
                    state.editingTagId = t.id;
                    tagNameInputEl.value = t.name;
                    tagColorInputEl.value = t.color;
                    addOrUpdateTagButtonEl.textContent = "Update Tag";
                }
            });
        });

        tagListEl.querySelectorAll("[data-delete-tag]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-delete-tag");
                if (confirm("Hapus tag ini? (Prompt dengan tag ini tidak dihapus)")) {
                    db.tags = db.tags.filter(t => t.id !== id);
                    state.selectedTagIds.delete(id);
                    db.prompts.forEach(p => { p.tags = p.tags.filter(tid => tid !== id); });
                    db = await saveDb(db, { reason: "deleteTag" });
                    renderTagList();
                    renderAll();
                }
            });
        });
    }

    async function saveTag() {
        const name = tagNameInputEl.value.trim();
        const color = tagColorInputEl.value;
        if (!name) { showToast("Error", "Nama tag wajib diisi", "warning"); return; }
        const dupTag = db.tags.find(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== state.editingTagId);
        if (dupTag) { showToast("Error", "Tag dengan nama ini sudah ada", "warning"); return; }

        if (state.editingTagId) {
            const t = getTagById(state.editingTagId);
            if (t) { t.name = name; t.color = color; }
        } else {
            db.tags.push({ id: uuidV4(), name, color });
        }
        db = await saveDb(db, { reason: "saveTag" });
        tagNameInputEl.value = "";
        tagColorInputEl.value = "#1F8EF1";
        state.editingTagId = null;
        addOrUpdateTagButtonEl.textContent = "Tambah Tag";
        renderTagList();
        renderAll();
    }

    // ---- Export (native dialog) ----
    async function doExport() {
        const result = await window.dbApi.exportDb(db);
        if (result.success) {
            showToast("Export Berhasil", `Tersimpan ke: ${result.path}`, "success", 5000);
        } else if (!result.canceled) {
            showToast("Export Gagal", result.error || "Unknown error", "warning");
        }
    }

    async function doExportBundled() {
        const hasImages = db.prompts.some(p => p.imageUrl && p.imageUrl.startsWith("img::"));
        const result = await window.dbApi.exportBundled(db);
        if (result.success) {
            showToast("Export Berhasil", `Tersimpan ke: ${result.path}${hasImages ? " (gambar ter-embed)" : ""}`, "success", 5000);
        } else if (!result.canceled) {
            showToast("Export Gagal", result.error || "Unknown error", "warning");
        }
    }

    // ---- Import (native dialog) ----
    async function doImport() {
        const result = await window.dbApi.importDb();
        if (result.canceled) return;
        if (!result.success) {
            showToast("Import Gagal", result.error || "File tidak valid", "warning");
            return;
        }

        try {
            let imported = result.data;
            if (!imported || typeof imported !== "object") {
                showToast("Error", "File JSON tidak berisi objek yang valid.", "warning");
                return;
            }

            imported = normalizeDb(imported, { allowCreateDefaults: false });

            // Extract bundled base64 images to files
            for (const p of (imported.prompts || [])) {
                if (p.imageUrl && p.imageUrl.startsWith("data:image/")) {
                    try {
                        const match = p.imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                        if (match) {
                            const ext = match[1] === "jpeg" ? "jpg" : match[1];
                            const filename = uuidV4() + "." + ext;
                            const buffer = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)).buffer;
                            const res = await window.dbApi.saveImage(filename, buffer);
                            if (res.success) p.imageUrl = "img::" + res.filename;
                        }
                    } catch (_) { /* keep original if extraction fails */ }
                }
            }

            // Count what will be added (new items only)
            const newPrompts = (imported.prompts || []).filter(p => !db.prompts.find(x => x.id === p.id)).length;
            const newTags = (imported.tags || []).filter(t => !db.tags.find(x => x.id === t.id)).length;
            const newFolders = (imported.folders || []).filter(f => !db.folders.find(x => x.id === f.id)).length;
            const skipped = (imported.prompts || []).length - newPrompts;

            // Show preview dialog
            const preview = [
                `📋 ${newPrompts} prompt baru${skipped > 0 ? ` (${skipped} dilewati, sudah ada)` : ""}`,
                newFolders > 0 ? `📁 ${newFolders} folder baru` : null,
                newTags > 0 ? `🏷️ ${newTags} tag baru` : null,
            ].filter(Boolean).join("\n");

            if (!confirm(`Preview Import:\n\n${preview}\n\nLanjutkan?`)) return;

            // Merge mode (local wins)
            for (let t of (imported.tags || [])) {
                if (!db.tags.find(x => x.id === t.id)) db.tags.push(t);
            }
            for (let f of (imported.folders || [])) {
                if (!db.folders.find(x => x.id === f.id)) db.folders.push(f);
            }
            for (let p of (imported.prompts || [])) {
                if (!db.prompts.find(x => x.id === p.id)) db.prompts.push(p);
            }

            db = await saveDb(db, { reason: "importMerge" });
            renderAll();
            showToast("Import Sukses", `+${newPrompts} Prompt, +${newFolders} Folder, +${newTags} Tag`, "success", 5000);
        } catch (err) {
            showToast("Error", "Terjadi error saat import: " + err.message, "warning");
        }
    }

    // ---- Wire up events ----
    searchInputEl.addEventListener("input", (e) => { state.searchQuery = e.target.value; renderPromptGrid(); });
    clearSearchButtonEl.addEventListener("click", () => { searchInputEl.value = ""; state.searchQuery = ""; renderPromptGrid(); });

    // Close card menus on outside click
    document.addEventListener("click", () => {
        document.querySelectorAll(".cardMenu.open").forEach(m => m.classList.remove("open"));
    });

    fabButtonEl.addEventListener("click", () => openPromptModal());
    newPromptButtonEl.addEventListener("click", () => openPromptModal());

    // ---- Data dropdown (Export / Import) ----
    const dataDropdownToggleEl = document.getElementById("dataDropdownToggle");
    const dataDropdownMenuEl   = document.getElementById("dataDropdownMenu");
    dataDropdownToggleEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dataDropdownMenuEl.classList.toggle("open");
        dataDropdownToggleEl.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // ---- Custom sort dropdown ----
    const sortDropdownEl      = document.getElementById("sortDropdown");
    const sortDropdownBtnEl   = document.getElementById("sortDropdownBtn");
    const sortDropdownMenuEl  = document.getElementById("sortDropdownMenu");
    const sortDropdownLabelEl = document.getElementById("sortDropdownLabel");
    sortDropdownBtnEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = sortDropdownMenuEl.classList.toggle("open");
        sortDropdownEl.classList.toggle("open");
        sortDropdownBtnEl.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (isOpen) {
            const rect = sortDropdownBtnEl.getBoundingClientRect();
            sortDropdownMenuEl.style.top = (rect.bottom + 6) + "px";
            sortDropdownMenuEl.style.right = (window.innerWidth - rect.right) + "px";
        }
    });
    sortDropdownMenuEl.querySelectorAll("[data-sort-value]").forEach(opt => {
        opt.addEventListener("click", () => {
            const val = opt.getAttribute("data-sort-value");
            state.sortOrder = val;
            sortDropdownLabelEl.textContent = opt.textContent.trim();
            sortDropdownMenuEl.querySelectorAll("[data-sort-value]").forEach(o => o.classList.toggle("selected", o === opt));
            sortDropdownMenuEl.classList.remove("open");
            sortDropdownEl.classList.remove("open");
            renderPromptGrid();
        });
    });

    // Close all dropdowns when clicking elsewhere
    document.addEventListener("click", () => {
        dataDropdownMenuEl.classList.remove("open");
        dataDropdownToggleEl.setAttribute("aria-expanded", "false");
        sortDropdownMenuEl.classList.remove("open");
        sortDropdownEl.classList.remove("open");
        sortDropdownBtnEl.setAttribute("aria-expanded", "false");
    });

    selectModeButtonEl.addEventListener("click", () => {
        state.selectMode = !state.selectMode;
        state.selectedPromptIds.clear();
        renderPromptGrid();
    });
    bulkCancelButtonEl.addEventListener("click", () => {
        state.selectMode = false;
        state.selectedPromptIds.clear();
        renderPromptGrid();
    });
    bulkSelectAllButtonEl.addEventListener("click", () => {
        const allVisible = promptGridEl.querySelectorAll(".card");
        allVisible.forEach(el => state.selectedPromptIds.add(el.getAttribute("data-prompt-id")));
        renderPromptGrid();
    });
    bulkDeleteButtonEl.addEventListener("click", async () => {
        if (state.selectedPromptIds.size === 0) return;
        if (!confirm(`Hapus ${state.selectedPromptIds.size} prompt?`)) return;
        // Delete image files for selected prompts
        for (const pid of state.selectedPromptIds) {
            const p = db.prompts.find(x => x.id === pid);
            if (p && p.imageUrl && p.imageUrl.startsWith("img::")) {
                await window.dbApi.deleteImage(p.imageUrl.slice(5));
            }
        }
        db.prompts = db.prompts.filter(p => !state.selectedPromptIds.has(p.id));
        state.selectedPromptIds.clear();
        state.selectMode = false;
        db = await saveDb(db, { reason: "bulkDelete" });
        renderAll();
        showToast("Dihapus", "Prompt terpilih berhasil dihapus.", "success");
    });
    bulkMoveSelectEl.addEventListener("change", async () => {
        const targetId = bulkMoveSelectEl.value;
        if (!targetId || state.selectedPromptIds.size === 0) return;
        db.prompts.forEach(p => {
            if (state.selectedPromptIds.has(p.id)) { p.folderId = targetId; p.updatedAt = nowIso(); }
        });
        state.selectedPromptIds.clear();
        state.selectMode = false;
        db = await saveDb(db, { reason: "bulkMove" });
        renderAll();
        showToast("Dipindah", "Prompt terpilih berhasil dipindahkan.", "success");
    });
    exportButtonEl.addEventListener("click", () => doExport());
    exportBundledButtonEl.addEventListener("click", () => doExportBundled());
    importButtonEl.addEventListener("click", () => doImport());
    restoreBackupButtonEl.addEventListener("click", async () => {
        const backups = await window.dbApi.listBackups();
        if (backups.length === 0) {
            showToast("Tidak Ada Backup", "Belum ada backup otomatis tersedia.", "warning");
            return;
        }
        const lines = backups.map(b => {
            const d = new Date(b.mtime);
            const sizeKb = Math.round(b.size / 1024);
            return `[${b.slot}] ${d.toLocaleString()} — ${sizeKb} KB`;
        });
        const answer = prompt(
            `Pilih slot backup untuk di-restore (ketik angka):\n\n${lines.join("\n")}\n\nData saat ini akan digantikan. Lanjutkan?`
        );
        const slot = parseInt(answer);
        if (!slot || !backups.find(b => b.slot === slot)) return;
        const res = await window.dbApi.restoreBackup(slot);
        if (!res.success) { showToast("Gagal", res.error, "warning"); return; }
        db = normalizeDb(res.data, { allowCreateDefaults: true });
        renderAll();
        showToast("Restore Berhasil", `Data berhasil di-restore dari backup #${slot}.`, "success", 5000);
    });
    addFolderButtonEl.addEventListener("click", () => openFolderModal());

    closePromptModalEl.addEventListener("click", () => closeModal(promptModalOverlayEl));
    cancelPromptButtonEl.addEventListener("click", () => closeModal(promptModalOverlayEl));
    function updateContentCounter() {
        const text = promptContentInputEl.value;
        const chars = text.length;
        const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
        contentCounterEl.textContent = `${words} kata • ${chars} karakter`;
    }
    promptContentInputEl.addEventListener("input", updateContentCounter);

    savePromptButtonEl.addEventListener("click", savePrompt);
    let deleteConfirmTimer = null;
    deletePromptButtonEl.addEventListener("click", () => {
        if (deletePromptButtonEl.dataset.confirm === "1") {
            clearTimeout(deleteConfirmTimer);
            deletePromptButtonEl.dataset.confirm = "";
            deletePromptButtonEl.innerHTML = `${ICO.ico('trash', 16)}Hapus`;
            deletePrompt();
        } else {
            deletePromptButtonEl.dataset.confirm = "1";
            deletePromptButtonEl.innerHTML = `${ICO.ico('trash', 16)}Yakin Hapus?`;
            deleteConfirmTimer = setTimeout(() => {
                deletePromptButtonEl.dataset.confirm = "";
                deletePromptButtonEl.innerHTML = `${ICO.ico('trash', 16)}Hapus`;
            }, 3000);
        }
    });
    duplicatePromptButtonEl.addEventListener("click", duplicatePrompt);

    clearImageButtonEl.addEventListener("click", () => { promptImageUrlInputEl.value = ""; promptImageUploadEl.value = ""; updateImagePreview(); });

    promptImageUploadEl.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const buffer = await readFileAsArrayBuffer(file);
                const ext = file.name.split(".").pop().toLowerCase() || "jpg";
                const filename = uuidV4() + "." + ext;
                const result = await window.dbApi.saveImage(filename, buffer);
                if (result.success) {
                    promptImageUrlInputEl.value = "img::" + result.filename;
                    updateImagePreview();
                } else {
                    showToast("Peringatan", "Gagal menyimpan gambar", "warning");
                }
            } catch (err) {
                showToast("Peringatan", "Gagal membaca gambar", "warning");
            }
        }
    });

    closeFolderModalEl.addEventListener("click", () => closeModal(folderModalOverlayEl));
    cancelFolderButtonEl.addEventListener("click", () => closeModal(folderModalOverlayEl));
    saveFolderButtonEl.addEventListener("click", saveFolder);
    deleteFolderButtonEl.addEventListener("click", () => confirmDeleteFolder(state.editingFolderId));

    closeTagModalEl.addEventListener("click", () => closeModal(tagModalOverlayEl));
    if (closeTagModal2El) closeTagModal2El.addEventListener("click", () => closeModal(tagModalOverlayEl));

    // ---- Keyboard Shortcuts Modal ----
    const shortcutsModalOverlayEl  = document.getElementById("shortcutsModalOverlay");
    const closeShortcutsModalEl    = document.getElementById("closeShortcutsModal");
    const closeShortcutsModal2El   = document.getElementById("closeShortcutsModal2");
    closeShortcutsModalEl.addEventListener("click",  () => closeModal(shortcutsModalOverlayEl));
    closeShortcutsModal2El.addEventListener("click", () => closeModal(shortcutsModalOverlayEl));
    addOrUpdateTagButtonEl.addEventListener("click", saveTag);
    resetTagFormButtonEl.addEventListener("click", () => {
        state.editingTagId = null;
        tagNameInputEl.value = "";
        tagColorInputEl.value = "#1F8EF1";
        addOrUpdateTagButtonEl.textContent = "Tambah Tag";
    });

    themeToggleEl.addEventListener("click", () => {
        const cycle = { dark: "light", light: "oled", oled: "dark" };
        setTheme(cycle[appSettings.theme] || "dark");
    });

    // ---- Sidebar Collapse ----
    const sidebarEl = document.getElementById("sidebar");
    const sidebarCollapseBtnEl = document.getElementById("sidebarCollapseBtn");
    let sidebarCollapsed = appSettings.sidebarCollapsed === true;

    function setSidebarCollapsed(collapsed) {
        sidebarCollapsed = collapsed;
        sidebarEl.classList.toggle("collapsed", collapsed);
        appSettings.sidebarCollapsed = collapsed;
        saveAppSettings(appSettings);
    }

    setSidebarCollapsed(sidebarCollapsed);

    sidebarCollapseBtnEl.addEventListener("click", () => {
        setSidebarCollapsed(!sidebarCollapsed);
    });
    autoBackupToggleEl.addEventListener("click", () => {
        setAutoBackup(!appSettings.autoBackup);
    });

    // ---- Keyboard Shortcuts ----
    document.addEventListener("keydown", (e) => {
        const modalOpen = document.querySelector(".modalOverlay.open");

        // Esc — tutup modal yang sedang terbuka
        if (e.key === "Escape" && modalOpen) {
            closeModal(modalOpen);
            return;
        }

        // Jangan trigger shortcut kalau sedang ngetik di input/textarea
        const tag = document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        // ? — keyboard shortcuts panel
        if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            openModal(shortcutsModalOverlayEl);
            return;
        }

        // Ctrl+N — tambah prompt baru
        if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            openPromptModal();
            return;
        }

        // Ctrl+F — fokus ke search
        if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            searchInputEl.focus();
            searchInputEl.select();
            return;
        }
    });

    // Ctrl+Enter di dalam modal — save
    promptModalOverlayEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            savePrompt();
        }
    });

    // ---- Titlebar window controls ----
    if (btnMinimize) btnMinimize.addEventListener("click", () => window.winApi.minimize());
    if (btnClose) btnClose.addEventListener("click", () => window.winApi.close());
    if (btnMaximize) btnMaximize.addEventListener("click", async () => {
        await window.winApi.maximize();
    });
    if (window.winApi) {
        window.winApi.onMaximizeChanged((isMax) => {
            if (btnMaximize) btnMaximize.querySelector("[data-icon]").setAttribute("data-icon", isMax ? "winRestore" : "winMax");
            // Re-apply icon
            const span = btnMaximize && btnMaximize.querySelector("[data-icon]");
            if (span) span.innerHTML = ICO.ico(isMax ? "winRestore" : "winMax", 12);
        });
    }

    // ---- View toggle (grid / list) ----
    function setViewMode(mode) {
        state.viewMode = mode;
        promptGridEl.classList.toggle("listView", mode === "list");
        if (viewGridBtn) viewGridBtn.classList.toggle("active", mode === "grid");
        if (viewListBtn) viewListBtn.classList.toggle("active", mode === "list");
    }
    if (viewGridBtn) viewGridBtn.addEventListener("click", () => setViewMode("grid"));
    if (viewListBtn) viewListBtn.addEventListener("click", () => setViewMode("list"));

    // ---- Init ----
    setTheme(appSettings.theme);
    setAutoBackup(appSettings.autoBackup);

    // Show db path in hint
    try {
        const dbPath = await window.dbApi.getDbPath();
        if (dbPathHintEl) dbPathHintEl.title = "DB: " + dbPath;
    } catch (e) { /* ignore */ }

    renderAll();
})();
