import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Pattern,
  Rect,
  Stop as GradientStop,
  Text as SvgText,
} from 'react-native-svg';
import {
  REGIONS,
  REGIONS_VERSION,
  regionId,
  regionLabel,
  type RegionBase,
  type RegionId,
  type Side,
} from '../domain/regions';
import { color, radius, space, type } from './components';

/**
 * Körperfigur nach docs/zielspezifikation-training.md T-9.
 *
 * Die Figur zeigt einen Zustand, kein Urteil. Sie sagt nichts über Gesundheit,
 * Belastbarkeit oder Verletzungen — nur, was gemeldet wurde beziehungsweise was
 * das Modell aus erfassten Einheiten und Meldungen gerechnet hat.
 *
 * Zwei Größen, zwei getrennte Skalen. `soreness` ist eine Nutzerangabe von 0
 * bis 10, `freshness` eine gerechnete Größe von 0 bis 100. Sie werden niemals
 * in eine gemeinsame Farbskala gemischt; die Ansicht stellt immer genau eine
 * von beiden dar.
 *
 * `null` bedeutet unbekannt. Unbekannt ist nicht „frisch“: es bekommt eine
 * Schraffur und einen gestrichelten Rand, damit es auch ohne
 * Farbunterscheidungsvermögen eindeutig bleibt.
 */

export type BodyView = 'front' | 'back';
export type BodyMapMode = 'soreness' | 'freshness';

const WIDTH = 200;
/** Zuschnitt auf den tatsächlich bemalten Bereich, ohne leere Ränder. */
const VIEW_BOX = '30 0 140 438';
const HATCH_ID = 'runbackUnknownHatch';
/**
 * Eigene Töne für die Figur. Sie sind heller als die Kartenfläche, damit Körper
 * und Muskelflächen auch bei Sonnenlicht auseinandergehen; die Schraffur für
 * „unbekannt“ muss ohne Farbunterscheidung als eigene Sorte lesbar bleiben.
 */
const figure = {
  body: '#262D24',
  bodyLine: '#47523F',
  hatch: '#323A2F',
  hatchLine: '#5C6857',
};
const SCALE_ID = 'runbackScaleGradient';

type Point = [number, number];

/** Punkt auf der Kante von `corner` Richtung `towards`, höchstens halbe Kante. */
function shorten(corner: Point, towards: Point, r: number): Point {
  const dx = towards[0] - corner[0];
  const dy = towards[1] - corner[1];
  const length = Math.hypot(dx, dy) || 1;
  const step = Math.min(r, length / 2) / length;
  return [corner[0] + dx * step, corner[1] + dy * step];
}

/**
 * Weiche Ecken an einem Polygon. Muskeln haben keine rechten Winkel; die
 * Rundung ist der einzige Unterschied zwischen „Kasten“ und „Körper“.
 */
function rounded(points: Point[], r: number): string {
  const count = points.length;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const previous = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const from = shorten(current, previous, r);
    const to = shorten(current, next, r);
    parts.push(
      `${i === 0 ? 'M' : 'L'}${from[0].toFixed(1)},${from[1].toFixed(1)}`,
    );
    parts.push(
      `Q${current[0].toFixed(1)},${current[1].toFixed(1)} ${to[0].toFixed(
        1,
      )},${to[1].toFixed(1)}`,
    );
  }
  return `${parts.join(' ')} Z`;
}

const mirrorPoints = (points: Point[]): Point[] =>
  points.map(([x, y]) => [WIDTH - x, y] as Point);

interface Blob {
  points: Point[];
  r: number;
}

/**
 * Flächen der linken Bildhälfte. Die rechte Hälfte entsteht durch Spiegelung.
 * Nicht seitige Regionen liegen mittig und werden nur einmal gezeichnet.
 */
