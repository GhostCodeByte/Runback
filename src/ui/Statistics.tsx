import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Run } from '../native';
import {
  bucketValue,
  buildStatisticsView,
  STATS_RANGES,
  type StatsBucket,
  type StatsDelta,
  type StatsMetric,
  type StatsRange,
} from '../domain/statisticsView';
import {
  ChipGroup,
  Copy,
  EmptyState,
  Row,
  Section,
  Stat,
  color,
  radius,
  space,
  type as type_,
} from './components';

/**
 * Statistik in drei Tiefen:
 *
 * 1. Kopf — Zeitraum wählen, drei Kennzahlen mit Vergleich zum Zeitraum davor.
 * 2. Verlauf — ein Diagramm, dessen Kennzahl der Nutzer wählt; jeder Balken
 *    ist antippbar und öffnet seine Werte an Ort und Stelle.
 * 3. Abschnitte — Verteilung, Bestwerte, Konsistenz, Körperwerte; eingeklappt,
 *    bis jemand sie sehen will.
 *
 * Die Zeitraumauswahl steht über allem und gilt für alles darunter. Es gibt
 * keine zweite Auswahl, die nur einen Abschnitt betrifft.
 */

export interface StatisticsView {
  range: StatsRange;
  metric: StatsMetric;
}

export const defaultStatisticsView: StatisticsView = {
  range: '12w',
  metric: 'distance',
};

/** Die Einstellungen kommen als ungeprüftes JSON aus dem nativen Speicher.
 *  Unbekanntes fällt auf die Voreinstellung zurück, statt die Seite zu leeren. */
export function readStatisticsView(value: unknown): StatisticsView {
  const raw = (value ?? {}) as { range?: unknown; metric?: unknown };
  return {
    range: STATS_RANGES.some(entry => entry.value === raw.range)
      ? (raw.range as StatsRange)
      : defaultStatisticsView.range,
    metric: METRICS.some(entry => entry.value === raw.metric)
      ? (raw.metric as StatsMetric)
      : defaultStatisticsView.metric,
  };
}

const METRICS: {
  value: StatsMetric;
  label: string;
  /** Kennzahlen ohne sinnvollen Nullpunkt werden als Punkte gezeigt. */
  shape: 'bar' | 'point';
}[] = [
  { value: 'distance', label: 'Distanz', shape: 'bar' },
  { value: 'duration', label: 'Dauer', shape: 'bar' },
  { value: 'count', label: 'Läufe', shape: 'bar' },
  { value: 'pace', label: 'Tempo', shape: 'point' },
  { value: 'effort', label: 'Gefühl', shape: 'point' },
];

const DASH = '–';

const decimal = (value: number, digits = 1) =>
  value.toFixed(digits).replace('.', ',');

const formatKm = (value: number) => `${decimal(value, value >= 100 ? 0 : 1)}`;

const formatDuration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

const formatPace = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return DASH;
  }
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Ein Wert samt Einheit — die einzige Stelle, an der eine Kennzahl in Text
 *  übersetzt wird. Sie wird für Kacheln, Achse und Detailzeile benutzt. */
function formatMetric(
  metric: StatsMetric,
  value: number | null,
): { value: string; unit: string } {
  if (value === null || !Number.isFinite(value)) {
    return { value: DASH, unit: '' };
  }
  switch (metric) {
    case 'distance':
      return { value: formatKm(value), unit: 'km' };
    case 'duration':
      return { value: formatDuration(value), unit: '' };
    case 'count':
      return { value: String(Math.round(value)), unit: value === 1 ? 'Lauf' : 'Läufe' };
    case 'pace':
      return { value: formatPace(value), unit: 'min / km' };
    case 'effort':
      return { value: decimal(value), unit: '/ 10' };
  }
}

const metricLabel = (metric: StatsMetric) =>
  METRICS.find(entry => entry.value === metric)?.label ?? '';

