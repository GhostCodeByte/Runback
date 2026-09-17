import {
  createPreviewRoute,
  formatPaceSeconds,
  haversineMeters,
  nearestRoutePoint,
  nextTurn,
  remainingRouteMeters,
  routeDistanceMeters,
} from '../src/domain/routes';

const start = { latitude: 48, longitude: 7.8 };

describe('route planning domain', () => {
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
