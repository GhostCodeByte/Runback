import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { RunPurpose } from '../domain/types';
import { nativeCall, type RoutePoint, type Run } from '../native';
import {
  Button,
  Copy,
  Row,
  Section,
  Stat,
  color,
  purposeLabel,
} from './components';

/* ------------------------------------------------------------------ */
/* Reine Rechenhelfer: nur gespeicherte Messwerte, keine Modellschätzung. */
/* ------------------------------------------------------------------ */

export interface Totals {
  count: number;
  km: number;
  seconds: number;
  avgSecPerKm: number | undefined;
}

export function totals(runs: Run[]): Totals {
  const km =
    runs.reduce(
      (sum, r) =>
        sum +
        (Number.isFinite(r.distanceMeters) && r.distanceMeters > 0
          ? r.distanceMeters
          : 0),
      0,
    ) / 1000;
  const seconds = runs.reduce(
    (sum, r) =>
      sum +
      (Number.isFinite(r.durationSeconds) && r.durationSeconds > 0
        ? r.durationSeconds
        : 0),
    0,
  );
  return {
    count: runs.length,
    km,
    seconds,
    avgSecPerKm: km > 0 && seconds > 0 ? seconds / km : undefined,
  };
}

export interface WeekBucket {
  monday: number;
  label: string;
  km: number;
  count: number;
}

const mondayOf = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

const shortDate = (time: number): string => {
  const d = new Date(time);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

/** Letzte `weeks` Kalenderwochen (Mo–So), jüngste zuletzt. */
export function weekBuckets(
  runs: Run[],
  weeks: number,
  now: number,
): WeekBucket[] {
  const current = mondayOf(now);
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => {
    const monday = current - (weeks - 1 - i) * 7 * 86400000;
    return { monday, label: shortDate(monday), km: 0, count: 0 };
  });
  for (const run of runs) {
    if (!Number.isFinite(run.startTime)) {
      continue;
    }
    const monday = mondayOf(run.startTime);
    const bucket = buckets.find(b => b.monday === monday);
    if (bucket && Number.isFinite(run.distanceMeters) && run.distanceMeters > 0) {
      bucket.km += run.distanceMeters / 1000;
      bucket.count += 1;
    }
  }
  return buckets;
}

export interface TrendPoint {
  id: string;
  time: number;
  label: string;
  secPerKm: number;
}

/** Ø-Tempo pro Lauf, älteste zuerst, höchstens die letzten `limit`. */
export function paceTrend(runs: Run[], limit: number): TrendPoint[] {
  return runs
    .filter(
      r =>
        Number.isFinite(r.durationSeconds) &&
        r.durationSeconds > 0 &&
        Number.isFinite(r.distanceMeters) &&
        r.distanceMeters >= 500,
    )
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))
    .slice(-limit)
    .map(r => ({
      id: r.id,
      time: r.startTime,
      label: shortDate(r.startTime),
      secPerKm: r.durationSeconds / (r.distanceMeters / 1000),
    }));
}

export interface PurposeStat {
  purpose: RunPurpose;
  count: number;
  km: number;
}

