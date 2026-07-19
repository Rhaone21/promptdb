# PromptDB — Rust/Slint native rewrite

Council verdict: Tauri. Owner override: **native Slint** (max lightweight),
**replace on main**. Reads existing db.json unchanged. Win + Mac. Update = notify+button.

## Done
- [x] Council (2 opposing Sonnet councilors) + synthesis
- [x] De-risk: Slint toolchain builds + runs on Mac
- [x] Cargo project (size-optimized release profile)
- [x] `models.rs` — schema-exact structs, flatten catch-all (no data loss). Tested.
- [x] `store.rs` — data dir, load/save (atomic temp+rename), backups(3), import/export. Loads real db.json. Tested.
- [x] `updater.rs` — GitHub Releases check + semver compare + open release page. Tested.
- [x] Skeleton compiles, 6/6 tests pass

## Done (MVP + full parity)
- [x] Slint UI: sidebar, card grid, search, tag filter, 3 themes, titlebar, update button
- [x] main.rs wiring: load db → models → Slint, callbacks → store, update thread
- [x] Prompt CRUD + duplicate + 2-step delete confirm
- [x] Folder management (create/rename/icon/delete)
- [x] Tag management modal + multi-select AND/OR filter
- [x] Import/export (rfd dialogs), backup list/restore
- [x] Images (display + attach/detach), sidebar collapse
- [x] Clipboard copy (arboard)
- [x] CI (Win+Mac build+test) + Release workflow (tag → GitHub Release)
- [x] v2.0.0 released: mac + windows artifacts published. Updater live end-to-end.

## Done (UI fidelity pass — owner's 5 complaints)
- [x] 28 iconsax SVGs extracted from icons.js → `assets/icons/`, themeable `Icon` component (colorize)
- [x] All chrome emoji/glyphs → SVG icons (folder emoji = user data, stays)
- [x] Brand logo in header + sidebar; sidebar brand block + FOLDER section
- [x] Responsive reflowing card grid (was single column)
- [x] Layout alignment: layout-based centering in buttons/header/cards

## Done (reaudit fixes)
- [x] Double window chrome removed — native OS controls only
- [x] Image-card overflow fixed (236px uniform cards, actions never clip)
- [x] Tag modal stale input — two-way `<=>` binding chain
- [x] Folder delete button → GhostButton + trash icon
- [x] README.md added

## Follow-up (tracked)
- [ ] Retire Electron files from main (once owner confirms parity in daily use)
- [ ] Not yet ported from Electron: sort dropdown, grid/list view toggle, FAB,
      bulk select/move/delete, keyboard shortcuts, export+images (bundled), drag to folder
- [ ] Bundled-image export; proper .app/.dmg + .msi packaging + code signing
- [ ] RAM trim (software renderer option) if ~150MB matters
- [ ] Sidebar collapse to icon-rail (currently width 0)

## Design tokens (from existing style.css — 3 themes)
- radius 10 / small 8; space 8/16/24/32; sidebar 280 (collapsed 72); header 64
- dark:  bg #0d0c14 surface #131220 text #ede9f0 primary #8B5CF6 accent #EC4899
- oled:  bg #000000 surface #080610 text #F5F2FF primary #A78BFA accent #F472B6
- light: bg #F5F4FA surface #FFFFFF text #16122a primary #7C3AED accent #DB2777
