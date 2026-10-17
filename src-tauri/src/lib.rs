mod commands;
mod meta;
mod thumbs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_roots,
            commands::read_file_bytes,
            commands::preview_bytes,
            commands::fetch_tile,
            commands::save_text,
            commands::save_bytes,
            commands::reveal_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
