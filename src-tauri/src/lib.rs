#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let icon =
                        tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
                    let _ = win.set_icon(icon);
                }
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