const FRONT: Partial<Record<RegionBase, Blob>> = {
  shoulder_side: {
    points: [
      [48, 68],
      [63, 65],
      [66, 88],
      [48, 92],
    ],
    r: 7,
  },
  shoulder_front: {
    points: [
      [65, 66],
      [79, 71],
      [79, 93],
      [66, 90],
    ],
    r: 7,
  },
  chest_upper: {
    points: [
      [81, 76],
      [99, 79],
      [99, 99],
      [81, 97],
    ],
    r: 7,
  },
  chest_mid: {
    points: [
      [81, 101],
      [99, 102],
      [99, 122],
      [81, 118],
    ],
    r: 7,
  },
  biceps: {
    points: [
      [46, 98],
      [63, 100],
      [61, 139],
      [48, 139],
    ],
    r: 9,
  },
  forearm: {
    points: [
      [44, 147],
      [59, 147],
      [54, 193],
      [42, 191],
    ],
    r: 9,
  },
  oblique: {
    points: [
      [74, 127],
      [85, 129],
      [85, 174],
      [74, 167],
    ],
    r: 8,
  },
  hip_flexor: {
    points: [
      [75, 178],
      [93, 182],
      [89, 207],
      [71, 197],
    ],
    r: 9,
  },
  quad: {
    points: [
      [64, 214],
      [90, 219],
      [88, 288],
      [66, 291],
    ],
    r: 14,
  },
  adductor: {
    points: [
      [92, 221],
      [99, 224],
      [99, 274],
      [90, 278],
    ],
    r: 8,
  },
  tibialis: {
    points: [
      [72, 320],
      [86, 322],
      [84, 396],
      [72, 393],
    ],
    r: 9,
  },
  abs_upper: {
    points: [
      [88, 124],
      [112, 124],
      [112, 152],
      [88, 152],
    ],
    r: 7,
  },
  abs_lower: {
    points: [
      [88, 156],
      [112, 156],
      [110, 187],
      [90, 187],
    ],
    r: 7,
  },
};

const BACK: Partial<Record<RegionBase, Blob>> = {
  neck: {
    points: [
      [91, 44],
      [109, 44],
      [109, 63],
      [91, 63],
    ],
    r: 7,
  },
  trap_upper: {
    points: [
      [67, 61],
      [86, 56],
      [88, 83],
      [68, 87],
    ],
    r: 8,
  },
  trap_mid: {
    points: [
      [88, 67],
      [112, 67],
      [114, 97],
      [86, 97],
    ],
    r: 9,
  },
  rhomboid: {
    points: [
      [90, 101],
      [110, 101],
      [109, 133],
      [91, 133],
    ],
    r: 9,
  },
  shoulder_rear: {
    points: [
      [48, 68],
      [64, 65],
      [67, 89],
      [48, 93],
    ],
    r: 7,
  },
  triceps: {
    points: [
      [46, 98],
      [63, 100],
      [61, 141],
      [48, 141],
    ],
    r: 9,
  },
  lat: {
    points: [
      [66, 97],
      [88, 103],
      [86, 153],
      [70, 147],
    ],
    r: 11,
  },
  lower_back: {
    points: [
      [74, 157],
      [97, 160],
      [97, 189],
      [76, 187],
    ],
    r: 9,
  },
  glute: {
    points: [
      [65, 193],
      [98, 198],
      [97, 241],
      [66, 239],
    ],
    r: 16,
  },
  hamstring: {
    points: [
      [66, 247],
      [90, 250],
      [88, 302],
      [68, 302],
    ],
    r: 13,
  },
  calf_gastroc: {
    points: [
      [68, 328],
      [88, 332],
      [86, 373],
      [70, 371],
    ],
    r: 11,
  },
  calf_soleus: {
    points: [
      [70, 378],
      [86, 378],
      [84, 405],
      [72, 403],
    ],
    r: 8,
  },
};

/**
 * Halber Umriss, von der Halsbasis über Schulter und Arm zum Fuß und innen
 * hoch bis zur Mitte. Die zweite Hälfte ist die gespiegelte Umkehrung, damit
 * die Figur zwangsläufig symmetrisch bleibt.
 */
const HALF_OUTLINE: Point[] = [
  [91, 40],
  [85, 54],
  [70, 59],
  [56, 65],
  [48, 79],
  [46, 104],
  [44, 150],
  [41, 195],
  [38, 214],
  [49, 217],
  [54, 196],
  [59, 150],
  [64, 106],
  [69, 92],
  [72, 122],
  [74, 154],
  [72, 182],
  [66, 201],
  [64, 229],
  [62, 271],
  [64, 301],
  [67, 331],
  [70, 373],
  [68, 405],
  [66, 425],
  [85, 427],
  [87, 401],
  [89, 361],
  [91, 301],
  [93, 263],
  [95, 231],
  [100, 214],
];