export function Statistics({
  runs,
  view = defaultStatisticsView,
  onViewChange,
}: {
  runs: Run[];
  /** Zuletzt gewählter Zeitraum und Kennzahl. */
  view?: StatisticsView;
  onViewChange?: (view: StatisticsView) => void;
}) {
  const [localView, setLocalView] = useState(view);
  // Ohne Speicher von außen bleibt die Auswahl wenigstens für diese Sitzung.
  const active = onViewChange ? view : localView;
  const setView = (next: StatisticsView) => {
    setLocalView(next);
    onViewChange?.(next);
  };

  const stats = useMemo(
    () => buildStatisticsView(runs, active.range),
    [runs, active.range],
  );
  const [selected, setSelected] = useState<number | null>(null);

  // Eine Kennzahl, für die es keine Daten gibt, wird nicht angeboten — und
  // eine bereits gewählte fällt auf die Distanz zurück.
  const metrics = METRICS.filter(
    entry =>
      (entry.value !== 'pace' || stats.available.pace) &&
      (entry.value !== 'effort' || stats.available.effort),
  );
  const metric = metrics.some(entry => entry.value === active.metric)
    ? active.metric
    : 'distance';

  if (!runs.length) {
    return (
      <View style={styles.page}>
        <Text accessibilityRole="header" style={styles.title}>
          Statistik
        </Text>
        <EmptyState
          title="Noch keine Läufe"
          copy="Sobald ein Lauf abgeschlossen oder importiert ist, entsteht hier deine Entwicklung."
        />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>
        Statistik
      </Text>

      <ChipGroup
        label="Zeitraum"
        options={STATS_RANGES}
        value={active.range}
        onChange={range => {
          setSelected(null);
          setView({ ...active, range });
        }}
      />

      <View style={styles.tiles}>
        <Tile
          value={formatKm(stats.totals.distanceKm)}
          unit="km"
          label="Distanz"
          delta={stats.deltas.distance}
        />
        <Tile
          value={String(stats.totals.runCount)}
          unit=""
          label={stats.totals.runCount === 1 ? 'Lauf' : 'Läufe'}
          delta={stats.deltas.count}
        />
        <Tile
          value={formatDuration(stats.totals.durationSeconds)}
          unit=""
          label="Zeit"
          delta={stats.deltas.duration}
        />
      </View>
      <Copy muted style={styles.compare}>
        {stats.comparisonLabel
          ? `Pfeile vergleichen mit ${stats.comparisonLabel}.`
          : 'Kein vergleichbarer Zeitraum davor.'}
      </Copy>

      <Section title="Verlauf">
        <ChipGroup
          label="Kennzahl im Verlauf"
          options={metrics.map(entry => ({
            value: entry.value,
            label: entry.label,
          }))}
          value={metric}
          onChange={next => setView({ ...active, metric: next })}
        />
        <Chart
          buckets={stats.buckets}
          metric={metric}
          shape={
            METRICS.find(entry => entry.value === metric)?.shape ?? 'bar'
          }
          selected={selected}
          onSelect={index =>
            setSelected(current => (current === index ? null : index))
          }
        />
        <BucketDetail
          bucket={selected === null ? null : stats.buckets[selected]}
          metric={metric}
        />
      </Section>

      <Section title="Tiefer schauen">
        <Panel
          title="Verteilung"
          summary={
            stats.purposes.length
              ? `${stats.purposes[0].label} führt mit ${Math.round(
                  stats.purposes[0].share * 100,
                )} %`
              : DASH
          }
        >
          {stats.purposes.map(share => (
            <View key={share.purpose} style={styles.shareRow}>
              <View style={styles.shareHead}>
                <Text style={styles.shareLabel}>{share.label}</Text>
                <Text style={styles.rowValue}>
                  {formatKm(share.distanceKm)} km ·{' '}
                  {Math.round(share.share * 100)} %
                </Text>
              </View>
              <View style={styles.shareTrack}>
                <View
                  style={[
                    styles.shareFill,
                    { width: `${Math.max(share.share * 100, 1)}%` },
                  ]}
                />
              </View>
              <Text style={styles.shareMeta}>
                {share.runCount} {share.runCount === 1 ? 'Lauf' : 'Läufe'}
              </Text>
            </View>
          ))}
        </Panel>

        <Panel
          title="Bestwerte"
          summary={stats.records.length ? stats.records[0].value : DASH}
        >
          {stats.records.length ? (
            stats.records.map(record => (
              <ValueRow
                key={record.id}
                label={record.label}
                value={record.value}
                meta={record.detail}
              />
            ))
          ) : (
            <Copy muted>Für diesen Zeitraum gibt es noch keine Bestwerte.</Copy>
          )}
        </Panel>

        <Panel
          title="Konsistenz"
          summary={`${stats.consistency.activeWeeks} von ${stats.consistency.weekCount} Wochen`}
        >
          <ValueRow
            label="Wochen mit Lauf"
            value={`${stats.consistency.activeWeeks} / ${stats.consistency.weekCount}`}
          />
          <ValueRow
            label="Aktuelle Serie"
            value={`${stats.consistency.currentStreakWeeks} ${
              stats.consistency.currentStreakWeeks === 1 ? 'Woche' : 'Wochen'
            }`}
          />
          <ValueRow
            label="Längste Serie"
            value={`${stats.consistency.longestStreakWeeks} ${
              stats.consistency.longestStreakWeeks === 1 ? 'Woche' : 'Wochen'
            }`}
          />
          <ValueRow
            label="Läufe je Woche"
            value={
              stats.totals.runsPerWeek === null
                ? DASH
                : decimal(stats.totals.runsPerWeek)
            }
          />
          <ValueRow
            label="Tage mit Lauf"
            value={String(stats.consistency.activeDays)}
          />
        </Panel>

        <Panel
          title="Körperwerte"
          summary={
            stats.totals.paceSecondsPerKm === null
              ? DASH
              : `${formatPace(stats.totals.paceSecondsPerKm)} min / km`
          }
        >
          <ValueRow
            label="Ø Tempo"
            value={
              stats.totals.paceSecondsPerKm === null
                ? DASH
                : `${formatPace(stats.totals.paceSecondsPerKm)} min / km`
            }
          />
          <ValueRow
            label="Ø Distanz je Lauf"
            value={
              stats.totals.averageDistanceKm === null
                ? DASH
                : `${formatKm(stats.totals.averageDistanceKm)} km`
            }
          />
          <ValueRow
            label="Ø Beine"
            value={
              stats.totals.averageLegsRpe === null
                ? DASH
                : `${decimal(stats.totals.averageLegsRpe)} / 10`
            }
          />
          <ValueRow
            label="Ø Atmung"
            value={
              stats.totals.averageBreathingRpe === null
                ? DASH
                : `${decimal(stats.totals.averageBreathingRpe)} / 10`
            }
          />
          <ValueRow
            label="Ø Puls"
            value={
              stats.totals.averageHeartRate === null
                ? DASH
                : `${Math.round(stats.totals.averageHeartRate)} bpm`
            }
          />
          <ValueRow
            label="Ø Schrittfrequenz"
            value={
              stats.totals.averageCadence === null
                ? DASH
                : `${Math.round(stats.totals.averageCadence)} spm`
            }
          />
        </Panel>
      </Section>

      <Copy muted>
        Abgeschlossene und importierte Läufe, Doppelte zusammengeführt. Das
        Tempo ist nach Strecke gewichtet, ab 500 m.
      </Copy>
    </View>
  );
}

/** Kennzahl mit Vergleich. Der Pfeil ist die Richtung, der Prozentwert die
 *  Größe — Farbe trägt hier keine Information. */
function Tile({
  value,
  unit,
  label,
  delta,
}: {
  value: string;
  unit: string;
  label: string;
  delta: StatsDelta;
}) {
  const arrow =
    delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '';
  const percent =
    delta.changeRatio === null
      ? DASH
      : `${Math.abs(Math.round(delta.changeRatio * 100))} %`;
  const spoken =
    delta.direction === 'up'
      ? `${percent} mehr`
      : delta.direction === 'down'
      ? `${percent} weniger`
      : delta.direction === 'flat'
      ? 'unverändert'
      : 'kein Vergleich möglich';
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value} ${unit}, ${spoken}`}
      style={styles.tile}
    >
      <Stat value={value} label={unit ? `${label} · ${unit}` : label} />
      <Text style={styles.tileDelta}>
        {delta.direction === 'unknown'
          ? DASH
          : delta.direction === 'flat'
          ? '± 0 %'
          : `${arrow} ${percent}`}
      </Text>
    </View>
  );
}

/**
 * Ein Diagramm, eine Achse. Balken für Kennzahlen mit echtem Nullpunkt,
 * Punkte für Tempo und Gefühl — dort wäre ein Balken ab null eine Lüge über
 * die Größenordnung. Der ausgewählte Wert ist grün, alle anderen sind Fläche.
 */
function Chart({
  buckets,
  metric,
  shape,
  selected,
  onSelect,
}: {
  buckets: StatsBucket[];
  metric: StatsMetric;
  shape: 'bar' | 'point';
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const values = buckets.map(bucket => bucketValue(bucket, metric));
  const present = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const max = present.length ? Math.max(...present) : 0;
  const min = present.length ? Math.min(...present) : 0;
  // Punkte bekommen etwas Luft, damit der beste und der schlechteste Wert
  // nicht auf dem Rand kleben.
  const padding = shape === 'point' ? Math.max((max - min) * 0.2, max * 0.02) : 0;
  const low = shape === 'bar' ? 0 : min - padding;
  const high = shape === 'bar' ? max : max + padding;
  const span = high - low;
  const mean = present.length
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
  const share = (value: number) =>
    span > 0 ? Math.min(Math.max((value - low) / span, 0), 1) : 0.5;

  // Bei vielen Balken trägt nicht jeder eine Beschriftung, sonst überlappen sie.
  const step = Math.ceil(buckets.length / 7);
  const scale = present.length
    ? shape === 'bar'
      ? `0 bis ${formatMetric(metric, max).value}`
      : `${formatMetric(metric, min).value} bis ${formatMetric(metric, max).value}`
    : 'keine Werte';

  return (
    <View style={styles.chartBlock}>
      <View style={styles.chartHead}>
        <Text style={styles.chartScale}>{`Skala ${scale} ${
          formatMetric(metric, max).unit
        }`}</Text>
        {mean === null ? null : (
          <Text style={styles.chartScale}>
            {`Ø ${formatMetric(metric, mean).value}`}
          </Text>
        )}
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`${metricLabel(metric)} je Zeitraum, ${buckets.length} Werte`}
        style={styles.chart}
      >
        {buckets.map((bucket, index) => {
          const value = values[index];
          const isSelected = selected === index;
          const height = value === null ? 0 : share(value) * 100;
          const readout = formatMetric(metric, value);
          return (
            <Pressable
              key={bucket.startTime}
              accessibilityRole="button"
              accessibilityLabel={`${bucket.fullLabel}: ${readout.value} ${readout.unit}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(index)}
              style={styles.column}
            >
              <View style={styles.plot}>
                {value === null ? null : shape === 'bar' ? (
                  <View
                    style={[
                      styles.bar,
                      { height: `${Math.max(height, 1.5)}%` },
                      isSelected && styles.markSelected,
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      styles.dot,
                      { bottom: `${height}%` },
                      isSelected && styles.markSelected,
                    ]}
                  />
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.tick, isSelected && styles.tickSelected]}
              >
                {isSelected || index % step === 0 ? bucket.label : ''}
              </Text>
            </Pressable>
          );
        })}
        {mean === null ? null : (
          // Liegt über den Marken und deckt genau die Zeichenfläche ab, nicht
          // die Spalte samt Beschriftung.
          <View pointerEvents="none" style={styles.meanLayer}>
            <View style={[styles.mean, { bottom: `${share(mean) * 100}%` }]} />
          </View>
        )}
      </View>
    </View>
  );
}

