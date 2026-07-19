// Hide the console window on Windows release builds.
#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod models;
mod store;
mod updater;

use models::{Database, Folder, Prompt, Settings, Tag};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

slint::include_modules!();

/// All mutable app state lives here, behind a single Rc<RefCell<>> shared by
/// every UI callback closure. Single-threaded (Slint UI thread only) so
/// RefCell is sufficient — no locking needed.
struct AppState {
    db: Database,
    settings: Settings,
    folder_filter: String, // "" = All
    search: String,
    selected_tag_ids: Vec<String>,
    tag_filter_or: bool, // false = AND, true = OR

    // Prompt modal scratch state (mirrors what's currently open in the UI;
    // committed into `db` only on Save).
    editing_prompt_id: Option<String>,
    editing_prompt_tags: Vec<String>,
    editing_prompt_image_url: String,

    editing_folder_id: Option<String>,
    editing_tag_id: Option<String>,
}

fn hex_to_color(hex: &str) -> slint::Color {
    let h = hex.trim_start_matches('#');
    if h.len() >= 6 {
        if let Ok(v) = u32::from_str_radix(&h[0..6], 16) {
            return slint::Color::from_rgb_u8((v >> 16) as u8, (v >> 8) as u8, v as u8);
        }
    }
    slint::Color::from_rgb_u8(139, 92, 246) // fallback: theme primary purple
}

fn color_to_hex(c: slint::Color) -> String {
    format!("#{:02X}{:02X}{:02X}", c.red(), c.green(), c.blue())
}

/// First ~120 chars of content, newlines flattened to spaces, ellipsis if truncated.
fn make_preview(content: &str) -> String {
    let flat: String = content.trim().chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    let chars: Vec<char> = flat.chars().collect();
    if chars.len() <= 120 {
        flat
    } else {
        let mut s: String = chars[..120].iter().collect();
        s.push('\u{2026}');
        s
    }
}

/// Resolve a prompt's `img::<filename>` image_url into a loaded Slint image,
/// if present and readable. Anything else (empty, legacy data: URL, external
/// http) is treated as "no local image" for card/thumbnail display.
fn load_prompt_image(image_url: &str) -> Option<slint::Image> {
    let filename = image_url.strip_prefix("img::")?;
    let path = store::images_dir().join(filename);
    slint::Image::load_from_path(&path).ok()
}

fn build_prompt_items(state: &AppState) -> Vec<PromptItem> {
    let q = state.search.to_lowercase();
    let mut items: Vec<&Prompt> = state
        .db
        .prompts
        .iter()
        .filter(|p| state.folder_filter.is_empty() || p.folder_id == state.folder_filter)
        .filter(|p| {
            q.is_empty()
                || p.title.to_lowercase().contains(&q)
                || p.content.to_lowercase().contains(&q)
        })
        .filter(|p| {
            if state.selected_tag_ids.is_empty() {
                return true;
            }
            if state.tag_filter_or {
                state.selected_tag_ids.iter().any(|tid| p.tags.contains(tid))
            } else {
                state.selected_tag_ids.iter().all(|tid| p.tags.contains(tid))
            }
        })
        .collect();
    // Pinned first, then most-recently-updated first.
    items.sort_by(|a, b| b.pinned.cmp(&a.pinned).then_with(|| b.updated_at.cmp(&a.updated_at)));

    items
        .into_iter()
        .map(|p| {
            let folder_name = state
                .db
                .folders
                .iter()
                .find(|f| f.id == p.folder_id)
                .map(|f| f.name.clone())
                .unwrap_or_default();
            let mut tag_names = Vec::with_capacity(p.tags.len());
            let mut tag_colors = Vec::with_capacity(p.tags.len());
            for tid in &p.tags {
                if let Some(t) = state.db.tags.iter().find(|t| &t.id == tid) {
                    tag_names.push(slint::SharedString::from(t.name.clone()));
                    tag_colors.push(hex_to_color(&t.color));
                }
            }
            let image = load_prompt_image(&p.image_url);
            PromptItem {
                id: p.id.clone().into(),
                title: p.title.clone().into(),
                preview: make_preview(&p.content).into(),
                content: p.content.clone().into(),
                folder_name: folder_name.into(),
                pinned: p.pinned,
                tag_names: Rc::new(slint::VecModel::from(tag_names)).into(),
                tag_colors: Rc::new(slint::VecModel::from(tag_colors)).into(),
                has_image: image.is_some(),
                image: image.unwrap_or_default(),
            }
        })
        .collect()
}

