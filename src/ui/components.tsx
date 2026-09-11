import React, { memo, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
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
    Läufe: 'M6 4H18V21H6ZM9 8H15M9 12H15M9 16H13',
    Fokus: 'M8 4H16M12 4V8M6 8H18L21 20H3ZM9 14H15',
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

export const Route = memo(function Route({ points }: { points: RoutePoint[] }) {
  const valid = points
    .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .slice(0, 512);
  if (valid.length < 2) {
    return <Copy muted>Keine GPS-Strecke aufgezeichnet.</Copy>;
  }
  const lat = valid.map(p => p.latitude),
    lon = valid.map(p => p.longitude);
  const minLat = Math.min(...lat),
    maxLat = Math.max(...lat),
    minLon = Math.min(...lon),
    maxLon = Math.max(...lon);
  const correction = Math.max(
    0.01,
    Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180),
  );
  const spanX = (maxLon - minLon) * correction,
    spanY = maxLat - minLat;
  const scale = Math.min(
    284 / Math.max(spanX, 0.000001),
    184 / Math.max(spanY, 0.000001),
  );
  const xy = valid.map(p => [
    18 +
      (284 - spanX * scale) / 2 +
      (p.longitude - minLon) * correction * scale,
    18 + (184 - spanY * scale) / 2 + (maxLat - p.latitude) * scale,
  ]);
  return (
    <View
      accessibilityLabel="Vereinfachte aufgezeichnete GPS-Strecke, ohne Hintergrundkarte"
      style={s.route}
    >
      <Svg width="100%" height={220} viewBox="0 0 320 220">
        <Path
          d={xy
            .map(
              (p, i) => `${i === 0 || valid[i].gap ? 'M' : 'L'}${p[0]},${p[1]}`,
            )
            .join(' ')}
          stroke={color.green}
          strokeWidth={3}
          strokeLinejoin="round"
          fill="none"
        />
        <Circle cx={xy[0][0]} cy={xy[0][1]} r={5} fill={color.text} />
        <Circle
          cx={xy[xy.length - 1][0]}
          cy={xy[xy.length - 1][1]}
          r={5}
          fill={color.green}
          stroke={color.bg}
          strokeWidth={2}
        />
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
  route: { backgroundColor: color.surface, borderRadius: radius.sm },
});
