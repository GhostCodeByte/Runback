import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  Pattern,
  Polygon,
  Rect,
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
import { color } from './components';

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
 * Schraffur, einen gestrichelten Rand und den Text „–“ statt einer Zahl, damit
 * es auch ohne Farbunterscheidungsvermögen eindeutig bleibt.
 */

export type BodyView = 'front' | 'back';
export type BodyMapMode = 'soreness' | 'freshness';

/** Kasten in der linken Bildhälfte. Die rechte Hälfte entsteht durch Spiegelung. */
type Box = [number, number, number, number];

const WIDTH = 200;
const HEIGHT = 420;
const HATCH_ID = 'runbackUnknownHatch';

/**
 * Stilisierte Flächen. Anatomische Schönheit ist nicht das Ziel — eindeutige
 * Trefferflächen und korrekte Regionskennungen sind es. Für kleine Regionen
 * trägt zusätzlich die Liste unter der Figur den vollen 44-px-Tippbereich.
 */
const FRONT_BOXES: Partial<Record<RegionBase, Box>> = {
  shoulder_side: [20, 60, 48, 92],
  shoulder_front: [52, 58, 80, 92],
  chest_upper: [54, 94, 98, 122],
  chest_mid: [54, 124, 98, 152],
  biceps: [20, 96, 48, 140],
  forearm: [16, 144, 44, 192],
  oblique: [48, 154, 76, 198],
  abs_upper: [78, 152, 122, 180],
  abs_lower: [78, 182, 122, 210],
  hip_flexor: [60, 212, 96, 240],
  quad: [48, 244, 82, 320],
  adductor: [84, 244, 98, 312],
  tibialis: [58, 332, 86, 404],
};

const BACK_BOXES: Partial<Record<RegionBase, Box>> = {
  neck: [86, 52, 114, 80],
  trap_upper: [52, 60, 80, 92],
  shoulder_rear: [20, 64, 48, 98],
  trap_mid: [82, 82, 118, 112],
  rhomboid: [82, 114, 118, 146],
  lat: [52, 100, 80, 156],
  triceps: [18, 102, 46, 148],
  lower_back: [66, 158, 98, 196],
  glute: [58, 200, 98, 246],
  hamstring: [56, 250, 92, 316],
  calf_gastroc: [58, 326, 90, 372],
  calf_soleus: [58, 376, 90, 404],
};

const mirror = ([x0, y0, x1, y1]: Box): Box => [
  WIDTH - x1,
  y0,
  WIDTH - x0,
  y1,
];

const points = ([x0, y0, x1, y1]: Box) =>
  `${x0},${y0} ${x1},${y0} ${x1},${y1} ${x0},${y1}`;

interface Shape {
  id: RegionId;
  box: Box;
}

/**
 * In der Vorderansicht liegt die rechte Körperseite links im Bild, in der
 * Rückansicht die linke. Genau so sieht der Nutzer sich im Spiegel
 * beziehungsweise von hinten.
 */
function shapesFor(view: BodyView): Shape[] {
  const boxes = view === 'front' ? FRONT_BOXES : BACK_BOXES;
  const leftHalfSide: Side = view === 'front' ? 'r' : 'l';
  const rightHalfSide: Side = view === 'front' ? 'l' : 'r';
  const shapes: Shape[] = [];
  for (const region of REGIONS) {
    const box = boxes[region.base];
    if (region.view !== view || !box) {
      continue;
    }
    if (!region.sided) {
      shapes.push({ id: regionId(region.base), box });
      continue;
    }
    shapes.push({ id: regionId(region.base, leftHalfSide), box });
    shapes.push({ id: regionId(region.base, rightHalfSide), box: mirror(box) });
  }
  return shapes;
}

/** Alle konkreten Regionen einer Ansicht, in Reihenfolge der Regionenliste. */
export function regionsInView(view: BodyView): RegionId[] {
  return shapesFor(view).map(shape => shape.id);
}

// --- Zwei getrennte Skalen. Sie werden nie gemischt. --------------------------

type Stop = [number, [number, number, number]];

/** Gemeldeter Muskelkater 0–10. Warm, weil es eine Empfindung ist. */
const SORENESS_STOPS: Stop[] = [
  [0, [58, 70, 54]],
  [5, [212, 165, 90]],
  [10, [217, 106, 74]],
];

