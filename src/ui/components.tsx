import React, {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import type { RoutePoint } from '../native';
import type { RunPurpose } from '../domain/types';
import {
  TILE_ATTRIBUTION,
  TILE_SIZE,
  bboxOf,
  bestTileZoom,
  rangeForView,
  tileRange,
  tileUrl,
  worldPixel,
  zoomToFit,
} from './mapTiles';
export const color = {
  bg: '#101210',
  surface: '#1A1D1A',
  raised: '#242924',
  line: '#343B34',
  text: '#F2F4EF',
  muted: '#ADB5AB',
  green: '#A5D879',
  ink: '#14200E',
};
export const purposes: { value: RunPurpose; label: string; description: string }[] = [
  { value: 'free', label: 'Freier Lauf', description: 'Ohne feste Vorgabe' },
  {
    value: 'easy',
    label: 'Locker',
    description: 'Ein ruhiger, gleichmäßiger Lauf',
  },
  { value: 'long', label: 'Lang', description: 'Zeit auf den Beinen' },
  {
    value: 'intervals',
    label: 'Intervalle',
    description: 'Belastung und Erholung im Wechsel',
  },
  { value: 'race', label: 'Wettkampf', description: 'Laufen auf Leistung' },
  {
    value: 'unknown',
    label: 'Noch offen',
    description: 'Zweck später ergänzen',
  },
];
export const purposeLabel = (value: RunPurpose) =>
  purposes.find(p => p.value === value)?.label || 'Lauf';
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  small = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        small && s.small,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>
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
export function Section({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
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
    Läufe: 'M6 4H18V21H6ZM9 8H15M9 12H15M9 16H13',
    Fokus: 'M8 4H16M12 4V8M6 8H18L21 20H3ZM9 14H15',
    Statistik: 'M4 20V10M10 20V4M16 20V13M22 20H2',
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
export const Route = memo(function Route({
  points,
  onLockScroll,
}: {
  points: RoutePoint[];
  onLockScroll?: (locked: boolean) => void;
}) {
  return <RunMap tracks={[points]} showEndpoints onLockScroll={onLockScroll} />;
});

/**
 * Strecken auf OSM-Kacheln (grob, ohne Beschriftungen) — mit Ziehen und
 * Zwei-Finger-Zoom wie auf einer Karte. Es werden nur Kachelkoordinaten
 * übertragen, keine GPS-Punkte. Kacheln werden stets passend zum Ausschnitt
 * nachgeladen (gedeckelte Anzahl). Ohne Netz: Strecke ohne Hintergrundkarte.
 */
export function RunMap({
  tracks,
  heat = false,
  showEndpoints = false,
  onLockScroll,
}: {
  tracks: RoutePoint[][];
  heat?: boolean;
  showEndpoints?: boolean;
  onLockScroll?: (locked: boolean) => void;
}) {
  const lines = useMemo(
    () =>
      tracks
        .map(track =>
          track.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
        )
        .filter(track => track.length >= 2),
    [tracks],
  );
  const [tilesFailed, setTilesFailed] = useState(false);
  const [widthPx, setWidthPx] = useState(0);
  const bbox = useMemo(() => bboxOf(lines.flat()), [lines]);
  const fitZoom = useMemo(() => (bbox ? zoomToFit(bbox) : undefined), [bbox]);
  const fit = useMemo(() => {
    if (!bbox || fitZoom === undefined) {
      return undefined;
    }
    const range = tileRange(bbox, fitZoom);
    return {
      x: range.x0 * TILE_SIZE,
      y: range.y0 * TILE_SIZE,
      w: range.cols * TILE_SIZE,
      h: range.rows * TILE_SIZE,
    };
  }, [bbox, fitZoom]);
  const aspect = fit ? fit.w / fit.h : 4 / 3;
  const minW =
    fit && fitZoom !== undefined
      ? Math.max(16, fit.w / Math.pow(2, 17 - fitZoom))
      : 16;
  const [view, setView] = useState({ cx: 0, cy: 0, w: 0 });
  const fitKey = fit ? `${fit.x},${fit.y},${fit.w},${fit.h}` : '';
  useEffect(() => {
    if (fit) {
      setView({ cx: fit.x + fit.w / 2, cy: fit.y + fit.h / 2, w: fit.w });
      setTilesFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const clampView = (
    cx: number,
    cy: number,
    w: number,
  ): { cx: number; cy: number; w: number } => {
    if (!fit) {
      return { cx, cy, w };
    }
    const cw = Math.min(Math.max(w, minW), fit.w);
    const ch = cw / aspect;
    const fx = fit.x + fit.w / 2;
    const fy = fit.y + fit.h / 2;
    return {
      cx: cw >= fit.w ? fx : Math.min(Math.max(cx, fit.x + cw / 2), fit.x + fit.w - cw / 2),
      cy: ch >= fit.h ? fy : Math.min(Math.max(cy, fit.y + ch / 2), fit.y + fit.h - ch / 2),
      w: cw,
    };
  };

  const viewRef = useRef(view);
  viewRef.current = view;
  const widthRef = useRef(widthPx);
  widthRef.current = widthPx;
  const lockRef = useRef(onLockScroll);
  lockRef.current = onLockScroll;
  const geoRef = useRef({ fit, aspect, minW });
  geoRef.current = { fit, aspect, minW };
  const clampRef = useRef(clampView);
  clampRef.current = clampView;
  const gesture = useRef<{
    touches: number;
    startDist: number;
    base: { cx: number; cy: number; w: number };
  } | null>(null);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, state) => {
        const touches = evt.nativeEvent.touches.length;
        if (touches >= 2) {
          return true;
        }
        return (
          touches === 1 && (Math.abs(state.dx) > 6 || Math.abs(state.dy) > 6)
        );
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: evt => {
        gesture.current = initGesture(evt, viewRef.current);
        lockRef.current?.(true);
      },
      onPanResponderMove: (evt, state) => {
        const touches = evt.nativeEvent.touches.length;
        const current = gesture.current;
        const width = widthRef.current;
        const geo = geoRef.current;
        if (!current || width <= 0 || !geo.fit) {
          return;
        }
        if ((current.touches >= 2) !== (touches >= 2)) {
          gesture.current = initGesture(evt, viewRef.current);
          return;
        }
        const heightPx = width / geo.aspect;
        const base = current.base;
        if (touches >= 2) {
          const [dist, midX, midY] = pinchOf(evt);
          const factor = dist / current.startDist;
          if (!Number.isFinite(factor) || factor <= 0) {
            return;
          }
          const baseH = base.w / geo.aspect;
          const baseX = base.cx - base.w / 2;
          const baseY = base.cy - baseH / 2;
          const nextW = base.w / factor;
          const fx = baseX + (midX / width) * base.w;
          const fy = baseY + (midY / heightPx) * baseH;
          const nextH = nextW / geo.aspect;
          setView(
            clampRef.current(
              fx - (midX / width) * nextW + nextW / 2,
              fy - (midY / heightPx) * nextH + nextH / 2,
              nextW,
            ),
          );
        } else {
          setView(
            clampRef.current(
              base.cx - (state.dx / width) * base.w,
              base.cy - (state.dy / heightPx) * (base.w / geo.aspect),
              base.w,
            ),
          );
        }
      },
      onPanResponderRelease: () => {
        gesture.current = null;
        lockRef.current?.(false);
      },
      onPanResponderTerminate: () => {
        gesture.current = null;
        lockRef.current?.(false);
      },
    }),
  ).current;

  if (!bbox || lines.length === 0) {
    return <Copy muted>Keine darstellbare GPS-Strecke vorhanden.</Copy>;
  }
  if (!fit || fitZoom === undefined) {
    return <NormalizedTracks lines={lines} heat={heat} />;
  }

  const h = view.w / aspect;
  const tz = bestTileZoom(fitZoom, { x: 0, y: 0, w: view.w, h });
  const scale = Math.pow(2, tz - fitZoom);
  const vx = (view.cx - view.w / 2) * scale;
  const vy = (view.cy - h / 2) * scale;
  const vw = view.w * scale;
  const vh = h * scale;
  const range = rangeForView({ x: vx, y: vy, w: vw, h: vh }, tz);
  const tiles: { x: number; y: number }[] = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      tiles.push({ x, y });
    }
  }
  const first = lines[0][0];
  const last = lines[lines.length - 1][lines[lines.length - 1].length - 1];

  const zoomBy = (factor: number) => {
    const current = viewRef.current;
    setView(clampView(current.cx, current.cy, current.w / factor));
  };
  const reset = () => {
    if (fit) {
      setTilesFailed(false);
      setView({ cx: fit.x + fit.w / 2, cy: fit.y + fit.h / 2, w: fit.w });
    }
  };

  return (
    <View>
      <View
        {...responder.panHandlers}
        onLayout={e => setWidthPx(e.nativeEvent.layout.width)}
        style={[s.mapFrame, { aspectRatio: aspect }]}
      >
        {tilesFailed
          ? null
          : tiles.map(tile => (
              <Image
                key={`${tz}/${tile.x}/${tile.y}`}
                source={{ uri: tileUrl(tz, tile.x, tile.y) }}
                style={{
                  position: 'absolute',
                  left: `${((tile.x * TILE_SIZE - vx) / vw) * 100}%`,
                  top: `${((tile.y * TILE_SIZE - vy) / vh) * 100}%`,
                  width: `${(TILE_SIZE / vw) * 100}%`,
                  height: `${(TILE_SIZE / vh) * 100}%`,
                }}
                onError={() => setTilesFailed(true)}
              />
            ))}
        <Svg
          style={StyleSheet.absoluteFill}
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="none"
        >
          {lines.map((line, i) => (
            <Polyline
              key={i}
              points={line
                .map(p => worldPixel(p.latitude, p.longitude, tz).join(','))
                .join(' ')}
              stroke={color.green}
              strokeOpacity={heat ? 0.22 : 1}
              strokeWidth={heat ? 2.5 : 3}
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {showEndpoints ? (
            <>
              <Circle
                cx={worldPixel(first.latitude, first.longitude, tz)[0]}
                cy={worldPixel(first.latitude, first.longitude, tz)[1]}
                r={5}
                fill={color.text}
              />
              <Circle
                cx={worldPixel(last.latitude, last.longitude, tz)[0]}
                cy={worldPixel(last.latitude, last.longitude, tz)[1]}
                r={5}
                fill={color.green}
                stroke={color.bg}
                strokeWidth={2}
              />
            </>
          ) : null}
        </Svg>
      </View>
      <View style={s.zoomRow}>
        <Button small secondary title="−" onPress={() => zoomBy(0.5)} />
        <Button small secondary title="+" onPress={() => zoomBy(2)} />
        <Button small secondary title="Zurücksetzen" onPress={reset} />
      </View>
      <Copy muted style={s.tiny}>
        {tilesFailed
          ? 'Offline: Strecke ohne Hintergrundkarte. '
          : `${TILE_ATTRIBUTION}. `}
        Ziehen zum Verschieben, zwei Finger zum Zoomen.
      </Copy>
    </View>
  );

  function initGesture(
    evt: any,
    base: { cx: number; cy: number; w: number },
  ) {
    const touches = evt.nativeEvent.touches.length;
    const [dist] = pinchOf(evt);
    return { touches, startDist: dist, base };
  }
  function pinchOf(evt: any): [number, number, number] {
    const touches = evt.nativeEvent.touches;
    if (touches.length >= 2) {
      const a = touches[0];
      const b = touches[1];
      return [
        Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
        (a.locationX + b.locationX) / 2,
        (a.locationY + b.locationY) / 2,
      ];
    }
    return [1, 0, 0];
  }
}

function NormalizedTracks({
  lines,
  heat,
}: {
  lines: RoutePoint[][];
  heat: boolean;
}) {
  const width = 320;
  const height = 220;
  const pad = 18;
  const all = lines.flat();
  const lats = all.map(p => p.latitude);
  const lons = all.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const correction = Math.max(
    0.01,
    Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180),
  );
  const spanX = Math.max((maxLon - minLon) * correction, 0.000001);
  const spanY = Math.max(maxLat - minLat, 0.000001);
  const scale = Math.min(
    (width - 2 * pad) / spanX,
    (height - 2 * pad) / spanY,
  );
  const xy = (lat: number, lon: number): [number, number] => [
    pad + (width - 2 * pad - spanX * scale) / 2 + (lon - minLon) * correction * scale,
    pad + (height - 2 * pad - spanY * scale) / 2 + (maxLat - lat) * scale,
  ];
  return (
    <View>
      <View style={[s.mapFrame, { aspectRatio: width / height }]}>
        <Svg
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        >
          {lines.map((line, i) => (
            <Polyline
              key={i}
              points={line.map(p => xy(p.latitude, p.longitude).join(',')).join(' ')}
              stroke={color.green}
              strokeOpacity={heat ? 0.22 : 1}
              strokeWidth={heat ? 2.5 : 3}
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
      </View>
      <Copy muted style={s.tiny}>
        Zu weit verstreut für eine Karte — vereinfachte Darstellung.
      </Copy>
    </View>
  );
}
export const s = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: 8,
    backgroundColor: color.green,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondary: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderWidth: 1,
  },
  small: { minHeight: 44, paddingVertical: 10 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  buttonText: { color: color.ink, fontSize: 16, fontWeight: '700' },
  secondaryText: { color: color.text },
  copy: { color: color.text, fontSize: 16, lineHeight: 24 },
  muted: { color: color.muted },
  section: { marginTop: 28, gap: 12 },
  sectionTitle: { fontSize: 19, color: color.text, fontWeight: '600' },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowText: { flex: 1, gap: 5 },
  rowTitle: { color: color.text, fontSize: 16, fontWeight: '500' },
  rowSubtitle: { color: color.muted, fontSize: 14, lineHeight: 21 },
  chevron: { fontSize: 28, color: color.muted },
  stat: { flex: 1, gap: 5 },
  statValue: {
    color: color.text,
    fontSize: 28,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  statLarge: { fontSize: 66, fontWeight: '400' },
  statLabel: { color: color.muted, fontSize: 14 },
  mapFrame: { backgroundColor: color.surface, marginVertical: 8 },
  zoomRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  tiny: { fontSize: 12, lineHeight: 18 },
});
