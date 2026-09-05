import React, { memo, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import type { RoutePoint } from '../native';
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
    return <Copy muted>Keine darstellbare GPS-Strecke vorhanden.</Copy>;
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
        <Polyline
          points={xy.map(p => p.join(',')).join(' ')}
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
  route: { backgroundColor: color.surface, marginVertical: 8 },
});
