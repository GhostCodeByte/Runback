import React, {
  memo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  Image as NativeImage,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type ImageStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
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
  /** Etwas schlechter als sonst: nur für Text, nie als Fläche. */
  caution: '#E8B04B',
  mapOverlay: '#101210D9',
  mapLine: '#F2F4EF3D',
  /**
   * Linien der Laufgraphen. Der Akzent bleibt Tempo; Puls, Kadenz und Wind
   * brauchen eigene, gegen `surface` geprüfte Töne, weil sie nebeneinander
   * lesbar sein müssen. Höhe ist Hintergrund und bleibt `muted`.
   */
  series: {
    heart: '#E66767',
    cadence: '#9085E9',
    headwind: '#D95926',
    tailwind: '#3987E5',
  },
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
  options: { value: T; label: string; disabled?: boolean }[];
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
        const optionDisabled = disabled || option.disabled;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{
              selected,
              checked: selected,
              disabled: optionDisabled,
            }}
            disabled={optionDisabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              s.chip,
              selected && s.chipSelected,
              optionDisabled && s.disabled,
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

/** Wie eine Zahl gegenüber den letzten Läufen steht. Farbe nie allein: der Pfeil trägt dieselbe Aussage. */
export type StatTone = 'better' | 'same' | 'slightly_worse' | 'worse';
const TONE_MARK: Record<StatTone, string> = {
  better: '▲',
  same: '',
  slightly_worse: '▽',
  worse: '▼',
};
const TONE_WORD: Record<StatTone, string> = {
  better: 'besser als zuletzt',
  same: 'wie zuletzt',
  slightly_worse: 'etwas schlechter als zuletzt',
  worse: 'schlechter als zuletzt',
};
export function toneColor(tone: StatTone | undefined): string {
  return tone === 'better'
    ? color.green
    : tone === 'slightly_worse'
    ? color.caution
    : tone === 'worse'
    ? color.danger
    : color.text;
}

export function Stat({
  value,
  label,
  large = false,
  tone,
  delta,
}: {
  value: string;
  label: string;
  large?: boolean;
  /** Vergleich zu den letzten Läufen; färbt den Wert und setzt einen Pfeil. */
  tone?: StatTone;
  /** Kurzer Vergleichstext unter dem Label, z. B. „−0:08 /km“. */
  delta?: string;
}) {
  const mark = tone ? TONE_MARK[tone] : '';
  return (
    <View
      style={s.stat}
      accessibilityLabel={
        tone ? `${value} ${label}, ${TONE_WORD[tone]}` : undefined
      }
    >
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[
          s.statValue,
          large && s.statLarge,
          tone ? { color: toneColor(tone) } : null,
        ]}
      >
        {value}
        {mark ? <Text style={s.statMark}> {mark}</Text> : null}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
      {delta ? <Text style={s.statDelta}>{delta}</Text> : null}
    </View>
  );
}

/**
 * Ein Balken aus mehreren Anteilen, z. B. das Zeitbudget eines Laufs. Jeder
 * Anteil hat Farbe und Beschriftung; die Legende darunter nennt die Werte,
 * damit die Farbe nicht die einzige Information ist.
 */
