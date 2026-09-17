export type RouteMode = 'loop' | 'out_and_back';
export type RoutePreference = 'flat' | 'quiet' | 'green' | 'balanced';
export type RouteSource = 'brouter' | 'preview';

export interface RouteCoordinate {
  latitude: number;
  longitude: number;
  elevationMeters?: number;
}

export interface RouteRequest {
  start: RouteCoordinate;
  startLabel: string;
  distanceKm: number;
  mode: RouteMode;
  preference: RoutePreference;
}

export interface RoutePlan extends RouteRequest {
  id: string;
  createdAt: number;
  points: RouteCoordinate[];
  distanceMeters: number;
  ascentMeters?: number;
  source: RouteSource;
  providerLabel: string;
  preferencePenalty?: number;
  activeRunId?: string;
}

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_DEGREE_LATITUDE = 111_320;

const preferenceLabels: Record<RoutePreference, string> = {
  flat: 'möglichst flach',
  quiet: 'möglichst ruhig',
  green: 'möglichst grün',
  balanced: 'ausgeglichen',
};

export const routePreferenceLabel = (value: RoutePreference) =>
  preferenceLabels[value];

export function haversineMeters(
  first: RouteCoordinate,
  second: RouteCoordinate,
): number {
  const latitude = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitude = ((second.longitude - first.longitude) * Math.PI) / 180;
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, value)));
}

export function routeDistanceMeters(points: RouteCoordinate[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMeters(points[index - 1], points[index]);
  }
  return total;
}

function validRoutePoints(points: RouteCoordinate[]) {
  return points.filter(
    point =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
}

/**
 * Google Maps nimmt Zwischenziele entgegen, aber keine komplette GPS-Spur.
 * Wenige gleichmäßig verteilte Punkte halten den Link kurz und bewahren die
 * grobe Form, während Google die begehbare Verbindung neu berechnet.
 */
export function routeWaypoints(
  points: RouteCoordinate[],
  maximum = 3,
): RouteCoordinate[] {
  const valid = validRoutePoints(points);
  const middle = valid.slice(1, -1);
  const limit = Math.max(0, Math.floor(maximum));
  if (middle.length <= limit) return middle;
  if (limit === 0) return [];
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (middle.length - 1)) / Math.max(limit - 1, 1),
    );
    return middle[sourceIndex];
  });
}