/** Was hinter einem angetippten Balken steckt — an Ort und Stelle, ohne
 *  neue Ansicht. Ohne Auswahl steht hier der Hinweis, dass es etwas gibt. */
function BucketDetail({
  bucket,
  metric,
}: {
  bucket: StatsBucket | null;
  metric: StatsMetric;
}) {
  if (!bucket) {
    return (
      <Copy muted style={styles.hint}>
        Balken antippen zeigt den Zeitraum im Detail.
      </Copy>
    );
  }
  const highlighted = formatMetric(metric, bucketValue(bucket, metric));
  return (
    <View accessibilityLiveRegion="polite" style={styles.detail}>
      <Text style={styles.detailTitle}>{bucket.fullLabel}</Text>
      <Text style={styles.detailValue}>
        {`${metricLabel(metric)} ${highlighted.value} ${highlighted.unit}`.trim()}
      </Text>
      <Text style={styles.detailMeta}>
        {[
          `${bucket.runCount} ${bucket.runCount === 1 ? 'Lauf' : 'Läufe'}`,
          `${formatKm(bucket.distanceKm)} km`,
          formatDuration(bucket.durationSeconds),
          bucket.paceSecondsPerKm === null
            ? null
            : `${formatPace(bucket.paceSecondsPerKm)} min / km`,
          bucket.effort === null ? null : `Gefühl ${decimal(bucket.effort)} / 10`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

/** Eingeklappter Abschnitt. Der Titel trägt schon einen Wert, damit auch der
 *  geschlossene Zustand etwas sagt; `⌄` verspricht Inhalt an dieser Stelle. */
function Panel({
  title,
  summary,
  children,
}: React.PropsWithChildren<{ title: string; summary: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.panel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${summary}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => [styles.panelHead, pressed && styles.pressed]}
      >
        <View style={styles.panelText}>
          <Text style={styles.panelTitle}>{title}</Text>
          <Text style={styles.panelSummary}>{summary}</Text>
        </View>
        <Text style={[styles.caret, open && styles.caretOpen]}>⌄</Text>
      </Pressable>
      {open ? <View style={styles.panelBody}>{children}</View> : null}
    </View>
  );
}

/** Beschriftung und Wert. `Row` ist der Baustein; der Wert hängt als
 *  `trailing` daran, damit keine zweite Zeilenvariante entsteht. */
function ValueRow({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string | null;
}) {
  return (
    <Row
      title={label}
      subtitle={meta ?? undefined}
      trailing={<Text style={styles.rowValue}>{value}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  page: { gap: space.md },
  title: { color: color.text, ...type_.title, letterSpacing: -0.6 },
  tiles: { flexDirection: 'row', gap: space.sm, paddingTop: space.xs },
  tile: { flex: 1, gap: space.xxs },
  tileDelta: {
    color: color.text,
    ...type_.micro,
    fontVariant: ['tabular-nums'],
  },
  compare: { ...type_.label, fontWeight: '400' },

  chartBlock: { gap: space.xs },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between' },
  chartScale: {
    color: color.muted,
    ...type_.micro,
    fontVariant: ['tabular-nums'],
  },
  chart: { flexDirection: 'row', gap: space.xxs, alignItems: 'flex-end' },
  meanLayer: { position: 'absolute', left: 0, right: 0, top: 0, height: 132 },
  mean: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: color.muted,
    opacity: 0.5,
  },
  column: { flex: 1, alignItems: 'center', gap: space.xxs, minHeight: 48 },
  plot: { width: '100%', height: 132, justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: color.line, borderRadius: radius.sm },
  dot: {
    position: 'absolute',
    left: '50%',
    width: 10,
    height: 10,
    marginLeft: -5,
    marginBottom: -5,
    borderRadius: radius.pill,
    backgroundColor: color.line,
  },
  markSelected: { backgroundColor: color.green },
  tick: {
    height: 16,
    color: color.muted,
    ...type_.micro,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  tickSelected: { color: color.text },

  hint: { ...type_.label, fontWeight: '400' },
  detail: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xxs,
  },
  detailTitle: { color: color.muted, ...type_.label, fontWeight: '400' },
  detailValue: {
    color: color.text,
    ...type_.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  detailMeta: {
    color: color.muted,
    ...type_.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },

  panel: {
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  panelHead: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  panelText: { flex: 1, gap: space.xxs },
  panelTitle: { color: color.text, ...type_.body, fontWeight: '500' },
  panelSummary: {
    color: color.muted,
    ...type_.label,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  caret: { color: color.muted, fontSize: 22, lineHeight: 26 },
  caretOpen: { transform: [{ rotate: '180deg' }] },
  panelBody: { paddingBottom: space.md, gap: space.xs },
  pressed: { opacity: 0.72 },

  shareRow: { gap: space.xxs, paddingVertical: space.xs },
  shareLabel: { color: color.text, ...type_.body },
  shareHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  shareTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  shareFill: { height: '100%', backgroundColor: color.green },
  shareMeta: { color: color.muted, ...type_.micro },

  rowValue: {
    color: color.text,
    ...type_.body,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
