import React, { memo, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, {
  Circle,
  Image as SvgImage,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import type { RoutePoint } from '../native';

/**
 * Design-Token und Bausteine der gesamten Oberfläche. Verbindliche Regeln zu
 * Verwendung, Text und Affordanzen stehen in docs/design-language.md. Bildschirme
 * definieren keine eigenen Farben, Abstände oder Schriftgrößen.
 */
export const color = {
  bg: '#101210',
  surface: '#1A1D1A',
  raised: '#242924',
  line: '#343B34',
  text: '#F2F4EF',
  muted: '#ADB5AB',
  green: '#A5D879',
  greenSoft: '#26331E',
  ink: '#14200E',
  danger: '#E4796B',
  mapOverlay: '#101210D9',
  mapLine: '#F2F4EF3D',
};

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  display: { fontSize: 56, lineHeight: 60, fontWeight: '400' as const },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' as const },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  value: { fontSize: 26, lineHeight: 30, fontWeight: '500' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  micro: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
};

export function Title({ children }: PropsWithChildren) {
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  small = false,
  label,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
  /** Vorlesetext, wenn die Beschriftung allein nicht eindeutig ist. */
  label?: string;
}) {
  const outlined = secondary || danger;
  return (
    <Pressable
      accessibilityLabel={label ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        outlined && s.secondary,
        small && s.small,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text
        style={[
          s.buttonText,
          outlined && s.secondaryText,
          danger && s.dangerText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Copy({
  children,
  muted = false,
  style,
}: PropsWithChildren<{ muted?: boolean; style?: object }>) {
  return <Text style={[s.copy, muted && s.muted, style]}>{children}</Text>;
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: object }>) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Section({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  onPress,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const content = (
    <>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ?? (onPress ? <Text style={s.chevron}>›</Text> : null)}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={s.row}>{content}</View>
  );
}

/**
 * Einfachauswahl direkt auf der Seite. Ersetzt Dialoge, deren Optionen in eine
 * Zeile passen — ein Chip sieht auswählbar aus und verhält sich auch so.
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={s.chips}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              s.chip,
              selected && s.chipSelected,
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.chipText, selected && s.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={s.rowSubtitle}>{hint}</Text> : null}
    </View>
  );
}

export function Input({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={color.muted}
      selectionColor={color.green}
      {...props}
      style={[s.input, props.multiline && s.inputMultiline, props.style]}
    />
  );
}

export function Notice({
  children,
  title,
  onDismiss,
}: PropsWithChildren<{ title?: string; onDismiss?: () => void }>) {
  const body = (
    <>
      {title ? <Text style={s.noticeTitle}>{title}</Text> : null}
      <Text style={s.copy}>{children}</Text>
    </>
  );
  return onDismiss ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Meldung schließen"
      accessibilityLiveRegion="polite"
      onPress={onDismiss}
      style={({ pressed }) => [s.notice, pressed && s.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessibilityLiveRegion="polite" style={s.notice}>
      {body}
    </View>
  );
}

/** Leerer Zustand: Titel, ein Satz, genau eine Aktion. */
export function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: { title: string; onPress: () => void };
}) {
  return (
    <View style={s.empty}>
      <Text accessibilityRole="header" style={s.emptyTitle}>
        {title}
      </Text>
      <Copy muted>{copy}</Copy>
      {action ? <Button title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

export function Stat({
  value,
  label,
  large = false,
}: {
  value: string;
  label: string;
  large?: boolean;
}) {
  return (
    <View style={s.stat}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[s.statValue, large && s.statLarge]}
      >
        {value}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function Icon({
  name,
  selected = false,
}: {
  name: string;
  selected?: boolean;
}) {
  const paths: Record<string, string> = {
    Heute: 'M4 12L12 5L20 12M6 10V21H18V10M10 21V15H14V21',
    Planung:
      'M8 2V6M16 2V6M3 10H21M5 4H19A2 2 0 0 1 21 6V20A2 2 0 0 1 19 22H5A2 2 0 0 1 3 20V6A2 2 0 0 1 5 4M8 14H8.01M12 14H12.01M16 14H16.01M8 18H8.01M12 18H12.01',
    Einheiten: 'M4 7H7M4 12H7M4 17H7M11 7H20M11 12H20M11 17H20',
    Statistik: 'M4 20V13M10 20V7M16 20V10M3 20H21',

    Mehr: 'M4 7H20M4 12H20M4 17H20',
  };
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24">
      <Path
        d={paths[name] || paths.Mehr}
        stroke={selected ? color.green : color.muted}
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

const ROUTE_VIEWBOX_WIDTH = 360;
const ROUTE_VIEWBOX_HEIGHT = 220;
const ROUTE_PADDING = 24;
const TILE_SIZE = 256;
const TILE_MIN_ZOOM = 10;
const TILE_MAX_ZOOM = 18;
const MAX_ROUTE_POINTS = 512;

type Point = [number, number];
type Tile = {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Web-Mercator-Projektion in Pixeln. Nur für die Kartenkacheln, nicht für Analyse. */
function worldPixel(latitude: number, longitude: number, zoom: number): Point {
  const safeLatitude = clamp(latitude, -85.05112878, 85.05112878);
  const scale = TILE_SIZE * 2 ** zoom;
  const radians = (safeLatitude * Math.PI) / 180;
  return [
    ((longitude + 180) / 360) * scale,
    (0.5 -
      Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) /
        (4 * Math.PI)) *
      scale,
  ];
}

function bounds(points: Point[]) {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function routeZoom(points: RoutePoint[]): number {
  for (let zoom = TILE_MAX_ZOOM; zoom >= TILE_MIN_ZOOM; zoom -= 1) {
    const projected = points.map(point =>
      worldPixel(point.latitude, point.longitude, zoom),
    );
    const range = bounds(projected);
    const spanX = Math.max(range.maxX - range.minX, 1);
    const spanY = Math.max(range.maxY - range.minY, 1);
    const widthRatio = spanX / (ROUTE_VIEWBOX_WIDTH - ROUTE_PADDING * 2);
    const heightRatio = spanY / (ROUTE_VIEWBOX_HEIGHT - ROUTE_PADDING * 2);
    if (Math.max(widthRatio, heightRatio) <= 1.2) {
      return zoom;
    }
  }
  return TILE_MIN_ZOOM;
}

/** Behält Anfang, Ende und Unterbrechungen, ohne bei langen Läufen das Ziel abzuschneiden. */
function sampleRoute(points: RoutePoint[]): RoutePoint[] {
  const valid = points.filter(
    point =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
  if (valid.length <= MAX_ROUTE_POINTS) {
    return valid;
  }

  const indexes = new Set<number>([0, valid.length - 1]);
  valid.forEach((point, index) => {
    if (point.gap) {
      indexes.add(index);
    }
  });
  const target = Math.max(0, MAX_ROUTE_POINTS - indexes.size);
  for (let i = 0; i < target; i += 1) {
    indexes.add(Math.round((i * (valid.length - 1)) / Math.max(target - 1, 1)));
  }
  return Array.from(indexes)
    .sort((left, right) => left - right)
    .slice(0, MAX_ROUTE_POINTS)
    .map(index => valid[index]);
}

function routePath(points: Point[], source: RoutePoint[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 || source[index].gap ? 'M' : 'L'}${point[0].toFixed(
          2,
        )},${point[1].toFixed(2)}`,
    )
    .join(' ');
}

function mapTiles(
  range: { minX: number; maxX: number; minY: number; maxY: number },
  scale: number,
  zoom: number,
): Tile[] {
  const firstX = Math.floor(range.minX / TILE_SIZE) - 1;
  const lastX = Math.floor(range.maxX / TILE_SIZE) + 1;
  const firstY = Math.floor(range.minY / TILE_SIZE) - 1;
  const lastY = Math.floor(range.maxY / TILE_SIZE) + 1;
  const worldTiles = 2 ** zoom;
  const tiles: Tile[] = [];

  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    if (tileY < 0 || tileY >= worldTiles) {
      continue;
    }
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
      tiles.push({
        key: `${zoom}/${tileX}/${tileY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        left: ROUTE_PADDING + (tileX * TILE_SIZE - range.minX) * scale,
        top: ROUTE_PADDING + (tileY * TILE_SIZE - range.minY) * scale,
        size: TILE_SIZE * scale,
      });
    }
  }
  return tiles;
}

function RouteBackdrop() {
  return (
    <Svg
      height="100%"
      pointerEvents="none"
      style={s.routeLayer}
      viewBox={`0 0 ${ROUTE_VIEWBOX_WIDTH} ${ROUTE_VIEWBOX_HEIGHT}`}
      width="100%"
    >
      <Rect
        width={ROUTE_VIEWBOX_WIDTH}
        height={ROUTE_VIEWBOX_HEIGHT}
        fill={color.surface}
      />
      {Array.from({ length: 9 }, (_, index) => {
        const x = index * 45;
        return (
          <Line
            key={`vertical-${x}`}
            x1={x}
            x2={x}
            y1={0}
            y2={ROUTE_VIEWBOX_HEIGHT}
            stroke={color.line}
            strokeOpacity={0.36}
            strokeWidth={1}
          />
        );
      })}
      {Array.from({ length: 7 }, (_, index) => {
        const y = index * 42;
        return (
          <Line
            key={`horizontal-${y}`}
            x1={0}
            x2={ROUTE_VIEWBOX_WIDTH}
            y1={y}
            y2={y}
            stroke={color.line}
            strokeOpacity={0.36}
            strokeWidth={1}
          />
        );
      })}
    </Svg>
  );
}

function markerLabel(point: Point, label: string, width: number) {
  const left = clamp(point[0] + 12, 8, ROUTE_VIEWBOX_WIDTH - width - 8);
  const top = clamp(point[1] - 34, 8, ROUTE_VIEWBOX_HEIGHT - 30);
  return (
    <>
      <Rect
        x={left}
        y={top}
        width={width}
        height={22}
        rx={11}
        fill={color.mapOverlay}
        stroke={color.text}
        strokeOpacity={0.24}
        strokeWidth={1}
      />
      <SvgText
        x={left + width / 2}
        y={top + 15}
        fill={color.text}
        fontSize={10}
        fontWeight="700"
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </>
  );
}

export const Route = memo(function Route({ points }: { points: RoutePoint[] }) {
  const valid = sampleRoute(points);
  if (valid.length < 2) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Keine GPS-Strecke aufgezeichnet"
        style={[s.route, s.routeEmpty]}
      >
        <RouteBackdrop />
        <View pointerEvents="none" style={s.routeEmptyContent}>
          <Text style={s.routeEmptyTitle}>Keine GPS-Strecke</Text>
          <Text style={s.routeEmptyCopy}>
            Für diese Einheit wurde keine Route gespeichert.
          </Text>
        </View>
      </View>
    );
  }
  const zoom = routeZoom(valid);
  const projected = valid.map(point =>
    worldPixel(point.latitude, point.longitude, zoom),
  );
  const worldRange = bounds(projected);
  const spanX = Math.max(worldRange.maxX - worldRange.minX, 1);
  const spanY = Math.max(worldRange.maxY - worldRange.minY, 1);
  const scale = Math.min(
    (ROUTE_VIEWBOX_WIDTH - ROUTE_PADDING * 2) / spanX,
    (ROUTE_VIEWBOX_HEIGHT - ROUTE_PADDING * 2) / spanY,
  );
  const xy = projected.map(
    point =>
      [
        ROUTE_PADDING + (point[0] - worldRange.minX) * scale,
        ROUTE_PADDING + (point[1] - worldRange.minY) * scale,
      ] as Point,
  );
  const start = xy[0];
  const finish = xy[xy.length - 1];

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Aufgezeichnete GPS-Strecke auf einer OpenStreetMap-Karte. Start und Ziel sind markiert."
      style={s.route}
    >
      <RouteBackdrop />
      <Svg
        height="100%"
        pointerEvents="none"
        style={s.routeLayer}
        viewBox={`0 0 ${ROUTE_VIEWBOX_WIDTH} ${ROUTE_VIEWBOX_HEIGHT}`}
        width="100%"
      >
        {mapTiles(worldRange, scale, zoom).map(tile => (
          <SvgImage
            key={tile.key}
            x={tile.left}
            y={tile.top}
            width={tile.size}
            height={tile.size}
            href={{ uri: tile.url }}
            opacity={0.82}
            preserveAspectRatio="xMidYMid slice"
          />
        ))}
      </Svg>
      <View pointerEvents="none" style={s.routeScrim} />
      <View pointerEvents="none" style={s.routeBadge}>
        <Text style={s.routeBadgeText}>GPS-Route</Text>
      </View>
      <Svg
        height="100%"
        pointerEvents="none"
        style={s.routeLayer}
        viewBox={`0 0 ${ROUTE_VIEWBOX_WIDTH} ${ROUTE_VIEWBOX_HEIGHT}`}
        width="100%"
      >
        <Path
          d={routePath(xy, valid)}
          stroke={color.ink}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.9}
        />
        <Path
          d={routePath(xy, valid)}
          stroke={color.green}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Circle
          cx={start[0]}
          cy={start[1]}
          r={8}
          fill={color.text}
          stroke={color.ink}
          strokeWidth={3}
        />
        <Circle
          cx={finish[0]}
          cy={finish[1]}
          r={8}
          fill={color.green}
          stroke={color.ink}
          strokeWidth={3}
        />
        {markerLabel(start, 'Start', 48)}
        {markerLabel(finish, 'Ziel', 42)}
        <SvgText
          x={ROUTE_VIEWBOX_WIDTH - 10}
          y={ROUTE_VIEWBOX_HEIGHT - 10}
          fill={color.text}
          fontSize={9}
          opacity={0.84}
          textAnchor="end"
        >
          © OpenStreetMap-Mitwirkende
        </SvgText>
      </Svg>
    </View>
  );
});

type MapPoint = Pick<RoutePoint, 'latitude' | 'longitude'>;

/**
 * Kleine, lokale Routendarstellung ohne Karten-Scraping oder SDK-Zwang. Die
 * geplante Linie und der tatsächlich aufgezeichnete Teil bleiben getrennt;
 * dadurch sieht der Nutzer auch bei fehlender Hintergrundkarte, wo er ist.
 */
export const RouteMap = memo(function RouteMap({
  planned,
  track = [],
  current,
}: {
  planned: MapPoint[];
  track?: MapPoint[];
  current?: MapPoint;
}) {
  const validPlanned = planned
    .filter(
      point =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    )
    .slice(0, 512);
  const validTrack = track
    .filter(
      point =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    )
    .slice(0, 512);
  const valid = [...validPlanned, ...validTrack, ...(current ? [current] : [])];
  if (valid.length < 2) {
    return <Copy muted>Die Route wird noch geladen.</Copy>;
  }
  const latitudes = valid.map(point => point.latitude);
  const longitudes = valid.map(point => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const correction = Math.max(
    0.01,
    Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180),
  );
  const spanX = Math.max((maxLon - minLon) * correction, 0.000001);
  const spanY = Math.max(maxLat - minLat, 0.000001);
  const scale = Math.min(284 / spanX, 184 / spanY);
  const pointToSvg = (point: MapPoint) => [
    18 +
      (284 - spanX * scale) / 2 +
      (point.longitude - minLon) * correction * scale,
    18 + (184 - spanY * scale) / 2 + (maxLat - point.latitude) * scale,
  ];
  const pathFor = (points: MapPoint[]) => {
    const usable = points.filter(
      point =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
    );
    return usable
      .map((point, index) => {
        const [x, y] = pointToSvg(point);
        return `${index === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ');
  };
  const start = validPlanned[0] ? pointToSvg(validPlanned[0]) : null;
  const lastTrack = validTrack[validTrack.length - 1];
  const currentPoint = current || lastTrack;
  const currentSvg = currentPoint ? pointToSvg(currentPoint) : null;
  return (
    <View
      accessibilityLabel="Geplante Laufstrecke mit bisher aufgezeichneter Position"
      style={s.route}
    >
      <Svg width="100%" height={220} viewBox="0 0 320 220">
        <Path
          d="M18 18H302M18 110H302M18 202H302M18 18V202M160 18V202M302 18V202"
          stroke={color.line}
          strokeWidth={0.7}
          opacity={0.7}
          fill="none"
        />
        <Path
          d={pathFor(validPlanned)}
          stroke={color.muted}
          strokeWidth={2.2}
          strokeDasharray="5 5"
          strokeLinejoin="round"
          fill="none"
        />
        {validTrack.length > 1 ? (
          <Path
            d={pathFor(validTrack)}
            stroke={color.green}
            strokeWidth={4}
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
        {start ? (
          <Circle cx={start[0]} cy={start[1]} r={5} fill={color.text} />
        ) : null}
        {currentSvg ? (
          <Circle
            cx={currentSvg[0]}
            cy={currentSvg[1]}
            r={7}
            fill={color.green}
            stroke={color.ink}
            strokeWidth={3}
          />
        ) : null}
      </Svg>
    </View>
  );
});

export type { ReactNode };

export const s = StyleSheet.create({
  title: { color: color.text, ...type.title, letterSpacing: -0.6 },
  button: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: color.green,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.ml,
    paddingVertical: space.md,
  },
  secondary: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1,
  },
  small: { minHeight: 48, paddingVertical: space.sm },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  buttonText: { color: color.ink, ...type.body, fontWeight: '700' },
  secondaryText: { color: color.text },
  dangerText: { color: color.danger },
  copy: { color: color.text, ...type.body },
  muted: { color: color.muted },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  section: { marginTop: space.xl, gap: space.sm },
  sectionTitle: { color: color.text, ...type.heading },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowText: { flex: 1, gap: space.xxs },
  rowTitle: { color: color.text, ...type.body, fontWeight: '500' },
  rowSubtitle: { color: color.muted, ...type.label, fontWeight: '400' },
  chevron: { fontSize: 26, color: color.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipSelected: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  chipText: { color: color.muted, ...type.label },
  chipTextSelected: { color: color.text, fontWeight: '600' },
  field: { gap: space.xs },
  fieldLabel: { color: color.text, ...type.label },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    color: color.text,
    backgroundColor: color.surface,
    ...type.body,
    minHeight: 52,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  notice: {
    backgroundColor: color.raised,
    borderRadius: radius.sm,
    padding: space.md,
    gap: space.xxs,
    borderLeftWidth: 3,
    borderLeftColor: color.green,
  },
  noticeTitle: { color: color.text, ...type.label, fontWeight: '700' },
  empty: { paddingVertical: space.xxl, gap: space.md },
  emptyTitle: { color: color.text, ...type.heading },
  stat: { flex: 1, gap: space.xxs },
  statValue: {
    color: color.text,
    ...type.value,
    fontVariant: ['tabular-nums'],
  },
  statLarge: { ...type.display },
  statLabel: { color: color.muted, ...type.label, fontWeight: '400' },
  route: {
    height: ROUTE_VIEWBOX_HEIGHT,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  routeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  routeScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.mapOverlay,
    opacity: 0.34,
  },
  routeBadge: {
    position: 'absolute',
    left: space.md,
    top: space.md,
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.mapOverlay,
    borderWidth: 1,
    borderColor: color.mapLine,
  },
  routeBadgeText: { color: color.text, ...type.micro, fontWeight: '700' },
  routeEmpty: { justifyContent: 'center', alignItems: 'center' },
  routeEmptyContent: {
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  routeEmptyTitle: { color: color.text, ...type.heading },
  routeEmptyCopy: {
    color: color.muted,
    ...type.label,
    textAlign: 'center',
    marginTop: space.xs,
  },
});
