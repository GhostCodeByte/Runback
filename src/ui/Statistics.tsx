import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Run } from '../native';
import { aggregateStatistics } from '../domain/statistics';
import { color, Copy, Section } from './components';

const formatNumber = (value: number, digits = 1) =>
  value.toFixed(digits).replace('.', ',');

const formatDuration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
};

const formatPace = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '–';
  }
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function Statistics({ runs }: { runs: Run[] }) {
  const statistics = useMemo(() => aggregateStatistics(runs), [runs]);
  const maxWeekDistance = Math.max(
    ...statistics.weeks.map(week => week.distanceKm),
    1,
  );

  if (!statistics.runCount) {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>Statistik</Text>
        <Copy muted>
          Sobald abgeschlossene oder importierte Läufe vorhanden sind, findest
          du hier deine Entwicklung.
        </Copy>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Statistik</Text>
      {runs.length >= 1000 ? (
        <Copy muted>Übersicht der bis zu 1.000 zuletzt geladenen Läufe.</Copy>
      ) : null}
      <View style={styles.metrics}>
        <Metric
          value={formatNumber(statistics.totalDistanceKm, 1)}
          label="km gesamt"
        />
        <Metric value={String(statistics.runCount)} label="Läufe" />
        <Metric
          value={formatDuration(statistics.totalDurationSeconds)}
          label="Zeit"
        />
      </View>
      <Section title="Letzte 8 Wochen">
        <View
          style={styles.chart}
          accessibilityLabel="Kilometer der letzten 8 Wochen"
        >
          {statistics.weeks.map(week => (
            <View key={week.startTime} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    { height: `${(week.distanceKm / maxWeekDistance) * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.weekLabel}>{week.label}</Text>
              <Text style={styles.weekValue}>
                {formatNumber(week.distanceKm, 1)}
              </Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Dein Überblick">
        <MetricRow
          label="Ø Tempo"
          value={`${formatPace(statistics.paceSecondsPerKm)} min / km`}
        />
        <MetricRow
          label="Längster Lauf"
          value={`${formatNumber(
            (statistics.longestRun?.distanceMeters || 0) / 1000,
            1,
          )} km`}
        />
        <MetricRow
          label="Ø Beine"
          value={
            statistics.averageLegsRpe === null
              ? '–'
              : `${formatNumber(statistics.averageLegsRpe)} / 10`
          }
        />
        <MetricRow
          label="Ø Atmung"
          value={
            statistics.averageBreathingRpe === null
              ? '–'
              : `${formatNumber(statistics.averageBreathingRpe)} / 10`
          }
        />
      </Section>
      <Copy muted>
        Abgeschlossene und importierte Läufe. Das Durchschnittstempo ist nach
        Strecke gewichtet, ab 500 m. Beine und Atmung zeigen dein angegebenes
        Laufgefühl.
      </Copy>
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  empty: { paddingVertical: 22, gap: 12 },
  title: { color: color.text, fontSize: 30, fontWeight: '600' },
  metrics: { flexDirection: 'row', gap: 14, paddingVertical: 24 },
  metric: { flex: 1, gap: 4 },
  metricValue: {
    color: color.text,
    fontSize: 23,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: { color: color.muted, fontSize: 13 },
  chart: { flexDirection: 'row', gap: 7, height: 150, alignItems: 'flex-end' },
  barColumn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  barTrack: {
    width: '100%',
    height: 100,
    justifyContent: 'flex-end',
    backgroundColor: color.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: { width: '100%', backgroundColor: color.green, borderRadius: 4 },
  weekLabel: { color: color.muted, fontSize: 10 },
  weekValue: { color: color.text, fontSize: 10, fontVariant: ['tabular-nums'] },
  metricRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowLabel: { color: color.muted, fontSize: 15 },
  rowValue: { color: color.text, fontSize: 15, fontVariant: ['tabular-nums'] },
});