export function StackedBar({
  label,
  parts,
}: {
  label: string;
  parts: { value: number; color: string; label: string; text: string }[];
}) {
  const total = parts.reduce((sum, part) => sum + Math.max(part.value, 0), 0);
  if (total <= 0) return null;
  return (
    <View style={s.stacked}>
      <View
        accessibilityRole="image"
        accessibilityLabel={`${label}: ${parts
          .map(part => `${part.label} ${part.text}`)
          .join(', ')}`}
        style={s.stackedBar}
      >
        {parts.map(part =>
          part.value > 0 ? (
            <View
              key={part.label}
              style={{
                flex: part.value / total,
                backgroundColor: part.color,
              }}
            />
          ) : null,
        )}
      </View>
      <View style={s.stackedLegend}>
        {parts.map(part => (
          <View key={part.label} style={s.stackedItem}>
            <View style={[s.swatch, { backgroundColor: part.color }]} />
            <Text style={s.stackedText}>
              {part.label} <Text style={s.stackedValue}>{part.text}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Umschalter zwischen zwei oder drei gleichwertigen Ansichten derselben Seite
 * (Einheiten · Statistik, Laufen · Krafttraining). Anders als `ChipGroup` steht
 * er für Ansichten, nicht für Eingaben, und füllt die ganze Breite.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={s.segmented}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              s.segment,
              selected && s.segmentSelected,
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.segmentText, selected && s.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Sichtbarer Zustand als kleines Etikett: Vorschlag · Aktiv · Pausiert. */
export function Badge({
  children,
  muted = false,
}: PropsWithChildren<{ muted?: boolean }>) {
  return (
    <View style={[s.badge, muted && s.badgeMuted]}>
      <Text style={[s.badgeText, muted && s.badgeTextMuted]}>{children}</Text>
    </View>
  );
}

/** Fortschritt einer Prüfung als Balken. `value` zwischen 0 und 1. */
export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={s.progress}
    >
      <View style={[s.progressFill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

/**
 * Klappt Inhalt an Ort und Stelle auf (Symbol `⌄`). Für Nebenwege, die auf der
 * Seite bleiben sollen: Details, Verwalten, weitere Kennzahlen.
 */
export function Disclosure({
  title,
  subtitle,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}>) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const toggle = () => {
    setLocalOpen(!open);
    onToggle?.(!open);
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
      >
        <View style={s.rowText}>
          <Text style={s.rowTitle}>{title}</Text>
          {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
        </View>
        <Text style={[s.chevron, open && s.chevronOpen]}>⌄</Text>
      </Pressable>
      {open ? <View style={s.disclosureBody}>{children}</View> : null}
    </View>
  );
}

/**
 * Bottom-Sheet für Entscheidungen im Moment des Tuns: Start einer Einheit,
 * Bearbeiten einer Einheit. Die Seite darunter bleibt sichtbar, damit klar
 * ist, wohin man zurückkehrt.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
}>) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="height" style={s.sheetBackdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} schließen`}
          onPress={onClose}
          style={s.sheetScrim}
        />
        <ScrollView
          style={s.sheetScroll}
          contentContainerStyle={s.sheetCard}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.sheetGrip} />
          <Text accessibilityRole="header" style={s.sheetTitle}>
            {title}
          </Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
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
    Plan: 'M8 2V6M16 2V6M3 10H21M5 4H19A2 2 0 0 1 21 6V20A2 2 0 0 1 19 22H5A2 2 0 0 1 3 20V6A2 2 0 0 1 5 4M8 14H8.01M12 14H12.01M16 14H16.01M8 18H8.01M12 18H12.01',
    Verlauf: 'M4 20V13M10 20V7M16 20V10M3 20H21',
    Coach:
      'M12 21A9 9 0 1 0 12 3A9 9 0 0 0 12 21M12 16A4 4 0 1 0 12 8A4 4 0 0 0 12 16M12 12H12.01',
    Einstellungen:
      'M12 15A3 3 0 1 0 12 9A3 3 0 0 0 12 15M19.4 15A1.65 1.65 0 0 0 19.73 16.82L19.79 16.88A2 2 0 1 1 16.96 19.71L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14.08 20.83V21A2 2 0 1 1 10.08 21V20.91A1.65 1.65 0 0 0 9 19.4A1.65 1.65 0 0 0 7.18 19.73L7.12 19.79A2 2 0 1 1 4.29 16.96L4.35 16.9A1.65 1.65 0 0 0 4.68 15.08A1.65 1.65 0 0 0 3.17 14.08H3A2 2 0 1 1 3 10.08H3.09A1.65 1.65 0 0 0 4.6 9A1.65 1.65 0 0 0 4.27 7.18L4.21 7.12A2 2 0 1 1 7.04 4.29L7.1 4.35A1.65 1.65 0 0 0 8.92 4.68H9A1.65 1.65 0 0 0 10 3.17V3A2 2 0 1 1 14 3V3.09A1.65 1.65 0 0 0 15 4.6A1.65 1.65 0 0 0 16.82 4.27L16.88 4.21A2 2 0 1 1 19.71 7.04L19.65 7.1A1.65 1.65 0 0 0 19.32 8.92V9A1.65 1.65 0 0 0 20.83 10H21A2 2 0 1 1 21 14H20.91A1.65 1.65 0 0 0 19.4 15',
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
const ROUTE_VIEWBOX_HEIGHT = 260;
const ROUTE_PADDING = 28;
const TILE_SIZE = 256;
const TILE_MIN_ZOOM = 10;
const TILE_MAX_ZOOM = 18;
const MAX_ROUTE_POINTS = 512;
const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_HEADERS = {
  Accept: 'image/png,image/*;q=0.8',
  'User-Agent':
    'Runback/0.1 (https://github.com/GhostCodeByte/Runback; route map)',
};

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

type MapPoint = Pick<RoutePoint, 'latitude' | 'longitude'> & {
  gap?: boolean;
};

function validMapPoint(point: MapPoint | undefined): point is MapPoint {
  return Boolean(
    point &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude),
  );
}

function routeZoom(points: MapPoint[]): number {
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

function mapTiles(
  range: { minX: number; maxX: number; minY: number; maxY: number },
  scale: number,
  zoom: number,
): Tile[] {
  const worldPadding = ROUTE_PADDING / Math.max(scale, 0.0001);
  const firstX = Math.floor((range.minX - worldPadding) / TILE_SIZE) - 1;
  const lastX = Math.floor((range.maxX + worldPadding) / TILE_SIZE) + 1;
  const firstY = Math.floor((range.minY - worldPadding) / TILE_SIZE) - 1;
  const lastY = Math.floor((range.maxY + worldPadding) / TILE_SIZE) + 1;
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
        url: MAP_TILE_URL.replace('{z}', String(zoom))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(tileY)),
        left: ROUTE_PADDING + (tileX * TILE_SIZE - range.minX) * scale,
        top: ROUTE_PADDING + (tileY * TILE_SIZE - range.minY) * scale,
        size: TILE_SIZE * scale,
      });
    }
  }
  return tiles;
}

function markerLabel(
  point: Point,
  label: string,
  width: number,
  placement: 'above' | 'below' = 'above',
) {
  const left = clamp(point[0] + 12, 8, ROUTE_VIEWBOX_WIDTH - width - 8);
  const top = clamp(
    placement === 'above' ? point[1] - 34 : point[1] + 12,
    8,
    ROUTE_VIEWBOX_HEIGHT - 30,
  );
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

function mapProjection(points: MapPoint[]) {
  const zoom = routeZoom(points);
  const projected = points.map(point =>
    worldPixel(point.latitude, point.longitude, zoom),
  );
  const worldRange = bounds(projected);
  const spanX = Math.max(worldRange.maxX - worldRange.minX, 1);
  const spanY = Math.max(worldRange.maxY - worldRange.minY, 1);
  const scale = Math.min(
    (ROUTE_VIEWBOX_WIDTH - ROUTE_PADDING * 2) / spanX,
    (ROUTE_VIEWBOX_HEIGHT - ROUTE_PADDING * 2) / spanY,
  );
  const project = (point: MapPoint): Point => {
    const world = worldPixel(point.latitude, point.longitude, zoom);
    return [
      ROUTE_PADDING + (world[0] - worldRange.minX) * scale,
      ROUTE_PADDING + (world[1] - worldRange.minY) * scale,
    ];
  };
  return {
    xy: projected.map(
      point =>
        [
          ROUTE_PADDING + (point[0] - worldRange.minX) * scale,
          ROUTE_PADDING + (point[1] - worldRange.minY) * scale,
        ] as Point,
    ),
    tiles: mapTiles(worldRange, scale, zoom),
    project,
  };
}

/** Berührung in Ansichts-Pixeln → viewBox-Koordinaten (Svg füllt zentriert, „meet“). */
function svgPointFromTouch(
  x: number,
  y: number,
  width: number,
  height: number,
): Point {
  const k = Math.min(
    width / ROUTE_VIEWBOX_WIDTH,
    height / ROUTE_VIEWBOX_HEIGHT,
  );
  if (!(k > 0)) return [x, y];
  return [
    (x - (width - ROUTE_VIEWBOX_WIDTH * k) / 2) / k,
    (y - (height - ROUTE_VIEWBOX_HEIGHT * k) / 2) / k,
  ];
}

/** Zusätzliche Kartenebenen der Detailseite: aktiver Moment, Kilometer, markierter Abschnitt. */
export interface RouteOverlay {
  /** Aktiver Moment; weißer Ring, damit er sich von Start/Ziel und Kilometern abhebt. */
  focus?: MapPoint;
  /** Abschnitt (z. B. ein Kilometer), der hervorgehoben wird. */
  highlight?: MapPoint[];
  markers?: { point: MapPoint; label: string }[];
  /** Kurzer Hinweis oben rechts, z. B. Wind. */
  note?: string;
  /** Antippen oder Ziehen auf der Karte: nächster Streckenpunkt. */
  onPick?: (point: RoutePoint) => void;
}

function mapTileStyle(tile: Tile): ImageStyle {
  return {
    left: `${(tile.left / ROUTE_VIEWBOX_WIDTH) * 100}%`,
    top: `${(tile.top / ROUTE_VIEWBOX_HEIGHT) * 100}%`,
    width: `${(tile.size / ROUTE_VIEWBOX_WIDTH) * 100}%`,
    height: `${(tile.size / ROUTE_VIEWBOX_HEIGHT) * 100}%`,
  } as ImageStyle;
}

function RouteSurface({
  planned,
  track,
  current,
  mode,
  accessibilityLabel,
  overlay,
}: {
  planned: MapPoint[];
  track: MapPoint[];
  current?: MapPoint;
  mode: 'planned' | 'live' | 'recorded';
  accessibilityLabel: string;
  overlay?: RouteOverlay;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const validPlanned = planned.filter(validMapPoint).slice(0, MAX_ROUTE_POINTS);
  const validTrack = track.filter(validMapPoint).slice(0, MAX_ROUTE_POINTS);
  const validCurrent = validMapPoint(current) ? current : undefined;
  const valid = [
    ...validPlanned,
    ...validTrack,
    ...(validCurrent ? [validCurrent] : []),
  ];
  if (valid.length < 2) {
    const hasRecordedTrack = mode === 'recorded';
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[s.route, s.routeEmpty]}
      >
        <View pointerEvents="none" style={s.mapFallback} />
        <View pointerEvents="none" style={s.routeEmptyContent}>
          <Text style={s.routeEmptyTitle}>
            {hasRecordedTrack ? 'Keine GPS-Strecke' : 'Route wird geladen'}
          </Text>
          <Text style={s.routeEmptyCopy}>
            {hasRecordedTrack
              ? 'Für diese Einheit wurde keine Route gespeichert.'
              : 'Die Kartendaten werden vorbereitet.'}
          </Text>
        </View>
      </View>
    );
  }

  const { xy, tiles, project } = mapProjection(valid);
  const pointToSvg = (point: MapPoint) => {
    const index = valid.indexOf(point);
    return index >= 0 ? xy[index] : project(point);
  };
  const onPick = overlay?.onPick;
  // Antippen/Ziehen: nächster Streckenpunkt in Bildkoordinaten. Die Geste
  // bleibt bei der Karte, damit die Liste darunter nicht scrollt.
  const pick = (event: GestureResponderEvent) => {
    if (!onPick || !size || validTrack.length < 2) return;
    const { locationX, locationY } = event.nativeEvent;
    const [x, y] = svgPointFromTouch(
      locationX,
      locationY,
      size.width,
      size.height,
    );
    let best = 0;
    let bestDistance = Infinity;
    validTrack.forEach((point, index) => {
      const [px, py] = pointToSvg(point);
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    onPick(validTrack[best] as RoutePoint);
  };
  const responder = onPick
    ? {
        onLayout: (event: LayoutChangeEvent) =>
          setSize({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          }),
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderTerminationRequest: () => false,
        onResponderGrant: pick,
        onResponderMove: pick,
      }
    : {};

  const pathFor = (points: MapPoint[]) => {
    const usable = points.filter(validMapPoint);
    return usable
      .map((point, index) => {
        const [x, y] = pointToSvg(point);
        return `${index === 0 || point.gap ? 'M' : 'L'}${x.toFixed(
          2,
        )},${y.toFixed(2)}`;
      })
      .join(' ');
  };
  const startPoint = validPlanned[0] || validTrack[0];
  const finishPoint =
    validPlanned[validPlanned.length - 1] || validTrack[validTrack.length - 1];
  const start = pointToSvg(startPoint);
  const finish = pointToSvg(finishPoint);
  const currentPoint =
    mode === 'recorded' ? undefined : validCurrent || validTrack.at(-1);
  const currentSvg = currentPoint ? pointToSvg(currentPoint) : undefined;
  const plannedPath = pathFor(validPlanned);
  const trackPath = pathFor(validTrack);
  const highlightPath =
    overlay?.highlight && overlay.highlight.length >= 2
      ? pathFor(overlay.highlight)
      : '';
  const focus = validMapPoint(overlay?.focus)
    ? pointToSvg(overlay.focus)
    : undefined;

  return (
    <View
      accessible
      accessibilityRole={onPick ? 'adjustable' : 'image'}
      accessibilityLabel={accessibilityLabel}
      style={s.route}
      {...responder}
    >
      <View pointerEvents="none" style={s.routeLayer}>
        <View style={s.mapTiles}>
          {tiles.map(tile => (
            <NativeImage
              key={tile.key}
              accessible={false}
              source={{
                uri: tile.url,
                headers: MAP_TILE_HEADERS,
                cache: 'force-cache',
              }}
              resizeMode="cover"
              style={[s.mapTile, mapTileStyle(tile)]}
            />
          ))}
        </View>
        <View style={s.routeScrim} />
      </View>
      <View pointerEvents="none" style={s.routeBadge}>
        <Text style={s.routeBadgeText}>
          {mode === 'live' ? 'Live-Route' : 'GPS-Route'}
        </Text>
      </View>
      {overlay?.note ? (
        <View pointerEvents="none" style={[s.routeBadge, s.routeNote]}>
          <Text style={s.routeBadgeText}>{overlay.note}</Text>
        </View>
      ) : null}
      <Svg
        height="100%"
        pointerEvents="none"
        style={s.routeLayer}
        viewBox={`0 0 ${ROUTE_VIEWBOX_WIDTH} ${ROUTE_VIEWBOX_HEIGHT}`}
        width="100%"
      >
        {mode === 'live' && validPlanned.length >= 2 ? (
          <>
            <Path
              d={plannedPath}
              stroke={color.ink}
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="8 8"
              fill="none"
              opacity={0.92}
            />
            <Path
              d={plannedPath}
              stroke={color.text}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="8 8"
              fill="none"
            />
          </>
        ) : mode !== 'live' && validPlanned.length >= 2 ? (
          <>
            <Path
              d={plannedPath}
              stroke={color.ink}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={0.9}
            />
            <Path
              d={plannedPath}
              stroke={color.green}
              strokeWidth={5.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : null}
        {(mode === 'live' || mode === 'recorded') && validTrack.length >= 2 ? (
          <>
            <Path
              d={trackPath}
              stroke={color.ink}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={0.92}
            />
            <Path
              d={trackPath}
              stroke={color.green}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : null}
        {highlightPath ? (
          <Path
            d={highlightPath}
            stroke={color.text}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
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
        {overlay?.markers
          ?.filter(marker => validMapPoint(marker.point))
          .map(marker => {
            const [x, y] = pointToSvg(marker.point);
            return (
              <React.Fragment key={marker.label}>
                <Circle
                  cx={x}
                  cy={y}
                  r={8}
                  fill={color.mapOverlay}
                  stroke={color.green}
                  strokeWidth={1.5}
                />
                <SvgText
                  x={x}
                  y={y + 3.5}
                  fill={color.text}
                  fontSize={9}
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {marker.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        {overlay?.markers?.length
          ? null
          : markerLabel(start, 'Start', 48, 'above')}
        {overlay?.markers?.length
          ? null
          : markerLabel(finish, 'Ziel', 42, 'below')}
        {focus ? (
          <>
            <Circle
              cx={focus[0]}
              cy={focus[1]}
              r={13}
              fill="none"
              stroke={color.text}
              strokeWidth={2}
              opacity={0.6}
            />
            <Circle
              cx={focus[0]}
              cy={focus[1]}
              r={6}
              fill={color.text}
              stroke={color.ink}
              strokeWidth={3}
            />
          </>
        ) : null}
        {currentSvg ? (
          <Circle
            cx={currentSvg[0]}
            cy={currentSvg[1]}
            r={10}
            fill={color.green}
            stroke={color.ink}
            strokeWidth={4}
          />
        ) : null}
      </Svg>
      <View pointerEvents="none" style={s.mapAttribution}>
        <Text style={s.mapAttributionText}>© OpenStreetMap-Mitwirkende</Text>
      </View>
    </View>
  );
}

export const Route = memo(function Route({
  points,
  overlay,
}: {
  points: RoutePoint[];
  overlay?: RouteOverlay;
}) {
  const valid = sampleRoute(points);
  return (
    <RouteSurface
      planned={[]}
      track={valid}
      mode="recorded"
      overlay={overlay}
      accessibilityLabel={
        valid.length >= 2
          ? overlay?.onPick
            ? 'Aufgezeichnete GPS-Strecke mit OpenStreetMap-Karte. Antippen wählt einen Moment des Laufs.'
            : 'Aufgezeichnete GPS-Strecke mit OpenStreetMap-Karte. Start und Ziel sind markiert.'
          : 'Keine GPS-Strecke aufgezeichnet'
      }
    />
  );
});

/**
 * Kartenansicht für geplante und laufende Routen. Die Straßenkarte kommt als
 * normale React-Native-Bildkachel mit identifizierendem User-Agent; das
 * verhindert die 403-Sperre des öffentlichen OSM-Tileservers.
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
  return (
    <RouteSurface
      planned={planned}
      track={track}
      current={current}
      mode={track.length > 1 || current ? 'live' : 'planned'}
      accessibilityLabel="Geplante Laufstrecke auf einer OpenStreetMap-Karte mit Start, Ziel und bisheriger Position"
    />
  );
});

export function RouteOpenActions({
  onGoogleMaps,
  onCoMaps,
  disabled = false,
}: {
  onGoogleMaps: () => void;
  onCoMaps: () => void;
  disabled?: boolean;
}) {
  return (
    <Section title="Route in Karten-App öffnen">
      <Button
        secondary
        title="In Google Maps öffnen"
        onPress={onGoogleMaps}
        disabled={disabled}
      />
      <Button
        secondary
        title="In CoMaps oder anderer App öffnen"
        onPress={onCoMaps}
        disabled={disabled}
      />
      <Copy muted>
        Google Maps berechnet die Gehroute neu. CoMaps erhält die exakte Route
        als GPX-Datei.
      </Copy>
    </Section>
  );
}

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
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.xxs,
    gap: space.xxs,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  segmentSelected: { backgroundColor: color.raised },
  segmentText: { color: color.muted, ...type.label },
  segmentTextSelected: { color: color.text, fontWeight: '600' },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.green,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  badgeMuted: { borderColor: color.muted },
  badgeText: { color: color.green, ...type.micro, fontWeight: '600' },
  badgeTextMuted: { color: color.muted },
  progress: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: color.green },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  disclosureBody: { paddingTop: space.sm, gap: space.sm },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.mapOverlay,
  },
  sheetScroll: { maxHeight: '88%', flexGrow: 0 },
  sheetCard: {
    backgroundColor: color.raised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    marginBottom: space.xs,
  },
  sheetTitle: { color: color.text, ...type.heading },
  stat: { flex: 1, gap: space.xxs },
  statValue: {
    color: color.text,
    ...type.value,
    fontVariant: ['tabular-nums'],
  },
  statLarge: { ...type.display },
  statLabel: { color: color.muted, ...type.label, fontWeight: '400' },
  statMark: { ...type.label, fontWeight: '600' },
  statDelta: {
    color: color.muted,
    ...type.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  stacked: { gap: space.xs },
  stackedBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: color.raised,
  },
  stackedLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stackedItem: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  stackedText: { color: color.muted, ...type.label, fontWeight: '400' },
  stackedValue: {
    color: color.text,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  route: {
    height: ROUTE_VIEWBOX_HEIGHT,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  routeLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  mapTiles: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },
  mapTile: { position: 'absolute', backgroundColor: color.surface },
  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.surface,
  },
  routeScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.mapOverlay,
    opacity: 0.16,
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
  routeNote: { left: undefined, right: space.md },
  mapAttribution: {
    position: 'absolute',
    right: space.xs,
    bottom: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: color.mapOverlay,
  },
  mapAttributionText: { color: color.text, ...type.micro, fontSize: 10 },
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