const SILHOUETTE = rounded(
  [...HALF_OUTLINE, ...mirrorPoints(HALF_OUTLINE).reverse()],
  4,
);

/** Hals. Er schließt die Lücke zwischen Kopfkreis und Schulterlinie. */
const NECK = rounded(
  [
    [90, 30],
    [110, 30],
    [110, 52],
    [90, 52],
  ],
  5,
);

interface Shape {
  id: RegionId;
  blob: Blob;
}

/**
 * In der Vorderansicht liegt die rechte Körperseite links im Bild, in der
 * Rückansicht die linke. Genau so sieht der Nutzer sich im Spiegel
 * beziehungsweise von hinten.
 */
function shapesFor(view: BodyView): Shape[] {
  const blobs = view === 'front' ? FRONT : BACK;
  const leftHalfSide: Side = view === 'front' ? 'r' : 'l';
  const rightHalfSide: Side = view === 'front' ? 'l' : 'r';
  const shapes: Shape[] = [];
  for (const region of REGIONS) {
    const blob = blobs[region.base];
    if (region.view !== view || !blob) {
      continue;
    }
    if (!region.sided) {
      shapes.push({ id: regionId(region.base), blob });
      continue;
    }
    shapes.push({ id: regionId(region.base, leftHalfSide), blob });
    shapes.push({
      id: regionId(region.base, rightHalfSide),
      blob: { points: mirrorPoints(blob.points), r: blob.r },
    });
  }
  return shapes;
}

/** Alle konkreten Regionen einer Ansicht, in Reihenfolge der Regionenliste. */
export function regionsInView(view: BodyView): RegionId[] {
  return shapesFor(view).map(shape => shape.id);
}

// --- Zwei getrennte Skalen. Sie werden nie gemischt. --------------------------

type ColorStop = [number, [number, number, number]];

/** Gemeldeter Muskelkater 0–10. Warm, weil es eine Empfindung ist. */
const SORENESS_STOPS: ColorStop[] = [
  [0, [58, 70, 54]],
  [5, [212, 165, 90]],
  [10, [217, 106, 74]],
];

/** Gerechnete Frische 0–100. Grün, die Hausfarbe der App. */
const FRESHNESS_STOPS: ColorStop[] = [
  [0, [74, 90, 70]],
  [100, [165, 216, 121]],
];

function ramp(stops: ColorStop[], value: number): string {
  const clamped = Math.min(
    stops[stops.length - 1][0],
    Math.max(stops[0][0], value),
  );
  for (let i = 1; i < stops.length; i++) {
    const [toValue, to] = stops[i];
    if (clamped > toValue) {
      continue;
    }
    const [fromValue, from] = stops[i - 1];
    const span = toValue - fromValue || 1;
    const t = (clamped - fromValue) / span;
    const mixed = from.map((channel, index) =>
      Math.round(channel + (to[index] - channel) * t),
    );
    return `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`;
  }
  const last = stops[stops.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

export const MODE_SCALE: Record<
  BodyMapMode,
  { title: string; hint: string; max: number }
> = {
  soreness: {
    title: 'Gemeldeter Muskelkater',
    hint: 'Skala 0 bis 10 · deine eigene Angabe, keine Messung',
    max: 10,
  },
  freshness: {
    title: 'Gerechnete Frische',
    hint: `Skala 0 bis 100 · gerechnet aus erfassten Einheiten und deinen Meldungen (${REGIONS_VERSION})`,
    max: 100,
  },
};

/** Zahl oder „–“. Fehlende Daten erscheinen nie als 100 und nie als 0. */
export function displayValue(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.round(value))
    : '–';
}

function fillFor(mode: BodyMapMode, value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `url(#${HATCH_ID})`;
  }
  return mode === 'soreness'
    ? ramp(SORENESS_STOPS, value)
    : ramp(FRESHNESS_STOPS, value);
}

