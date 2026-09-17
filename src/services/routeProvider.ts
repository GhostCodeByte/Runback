import {
  limitRoutePoints,
  offsetPoint,
  routeAscentMeters,
  routeDistanceMeters,
  type RouteCoordinate,
  type RoutePlan,
  type RoutePreference,
  type RouteRequest,
} from '../domain/routes';

const B_ROUTER_URL = 'https://brouter.de/brouter';

type BRouterFeature = {
  geometry?: { coordinates?: number[][] };
  properties?: Record<string, unknown>;
};

type BRouterResponse = { features?: BRouterFeature[] };

function preferencePenalty(
  properties: Record<string, unknown> | undefined,
  preference: RoutePreference,
) {
  const messages = properties?.messages;
  if (!Array.isArray(messages)) return 0;
  const wayTags = messages
    .slice(1)
    .map(row => (Array.isArray(row) ? String(row[9] || '') : ''))
    .filter(Boolean);
  return wayTags.reduce((penalty, tags) => {
    const isMainRoad = /highway=(trunk|primary|secondary)/.test(tags);
    const isQuietPath = /highway=(path|footway|track|bridleway)/.test(tags);
    const isGreenSurface =
      /surface=(unpaved|ground|fine_gravel|gravel|dirt)/.test(tags);
    if (preference === 'quiet')
      return penalty + (isMainRoad ? 4 : isQuietPath ? -1 : 0);
    if (preference === 'green')
      return (
        penalty + (isQuietPath || isGreenSurface ? -1 : isMainRoad ? 3 : 0)
      );
    return penalty;
  }, 0);
}

function preferenceBearing(preference: RoutePreference) {
  switch (preference) {
    case 'flat':
      return 25;
    case 'quiet':
      return 145;
    case 'green':
      return 265;
    default:
      return 85;
  }
}

function waypointsFor(
  request: RouteRequest,
  variant: number,
): RouteCoordinate[] {
  const targetMeters = request.distanceKm * 1000;
  const bearing = preferenceBearing(request.preference) + variant * 120;
  if (request.mode === 'out_and_back') {
    return [
      request.start,
      offsetPoint(request.start, targetMeters / 2, bearing),
    ];
  }
  const radius = Math.max(350, (targetMeters / (2 * Math.PI)) * 0.8);
  return [
    request.start,
    offsetPoint(request.start, radius, bearing),
    offsetPoint(request.start, radius * 1.08, bearing + 120),
    offsetPoint(request.start, radius * 0.95, bearing + 240),
    request.start,
  ];
}

function routeFromFeature(
  request: RouteRequest,
  feature: BRouterFeature,
  variant: number,
  createdAt: number,
): RoutePlan | null {
  const rawCoordinates = feature.geometry?.coordinates;
  if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) return null;
  const points = rawCoordinates
    .filter(
      coordinate =>
        coordinate.length >= 2 &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1]),
    )
    .map(coordinate => ({
      longitude: coordinate[0],
      latitude: coordinate[1],
      ...(Number.isFinite(coordinate[2])
        ? { elevationMeters: coordinate[2] }
        : {}),
    }));
  if (points.length < 2) return null;

  const outbound = request.mode === 'out_and_back' ? points : null;
  const combined = outbound
    ? outbound.concat(outbound.slice(0, -1).reverse())
    : points;
  const distanceMeters = routeDistanceMeters(combined);
  const ascentMeters = routeAscentMeters(combined);
  const routePoints = limitRoutePoints(combined);
  if (!Number.isFinite(distanceMeters) || distanceMeters < 100) return null;
  return {
    ...request,
    id: `route-${createdAt}-${variant}`,
    createdAt,
    points: routePoints,
    distanceMeters,
    ascentMeters,
    source: 'brouter',
    providerLabel: 'OpenStreetMap · BRouter',
    preferencePenalty: preferencePenalty(
      feature.properties,
      request.preference,
    ),
  };
}

async function requestVariant(
  request: RouteRequest,
  variant: number,
  createdAt: number,
): Promise<RoutePlan | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const lonlats = waypointsFor(request, variant)
      .map(point => `${point.longitude},${point.latitude}`)
      .join('|');
    const response = await fetch(
      `${B_ROUTER_URL}?lonlats=${encodeURIComponent(
        lonlats,
      )}&profile=trekking&alternativeidx=0&format=geojson`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as BRouterResponse;
    return routeFromFeature(
      request,
      body.features?.[0] || {},
      variant,
      createdAt,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function routeScore(route: RoutePlan, request: RouteRequest) {
  const distanceError = Math.abs(
    route.distanceMeters - request.distanceKm * 1000,
  );
  const ascent = route.ascentMeters ?? 0;
  const elevationUncertainty =
    request.preference === 'flat' && route.ascentMeters === undefined
      ? 5_000
      : 0;
  const ascentWeight = request.preference === 'flat' ? 7 : 1;
  return (
    distanceError +
    elevationUncertainty +
    ascent * ascentWeight +
    (route.preferencePenalty || 0) * 1000
  );
}

export async function requestRoutePlan(
  request: RouteRequest,
  createdAt = Date.now(),
): Promise<RoutePlan | null> {
  const routes = await Promise.all(
    [0, 1, 2].map(variant => requestVariant(request, variant, createdAt)),
  );
  const valid = routes.filter((route): route is RoutePlan => Boolean(route));
  if (valid.length) {
    return valid.sort(
      (first, second) =>
        routeScore(first, request) - routeScore(second, request),
    )[0];
  }
  return null;
}