export function purposeStats(runs: Run[]): PurposeStat[] {
  const map = new Map<RunPurpose, PurposeStat>();
  for (const run of runs) {
    const entry = map.get(run.purpose) || { purpose: run.purpose, count: 0, km: 0 };
    entry.count += 1;
    if (Number.isFinite(run.distanceMeters) && run.distanceMeters > 0) {
      entry.km += run.distanceMeters / 1000;
    }
    map.set(run.purpose, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export interface RpeStat {
  legs: number | undefined;
  breathing: number | undefined;
  count: number;
}

export function rpeStat(runs: Run[]): RpeStat {
  let legs = 0;
  let breathing = 0;
  let legsN = 0;
  let breathingN = 0;
  for (const run of runs) {
    const legsValue = run.rpe?.legs;
    if (Number.isFinite(legsValue)) {
      legs += legsValue as number;
      legsN += 1;
    }
    const breathingValue = run.rpe?.breathing;
    if (Number.isFinite(breathingValue)) {
      breathing += breathingValue as number;
      breathingN += 1;
    }
  }
  return {
    legs: legsN > 0 ? legs / legsN : undefined,
    breathing: breathingN > 0 ? breathing / breathingN : undefined,
    count: Math.max(legsN, breathingN),
  };
}

export interface Highlight {
  id: string;
  time: number;
  detail: string;
}

/** Neutrale Bestwerte aus Messdaten: längster und schnellster Lauf (ab 1 km). */
export function highlights(runs: Run[]): { longest?: Highlight; fastest?: Highlight } {
  let longest: Run | undefined;
  let fastest: Run | undefined;
  for (const run of runs) {
    if (!Number.isFinite(run.distanceMeters) || run.distanceMeters <= 0) {
      continue;
    }
    if (!longest || run.distanceMeters > longest.distanceMeters) {
      longest = run;
    }
    if (
      run.distanceMeters >= 1000 &&
      Number.isFinite(run.durationSeconds) &&
      run.durationSeconds > 0 &&
      (!fastest ||
        run.durationSeconds / run.distanceMeters <
          fastest.durationSeconds / fastest.distanceMeters)
    ) {
      fastest = run;
    }
  }
  const detail = (r: Run) =>
    `${(r.distanceMeters / 1000).toFixed(1).replace('.', ',')} km · ${shortDate(r.startTime)}`;
  return {
    longest: longest ? { id: longest.id, time: longest.startTime, detail: detail(longest) } : undefined,
    fastest: fastest ? { id: fastest.id, time: fastest.startTime, detail: detail(fastest) } : undefined,
  };
}

export interface ProjectedTracks {
  lines: [number, number][][];
  trackCount: number;
  pointCount: number;
}

/**
 * Projiziert mehrere GPS-Spuren in ein Rechteck (W×H). Reine Darstellung aus
 * bereits reduzierten Geometrien; keine Hintergrundkarte nötig (offlinefähig).
 */
export function projectTracks(
  tracks: RoutePoint[][],
  width: number,
  height: number,
  pad: number,
): ProjectedTracks {
  const valid = tracks
    .map(track =>
      track.filter(
        p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
      ),
    )
    .filter(track => track.length >= 2);
  const all = valid.flat();
  if (!all.length) {
    return { lines: [], trackCount: 0, pointCount: 0 };
  }
  const lats = all.map(p => p.latitude);
  const lons = all.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const correction = Math.max(0.01, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  const spanX = Math.max((maxLon - minLon) * correction, 0.000001);
  const spanY = Math.max(maxLat - minLat, 0.000001);
  const scale = Math.min(
    (width - 2 * pad) / spanX,
    (height - 2 * pad) / spanY,
  );
  const project = (p: RoutePoint): [number, number] => [
    pad + (width - 2 * pad - spanX * scale) / 2 + (p.longitude - minLon) * correction * scale,
    pad + (height - 2 * pad - spanY * scale) / 2 + (maxLat - p.latitude) * scale,
  ];
  return {
    lines: valid.map(track => track.map(project)),
    trackCount: valid.length,
    pointCount: all.length,
  };
}

/* ------------------------------------------------------------------ */
/* Seite.                                                               */
/* ------------------------------------------------------------------ */

const HEATMAP_WIDTH = 320;
const HEATMAP_HEIGHT = 220;
const MAX_TRACKS = 25;
const TRACK_POINTS = 96;

const formatPace = (secPerKm: number): string => {
  const rounded = Math.round(secPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
};

export function StatsPage({
  runs,
  busy,
  onOpenRun,
}: {
  runs: Run[];
  busy: boolean;
  onOpenRun: (id: string) => void;
}) {
  const [tracks, setTracks] = useState<RoutePoint[][] | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [trackInfo, setTrackInfo] = useState('');

  const sum = totals(runs);
  const weeks = weekBuckets(runs, 8, Date.now());
  const trend = paceTrend(runs, 20);
  const purposeRows = purposeStats(runs);
  const rpe = rpeStat(runs);
  const best = highlights(runs);
  const maxWeekKm = Math.max(1, ...weeks.map(w => w.km));
  const heat = tracks ? projectTracks(tracks, HEATMAP_WIDTH, HEATMAP_HEIGHT, 14) : null;

  const trendMin = trend.length ? Math.min(...trend.map(p => p.secPerKm)) : 0;
  const trendMax = trend.length ? Math.max(...trend.map(p => p.secPerKm)) : 0;
  const trendSpan = Math.max(trendMax - trendMin, 1);
  const trendX = (i: number) =>
    trend.length < 2 ? 160 : 24 + (i / (trend.length - 1)) * 272;
  const trendY = (v: number) => 150 - ((v - trendMin) / trendSpan) * 120;

  const loadTracks = () => {
    if (loadingTracks) {
      return;
    }
    setLoadingTracks(true);
    setTrackInfo('');
    void (async () => {
      try {
        const picked = runs.slice(0, MAX_TRACKS);
        const loaded: RoutePoint[][] = [];
        for (const run of picked) {
          try {
            const points = await nativeCall<RoutePoint[]>(
              'getRoute',
              run.id,
              TRACK_POINTS,
            );
            const list = Array.isArray(points) ? points : [];
            if (list.length >= 2) {
              loaded.push(list);
            }
          } catch {
            // Läufe ohne GPS-Spur werden still übersprungen.
          }
        }
        setTracks(loaded);
        setTrackInfo(
          loaded.length > 0
            ? `${loaded.length} von ${picked.length} Läufen mit GPS-Spur. Übereinander liegende Strecken leuchten heller.`
            : 'Keine GPS-Spuren in den neuesten Läufen gefunden.',
        );
      } finally {
        setLoadingTracks(false);
      }
    })();
  };

  return (
    <>
      <Text style={styles.title}>Statistik</Text>
      <Copy muted>
        {runs.length === 0
          ? 'Noch keine Läufe gespeichert.'
          : `Aus ${runs.length} gespeicherten Läufen. Reine Messwerte, keine Modellschätzung.`}
      </Copy>

      {runs.length === 0 ? (
        <Section title="Hier geht's los">
          <Copy muted>
            Starte deinen ersten Lauf oder importiere deine Historie — danach
            zeigen wir hier Heatmap, Trends und Bestwerte.
          </Copy>
        </Section>
      ) : (
        <>
          <View style={styles.metrics}>
            <Stat value={String(sum.count)} label="Läufe" />
            <Stat value={sum.km.toFixed(0).replace('.', ',')} label="Kilometer" />
            <Stat value={formatDuration(sum.seconds)} label="Zeit" />
          </View>
          {sum.avgSecPerKm !== undefined ? (
            <View style={styles.metrics}>
              <Stat large value={formatPace(sum.avgSecPerKm)} label="Ø-Pace min/km (gesamt)" />
            </View>
          ) : null}

          <Section title="Strecken-Heatmap">
            <Copy muted>
              Alle GPS-Spuren übereinander — wo du oft läufst, leuchtet es
              heller. Bleibt auf dem Gerät, keine Karte nötig.
            </Copy>
            {heat && heat.lines.length > 0 ? (
              <View style={styles.map}>
                <Svg width="100%" height={HEATMAP_HEIGHT} viewBox={`0 0 ${HEATMAP_WIDTH} ${HEATMAP_HEIGHT}`}>
                  {heat.lines.map((line, i) => (
                    <Polyline
                      key={i}
                      points={line.map(p => p.join(',')).join(' ')}
                      stroke={color.green}
                      strokeOpacity={0.22}
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      fill="none"
                    />
                  ))}
                </Svg>
              </View>
            ) : null}
            {trackInfo ? <Copy muted>{trackInfo}</Copy> : null}
            <Button
              secondary
              title={
                loadingTracks
                  ? 'Spuren werden geladen …'
                  : heat
                    ? 'Heatmap neu laden'
                    : 'Heatmap laden'
              }
              onPress={loadTracks}
              disabled={busy || loadingTracks}
            />
          </Section>

          {trend.length >= 2 ? (
            <Section title="Tempo-Trend (Ø-Pace pro Lauf)">
              <View style={styles.map}>
                <Svg width="100%" height={180} viewBox="0 0 320 180">
                  <Line x1={16} y1={160} x2={304} y2={160} stroke={color.line} strokeWidth={1} />
                  <Polyline
                    points={trend.map((p, i) => `${trendX(i)},${trendY(p.secPerKm)}`).join(' ')}
                    stroke={color.green}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    fill="none"
                  />
                  {trend.map((p, i) => (
                    <Circle key={p.id} cx={trendX(i)} cy={trendY(p.secPerKm)} r={3.5} fill={color.text} />
                  ))}
                  <SvgText x={20} y={20} fontSize={11} fill={color.muted}>
                    {formatPace(trendMin)} (schnellster)
                  </SvgText>
                  <SvgText x={20} y={156} fontSize={11} fill={color.muted}>
                    {formatPace(trendMax)}
                  </SvgText>
                  <SvgText x={250} y={176} fontSize={11} fill={color.muted}>
                    {trend[trend.length - 1].label}
                  </SvgText>
                </Svg>
              </View>
              <Copy muted>
                {trend.length} Läufe, älteste links. Tempo allein sagt nichts
                über Zweck oder Anstrengung.
              </Copy>
            </Section>
          ) : null}

          <Section title="Kilometer pro Woche">
            <View style={styles.map}>
              <Svg width="100%" height={170} viewBox="0 0 320 170">
                {weeks.map((week, i) => {
                  const x = 14 + i * 38;
                  const barH = Math.max(week.km > 0 ? 4 : 0, (week.km / maxWeekKm) * 120);
                  return (
                    <React.Fragment key={week.monday}>
                      <Rect
                        x={x}
                        y={130 - barH}
                        width={26}
                        height={barH}
                        rx={3}
                        fill={week.km > 0 ? color.green : color.line}
                        opacity={week.km > 0 ? 1 : 0.35}
                      />
                      {week.km > 0 ? (
                        <SvgText x={x + 13} y={122 - barH} fontSize={10} fill={color.text} textAnchor="middle">
                          {week.km.toFixed(0)}
                        </SvgText>
                      ) : null}
                      <SvgText x={x + 13} y={146} fontSize={10} fill={color.muted} textAnchor="middle">
                        {week.label}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
              </Svg>
            </View>
            <Copy muted>Letzte 8 Kalenderwochen (Mo–So), Kilometer oben.</Copy>
          </Section>

          <Section title="Laufzwecke">
            {purposeRows.map(row => (
              <Row
                key={row.purpose}
                title={purposeLabel(row.purpose)}
                subtitle={`${row.count} ${row.count === 1 ? 'Lauf' : 'Läufe'} · ${row.km.toFixed(1).replace('.', ',')} km`}
              />
            ))}
          </Section>

          {rpe.count > 0 ? (
            <Section title="Laufgefühl im Schnitt">
              <View style={styles.metrics}>
                <Stat
                  value={rpe.legs !== undefined ? rpe.legs.toFixed(1).replace('.', ',') : '–'}
                  label="Beine (1–10)"
                />
                <Stat
                  value={rpe.breathing !== undefined ? rpe.breathing.toFixed(1).replace('.', ',') : '–'}
                  label="Atmung (1–10)"
                />
              </View>
              <Copy muted>
                Aus {rpe.count} {rpe.count === 1 ? 'Bewertung' : 'Bewertungen'}. Subjektiv —
                kein Vergleichsmaßstab für andere.
              </Copy>
            </Section>
          ) : null}

          <Section title="Bestwerte">
            {best.longest ? (
              <Row
                title="Längster Lauf"
                subtitle={best.longest.detail}
                onPress={() => {
                  if (best.longest) {
                    onOpenRun(best.longest.id);
                  }
                }}
              />
            ) : null}
            {best.fastest ? (
              <Row
                title="Schnellster Lauf (ab 1 km)"
                subtitle={best.fastest.detail}
                onPress={() => {
                  if (best.fastest) {
                    onOpenRun(best.fastest.id);
                  }
                }}
              />
            ) : null}
            <Copy muted>
              Reine Messwerte aus deinen Läufen — kein Urteil über Form oder
              Gesundheit.
            </Copy>
          </Section>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  title: { color: color.text, fontSize: 30, fontWeight: '600' },
  metrics: { flexDirection: 'row', gap: 12, marginTop: 16 },
  map: { backgroundColor: color.surface, marginVertical: 8 },
});