/** Der gesprochene Zustand einer Region, ohne Wertung. */
export function regionSpeech(
  mode: BodyMapMode,
  id: RegionId,
  value: number | null | undefined,
): string {
  const name = regionLabel(id);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${name}: unbekannt, keine ausreichende Grundlage`;
  }
  return mode === 'soreness'
    ? `${name}: gemeldeter Muskelkater ${Math.round(value)} von 10`
    : `${name}: gerechnete Frische ${Math.round(value)} von 100`;
}

/** Mittelpunkt einer Fläche, für die Zahl auf der Figur. */
function centroid(points: Point[]): Point {
  const sum = points.reduce<Point>(
    (acc, [x, y]) => [acc[0] + x, acc[1] + y],
    [0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length];
}

/** Schraffurmuster für „unbekannt“. Auf Figur und Legende identisch. */
function UnknownHatch({ id }: { id: string }) {
  return (
    <Pattern height="6" id={id} patternUnits="userSpaceOnUse" width="6">
      <Rect fill={figure.hatch} height="6" width="6" x="0" y="0" />
      <Line
        stroke={figure.hatchLine}
        strokeWidth="1.3"
        x1="0"
        x2="6"
        y1="6"
        y2="0"
      />
    </Pattern>
  );
}

export interface BodyMapProps {
  /** Werte je konkreter Region. `null` heißt unbekannt, nicht „unbelastet“. */
  values: Record<RegionId, number | null>;
  /** Genau eine Größe wird dargestellt. Vermischen ist nicht vorgesehen. */
  mode: BodyMapMode;
  view?: BodyView;
  onChangeView?: (view: BodyView) => void;
  onSelectRegion?: (id: RegionId) => void;
  /** Hervorgehobene Region, etwa während einer Rückfrage. */
  selected?: RegionId | null;
  /** Liste unter der Figur ausblenden, wenn der Aufrufer eine eigene zeigt. */
  showList?: boolean;
  /** Zahlen auf der Figur. Beim Erfassen stören sie mehr, als sie helfen. */
  showNumbers?: boolean;
  /** Kopfzeile mit Skalenname und -hinweis ausblenden. */
  showScaleTitle?: boolean;
  /** Höhe der Figur. Erfassung darf größer sein als eine Übersicht. */
  height?: number;
}

export function BodyMap({
  values,
  mode,
  view,
  onChangeView,
  onSelectRegion,
  selected = null,
  showList = true,
  showNumbers = true,
  showScaleTitle = true,
  height = 500,
}: BodyMapProps) {
  const [ownView, setOwnView] = useState<BodyView>('front');
  const [listOpen, setListOpen] = useState(false);
  const current = view ?? ownView;
  const setView = (next: BodyView) => {
    setOwnView(next);
    onChangeView?.(next);
  };
  const shapes = useMemo(() => shapesFor(current), [current]);
  const scale = MODE_SCALE[mode];

  return (
    <View style={styles.wrap}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(['front', 'back'] as BodyView[]).map(option => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: current === option }}
            accessibilityLabel={
              option === 'front'
                ? 'Vorderansicht der Körperfigur zeigen'
                : 'Rückansicht der Körperfigur zeigen'
            }
            key={option}
            onPress={() => setView(option)}
            style={({ pressed }) => [
              styles.tab,
              current === option && styles.tabActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.tabText,
                current === option && styles.tabTextActive,
              ]}
            >
              {option === 'front' ? 'Vorn' : 'Hinten'}
            </Text>
          </Pressable>
        ))}
      </View>

      {showScaleTitle ? (
        <View style={styles.scaleHead}>
          <Text style={styles.scaleTitle}>{scale.title}</Text>
          <Text style={styles.scaleHint}>{scale.hint}</Text>
        </View>
      ) : null}

      <View style={styles.figure}>
        <Svg
          height={height}
          viewBox={VIEW_BOX}
          width="100%"
          accessibilityLabel={`Körperfigur, ${
            current === 'front' ? 'Vorderansicht' : 'Rückansicht'
          }`}
        >
          <Defs>
            <UnknownHatch id={HATCH_ID} />
          </Defs>

          {/* Kopf, Hals und Umriss sind Beiwerk und nicht antippbar. */}
          <Path d={NECK} fill={figure.body} />
          <Circle
            cx={100}
            cy={25}
            fill={figure.body}
            r={21}
            stroke={figure.bodyLine}
            strokeWidth={1}
          />
          <Path
            d={SILHOUETTE}
            fill={figure.body}
            stroke={figure.bodyLine}
            strokeWidth={1}
          />

          {shapes.map(shape => {
            const value = values[shape.id] ?? null;
            const unknown = typeof value !== 'number';
            const isSelected = selected === shape.id;
            const [cx, cy] = centroid(shape.blob.points);
            return (
              <G key={shape.id}>
                <Path
                  accessibilityLabel={regionSpeech(mode, shape.id, value)}
                  d={rounded(shape.blob.points, shape.blob.r)}
                  fill={fillFor(mode, value)}
                  onPress={
                    onSelectRegion ? () => onSelectRegion(shape.id) : undefined
                  }
                  stroke={isSelected ? color.text : color.line}
                  strokeDasharray={unknown && !isSelected ? '3 3' : undefined}
                  strokeWidth={isSelected ? 2.6 : 0.9}
                />
                {showNumbers && !unknown ? (
                  <SvgText
                    fill={color.ink}
                    fontSize={11}
                    fontWeight="700"
                    textAnchor="middle"
                    x={cx}
                    y={cy + 4}
                  >
                    {displayValue(value)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </Svg>
      </View>

      {/* Skala als Balken statt als Absatz: kürzer und genauso eindeutig. */}
      <View style={styles.legend}>
        <Text style={styles.legendEnd}>0</Text>
        <View style={styles.legendBar}>
          <Svg height={10} width="100%">
            <Defs>
              <LinearGradient id={SCALE_ID} x1="0" x2="1" y1="0" y2="0">
                <GradientStop offset="0" stopColor={fillFor(mode, 0)} />
                <GradientStop offset="1" stopColor={fillFor(mode, scale.max)} />
              </LinearGradient>
            </Defs>
            <Rect
              fill={`url(#${SCALE_ID})`}
              height="10"
              rx="5"
              width="100%"
              x="0"
              y="0"
            />
          </Svg>
        </View>
        <Text style={styles.legendEnd}>{scale.max}</Text>
        <View style={styles.legendUnknown}>
          <Svg height={14} width={14}>
            <Defs>
              <UnknownHatch id={`${HATCH_ID}Legend`} />
            </Defs>
            <Rect
              fill={`url(#${HATCH_ID}Legend)`}
              height="14"
              rx="4"
              stroke={color.line}
              strokeDasharray="3 3"
              width="14"
              x="0"
              y="0"
            />
          </Svg>
          <Text style={styles.legendEnd}>unbekannt</Text>
        </View>
      </View>

      {showList ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: listOpen }}
            onPress={() => setListOpen(open => !open)}
            style={({ pressed }) => [
              styles.disclosure,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.disclosureText}>
              {listOpen ? 'Liste ausblenden' : 'Alle Regionen als Liste'}
            </Text>
            <Text style={styles.disclosureText}>{listOpen ? '▴' : '▾'}</Text>
          </Pressable>
          {listOpen
            ? shapes.map(shape => {
                const value = values[shape.id] ?? null;
                return (
                  <Pressable
                    accessibilityLabel={regionSpeech(mode, shape.id, value)}
                    accessibilityRole="button"
                    key={`row-${shape.id}`}
                    onPress={() => onSelectRegion?.(shape.id)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.rowName}>{regionLabel(shape.id)}</Text>
                    <Text
                      style={[
                        styles.rowValue,
                        typeof value !== 'number' && styles.rowUnknown,
                      ]}
                    >
                      {typeof value === 'number'
                        ? displayValue(value)
                        : 'unbekannt'}
                    </Text>
                  </Pressable>
                );
              })
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  tabs: {
    flexDirection: 'row',
    gap: space.xxs,
    backgroundColor: color.surface,
    borderRadius: radius.pill,
    padding: space.xxs,
  },
  tab: {
    minHeight: 44,
    flex: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: color.raised },
  tabText: { color: color.muted, ...type.body, fontWeight: '600' },
  tabTextActive: { color: color.text },
  pressed: { opacity: 0.72 },
  scaleHead: { gap: space.xxs },
  scaleTitle: { color: color.text, ...type.label, fontWeight: '700' },
  scaleHint: { color: color.muted, ...type.micro },
  figure: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    paddingVertical: space.sm,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendBar: { flex: 1 },
  legendEnd: {
    color: color.muted,
    ...type.micro,
    fontVariant: ['tabular-nums'],
  },
  legendUnknown: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  disclosure: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disclosureText: { color: color.muted, ...type.label },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  rowName: { flex: 1, color: color.text, ...type.body },
  rowValue: {
    color: color.text,
    ...type.body,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowUnknown: { color: color.muted, fontWeight: '500' },
});