fn build_folder_items(db: &Database) -> Vec<FolderItem> {
    let mut folders: Vec<&Folder> = db.folders.iter().collect();
    folders.sort_by_key(|f| f.order);

    let mut out = Vec::with_capacity(folders.len() + 1);
    out.push(FolderItem {
        id: "".into(),
        name: "All Prompts".into(),
        icon: "\u{1F5C2}".into(), // card index dividers — generic "all" glyph
        count: db.prompts.len() as i32,
    });
    for f in folders {
        let count = db.prompts.iter().filter(|p| p.folder_id == f.id).count() as i32;
        out.push(FolderItem {
            id: f.id.clone().into(),
            name: f.name.clone().into(),
            icon: f.icon.clone().into(),
            count,
        });
    }
    out
}

/// Build tag chips for any of the three tag lists (filter bar / manage modal
/// / prompt-edit selector) — they differ only in which ids count as
/// "selected" and whether a prompt-count badge is meaningful.
fn build_tag_items(db: &Database, selected_ids: &[String]) -> Vec<TagItem> {
    db.tags
        .iter()
        .map(|t| TagItem {
            id: t.id.clone().into(),
            name: t.name.clone().into(),
            color: hex_to_color(&t.color),
            count: db.prompts.iter().filter(|p| p.tags.contains(&t.id)).count() as i32,
            selected: selected_ids.contains(&t.id),
        })
        .collect()
}

fn build_backup_items() -> Vec<BackupItem> {
    store::list_backups()
        .into_iter()
        .map(|b| {
            let when = b
                .modified
                .map(|m| {
                    let dt: chrono::DateTime<chrono::Local> = m.into();
                    dt.format("%d %b %Y %H:%M").to_string()
                })
                .unwrap_or_else(|| "?".to_string());
            let kb = b.size / 1024;
            BackupItem {
                slot: b.slot as i32,
                label: format!("Slot {} — {} — {} KB", b.slot, when, kb).into(),
            }
        })
        .collect()
}

fn refresh_prompts(ui: &AppWindow, state: &AppState) {
    ui.set_prompts(Rc::new(slint::VecModel::from(build_prompt_items(state))).into());
}

fn refresh_folders(ui: &AppWindow, state: &AppState) {
    let items = build_folder_items(&state.db);
    // folder-options drops the synthetic "All Prompts" entry (id == "") —
    // it's only meaningful in the sidebar, not in a prompt's folder picker.
    let options: Vec<FolderItem> = items.iter().filter(|f| !f.id.is_empty()).cloned().collect();
    ui.set_folders(Rc::new(slint::VecModel::from(items)).into());
    ui.set_folder_options(Rc::new(slint::VecModel::from(options)).into());
}

fn refresh_tag_filter(ui: &AppWindow, state: &AppState) {
    let items = build_tag_items(&state.db, &state.selected_tag_ids);
    ui.set_tag_filter_items(Rc::new(slint::VecModel::from(items)).into());
    ui.set_selected_tag_count(state.selected_tag_ids.len() as i32);
    ui.set_tag_filter_mode(if state.tag_filter_or { "OR" } else { "AND" }.into());
}

fn refresh_tag_manage(ui: &AppWindow, state: &AppState) {
    let items = build_tag_items(&state.db, &[]);
    ui.set_tag_manage_items(Rc::new(slint::VecModel::from(items)).into());
}

fn refresh_edit_tags(ui: &AppWindow, state: &AppState) {
    let items = build_tag_items(&state.db, &state.editing_prompt_tags);
    ui.set_edit_tag_items(Rc::new(slint::VecModel::from(items)).into());
}

fn refresh_backups(ui: &AppWindow) {
    ui.set_backups(Rc::new(slint::VecModel::from(build_backup_items())).into());
}

