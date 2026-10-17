mod commands;
mod meta;
mod thumbs;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Response, StatusCode};

fn photo_mime(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "heic" | "heif" => "image/heic",
        "tif" | "tiff" => "image/tiff",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Serve photo files straight to the webview via a custom protocol.
        // This avoids shipping multi-megabyte originals over IPC and lets the
        // platform decoder handle JPEG/PNG/WebP/HEIC natively.
        .register_uri_scheme_protocol("photo", |_ctx, request| {
            let query = request.uri().query().unwrap_or("");
            let encoded = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("p="))
                .unwrap_or("");
            let path = percent_decode_str(encoded).decode_utf8_lossy().into_owned();
            let mime = photo_mime(&path);
            if mime == "application/octet-stream" {
                return Response::builder()
                    .status(StatusCode::FORBIDDEN)
                    .body(Vec::new())
                    .unwrap();
            }
            match std::fs::read(&path) {
                Ok(bytes) => Response::builder()
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(header::CACHE_CONTROL, "max-age=3600")
                    .body(bytes)
                    .unwrap(),
                Err(_) => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_roots,
            commands::read_file_bytes,
            commands::preview_bytes,
            commands::fetch_tile,
            commands::save_text,
            commands::save_bytes,
            commands::reveal_in_file_manager,
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
