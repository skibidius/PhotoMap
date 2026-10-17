//! Tauri commands exposed to the frontend.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::{meta, thumbs};

#[derive(Serialize, Clone)]
pub struct PhotoMeta {
    pub id: String,
    pub path: String,
    pub album: String,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub azimuth: Option<f64>,
    pub azimuth_ref: Option<String>,
    pub altitude: Option<f64>,
    pub datetime: Option<String>,
    pub orientation: u32,
    pub thumb: Option<String>,
    pub focal_length: Option<f64>,
    pub focal_length_35: Option<f64>,
    pub fov: f64,
}

#[derive(Serialize)]
pub struct ScanSummary {
    pub photos: Vec<PhotoMeta>,
    pub scanned: u32,
    pub with_gps: u32,
    pub errors: u32,
}

#[derive(Serialize, Clone)]
struct ScanProgress {
    scanned: u32,
    found: u32,
    current: String,
}

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "tif", "tiff", "heic", "heif",
];

/// Walk one or more folders, extract GPS metadata from every image and build
/// cached thumbnails. Emits `scan-progress` events so the UI can stay alive.
/// Runs on a blocking thread because decoding thumbnails is CPU-heavy.
#[tauri::command]
pub async fn scan_roots(app: tauri::AppHandle, roots: Vec<String>) -> Result<ScanSummary, String> {
    tauri::async_runtime::spawn_blocking(move || scan_roots_impl(app, roots))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_roots_impl(app: tauri::AppHandle, roots: Vec<String>) -> Result<ScanSummary, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let thumbs_dir = cache.join("thumbs");
    let _ = std::fs::create_dir_all(&thumbs_dir);

    let mut photos: Vec<PhotoMeta> = Vec::new();
    let mut scanned: u32 = 0;
    let mut errors: u32 = 0;

    for root in &roots {
        let root_path = PathBuf::from(root);
        let album = if root_path.is_dir() {
            root_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.clone())
        } else {
            root_path
                .parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| root.clone())
        };

        for entry in walkdir::WalkDir::new(&root_path).follow_links(false) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    errors += 1;
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase());
            if !matches!(ext.as_deref(), Some(e) if IMAGE_EXTS.contains(&e)) {
                continue;
            }

            scanned += 1;

            let Some(data) = meta::extract(path) else {
                continue;
            };

            let path_str = path.to_string_lossy();
            let id = format!("{:016x}", meta::hash_path(&path_str));
            let thumb_path = thumbs_dir.join(format!("{}.jpg", id));
            let thumb = if thumb_path.exists()
                || thumbs::make_thumbnail(path, &thumb_path, data.orientation)
            {
                Some(thumb_path.to_string_lossy().into_owned())
            } else {
                None
            };

            photos.push(PhotoMeta {
                id,
                path: path_str.clone().into_owned(),
                album: album.clone(),
                name: path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                latitude: data.latitude,
                longitude: data.longitude,
                azimuth: data.azimuth,
                azimuth_ref: data.azimuth_ref.map(|b| (b as char).to_string()),
                altitude: data.altitude,
                datetime: data.datetime.clone(),
                orientation: data.orientation,
                thumb,
                focal_length: data.focal_length,
                focal_length_35: data.focal_length_35,
                fov: data.fov,
            });

            if scanned % 20 == 0 {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        scanned,
                        found: photos.len() as u32,
                        current: path_str.into_owned(),
                    },
                );
            }
        }
    }

    let _ = app.emit(
        "scan-progress",
        ScanProgress {
            scanned,
            found: photos.len() as u32,
            current: String::new(),
        },
    );

    let with_gps = photos.len() as u32;

    Ok(ScanSummary {
        photos,
        scanned,
        with_gps,
        errors,
    })
}

/// Read an arbitrary file as bytes. Used to stream thumbnails and full-size
/// photos into the webview without going through the asset protocol scope.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Fetch a remote tile through native HTTP, bypassing CORS restrictions that
/// would break the in-browser screenshot exporter.
#[tauri::command]
pub async fn fetch_tile(url: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_tile_impl(url))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_tile_impl(url: String) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let resp = ureq::get(&url)
        .set("User-Agent", "PhotoMap/0.1 (+https://github.com)")
        .set("Accept", "image/*")
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    resp.into_reader()
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Write a UTF-8 text file (KML / GeoJSON export).
#[tauri::command]
pub fn save_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Write binary data from a base64 string (PNG screenshot export).
#[tauri::command]
pub fn save_bytes(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Reveal a file in the OS file manager.
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