/// Every mutation goes through here: save db.json, then rotate backups if
/// the user has auto-backup on (matches Electron's behavior exactly).
fn persist(state: &AppState) {
    let _ = store::save_database(&state.db);
    if state.settings.auto_backup {
        let _ = store::rotate_backups(&state.db);
    }
}

fn show_toast(ui_weak: &slint::Weak<AppWindow>, message: impl Into<String>, kind: &str) {
    let message = message.into();
    if let Some(ui) = ui_weak.upgrade() {
        ui.set_toast_message(message.into());
        ui.set_toast_kind(kind.into());
    }
    let weak2 = ui_weak.clone();
    slint::Timer::single_shot(Duration::from_secs(3), move || {
        if let Some(ui) = weak2.upgrade() {
            ui.set_toast_message("".into());
        }
    });
}

fn main() -> Result<(), slint::PlatformError> {
    let ui = AppWindow::new()?;

    // Preflight-style guard so tests/CI can construct without an event loop.
    if std::env::var("PROMPTDB_NO_RUN").is_ok() {
        println!("AppWindow constructed OK");
        return Ok(());
    }

    let db = store::load_database();
    let settings = store::load_settings();

    ui.global::<Theme>().set_mode(settings.theme.clone().into());
    ui.set_sidebar_collapsed(settings.sidebar_collapsed);

    let state = Rc::new(RefCell::new(AppState {
        db,
        settings,
        folder_filter: String::new(),
        search: String::new(),
        selected_tag_ids: Vec::new(),
        tag_filter_or: false,
        editing_prompt_id: None,
        editing_prompt_tags: Vec::new(),
        editing_prompt_image_url: String::new(),
        editing_folder_id: None,
        editing_tag_id: None,
    }));

    refresh_folders(&ui, &state.borrow());
    refresh_prompts(&ui, &state.borrow());
    refresh_tag_filter(&ui, &state.borrow());
    refresh_tag_manage(&ui, &state.borrow());

    // --- search ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_search(move |text| {
            state.borrow_mut().search = text.to_string();
            if let Some(ui) = ui_weak.upgrade() {
                refresh_prompts(&ui, &state.borrow());
            }
        });
    }

    // --- folder select (sidebar) ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_select_folder(move |id| {
            state.borrow_mut().folder_filter = id.to_string();
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_selected_folder_id(id);
                refresh_prompts(&ui, &state.borrow());
            }
        });
    }

    // --- pin toggle (mutates + saves + re-renders) ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_pin(move |id| {
            let mut st = state.borrow_mut();
            if let Some(p) = st.db.prompts.iter_mut().find(|p| p.id.as_str() == id.as_str()) {
                p.pinned = !p.pinned;
            }
            persist(&st);
            if let Some(ui) = ui_weak.upgrade() {
                refresh_prompts(&ui, &st);
            }
        });
    }

    // --- copy: write prompt content to the system clipboard ---
    // One Clipboard instance reused across copies (arboard's recommendation).
    // On macOS/Windows the copied text persists after the app exits.
    {
        let clipboard = Rc::new(RefCell::new(arboard::Clipboard::new().ok()));
        let ui_weak = ui.as_weak();
        ui.on_copy(move |content| {
            if let Some(cb) = clipboard.borrow_mut().as_mut() {
                let _ = cb.set_text(content.to_string());
            }
            show_toast(&ui_weak, "Dicopy ke clipboard.", "success");
        });
    }

    // --- theme cycle: dark -> oled -> light -> dark, persisted ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_cycle_theme(move || {
            if let Some(ui) = ui_weak.upgrade() {
                let theme = ui.global::<Theme>();
                let next = match theme.get_mode().as_str() {
                    "dark" => "oled",
                    "oled" => "light",
                    _ => "dark",
                };
                theme.set_mode(next.into());
                let mut st = state.borrow_mut();
                st.settings.theme = next.to_string();
                let _ = store::save_settings(&st.settings);
            }
        });
    }

    // --- sidebar collapse, persisted in Settings ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_sidebar(move || {
            let mut st = state.borrow_mut();
            let collapsed = !st.settings.sidebar_collapsed;
            st.settings.sidebar_collapsed = collapsed;
            let _ = store::save_settings(&st.settings);
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_sidebar_collapsed(collapsed);
            }
        });
    }

    // ================= Prompt CRUD =================

    fn open_prompt_modal(ui: &AppWindow, state: &Rc<RefCell<AppState>>, prompt_id: Option<String>) {
        let mut st = state.borrow_mut();
        st.editing_prompt_id = prompt_id.clone();

        match &prompt_id {
            Some(id) => {
                if let Some(p) = st.db.prompts.iter().find(|p| &p.id == id).cloned() {
                    ui.set_prompt_is_edit(true);
                    ui.set_editing_id(id.clone().into());
                    ui.set_edit_title(p.title.clone().into());
                    ui.set_edit_content(p.content.clone().into());
                    ui.set_edit_folder_id(p.folder_id.clone().into());
                    ui.set_prompt_created_label(format!("Dibuat: {}", p.created_at).into());
                    st.editing_prompt_tags = p.tags.clone();
                    st.editing_prompt_image_url = p.image_url.clone();
                    let image = load_prompt_image(&p.image_url);
                    ui.set_edit_has_image(image.is_some());
                    ui.set_edit_image_preview(image.unwrap_or_default());
                    let label = p
                        .image_url
                        .strip_prefix("img::")
                        .unwrap_or(&p.image_url)
                        .to_string();
                    ui.set_edit_image_label(label.into());
                }
            }
            None => {
                ui.set_prompt_is_edit(false);
                ui.set_editing_id("".into());
                ui.set_edit_title("".into());
                ui.set_edit_content("".into());
                let default_folder = if st.folder_filter.is_empty() {
                    st.db.folders.first().map(|f| f.id.clone()).unwrap_or_default()
                } else {
                    st.folder_filter.clone()
                };
                ui.set_edit_folder_id(default_folder.into());
                ui.set_prompt_created_label("Prompt baru belum disimpan.".into());
                st.editing_prompt_tags = Vec::new();
                st.editing_prompt_image_url = String::new();
                ui.set_edit_has_image(false);
                ui.set_edit_image_preview(Default::default());
                ui.set_edit_image_label("".into());
            }
        }
        refresh_edit_tags(ui, &st);
        ui.set_show_prompt_modal(true);
    }

    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_add_prompt(move || {
            if let Some(ui) = ui_weak.upgrade() {
                open_prompt_modal(&ui, &state, None);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_edit_prompt(move |id| {
            if let Some(ui) = ui_weak.upgrade() {
                open_prompt_modal(&ui, &state, Some(id.to_string()));
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_close_prompt_modal(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_prompt_modal(false);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        // folder-id lives purely in UI state (edit-folder-id) until Save reads it.
        ui.on_select_edit_folder(move |id| {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_edit_folder_id(id);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_edit_tag(move |tag_id| {
            let tag_id = tag_id.to_string();
            let mut st = state.borrow_mut();
            if let Some(pos) = st.editing_prompt_tags.iter().position(|t| t == &tag_id) {
                st.editing_prompt_tags.remove(pos);
            } else {
                st.editing_prompt_tags.push(tag_id);
            }
            if let Some(ui) = ui_weak.upgrade() {
                refresh_edit_tags(&ui, &st);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_prompt(move |title, content| {
            let title = title.trim().to_string();
            let content = content.trim().to_string();
            if title.is_empty() || content.is_empty() {
                show_toast(&ui_weak, "Judul dan Isi tidak boleh kosong", "warning");
                return;
            }
            let Some(ui) = ui_weak.upgrade() else { return };
            let folder_id = ui.get_edit_folder_id().to_string();
            let mut st = state.borrow_mut();
            let tags = st.editing_prompt_tags.clone();
            let image_url = st.editing_prompt_image_url.clone();
            let now = chrono::Utc::now().to_rfc3339();

            if let Some(id) = st.editing_prompt_id.clone() {
                if let Some(p) = st.db.prompts.iter_mut().find(|p| p.id == id) {
                    // Mutate the loaded struct in place — preserves `extra`.
                    p.title = title;
                    p.content = content;
                    p.folder_id = folder_id;
                    p.tags = tags;
                    p.image_url = image_url;
                    p.updated_at = now;
                }
            } else {
                st.db.prompts.push(Prompt {
                    id: uuid::Uuid::new_v4().to_string(),
                    title,
                    content,
                    tags,
                    folder_id,
                    image_url,
                    pinned: false,
                    created_at: now.clone(),
                    updated_at: now,
                    extra: Default::default(),
                });
            }
            persist(&st);
            refresh_prompts(&ui, &st);
            refresh_folders(&ui, &st);
            ui.set_show_prompt_modal(false);
            drop(st);
            show_toast(&ui_weak, "Prompt berhasil disimpan.", "success");
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_delete_prompt(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(id) = st.editing_prompt_id.clone() else { return };
            if let Some(pos) = st.db.prompts.iter().position(|p| p.id == id) {
                let removed = st.db.prompts.remove(pos);
                if let Some(name) = removed.image_url.strip_prefix("img::") {
                    let _ = store::delete_image(name);
                }
            }
            persist(&st);
            refresh_prompts(&ui, &st);
            refresh_folders(&ui, &st);
            ui.set_show_prompt_modal(false);
            drop(st);
            show_toast(&ui_weak, "Prompt dihapus.", "warning");
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_duplicate_prompt(move |id| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let id = id.to_string();
            if let Some(src) = st.db.prompts.iter().find(|p| p.id == id).cloned() {
                let now = chrono::Utc::now().to_rfc3339();
                let mut copy = src;
                copy.id = uuid::Uuid::new_v4().to_string();
                copy.title = format!("{} (copy)", copy.title);
                copy.pinned = false;
                copy.created_at = now.clone();
                copy.updated_at = now;
                // A duplicated prompt gets its own copy of the image file so
                // deleting either prompt later doesn't orphan the other's image.
                if let Some(name) = copy.image_url.strip_prefix("img::") {
                    if let Ok(bytes) = std::fs::read(store::images_dir().join(name)) {
                        let ext = std::path::Path::new(name)
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("png");
                        let new_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
                        if store::save_image(&new_name, &bytes).is_ok() {
                            copy.image_url = format!("img::{}", new_name);
                        }
                    }
                }
                st.db.prompts.push(copy);
            }
            persist(&st);
            refresh_prompts(&ui, &st);
            ui.set_show_prompt_modal(false);
            drop(st);
            show_toast(&ui_weak, "Prompt diduplikat.", "success");
        });
    }

    // --- image attach/clear (nice-to-have: native file picker -> copy into images dir) ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_attach_image(move || {
            let Some(picked) = rfd::FileDialog::new()
                .add_filter("Gambar", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
                .pick_file()
            else {
                return;
            };
            let Ok(bytes) = std::fs::read(&picked) else {
                show_toast(&ui_weak, "Gagal membaca gambar", "warning");
                return;
            };
            let ext = picked
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png")
                .to_lowercase();
            let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
            if store::save_image(&filename, &bytes).is_err() {
                show_toast(&ui_weak, "Gagal menyimpan gambar", "warning");
                return;
            }
            let mut st = state.borrow_mut();
            // Replace any previously-attached (but not yet saved) local image.
            if let Some(old) = st.editing_prompt_image_url.strip_prefix("img::") {
                let _ = store::delete_image(old);
            }
            st.editing_prompt_image_url = format!("img::{}", filename);
            if let Some(ui) = ui_weak.upgrade() {
                let image = load_prompt_image(&st.editing_prompt_image_url);
                ui.set_edit_has_image(image.is_some());
                ui.set_edit_image_preview(image.unwrap_or_default());
                ui.set_edit_image_label(filename.into());
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_clear_image(move || {
            let mut st = state.borrow_mut();
            if let Some(old) = st.editing_prompt_image_url.strip_prefix("img::") {
                let _ = store::delete_image(old);
            }
            st.editing_prompt_image_url.clear();
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_edit_has_image(false);
                ui.set_edit_image_preview(Default::default());
                ui.set_edit_image_label("".into());
            }
        });
    }

    // ================= Folder management =================

    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_add_folder(move || {
            state.borrow_mut().editing_folder_id = None;
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_folder_is_edit(false);
                ui.set_edit_folder_name("".into());
                ui.set_edit_folder_icon("\u{1F4C1}".into());
                ui.set_folder_error("".into());
                ui.set_show_folder_modal(true);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_edit_folder(move |id| {
            let id = id.to_string();
            let st = state.borrow();
            if let Some(f) = st.db.folders.iter().find(|f| f.id == id) {
                if let Some(ui) = ui_weak.upgrade() {
                    ui.set_folder_is_edit(true);
                    ui.set_edit_folder_name(f.name.clone().into());
                    ui.set_edit_folder_icon(f.icon.clone().into());
                    ui.set_folder_error("".into());
                    ui.set_show_folder_modal(true);
                }
            }
            drop(st);
            state.borrow_mut().editing_folder_id = Some(id);
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_close_folder_modal(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_folder_modal(false);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_folder(move |name, icon| {
            let name = name.trim().to_string();
            let icon = {
                let i = icon.trim();
                if i.is_empty() { "\u{1F4C1}".to_string() } else { i.to_string() }
            };
            let Some(ui) = ui_weak.upgrade() else { return };
            if name.is_empty() {
                ui.set_folder_error("Nama folder wajib diisi".into());
                return;
            }
            let mut st = state.borrow_mut();
            let editing_id = st.editing_folder_id.clone();
            let dup = st
                .db
                .folders
                .iter()
                .any(|f| f.name.eq_ignore_ascii_case(&name) && Some(&f.id) != editing_id.as_ref());
            if dup {
                ui.set_folder_error("Folder dengan nama ini sudah ada".into());
                return;
            }
            if let Some(id) = editing_id {
                if let Some(f) = st.db.folders.iter_mut().find(|f| f.id == id) {
                    f.name = name;
                    f.icon = icon;
                }
            } else {
                let order = st.db.folders.iter().map(|f| f.order).max().unwrap_or(0) + 1;
                st.db.folders.push(Folder {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    icon,
                    order,
                    extra: Default::default(),
                });
            }
            persist(&st);
            refresh_folders(&ui, &st);
            ui.set_show_folder_modal(false);
        });
    }

    /// Shared by both the sidebar trash icon and the folder-modal delete
    /// button. Blocks (with a native confirm dialog) unless the folder is
    /// empty — matches Electron's confirmDeleteFolder exactly.
    fn try_delete_folder(ui: &AppWindow, state: &Rc<RefCell<AppState>>, folder_id: &str) {
        let mut st = state.borrow_mut();
        let Some(folder) = st.db.folders.iter().find(|f| f.id == folder_id).cloned() else {
            return;
        };
        let count = st.db.prompts.iter().filter(|p| p.folder_id == folder_id).count();
        if count > 0 {
            rfd::MessageDialog::new()
                .set_title("Gagal")
                .set_description(format!("Kosongkan folder ini dulu ({} prompt)", count))
                .set_level(rfd::MessageLevel::Warning)
                .show();
            return;
        }
        let confirmed = rfd::MessageDialog::new()
            .set_title("Hapus Folder")
            .set_description(format!("Hapus folder \"{}\"?", folder.name))
            .set_buttons(rfd::MessageButtons::YesNo)
            .set_level(rfd::MessageLevel::Warning)
            .show();
        if confirmed != rfd::MessageDialogResult::Yes {
            return;
        }
        st.db.folders.retain(|f| f.id != folder_id);
        if st.folder_filter == folder_id {
            st.folder_filter.clear();
            ui.set_selected_folder_id("".into());
        }
        persist(&st);
        refresh_folders(ui, &st);
        refresh_prompts(ui, &st);
        ui.set_show_folder_modal(false);
    }

    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_request_delete_folder(move |id| {
            if let Some(ui) = ui_weak.upgrade() {
                try_delete_folder(&ui, &state, &id);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_delete_folder(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let id = state.borrow().editing_folder_id.clone();
            if let Some(id) = id {
                try_delete_folder(&ui, &state, &id);
            }
        });
    }

    // ================= Tag management =================

    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_open_tag_modal(move || {
            state.borrow_mut().editing_tag_id = None;
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_tag_is_edit(false);
                ui.set_edit_tag_name("".into());
                ui.set_edit_tag_color(hex_to_color("#1F8EF1"));
                ui.set_tag_error("".into());
                refresh_tag_manage(&ui, &state.borrow());
                ui.set_show_tag_modal(true);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_close_tag_modal(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_tag_modal(false);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_pick_tag_color(move |c| {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_edit_tag_color(c);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_reset_tag_form(move || {
            state.borrow_mut().editing_tag_id = None;
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_tag_is_edit(false);
                ui.set_edit_tag_name("".into());
                ui.set_edit_tag_color(hex_to_color("#1F8EF1"));
                ui.set_tag_error("".into());
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_edit_tag(move |id| {
            let id = id.to_string();
            let st = state.borrow();
            if let Some(t) = st.db.tags.iter().find(|t| t.id == id) {
                if let Some(ui) = ui_weak.upgrade() {
                    ui.set_tag_is_edit(true);
                    ui.set_edit_tag_name(t.name.clone().into());
                    ui.set_edit_tag_color(hex_to_color(&t.color));
                    ui.set_tag_error("".into());
                }
            }
            drop(st);
            state.borrow_mut().editing_tag_id = Some(id);
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_save_tag(move |name| {
            let name = name.trim().to_string();
            let Some(ui) = ui_weak.upgrade() else { return };
            if name.is_empty() {
                ui.set_tag_error("Nama tag wajib diisi".into());
                return;
            }
            let color = color_to_hex(ui.get_edit_tag_color());
            let mut st = state.borrow_mut();
            let editing_id = st.editing_tag_id.clone();
            let dup = st
                .db
                .tags
                .iter()
                .any(|t| t.name.eq_ignore_ascii_case(&name) && Some(&t.id) != editing_id.as_ref());
            if dup {
                ui.set_tag_error("Tag dengan nama ini sudah ada".into());
                return;
            }
            if let Some(id) = editing_id {
                if let Some(t) = st.db.tags.iter_mut().find(|t| t.id == id) {
                    t.name = name;
                    t.color = color;
                }
            } else {
                st.db.tags.push(Tag {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    color,
                    extra: Default::default(),
                });
            }
            persist(&st);
            st.editing_tag_id = None;
            ui.set_tag_is_edit(false);
            ui.set_edit_tag_name("".into());
            ui.set_edit_tag_color(hex_to_color("#1F8EF1"));
            refresh_tag_manage(&ui, &st);
            refresh_tag_filter(&ui, &st);
            refresh_prompts(&ui, &st);
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_delete_tag(move |id| {
            let id = id.to_string();
            let confirmed = rfd::MessageDialog::new()
                .set_title("Hapus Tag")
                .set_description("Hapus tag ini? (Prompt dengan tag ini tidak dihapus)")
                .set_buttons(rfd::MessageButtons::YesNo)
                .set_level(rfd::MessageLevel::Warning)
                .show();
            if confirmed != rfd::MessageDialogResult::Yes {
                return;
            }
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            st.db.tags.retain(|t| t.id != id);
            st.selected_tag_ids.retain(|t| t != &id);
            for p in st.db.prompts.iter_mut() {
                p.tags.retain(|t| t != &id);
            }
            persist(&st);
            refresh_tag_manage(&ui, &st);
            refresh_tag_filter(&ui, &st);
            refresh_prompts(&ui, &st);
        });
    }

    // --- tag filter bar ---
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_tag_filter(move |id| {
            let id = id.to_string();
            let mut st = state.borrow_mut();
            if let Some(pos) = st.selected_tag_ids.iter().position(|t| t == &id) {
                st.selected_tag_ids.remove(pos);
            } else {
                st.selected_tag_ids.push(id);
            }
            if let Some(ui) = ui_weak.upgrade() {
                refresh_tag_filter(&ui, &st);
                refresh_prompts(&ui, &st);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_toggle_tag_filter_mode(move || {
            let mut st = state.borrow_mut();
            st.tag_filter_or = !st.tag_filter_or;
            if let Some(ui) = ui_weak.upgrade() {
                refresh_tag_filter(&ui, &st);
                refresh_prompts(&ui, &st);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_clear_tag_filter(move || {
            let mut st = state.borrow_mut();
            st.selected_tag_ids.clear();
            if let Some(ui) = ui_weak.upgrade() {
                refresh_tag_filter(&ui, &st);
                refresh_prompts(&ui, &st);
            }
        });
    }

    // ================= Import / Export =================

    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_do_export(move || {
            let Some(path) = rfd::FileDialog::new()
                .set_file_name("promptdb-export.json")
                .add_filter("JSON", &["json"])
                .save_file()
            else {
                return;
            };
            let st = state.borrow();
            match store::export_to(&path, &st.db) {
                Ok(()) => show_toast(&ui_weak, format!("Tersimpan ke: {}", path.display()), "success"),
                Err(e) => show_toast(&ui_weak, format!("Export gagal: {e}"), "warning"),
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_do_import(move || {
            let Some(path) = rfd::FileDialog::new().add_filter("JSON", &["json"]).pick_file() else {
                return;
            };
            let imported = match store::import_from(&path) {
                Ok(db) => db,
                Err(e) => {
                    show_toast(&ui_weak, format!("Import gagal: {e}"), "warning");
                    return;
                }
            };
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();

            // Merge mode (local wins on id collisions) — matches renderer.js.
            let mut new_tags = 0;
            for t in imported.tags {
                if !st.db.tags.iter().any(|x| x.id == t.id) {
                    new_tags += 1;
                    st.db.tags.push(t);
                }
            }
            let mut new_folders = 0;
            for f in imported.folders {
                if !st.db.folders.iter().any(|x| x.id == f.id) {
                    new_folders += 1;
                    st.db.folders.push(f);
                }
            }
            let mut new_prompts = 0;
            for p in imported.prompts {
                if !st.db.prompts.iter().any(|x| x.id == p.id) {
                    new_prompts += 1;
                    st.db.prompts.push(p);
                }
            }

            persist(&st);
            refresh_folders(&ui, &st);
            refresh_prompts(&ui, &st);
            refresh_tag_filter(&ui, &st);
            refresh_tag_manage(&ui, &st);
            drop(st);
            show_toast(
                &ui_weak,
                format!("+{new_prompts} Prompt, +{new_folders} Folder, +{new_tags} Tag"),
                "success",
            );
        });
    }

    // ================= Backup restore =================

    {
        let ui_weak = ui.as_weak();
        ui.on_open_backups(move || {
            if let Some(ui) = ui_weak.upgrade() {
                refresh_backups(&ui);
                ui.set_show_backup_modal(true);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_close_backups(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_backup_modal(false);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        let state = state.clone();
        ui.on_restore_backup(move |slot| {
            let confirmed = rfd::MessageDialog::new()
                .set_title("Restore Backup")
                .set_description(format!(
                    "Data saat ini akan digantikan oleh backup slot {slot}. Lanjutkan?"
                ))
                .set_buttons(rfd::MessageButtons::YesNo)
                .set_level(rfd::MessageLevel::Warning)
                .show();
            if confirmed != rfd::MessageDialogResult::Yes {
                return;
            }
            let Some(ui) = ui_weak.upgrade() else { return };
            match store::restore_backup(slot as u8) {
                Ok(db) => {
                    let mut st = state.borrow_mut();
                    st.db = db;
                    st.folder_filter.clear();
                    st.selected_tag_ids.clear();
                    ui.set_selected_folder_id("".into());
                    refresh_folders(&ui, &st);
                    refresh_prompts(&ui, &st);
                    refresh_tag_filter(&ui, &st);
                    refresh_tag_manage(&ui, &st);
                    ui.set_show_backup_modal(false);
                    drop(st);
                    show_toast(&ui_weak, format!("Data berhasil di-restore dari backup #{slot}."), "success");
                }
                Err(e) => show_toast(&ui_weak, format!("Restore gagal: {e}"), "warning"),
            }
        });
    }

    // --- background update check ---
    {
        let ui_weak = ui.as_weak();
        std::thread::spawn(move || {
            if let Some(info) = updater::check_for_update() {
                let _ = slint::invoke_from_event_loop(move || {
                    if let Some(ui) = ui_weak.upgrade() {
                        ui.set_update_available(true);
                        ui.set_update_version(info.version.into());
                        ui.set_update_url(info.url.into());
                    }
                });
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_open_update(move || {
            if let Some(ui) = ui_weak.upgrade() {
                let url = ui.get_update_url();
                if !url.is_empty() {
                    updater::open_release_page(&url);
                }
            }
        });
    }

    ui.run()
}
