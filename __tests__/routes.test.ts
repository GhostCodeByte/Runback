import {
  createPreviewRoute,
  formatPaceSeconds,
  googleMapsDirectionsUrl,
  haversineMeters,
  limitRoutePoints,
  nearestRoutePoint,
  nextTurn,
  remainingRouteMeters,
  routeDistanceMeters,
} from '../src/domain/routes';

const start = { latitude: 48, longitude: 7.8 };

describe('route planning domain', () => {
  it('builds a short Google Maps directions link with ordered walking waypoints', () => {
    const url = googleMapsDirectionsUrl([
      { latitude: 48.0, longitude: 7.8 },
      { latitude: 48.001, longitude: 7.801 },
      { latitude: 48.002, longitude: 7.802 },
      { latitude: 48.003, longitude: 7.803 },
      { latitude: 48.004, longitude: 7.804 },
    ]);

    expect(url).toContain('https://www.google.com/maps/dir/?api=1');
    expect(url).toContain('travelmode=walking');
    expect(url).toContain('origin=48.000000%2C7.800000');
    expect(url).toContain('destination=48.004000%2C7.804000');
    expect(url).toContain(
      'waypoints=48.001000%2C7.801000%7C48.002000%2C7.802000%7C48.003000%2C7.803000',
    );
  });

  it('does not create an external link for an incomplete route', () => {
    expect(googleMapsDirectionsUrl([])).toBe('');
    expect(googleMapsDirectionsUrl([{ latitude: 48.0, longitude: 7.8 }])).toBe(
      '',
    );
  });

  it('creates a loop close to the requested total distance', () => {
    const route = createPreviewRoute(
      {
        start,
        startLabel: 'Start',
        distanceKm: 5,
        mode: 'loop',
        preference: 'flat',
      },
      100,
    );

    expect(route.points[0]).toEqual(start);
    expect(route.points[route.points.length - 1]).toEqual(start);
    expect(route.distanceMeters).toBeGreaterThan(4_900);
    expect(route.distanceMeters).toBeLessThan(5_100);
  });

  it('creates an out-and-back with the same start and end', () => {
    const route = createPreviewRoute(
      {
        start,
        startLabel: 'Start',
        distanceKm: 8,
        mode: 'out_and_back',
        preference: 'balanced',
      },
      100,
    );

    expect(route.points[0]).toEqual(start);
    expect(route.points[route.points.length - 1]).toEqual(start);
    expect(routeDistanceMeters(route.points)).toBeCloseTo(8_000, -1);
  });

  it('finds progress and remaining distance from the planned path', () => {
    const route = createPreviewRoute(
      {
        start,
        startLabel: 'Start',
        distanceKm: 5,
        mode: 'out_and_back',
        preference: 'balanced',
      },
      100,
    );
    const current = route.points[4];
    const nearest = nearestRoutePoint(route.points, current);

    expect(nearest.index).toBe(4);
    expect(nearest.distanceMeters).toBe(0);
    expect(remainingRouteMeters(route.points, nearest.index)).toBeLessThan(
      route.distanceMeters,
    );
    expect(haversineMeters(start, start)).toBe(0);
  });

  it('does not jump back to the outbound leg after the turnaround', () => {
    const route = createPreviewRoute(
      {
        start,
        startLabel: 'Start',
        distanceKm: 8,
        mode: 'out_and_back',
        preference: 'balanced',
      },
      100,
    );
    const outbound = nearestRoutePoint(route.points, route.points[5]);
    const returnPoint = nearestRoutePoint(
      route.points,
      route.points[route.points.length - 3],
      outbound.index,
    );

    expect(returnPoint.index).toBeGreaterThan(outbound.index);
  });

  it('formats a pace without inventing a value', () => {
    expect(formatPaceSeconds(5 * 60 + 7)).toBe('5:07 /km');
    expect(formatPaceSeconds(undefined)).toBe('–:––');
  });

  it('keeps route endpoints while bounding detailed geometry', () => {
    const points = Array.from({ length: 1_000 }, (_, index) => ({
      latitude: 48 + index / 100_000,
      longitude: 7.8 + Math.sin(index / 20) / 100_000,
    }));
    const bounded = limitRoutePoints(points, 128);

    expect(bounded.length).toBeLessThanOrEqual(128);
    expect(bounded[0]).toEqual(points[0]);
    expect(bounded[bounded.length - 1]).toEqual(points[points.length - 1]);
  });

  it('finds a meaningful turn ahead without inventing one on a straight path', () => {
    const straight = [
      { latitude: 48, longitude: 7.8 },
      { latitude: 48.001, longitude: 7.8 },
      { latitude: 48.002, longitude: 7.8 },
      { latitude: 48.003, longitude: 7.8 },
      { latitude: 48.004, longitude: 7.8 },
    ];
    expect(nextTurn(straight, 0)).toBeUndefined();

    const corner = [
      { latitude: 48, longitude: 7.8 },
      { latitude: 48.001, longitude: 7.8 },
      { latitude: 48.002, longitude: 7.8 },
      { latitude: 48.002, longitude: 7.802 },
      { latitude: 48.002, longitude: 7.804 },
      { latitude: 48.002, longitude: 7.806 },
    ];
    expect(nextTurn(corner, 0)?.direction).toBe('right');
  });
});
