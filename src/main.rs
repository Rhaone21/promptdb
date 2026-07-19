// Hide the console window on Windows release builds.
#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod models;
mod store;
mod updater;

use models::{Database, Folder, Prompt};
use std::cell::RefCell;
use std::rc::Rc;

slint::include_modules!();

/// All mutable app state lives here, behind a single Rc<RefCell<>> shared by
/// every UI callback closure. Single-threaded (Slint UI thread only) so
/// RefCell is sufficient — no locking needed.
struct AppState {
    db: Database,
    folder_filter: String, // "" = All
    search: String,
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
            PromptItem {
                id: p.id.clone().into(),
                title: p.title.clone().into(),
                preview: make_preview(&p.content).into(),
                content: p.content.clone().into(),
                folder_name: folder_name.into(),
                pinned: p.pinned,
                tag_names: Rc::new(slint::VecModel::from(tag_names)).into(),
                tag_colors: Rc::new(slint::VecModel::from(tag_colors)).into(),
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
        name: "All".into(),
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

fn refresh_prompts(ui: &AppWindow, state: &AppState) {
    let items = build_prompt_items(state);
    ui.set_prompts(Rc::new(slint::VecModel::from(items)).into());
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

    let state = Rc::new(RefCell::new(AppState {
        db,
        folder_filter: String::new(),
        search: String::new(),
    }));

    ui.set_folders(Rc::new(slint::VecModel::from(build_folder_items(&state.borrow().db))).into());
    refresh_prompts(&ui, &state.borrow());

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

    // --- folder select ---
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
            let _ = store::save_database(&st.db);
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
        ui.on_copy(move |content| {
            if let Some(cb) = clipboard.borrow_mut().as_mut() {
                let _ = cb.set_text(content.to_string());
            }
        });
    }

    // --- theme cycle: dark -> oled -> light -> dark, persisted ---
    {
        let ui_weak = ui.as_weak();
        ui.on_cycle_theme(move || {
            if let Some(ui) = ui_weak.upgrade() {
                let theme = ui.global::<Theme>();
                let next = match theme.get_mode().as_str() {
                    "dark" => "oled",
                    "oled" => "light",
                    _ => "dark",
                };
                theme.set_mode(next.into());
                let mut settings = store::load_settings();
                settings.theme = next.to_string();
                let _ = store::save_settings(&settings);
            }
        });
    }

    // --- window controls ---
    {
        let ui_weak = ui.as_weak();
        ui.on_minimize_window(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.window().set_minimized(true);
            }
        });
    }
    {
        let ui_weak = ui.as_weak();
        ui.on_maximize_window(move || {
            if let Some(ui) = ui_weak.upgrade() {
                let w = ui.window();
                w.set_maximized(!w.is_maximized());
            }
        });
    }
    ui.on_close_window(move || {
        let _ = slint::quit_event_loop();
    });

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
