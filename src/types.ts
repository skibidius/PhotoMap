export interface Photo {
  id: string;
  path: string;
  album: string;
  name: string;
  latitude: number;
  longitude: number;
  azimuth: number | null;
  azimuth_ref: string | null;
  altitude: number | null;
  datetime: string | null;
  orientation: number;
  thumb: string | null;
  focal_length: number | null;
  focal_length_35: number | null;
  fov: number;
  /** True for a 360° equirectangular panorama. */
  is_pano?: boolean;
}

export interface ScanSummary {
  photos: Photo[];
  scanned: number;
  with_gps: number;
  errors: number;
}

export interface AlbumInfo {
  name: string;
  color: string;
  count: number;
}
