# PromptDB

Offline prompt-storage desktop app, rewritten from Electron to **native Rust + [Slint](https://slint.dev)** for a minimal footprint.

|            | Electron (v1) | Rust/Slint (v2) |
|------------|---------------|-----------------|
| Disk       | ~235 MB       | **~7.6 MB**     |
| Idle RAM   | ~235 MB       | **~130–165 MB** |
| Runtime    | Chromium + Node | single native binary |

## Features

- Prompt CRUD — add, edit, duplicate, two-step delete confirm, pin, copy to clipboard
- Folders (emoji icon, rename, safe delete) and tags (color, AND/OR multi-select filter)
- Live search over title + content
- Optional image attachment per prompt
- Three themes: dark / OLED / light (persisted)
- Import / export JSON, automatic rotating backups (3 slots) with in-app restore
- Update check on launch against GitHub Releases — shows an "Update" button when a newer version exists (no silent auto-update)
- UI text in Bahasa Indonesia, iconsax SVG icon set

## Data format

Reads and writes the same files as the Electron version — no migration needed:

```
data/
  db.json         # { prompts[], tags[], folders[], settings }
  settings.json   # { theme, autoBackup, sidebarCollapsed }
  backups/        # backup_1..3.json (rotating)
  images/         # attached images (img::<filename> refs)
```

Unknown/extra JSON fields are preserved on save (serde flatten catch-all), so the file stays compatible in both directions.

Data directory resolution: `data/` next to the executable if present (portable mode), otherwise the platform user-data dir. In dev builds it is `./data`.

## Build

Requires stable Rust.

```sh
cargo build --release   # binary at target/release/promptdb
cargo test              # data-layer + updater tests
```

CI builds and tests on Windows + macOS. Pushing a `v*` tag builds both platforms and publishes the artifacts to a GitHub Release — which is what the in-app updater checks.

## Releasing

```sh
# bump version in Cargo.toml first
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Repo layout

```
src/main.rs      # UI wiring, callbacks, app state
src/models.rs    # db.json schema (lossless round-trip)
src/store.rs     # load/save, backups, import/export, images
src/updater.rs   # GitHub Releases check (semver)
ui/app.slint     # entire interface (theme global, components, modals)
assets/icons/    # iconsax SVGs (extracted from the original icons.js)
```

The legacy Electron implementation (`main.js`, `renderer.js`, `index.html`, …) is still in the tree as reference until the native version fully retires it.

## License

GPL-3.0-or-later. UI built with Slint (GPLv3/royalty-free/commercial tri-license).
