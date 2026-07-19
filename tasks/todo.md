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

## In progress
- [ ] Slint UI (agent): sidebar(folders), prompt card grid, search, tag filter,
      theme dark/oled/light, custom titlebar, prompt CRUD/copy/pin, update button
- [ ] Wire main.rs: load db → models → Slint, callbacks → store, update check thread

## Follow-up (tracked, not MVP)
- [ ] Image paste/attach (imageUrl `img::` + data/images)
- [ ] Tag-manager modal, folder edit modal
- [ ] Backup restore UI, import/export dialogs (rfd)
- [ ] GitHub Actions matrix: Windows .exe/.msi + Mac .dmg
- [ ] Retire Electron files from main (final step, once Slint at parity)

## Design tokens (from existing style.css — 3 themes)
- radius 10 / small 8; space 8/16/24/32; sidebar 280 (collapsed 72); header 64
- dark:  bg #0d0c14 surface #131220 text #ede9f0 primary #8B5CF6 accent #EC4899
- oled:  bg #000000 surface #080610 text #F5F2FF primary #A78BFA accent #F472B6
- light: bg #F5F4FA surface #FFFFFF text #16122a primary #7C3AED accent #DB2777
