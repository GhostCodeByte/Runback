import {
  bboxOf,
  bestTileZoom,
  rangeForView,
  tileRange,
  tileUrl,
  worldPixel,
  zoomToFit,
  MAX_COLS,
  MAX_ROWS,
} from '../src/ui/mapTiles';

describe('mapTiles', () => {
  it('builds a bounding box over valid points only', () => {
    const bbox = bboxOf([
      { latitude: 52, longitude: 13 },
      { latitude: 53, longitude: 14 },
      { latitude: NaN, longitude: 0 },
    ]);
    expect(bbox).toEqual({ minLat: 52, maxLat: 53, minLon: 13, maxLon: 14 });
    expect(bboxOf([])).toBeUndefined();
    expect(bboxOf([{ latitude: NaN, longitude: NaN }])).toBeUndefined();
  });

  it('keeps a point inside its own tile', () => {
    const lat = 52.52;
    const lon = 13.405;
    const zoom = 12;
    const [px, py] = worldPixel(lat, lon, zoom);
    const range = tileRange(
      { minLat: lat, maxLat: lat, minLon: lon, maxLon: lon },
      zoom,
    );
    expect(range.cols).toBe(1);
    expect(range.rows).toBe(1);
    expect(px).toBeGreaterThanOrEqual(range.x0 * 256);
    expect(px).toBeLessThan((range.x1 + 1) * 256);
    expect(py).toBeGreaterThanOrEqual(range.y0 * 256);
    expect(py).toBeLessThan((range.y1 + 1) * 256);
  });

  it('fits a city track into the tile budget', () => {
    const zoom = zoomToFit(
      { minLat: 52.5, maxLat: 52.55, minLon: 13.38, maxLon: 13.45 },
      MAX_COLS,
      MAX_ROWS,
    );
    expect(zoom).toBeDefined();
    const range = tileRange(
      { minLat: 52.5, maxLat: 52.55, minLon: 13.38, maxLon: 13.45 },
      zoom as number,
    );
    expect(range.cols).toBeLessThanOrEqual(MAX_COLS);
    expect(range.rows).toBeLessThanOrEqual(MAX_ROWS);
    expect(zoom as number).toBeLessThanOrEqual(15);
    expect(zoom as number).toBeGreaterThanOrEqual(2);
  });

  it('gives up on world-spanning tracks instead of fetching hundreds of tiles', () => {
    expect(
      zoomToFit(
        { minLat: -80, maxLat: 80, minLon: -170, maxLon: 170 },
        MAX_COLS,
        MAX_ROWS,
      ),
    ).toBeUndefined();
  });
  it('builds stable label-free tile urls', () => {
    expect(tileUrl(12, 2200, 1343)).toBe(
      'https://d.basemaps.cartocdn.com/dark_nolabels/12/2200/1343.png',
    );
    expect(tileUrl(12, 2200, 1343)).toContain('dark_nolabels');
  });

  it('covers a zoomed view with a bounded tile grid', () => {
    const view = { x: 2200 * 256, y: 1343 * 256, w: 512, h: 384 };
    const range = rangeForView(view, 12);
    expect(range.cols).toBeLessThanOrEqual(3);
    expect(range.rows).toBeLessThanOrEqual(3);
    expect(range.x0).toBeLessThanOrEqual(2200);
    expect(range.x1).toBeGreaterThanOrEqual(2201);
  });

  it('sharpens tiles when zooming without breaking the budget', () => {
    const baseZoom = 10;
    const wide = { x: 550 * 256, y: 335 * 256, w: 4 * 256, h: 3 * 256 };
    expect(bestTileZoom(baseZoom, wide)).toBe(baseZoom);
    const narrow = { x: 550 * 256, y: 335 * 256, w: 256, h: 192 };
    const sharper = bestTileZoom(baseZoom, narrow);
    expect(sharper).toBeGreaterThan(baseZoom);
    expect(sharper).toBeLessThanOrEqual(17);
    const k = Math.pow(2, sharper - baseZoom);
    const range = rangeForView(
      { x: narrow.x * k, y: narrow.y * k, w: narrow.w * k, h: narrow.h * k },
      sharper,
    );
    expect(range.cols).toBeLessThanOrEqual(6);
    expect(range.rows).toBeLessThanOrEqual(6);
  });
});