function coordinateForMaps(point: RouteCoordinate) {
  return `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
}

/** Universal Google-Maps-Link für eine Laufroute mit wenigen Formpunkten. */
export function googleMapsDirectionsUrl(points: RouteCoordinate[]): string {
  const valid = validRoutePoints(points);
  if (valid.length < 2) return '';
  const origin = coordinateForMaps(valid[0]);
  const destination = coordinateForMaps(valid[valid.length - 1]);
  const waypoints = routeWaypoints(valid).map(coordinateForMaps).join('|');
  return [
    'https://www.google.com/maps/dir/?api=1',
    `origin=${encodeURIComponent(origin)}`,
    `destination=${encodeURIComponent(destination)}`,
    'travelmode=walking',
    waypoints ? `waypoints=${encodeURIComponent(waypoints)}` : '',
  ]
    .filter(Boolean)
    .join('&');
}

/** Keep route documents and SVG rendering bounded without changing endpoints. */
export function limitRoutePoints(
  points: RouteCoordinate[],
  maxPoints = 512,
): RouteCoordinate[] {
  if (points.length <= maxPoints) return points;
  const limit = Math.max(2, Math.floor(maxPoints));
  const pointToSegmentDistance = (
    point: RouteCoordinate,
    first: RouteCoordinate,
    second: RouteCoordinate,
  ) => {
    const target = localMeters(first, second);
    const current = localMeters(first, point);
    const denominator = target.north ** 2 + target.east ** 2;
    if (denominator <= 0) return Math.hypot(current.north, current.east);
    const ratio = Math.max(
      0,
      Math.min(
        1,
        (current.north * target.north + current.east * target.east) /
          denominator,
      ),
    );
    return Math.hypot(
      current.north - target.north * ratio,
      current.east - target.east * ratio,
    );
  };
  const simplify = (tolerance: number) => {
    const keep = new Set([0, points.length - 1]);
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
      const [firstIndex, lastIndex] = stack.pop() as [number, number];
      let splitIndex = -1;
      let splitDistance = tolerance;
      for (let index = firstIndex + 1; index < lastIndex; index += 1) {
        const distance = pointToSegmentDistance(
          points[index],
          points[firstIndex],
          points[lastIndex],
        );
        if (distance > splitDistance) {
          splitDistance = distance;
          splitIndex = index;
        }
      }
      if (splitIndex >= 0) {
        keep.add(splitIndex);
        stack.push([firstIndex, splitIndex], [splitIndex, lastIndex]);
      }
    }
    return [...keep].sort((first, second) => first - second);
  };

  let high = 1;
  for (const point of points) {
    high = Math.max(high, haversineMeters(points[0], point));
  }
  let low = 0;
  let best = [0, points.length - 1];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const midpoint = (low + high) / 2;
    const candidate = simplify(midpoint);
    if (candidate.length <= limit) {
      best = candidate;
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return best.map(index => points[index]);
}

export function routeAscentMeters(
  points: RouteCoordinate[],
): number | undefined {
  const withElevation = points.filter(point =>
    Number.isFinite(point.elevationMeters),
  );
  if (withElevation.length < 2 || withElevation.length !== points.length) {
    return undefined;
  }
  let ascent = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta =
      (points[index].elevationMeters || 0) -
      (points[index - 1].elevationMeters || 0);
    if (delta > 0) ascent += delta;
  }
  return ascent;
}

export function offsetPoint(
  origin: RouteCoordinate,
  distanceMeters: number,
  bearingDegreesValue: number,
): RouteCoordinate {
  const bearing = (bearingDegreesValue * Math.PI) / 180;
  const latitudeRadians = (origin.latitude * Math.PI) / 180;
  const north = Math.cos(bearing) * distanceMeters;
  const east = Math.sin(bearing) * distanceMeters;
  return {
    latitude: origin.latitude + north / METERS_PER_DEGREE_LATITUDE,
    longitude:
      origin.longitude +
      east / (METERS_PER_DEGREE_LATITUDE * Math.cos(latitudeRadians)),
  };
}

function localMeters(origin: RouteCoordinate, point: RouteCoordinate) {
  const latitudeRadians = (origin.latitude * Math.PI) / 180;
  return {
    north: (point.latitude - origin.latitude) * METERS_PER_DEGREE_LATITUDE,
    east:
      (point.longitude - origin.longitude) *
      METERS_PER_DEGREE_LATITUDE *
      Math.cos(latitudeRadians),
  };
}

function fromLocalMeters(origin: RouteCoordinate, north: number, east: number) {
  const latitudeRadians = (origin.latitude * Math.PI) / 180;
  return {
    latitude: origin.latitude + north / METERS_PER_DEGREE_LATITUDE,
    longitude:
      origin.longitude +
      east / (METERS_PER_DEGREE_LATITUDE * Math.cos(latitudeRadians)),
  };
}

function scaleToDistance(
  points: RouteCoordinate[],
  origin: RouteCoordinate,
  targetMeters: number,
): RouteCoordinate[] {
  const actual = routeDistanceMeters(points);
  if (actual <= 0 || !Number.isFinite(actual)) return points;
  const factor = targetMeters / actual;
  return points.map(point => {
    const local = localMeters(origin, point);
    return fromLocalMeters(origin, local.north * factor, local.east * factor);
  });
}

function previewPoints(request: RouteRequest, seed: number) {
  const targetMeters = request.distanceKm * 1000;
  const bearing = (seed * 73 + 38) % 360;
  const forward = {
    north: Math.cos((bearing * Math.PI) / 180),
    east: Math.sin((bearing * Math.PI) / 180),
  };
  const sideways = { north: -forward.east, east: forward.north };

  if (request.mode === 'out_and_back') {
    const outwardMeters = targetMeters / 2;
    const outbound: RouteCoordinate[] = [];
    for (let index = 0; index <= 8; index += 1) {
      const progress = index / 8;
      const side = Math.sin(progress * Math.PI) * targetMeters * 0.08;
      outbound.push(
        fromLocalMeters(
          request.start,
          forward.north * outwardMeters * progress + sideways.north * side,
          forward.east * outwardMeters * progress + sideways.east * side,
        ),
      );
    }
    const points = outbound.concat(outbound.slice(0, -1).reverse());
    return scaleToDistance(points, request.start, targetMeters);
  }

  const radius = (targetMeters / (2 * Math.PI)) * 0.78;
  const ring: RouteCoordinate[] = [];
  const pointsInRing = 16;
  for (let index = 0; index <= pointsInRing; index += 1) {
    const angle = (index / pointsInRing) * Math.PI * 2;
    const wobble = 1 + Math.sin(angle * 3 + seed) * 0.12;
    const north = forward.north * radius + sideways.north * 0;
    const east = forward.east * radius + sideways.east * 0;
    ring.push(
      fromLocalMeters(
        request.start,
        north * Math.cos(angle) * wobble - east * Math.sin(angle) * wobble,
        east * Math.cos(angle) * wobble + north * Math.sin(angle) * wobble,
      ),
    );
  }
  const points = [request.start, ...ring, request.start];
  return scaleToDistance(points, request.start, targetMeters);
}

export function createPreviewRoute(
  request: RouteRequest,
  createdAt = Date.now(),
  seed = 0,
): RoutePlan {
  const points = previewPoints(request, seed);
  return {
    ...request,
    id: `route-${createdAt}-${seed}`,
    createdAt,
    points,
    distanceMeters: routeDistanceMeters(points),
    ascentMeters: routeAscentMeters(points),
    source: 'preview',
    providerLabel: 'Lokale Vorschau',
  };
}

export function nearestRoutePoint(
  route: RouteCoordinate[],
  current: RouteCoordinate,
  minimumIndex = 0,
) {
  if (!route.length) return { index: -1, distanceMeters: undefined };
  const firstIndex = Math.min(
    Math.max(0, Math.floor(minimumIndex)),
    route.length - 1,
  );
  let index = firstIndex;
  let distance = haversineMeters(route[firstIndex], current);
  for (
    let candidate = firstIndex + 1;
    candidate < route.length;
    candidate += 1
  ) {
    const nextDistance = haversineMeters(route[candidate], current);
    if (nextDistance < distance) {
      distance = nextDistance;
      index = candidate;
    }
  }
  return { index, distanceMeters: distance };
}

export function remainingRouteMeters(
  route: RouteCoordinate[],
  nearestIndex: number,
): number | undefined {
  if (nearestIndex < 0 || nearestIndex >= route.length) return undefined;
  return routeDistanceMeters(route.slice(nearestIndex));
}

function bearingDegrees(first: RouteCoordinate, second: RouteCoordinate) {
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const longitude = ((second.longitude - first.longitude) * Math.PI) / 180;
  const y = Math.sin(longitude) * Math.cos(secondLatitude);
  const x =
    Math.cos(firstLatitude) * Math.sin(secondLatitude) -
    Math.sin(firstLatitude) * Math.cos(secondLatitude) * Math.cos(longitude);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function bearingDelta(first: number, second: number) {
  return ((second - first + 540) % 360) - 180;
}

export function nextTurn(
  route: RouteCoordinate[],
  nearestIndex: number,
): { direction: 'left' | 'right'; distanceMeters: number } | undefined {
  if (nearestIndex < 0 || nearestIndex >= route.length - 3) return undefined;
  const currentIndex = Math.min(nearestIndex + 2, route.length - 2);
  const currentBearing = bearingDegrees(
    route[nearestIndex],
    route[currentIndex],
  );
  let distance = routeDistanceMeters(
    route.slice(nearestIndex, currentIndex + 1),
  );
  for (let index = currentIndex + 1; index < route.length - 2; index += 1) {
    const nextBearing = bearingDegrees(route[index], route[index + 2]);
    const delta = bearingDelta(currentBearing, nextBearing);
    if (Math.abs(delta) >= 45 && distance >= 35) {
      return {
        direction: delta > 0 ? 'right' : 'left',
        distanceMeters: distance,
      };
    }
    distance += haversineMeters(route[index], route[index + 1]);
  }
  return undefined;
}

export function formatDistanceKm(meters: number | undefined): string {
  if (!Number.isFinite(meters)) return '–';
  return `${((meters || 0) / 1000).toFixed(2).replace('.', ',')} km`;
}

export function formatPaceSeconds(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || (seconds || 0) <= 0) return '–:––';
  const rounded = Math.round(seconds || 0);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(
    2,
    '0',
  )} /km`;
}
