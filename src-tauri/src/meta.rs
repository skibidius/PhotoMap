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

/// Convert the three RATIONAL values of a GPS DMS coordinate to decimal.
fn to_dms(r: &[exif::Rational]) -> f64 {
    let d = r.first().map(|x| x.to_f64()).unwrap_or(0.0);
    let m = r.get(1).map(|x| x.to_f64()).unwrap_or(0.0);
    let s = r.get(2).map(|x| x.to_f64()).unwrap_or(0.0);
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

    // Iterate every field regardless of which IFD it lives in; GPS fields are
    // stored in their own sub-IFD and this finds them without hardcoding
    // IFD indices.
    for f in exif.fields() {
        let t = f.tag;
        if t == exif::Tag::GPSLatitude {
            if let exif::Value::Rational(ref v) = f.value {
                lat = Some(to_dms(v));
            }
        } else if t == exif::Tag::GPSLatitudeRef {
            lat_ref = ascii_byte(&f.value);
        } else if t == exif::Tag::GPSLongitude {
            if let exif::Value::Rational(ref v) = f.value {
                lon = Some(to_dms(v));
            }
        } else if t == exif::Tag::GPSLongitudeRef {
            lon_ref = ascii_byte(&f.value);
        } else if t == exif::Tag::GPSImgDirection {
            if let exif::Value::Rational(ref v) = f.value {
                azimuth = v.first().map(|x| x.to_f64());
            }
        } else if t == exif::Tag::GPSImgDirectionRef {
            azimuth_ref = ascii_byte(&f.value);
        } else if t == exif::Tag::GPSAltitude {
            if let exif::Value::Rational(ref v) = f.value {
                altitude = v.first().map(|x| x.to_f64());
            }
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
    })
}
