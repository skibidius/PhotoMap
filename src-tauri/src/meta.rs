//! EXIF metadata extraction: GPS coordinates, shooting direction (azimuth),
//! altitude, capture time and orientation.

use std::path::Path;

/// Everything the app needs to know about a single photo.
pub struct GpsData {
    pub latitude: f64,
    pub longitude: f64,
    /// Shooting direction in degrees (0 = north, clockwise). `None` when the
    /// camera did not record it.
    pub azimuth: Option<f64>,
    /// 'T' for true north, 'M' for magnetic north.
    pub azimuth_ref: Option<u8>,
    pub altitude: Option<f64>,
    /// Capture time as "YYYY-MM-DD HH:MM:SS" when available.
    pub datetime: Option<String>,
    /// EXIF orientation value (1..=8).
    pub orientation: u32,
    /// Focal length in millimetres (the real lens value).
    pub focal_length: Option<f64>,
    /// 35mm-equivalent focal length, when the camera writes it.
    pub focal_length_35: Option<f64>,
    /// Horizontal field of view in degrees, derived from the focal length.
    pub fov: f64,
}

/// Small stable hash of a path string. Used both as the photo id and as the
/// thumbnail cache filename, so re-importing the same file never duplicates
/// work and ids stay the same across runs.
pub fn hash_path(s: &str) -> u64 {
    let mut h: u64 = 5381;
    for b in s.bytes() {
        h = h.wrapping_mul(33).wrapping_add(b as u64);
    }
    h
}

/// Read a RATIONAL or SRATIONAL list as f64. Some cameras store GPS
/// coordinates as SRATIONAL even though the spec says RATIONAL.
fn rationals(v: &exif::Value) -> Option<Vec<f64>> {
    match v {
        exif::Value::Rational(r) => Some(r.iter().map(|x| x.to_f64()).collect()),
        exif::Value::SRational(r) => Some(r.iter().map(|x| x.to_f64()).collect()),
        _ => None,
    }
}

fn first_rational(v: &exif::Value) -> Option<f64> {
    rationals(v).and_then(|r| r.first().copied())
}

/// Convert three DMS values (degrees, minutes, seconds) to decimal degrees.
fn to_dms(r: &[f64]) -> f64 {
    let d = r.first().copied().unwrap_or(0.0);
    let m = r.get(1).copied().unwrap_or(0.0);
    let s = r.get(2).copied().unwrap_or(0.0);
    d + m / 60.0 + s / 3600.0
}

fn ascii_byte(v: &exif::Value) -> Option<u8> {
    match v {
        exif::Value::Ascii(ref s) => s.first().and_then(|b| b.first()).copied(),
        _ => None,
    }
}

/// EXIF stores "YYYY:MM:DD HH:MM:SS"; we normalize to "YYYY-MM-DD HH:MM:SS".
fn parse_datetime(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = s.to_string();
    if b.len() >= 10 && b[4] == b':' && b[7] == b':' {
        out.replace_range(4..5, "-");
        out.replace_range(7..8, "-");
    }
    out
}

/// Horizontal field of view from the focal length, assuming a full-frame
/// (36 mm) sensor. The 35mm-equivalent value is preferred because it is
/// independent of the sensor size; a raw focal length below ~8 mm almost
/// always comes from a phone/action camera, so without its 35mm-equivalent we
/// fall back to a neutral default instead of guessing a wildly wrong angle.
fn fov_from_focal(focal_35: Option<f64>, focal: Option<f64>) -> f64 {
    let f = match focal_35 {
        Some(x) if x > 0.0 => Some(x),
        _ => focal.filter(|&x| x >= 8.0),
    };
    match f {
        Some(f) => (2.0 * (18.0 / f).atan().to_degrees()).clamp(10.0, 120.0),
        None => 55.0,
    }
}

/// Read GPS metadata from a single image file. Returns `None` when the file
/// has no EXIF data or no usable coordinates.
pub fn extract(path: &Path) -> Option<GpsData> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new().read_from_container(&mut reader).ok()?;

    let mut lat: Option<f64> = None;
    let mut lat_ref: Option<u8> = None;
    let mut lon: Option<f64> = None;
    let mut lon_ref: Option<u8> = None;
    let mut azimuth: Option<f64> = None;
    let mut azimuth_ref: Option<u8> = None;
    let mut altitude: Option<f64> = None;
    let mut datetime: Option<String> = None;
    let mut orientation: u32 = 1;
    let mut focal_length: Option<f64> = None;
    let mut focal_length_35: Option<f64> = None;

    // Iterate every field regardless of which IFD it lives in; GPS fields are
    // stored in their own sub-IFD and this finds them without hardcoding
    // IFD indices.
    for f in exif.fields() {
        let t = f.tag;
        if t == exif::Tag::GPSLatitude {
            if let Some(v) = rationals(&f.value) {
                lat = Some(to_dms(&v));
            }
        } else if t == exif::Tag::GPSLatitudeRef {
            lat_ref = ascii_byte(&f.value);
        } else if t == exif::Tag::GPSLongitude {
            if let Some(v) = rationals(&f.value) {
                lon = Some(to_dms(&v));
            }
        } else if t == exif::Tag::GPSLongitudeRef {
            lon_ref = ascii_byte(&f.value);
        } else if t == exif::Tag::GPSImgDirection {
            azimuth = first_rational(&f.value);
        } else if t == exif::Tag::GPSImgDirectionRef {
            azimuth_ref = ascii_byte(&f.value);
        } else if t == exif::Tag::GPSAltitude {
            altitude = first_rational(&f.value);
        } else if t == exif::Tag::DateTimeOriginal {
            if let exif::Value::Ascii(ref v) = f.value {
                if let Some(s) = v.first() {
                    if let Ok(s) = std::str::from_utf8(s) {
                        datetime = Some(parse_datetime(s));
                    }
                }
            }
        } else if t == exif::Tag::Orientation {
            orientation = f.value.get_uint(0).unwrap_or(1);
        } else if t == exif::Tag::FocalLength {
            focal_length = first_rational(&f.value);
        } else if t == exif::Tag::FocalLengthIn35mmFilm {
            focal_length_35 = f
                .value
                .get_uint(0)
                .map(|x| x as f64)
                .or_else(|| first_rational(&f.value));
        }
    }

    let (lat, lat_ref, lon, lon_ref) = (lat?, lat_ref?, lon?, lon_ref?);
    let latitude = if lat_ref == b'S' { -lat } else { lat };
    let longitude = if lon_ref == b'W' { -lon } else { lon };

    Some(GpsData {
        latitude,
        longitude,
        azimuth,
        azimuth_ref,
        altitude,
        datetime,
        orientation,
        focal_length,
        focal_length_35,
        fov: fov_from_focal(focal_length_35, focal_length),
    })
}