/** Gerechnete Frische 0–100. Grün, die Hausfarbe der App. */
const FRESHNESS_STOPS: Stop[] = [
  [0, [74, 90, 70]],
  [100, [165, 216, 121]],
];

function ramp(stops: Stop[], value: number): string {
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
}

export function BodyMap({
  values,
  mode,
  view,
  onChangeView,
  onSelectRegion,
  selected = null,
  showList = true,
}: BodyMapProps) {
  const [ownView, setOwnView] = useState<BodyView>('front');
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
            style={[styles.tab, current === option && styles.tabActive]}
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

      <Text style={styles.scaleTitle}>{scale.title}</Text>
      <Text style={styles.scaleHint}>{scale.hint}</Text>

      <View style={styles.figure}>
        <Svg
          height={504}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          accessibilityLabel={`Körperfigur, ${
            current === 'front' ? 'Vorderansicht' : 'Rückansicht'
          }`}
        >
          <Defs>
            {/* Schraffur für unbekannt. Wirkt auch ohne Farbunterscheidung. */}
            <Pattern
              height="6"
              id={HATCH_ID}
              patternUnits="userSpaceOnUse"
              width="6"
            >
              <Rect fill={color.surface} height="6" width="6" x="0" y="0" />
              <Line
                stroke={color.muted}
                strokeWidth="1.2"
                x1="0"
                x2="6"
                y1="6"
                y2="0"
              />
            </Pattern>
          </Defs>
          {/* Kopf und Rumpfumriss sind Beiwerk und nicht antippbar. */}
          <G>
            <Circle
              cx={100}
              cy={28}
              fill={color.raised}
              r={20}
              stroke={color.line}
              strokeWidth={1}
            />
          </G>
          {shapes.map(shape => {
            const value = values[shape.id] ?? null;
            const unknown = typeof value !== 'number';
            const [x0, y0, x1, y1] = shape.box;
            return (
              <G key={shape.id}>
                <Polygon
                  accessibilityLabel={regionSpeech(mode, shape.id, value)}
                  fill={fillFor(mode, value)}
                  onPress={
                    onSelectRegion ? () => onSelectRegion(shape.id) : undefined
                  }
                  points={points(shape.box)}
                  stroke={selected === shape.id ? color.text : color.line}
                  strokeDasharray={unknown ? '4 3' : undefined}
                  strokeWidth={selected === shape.id ? 2.4 : 1}
                />
                <SvgText
                  fill={unknown ? color.muted : color.ink}
                  fontSize={11}
                  fontWeight="700"
                  textAnchor="middle"
                  x={(x0 + x1) / 2}
                  y={(y0 + y1) / 2 + 4}
                >
                  {displayValue(value)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>

      <Text style={styles.legend}>
        „–“ mit Schraffur bedeutet unbekannt: keine ausreichende Grundlage. Das
        ist etwas anderes als ein niedriger oder hoher Wert.
      </Text>

      {showList ? (
        <ScrollView style={styles.list}>
          {shapes.map(shape => {
            const value = values[shape.id] ?? null;
            return (
              <Pressable
                accessibilityLabel={regionSpeech(mode, shape.id, value)}
                accessibilityRole="button"
                key={`row-${shape.id}`}
                onPress={() => onSelectRegion?.(shape.id)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
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
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    minHeight: 44,
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  tabActive: { backgroundColor: color.raised, borderColor: color.green },
  tabText: { color: color.muted, fontSize: 16, fontWeight: '600' },
  tabTextActive: { color: color.text },
  scaleTitle: { color: color.text, fontSize: 16, fontWeight: '600' },
  scaleHint: { color: color.muted, fontSize: 14, lineHeight: 21 },
  figure: { backgroundColor: color.surface, borderRadius: 10, paddingVertical: 8 },
  legend: { color: color.muted, fontSize: 14, lineHeight: 21 },
  list: { maxHeight: 320 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  pressed: { opacity: 0.72 },
  rowName: { flex: 1, color: color.text, fontSize: 16 },
  rowValue: {
    color: color.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowUnknown: { color: color.muted, fontWeight: '500' },
});
