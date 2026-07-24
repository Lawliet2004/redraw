# Redraw

Local infinite-canvas whiteboard (Tauri v2 + React + Excalidraw).

## Develop

```bash
npm install
npm run tauri dev
```

## Installer

Build a local installer for the current operating system:

```bash
npm run dist
```

The generated packages are written under `src-tauri/target/release/bundle/`:

- Windows: NSIS `.exe` and MSI packages
- Linux: AppImage and `.deb` packages
- macOS: `.dmg` and `.app` bundles

For users, tagged releases are built automatically for Windows x64, Linux x64,
macOS Intel, and macOS Apple Silicon by GitHub Actions. Download them from the
repository's GitHub Releases page.

Windows setup exe (local Windows build):

`src-tauri/target/release/bundle/nsis/Redraw_0.1.0_x64-setup.exe`

Installs for the current user, creates **Desktop** + **Start Menu** shortcuts.

## Notes

- Data: `%LOCALAPPDATA%\\com.papan-ghosh.redraw\\canvas.db` (or app local data path)
- Offline fonts under `public/fonts` (CJK Xiaolai omitted to save ~12 MB; Latin sketch fonts kept)
- App size is mostly `@excalidraw/excalidraw`
