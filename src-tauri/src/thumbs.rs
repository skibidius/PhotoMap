//! Thumbnail generation with EXIF orientation applied.

use std::path::Path;

const THUMB_MAX: u32 = 256;

/// Generate a JPEG thumbnail of `src` at `dst`, honoring the EXIF orientation.
/// Returns `false` when the file cannot be decoded (e.g. HEIC on platforms
/// where the `image` crate has no decoder); the UI then falls back to the
/// original file.
pub fn make_thumbnail(src: &Path, dst: &Path, orientation: u32) -> bool {
    let img = match image::open(src) {
        Ok(i) => i,
        Err(_) => return false,
    };
    let img = apply_orientation(img, orientation);
    let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);
    thumb
        .save_with_format(dst, image::ImageFormat::Jpeg)
        .is_ok()
}

fn apply_orientation(img: image::DynamicImage, o: u32) -> image::DynamicImage {
    match o {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.fliph().rotate270(),
        6 => img.rotate90(),
        7 => img.flipv().rotate270(),
        8 => img.rotate270(),
        _ => img,
    }
}
