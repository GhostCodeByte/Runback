/**
 * Web-Mercator-Kachelmathematik für OSM-Hintergrundkarten (reine Funktionen).
 *
 * Vorläufige Quelle: CARTO dark_nolabels (OSM-Daten, ohne Beschriftungen,
 * passend zum dunklen Design). Es werden nur Kachelkoordinaten (z/x/y)
 * übertragen, keine GPS-Punkte. Ohne Netz schaltet die UI auf Darstellung
 * ohne Hintergrundkarte zurück.
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface BBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface TileRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cols: number;
  rows: number;
}

export const TILE_SIZE = 256;
/** Grob genug für Übersicht, kein hochauflösendes Heranzoomen. */
export const MAX_ZOOM = 15;
export const MIN_ZOOM = 2;
export const MAX_COLS = 4;
export const MAX_ROWS = 3;
/** Beim interaktiven Zoomen: schärfere Kacheln, aber nie mehr als das. */
export const TILE_BUDGET_COLS = 6;
export const TILE_BUDGET_ROWS = 6;
export const MAX_EFFECTIVE_ZOOM = 17;

const SUBDOMAINS = ['a', 'b', 'c', 'd'];

export function tileUrl(zoom: number, x: number, y: number): string {
  const s = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  return `https://${s}.basemaps.cartocdn.com/dark_nolabels/${zoom}/${x}/${y}.png`;
}

export const TILE_ATTRIBUTION = 'Karte: © OpenStreetMap-Mitwirkende © CARTO';

export function bboxOf(points: GeoPoint[]): BBox | undefined {
  const valid = points.filter(
    p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (!valid.length) {
    return undefined;
  }
  return {
    minLat: Math.min(...valid.map(p => p.latitude)),
    maxLat: Math.max(...valid.map(p => p.latitude)),
    minLon: Math.min(...valid.map(p => p.longitude)),
    maxLon: Math.max(...valid.map(p => p.longitude)),
  };
}

const clampLat = (lat: number): number =>
  Math.max(-85.0511, Math.min(85.0511, lat));

/** Globale Pixelkoordinaten im 256*2^zoom-Raum. */
export function worldPixel(
  lat: number,
  lon: number,
  zoom: number,
): [number, number] {
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n * TILE_SIZE;
  const rad = (clampLat(lat) * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    n *
    TILE_SIZE;
  return [x, y];
}

export function tileRange(bbox: BBox, zoom: number): TileRange {
  const n = Math.pow(2, zoom);
  const [xMin] = worldPixel(bbox.minLat, bbox.minLon, zoom);
  const [xMax] = worldPixel(bbox.maxLat, bbox.maxLon, zoom);
  const [, yNorth] = worldPixel(bbox.maxLat, bbox.minLon, zoom);
  const [, ySouth] = worldPixel(bbox.minLat, bbox.minLon, zoom);
  const x0 = Math.max(0, Math.floor(Math.min(xMin, xMax) / TILE_SIZE));
  const x1 = Math.min(n - 1, Math.floor(Math.max(xMin, xMax) / TILE_SIZE));
  const y0 = Math.max(0, Math.floor(Math.min(yNorth, ySouth) / TILE_SIZE));
  const y1 = Math.min(n - 1, Math.floor(Math.max(yNorth, ySouth) / TILE_SIZE));
  return { x0, x1, y0, y1, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

/**
 * Größter Zoom, dessen Kacheln in maxCols×maxRows passen.
 * undefined, wenn selbst der Mindest-Zoom zu viele Kacheln bräuchte.
 */
export function zoomToFit(
  bbox: BBox,
  maxCols: number = MAX_COLS,
  maxRows: number = MAX_ROWS,
  maxZoom: number = MAX_ZOOM,
  minZoom: number = MIN_ZOOM,
): number | undefined {
  for (let zoom = maxZoom; zoom >= minZoom; zoom--) {
    const range = tileRange(bbox, zoom);
    if (range.cols <= maxCols && range.rows <= maxRows) {
      return zoom;
    }
  }
  return undefined;
}

/** Sichtbarer Ausschnitt, ausgedrückt in Weltpixeln eines Basis-Zooms. */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kacheln, die einen beliebigen Ausschnitt abdecken (auf gültige Indizes begrenzt). */
export function rangeForView(view: ViewRect, zoom: number): TileRange {
  const n = Math.pow(2, zoom);
  const clamp = (v: number): number => Math.max(0, Math.min(n - 1, v));
  const x0 = clamp(Math.floor(view.x / TILE_SIZE));
  const x1 = clamp(Math.floor((view.x + view.w) / TILE_SIZE));
  const y0 = clamp(Math.floor(view.y / TILE_SIZE));
  const y1 = clamp(Math.floor((view.y + view.h) / TILE_SIZE));
  return { x0, x1, y0, y1, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

/**
 * Schärfster Zoom für einen Ausschnitt, ohne das Kachelbudget zu sprengen.
 * Der Basis-Zoom passt immer und ist damit die Untergrenze.
 */
export function bestTileZoom(
  baseZoom: number,
  viewInBasePixels: ViewRect,
  maxZoom: number = MAX_EFFECTIVE_ZOOM,
): number {
  let best = baseZoom;
  for (let zoom = baseZoom + 1; zoom <= maxZoom; zoom++) {
    const k = Math.pow(2, zoom - baseZoom);
    const range = rangeForView(
      {
        x: viewInBasePixels.x * k,
        y: viewInBasePixels.y * k,
        w: viewInBasePixels.w * k,
        h: viewInBasePixels.h * k,
      },
      zoom,
    );
    if (range.cols <= TILE_BUDGET_COLS && range.rows <= TILE_BUDGET_ROWS) {
      best = zoom;
    } else {
      break;
    }
  }
  return best;
}
