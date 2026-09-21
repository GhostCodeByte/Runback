import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import type { PacingAnalysis, RunSummary } from '../domain/types';
import {
  compassLabel,
  formatElapsed,
  formatKm,
  formatPace,
  type RunSeries,
} from '../domain/runSeries';
import {
  endRecovery,
  environmentCost,
  fatiguePattern,
  formatSignedPercent,
  formatSignedSeconds,
  gradeAdjustedPace,
  heartRateDrift,
  heartRatePaceCurve,
  heartRateZones,
  maxHeartRate,
  metersPerBeat,
  movementInsight,
  pacingVerdict,
  recentComparison,
  sameRouteComparison,
  timeBudgetShares,
  walkRecovery,
  weatherInsight,
  type ComparedMetric,
  type MetricComparison,
  type RecentComparison,
} from '../domain/insights';
import {
  Copy,
  Disclosure,
  Input,
  Row,
  Section,
  StackedBar,
  color,
  space,
  toneColor,
  type,
  type StatTone,
} from './components';

/**
 * Tiefere Einblicke auf der Detailseite eines Laufs. Jede Sektion zeigt nur,
 * was die Daten tragen: Ohne Zeitbudget keine Bewegung, ohne Puls keine
 * Zonen, unter drei Vergleichsläufen kein Vergleich. Nichts hier ist eine
 * Empfehlung — das bleibt beim „Nächsten Schritt“.
 */
export interface RunInsightsProps {
  run: RunSummary;
  series: RunSeries | null;
  history: RunSummary[];
  pacing?: PacingAnalysis;
  /** Eingestellter Maxpuls; fehlt er, schätzt Runback aus den letzten Läufen. */
  maxHeartRateSetting?: number;
  onMaxHeartRate?: (value: number | undefined) => void;
}

const number = (value: number, digits = 0) =>
  value.toFixed(digits).replace('.', ',');
const bpm = (value: number | undefined) =>
  value === undefined ? '–' : `${Math.round(value)} bpm`;

export const METRIC_WORDS: Record<ComparedMetric, string> = {
  pace: 'Tempo',
  heartRate: 'Ø Puls',
  metersPerBeat: 'Meter je Herzschlag',
  cadence: 'Kadenz',
  drift: 'Puls-Drift',
  fade: 'Tempoabfall',
};
function metricText(metric: ComparedMetric, value: number): string {
  switch (metric) {
    case 'pace':
      return `${formatPace(value)} /km`;
    case 'heartRate':
      return bpm(value);
    case 'metersPerBeat':
      return `${number(value, 2)} m`;
    case 'cadence':
      return `${Math.round(value)} spm`;
    case 'drift':
    case 'fade':
      return `${number(value, 1)} %`;
  }
}
/** Unterschied zur Basis in der Einheit der Kennzahl, mit Vorzeichen. */
export function deltaText(item: MetricComparison): string {
  const diff = item.value - item.reference;
  switch (item.metric) {
    case 'pace':
      return `${formatSignedSeconds(diff)}/km`;
    case 'heartRate': {
      const rounded = Math.round(diff);
      return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(
        rounded,
      )} bpm`;
    }
    case 'cadence': {
      const rounded = Math.round(diff);
      return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(
        rounded,
      )} spm`;
    }
    case 'metersPerBeat':
      return formatSignedPercent(item.deltaPercent);
    case 'drift':
    case 'fade':
      return `${formatSignedPercent(diff, 1).replace(' %', '')} Punkte`;
  }
}
export function toneFor(
  comparison: RecentComparison | undefined,
  metric: ComparedMetric,
): { tone: StatTone; delta: string } | undefined {
  const item = comparison?.metrics.find(entry => entry.metric === metric);
  return item ? { tone: item.rating, delta: deltaText(item) } : undefined;
}

export function RunInsights({
  run,
  series,
  history,
  pacing,
  maxHeartRateSetting,
  onMaxHeartRate,
}: RunInsightsProps) {
  const budget = timeBudgetShares(run);
  const movement = movementInsight(run);
  const verdict = pacingVerdict(pacing, run);
  const drift = heartRateDrift(run);
  const gap = gradeAdjustedPace(run);
  const efficiency = metersPerBeat(run);
  const walk = useMemo(() => walkRecovery(run, series), [run, series]);
  const end = useMemo(() => endRecovery(run, series), [run, series]);
  const max = useMemo(
    () => maxHeartRate(maxHeartRateSetting, history),
    [maxHeartRateSetting, history],
  );
  const zones = useMemo(() => heartRateZones(series, max), [series, max]);
  const fatigue = useMemo(() => fatiguePattern(run, series), [run, series]);
  const weather = useMemo(() => weatherInsight(run, series), [run, series]);
  const cost = useMemo(() => environmentCost(run, series), [run, series]);
  const comparison = useMemo(
    () => recentComparison(run, history, pacing),
    [run, history, pacing],
  );
  const route = useMemo(
    () => sameRouteComparison(run, history),
    [run, history],
  );
  const curve = useMemo(() => heartRatePaceCurve(run, history), [run, history]);
  const hasHeartRate = run.avgHeartRate !== undefined;
  const heartRateSpan =
    run.avgHeartRateMin !== undefined && run.avgHeartRateMax !== undefined
      ? `${Math.round(run.avgHeartRateMin)}–${Math.round(
          run.avgHeartRateMax,
        )} bpm`
      : undefined;
  const cadenceSpan =
    run.avgCadenceMin !== undefined && run.avgCadenceMax !== undefined
      ? `${Math.round(run.avgCadenceMin)}–${Math.round(run.avgCadenceMax)} spm`
      : undefined;
  const segments = run.segments ?? [];
  const kmLabel = (index: number | undefined) => {
    if (index === undefined) return undefined;
    let meters = 0;
    for (let i = 0; i <= index; i += 1)
      meters += segments[i]?.distanceMeters ?? 0;
    return `km ${Math.round(meters / 1000)}`;
  };

  return (
    <>
      {budget || movement ? (
        <Section title="Bewegung">
          {budget ? (
            <StackedBar
              label="Zeitbudget"
              parts={[
                {
                  value: budget.runningSeconds,
                  color: color.green,
                  label: 'gelaufen',
                  text: formatElapsed(budget.runningSeconds),
                },
                {
                  value: budget.walkingSeconds,
                  color: color.series.cadence,
                  label: 'gegangen',
                  text: formatElapsed(budget.walkingSeconds),
                },
                {
                  value: budget.stoppedSeconds,
                  color: color.muted,
                  label: 'gestanden',
                  text: formatElapsed(budget.stoppedSeconds),
                },
              ]}
            />
          ) : null}
          {budget && budget.pausedSeconds >= 30 ? (
            <Copy muted>
              Dazu {formatElapsed(budget.pausedSeconds)} pausiert.
            </Copy>
          ) : null}
          {movement?.longestRunMeters !== undefined &&
          movement.longestRunSeconds !== undefined ? (
            <Row
              title="Längster Abschnitt am Stück"
              subtitle={`${formatKm(
                movement.longestRunMeters,
              )} km · ${formatElapsed(
                movement.longestRunSeconds,
              )} ohne Gehpause`}
            />
          ) : null}
          {movement ? (
            <Row
              title="Wechsel zwischen Laufen und Gehen"
              subtitle={
                movement.runWalkTransitions === 0
                  ? 'Keiner — durchgelaufen'
                  : `${movement.runWalkTransitions}×`
              }
            />
          ) : null}
          {movement?.runningHeartRate !== undefined &&
          movement.walkingHeartRate !== undefined ? (
            <Row
              title="Puls laufend · gehend"
              subtitle={`${bpm(movement.runningHeartRate)} · ${bpm(
                movement.walkingHeartRate,
              )}`}
            />
          ) : null}
        </Section>
      ) : null}

      {verdict || drift || gap ? (
        <Section title="Pacing">
          {verdict ? <Copy>{verdict.sentence}</Copy> : null}
          {verdict ? (
            <Row
              title="Gleichmäßigkeit"
              subtitle={`${verdict.evenness} · Schwankung ${number(
                verdict.coefficientOfVariation * 100,
                1,
              )} %`}
            />
          ) : null}
          {verdict?.fastestSecondsPerKm !== undefined &&
          verdict.slowestSecondsPerKm !== undefined &&
          verdict.fastestSegmentIndex !== verdict.slowestSegmentIndex ? (
            <Row
              title="Schnellster · langsamster Kilometer"
              subtitle={`${formatPace(verdict.fastestSecondsPerKm)} (${kmLabel(
                verdict.fastestSegmentIndex,
              )}) · ${formatPace(verdict.slowestSecondsPerKm)} (${kmLabel(
                verdict.slowestSegmentIndex,
              )})`}
            />
          ) : null}
          {drift ? (
            <Row
              title="Puls-Drift"
              subtitle={`${formatSignedPercent(drift.percent, 1)} · ${
                drift.verdict
              }`}
            />
          ) : null}
          {gap &&
          Math.abs(gap.adjustedSecondsPerKm - gap.realSecondsPerKm) >= 2 ? (
            <Row
              title="Flach-Äquivalent"
              subtitle={`${formatPace(
                gap.realSecondsPerKm,
              )} real · ${formatPace(
                gap.adjustedSecondsPerKm,
              )} /km in der Ebene — geschätzt`}
            />
          ) : null}
        </Section>
      ) : null}

      {hasHeartRate || cadenceSpan ? (
        <Section title="Puls & Schritt">
          {heartRateSpan ? <Row title="Puls" subtitle={heartRateSpan} /> : null}
          {cadenceSpan ? <Row title="Kadenz" subtitle={cadenceSpan} /> : null}
          {efficiency !== undefined ? (
            <Row
              title="Meter je Herzschlag"
              subtitle={`${number(efficiency, 2)} m`}
            />
          ) : null}
          {walk ? (
            <Row
              title="Erholung in Gehpausen"
              subtitle={`Puls fällt in der ersten Minute um ${Math.round(
                walk.dropFirstMinute,
              )} bpm (${walk.pauses} ${
                walk.pauses === 1 ? 'Pause' : 'Pausen'
              })${
                walk.lowestHeartRate !== undefined
                  ? ` · tiefster Wert ${Math.round(walk.lowestHeartRate)} bpm`
                  : ''
              }`}
            />
          ) : null}
          {end ? (
            <Row
              title="Erholung nach dem Ende"
              subtitle={`Von ${Math.round(
                end.heartRateAtEnd,
              )} bpm um ${Math.round(
                end.dropFirstMinute,
              )} bpm in der ersten Minute`}
            />
          ) : null}
          {zones ? (
            <StackedBar
              label="Zeit in Pulszonen"
              parts={zones.zones.map((zone, i) => ({
                value: zone.seconds,
                color: [
                  color.series.tailwind,
                  color.green,
                  color.caution,
                  color.series.headwind,
                  color.series.heart,
                ][i],
                label: `Z${zone.zone} ${zone.label}`,
                text: `${Math.round(zone.share * 100)} %`,
              }))}
            />
          ) : null}
          {hasHeartRate && onMaxHeartRate ? (
            <MaxHeartRateField
              current={max}
              setting={maxHeartRateSetting}
              onChange={onMaxHeartRate}
            />
          ) : null}
        </Section>
      ) : null}

      {fatigue && fatigue.verdict !== 'unklar' ? (
        <Section title="Ermüdung">
          <Copy>{fatigue.sentence}</Copy>
          <Row
            title="Letztes gegen erstes Drittel"
            subtitle={[
              fatigue.paceChangePercent !== undefined
                ? `Tempo ${formatSignedPercent(fatigue.paceChangePercent)}`
                : null,
              fatigue.heartRateChangePercent !== undefined
                ? `Puls ${formatSignedPercent(fatigue.heartRateChangePercent)}`
                : null,
              fatigue.cadenceChangePercent !== undefined
                ? `Kadenz ${formatSignedPercent(fatigue.cadenceChangePercent)}`
                : null,
              fatigue.strideChangePercent !== undefined
                ? `Schritt ${formatSignedPercent(fatigue.strideChangePercent)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </Section>
      ) : null}

      {weather ? (
        <Section title="Bedingungen">
          <Copy>
            {[
              weather.temperatureC !== undefined
                ? `${number(weather.temperatureC)} °C`
                : null,
              weather.windMps !== undefined
                ? `Wind ${number(weather.windMps)} m/s${
                    weather.windFromDeg !== undefined
                      ? ` aus ${compassLabel(weather.windFromDeg)}`
                      : ''
                  }`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Copy>
          {weather.headwindKilometers.length ? (
            <Row
              title="Gegenwind"
              subtitle={`km ${weather.headwindKilometers.join(', ')}`}
            />
          ) : null}
          {weather.tailwindKilometers.length ? (
            <Row
              title="Rückenwind"
              subtitle={`km ${weather.tailwindKilometers.join(', ')}`}
            />
          ) : null}
          {cost?.windSecondsPerKm !== undefined ? (
            <Row
              title="Wind am Tempo"
              subtitle={`${formatSignedSeconds(
                cost.windSecondsPerKm,
              )}/km — geschätzt${
                cost.windCoverage !== undefined && cost.windCoverage < 0.9
                  ? `, ${Math.round(cost.windCoverage * 100)} % der Strecke`
                  : ''
              }`}
            />
          ) : null}
          {cost?.heatSecondsPerKm !== undefined ? (
            <Row
              title="Wärme am Tempo"
              subtitle={`${formatSignedSeconds(
                cost.heatSecondsPerKm,
              )}/km — grobe Schätzung ab 15 °C`}
            />
          ) : null}
        </Section>
      ) : null}

      {comparison || route || curve?.line ? (
        <Section title="Im Vergleich zu dir">
          {comparison ? (
            <Copy muted>
              Gegenüber dem Median deiner letzten {comparison.count}
              {comparison.samePurpose ? ' gleichartigen' : ''} Läufe.
            </Copy>
          ) : null}
          {comparison?.metrics.map(item => (
            <CompareRow key={item.metric} item={item} />
          ))}
          {route ? (
            <Row
              title={`${route.ordinal}. Mal auf dieser Strecke`}
              subtitle={`${formatElapsed(route.currentSeconds)} · ${
                route.deltaToLastSeconds === 0
                  ? 'wie zuletzt'
                  : `${formatSignedSeconds(
                      route.deltaToLastSeconds,
                    )} gegenüber zuletzt`
              }${
                route.currentSeconds <= route.bestSeconds ? ' · Bestzeit' : ''
              }`}
            />
          ) : null}
          {curve?.line ? (
            <>
              <Copy>
                {curve.verdict === 'effizienter'
                  ? `Bei gleichem Tempo ${Math.round(
                      Math.abs(curve.residualBpm ?? 0),
                    )} bpm unter deinem Normalniveau.`
                  : curve.verdict === 'höher'
                  ? `Bei gleichem Tempo ${Math.round(
                      curve.residualBpm ?? 0,
                    )} bpm über deinem Normalniveau.`
                  : 'Puls zum Tempo wie bei deinen letzten Läufen.'}
              </Copy>
              <HeartRatePaceChart points={curve.points} line={curve.line} />
            </>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

const TONE_MARK: Record<StatTone, string> = {
  better: '▲',
  same: '',
  slightly_worse: '▽',
  worse: '▼',
};
function CompareRow({ item }: { item: MetricComparison }) {
  const mark = TONE_MARK[item.rating];
  return (
    <Row
      title={METRIC_WORDS[item.metric]}
      subtitle={`Basis ${metricText(item.metric, item.reference)}`}
      trailing={
        <Text
          style={[styles.compareValue, { color: toneColor(item.rating) }]}
          accessibilityLabel={`${METRIC_WORDS[item.metric]} ${metricText(
            item.metric,
            item.value,
          )}, ${deltaText(item)}`}
        >
          {metricText(item.metric, item.value)}
          {mark ? ` ${mark}` : ''}
          {'\n'}
          <Text style={styles.compareDelta}>{deltaText(item)}</Text>
        </Text>
      }
    />
  );
}

function MaxHeartRateField({
  current,
  setting,
  onChange,
}: {
  current: ReturnType<typeof maxHeartRate>;
  setting: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(setting ? String(setting) : '');
  const commit = () => {
    const parsed = Number.parseInt(text, 10);
    onChange(
      Number.isFinite(parsed) && parsed >= 100 && parsed <= 230
        ? parsed
        : undefined,
    );
  };
  return (
    <Disclosure
      title="Maxpuls"
      subtitle={
        current
          ? `${current.value} bpm · ${
              current.source === 'setting'
                ? 'eingestellt'
                : `geschätzt aus ${current.runs} Läufen`
            }`
          : 'Noch nicht bekannt — eintragen oder drei Läufe mit Puls'
      }
    >
      <Copy muted>
        Die Zonen rechnen mit dem Maxpuls. Trag ihn ein, wenn du ihn kennst.
      </Copy>
      <Input
        label="Maxpuls in bpm"
        keyboardType="number-pad"
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder="z. B. 190"
      />
    </Disclosure>
  );
}

const CHART_HEIGHT = 150;
const CHART_MARGIN = { top: 8, bottom: 22, left: 36, right: 8 };
/**
 * Puls über Tempo: Punkte dieses Laufs, Gerade aus den letzten Läufen. Die
 * x-Achse zeigt Tempo (links langsam, rechts schnell), damit die Kurve wie
 * gewohnt nach rechts oben steigt.
 */
function HeartRatePaceChart({
  points,
  line,
}: {
  points: { speedMps: number; heartRate: number }[];
  line: { slope: number; intercept: number; runs: number };
}) {
  const [width, setWidth] = useState(320);
  const speeds = points.map(p => p.speedMps);
  const minSpeed = Math.min(...speeds) - 0.2;
  const maxSpeed = Math.max(...speeds) + 0.2;
  const hrs = [
    ...points.map(p => p.heartRate),
    line.intercept + line.slope * minSpeed,
    line.intercept + line.slope * maxSpeed,
  ];
  const minHr = Math.floor((Math.min(...hrs) - 5) / 5) * 5;
  const maxHr = Math.ceil((Math.max(...hrs) + 5) / 5) * 5;
  const plotWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const x = (speed: number) =>
    CHART_MARGIN.left +
    ((speed - minSpeed) / (maxSpeed - minSpeed)) * plotWidth;
  const y = (hr: number) =>
    CHART_MARGIN.top + (1 - (hr - minHr) / (maxHr - minHr)) * plotHeight;
  const ticks = [minSpeed + 0.2, (minSpeed + maxSpeed) / 2, maxSpeed - 0.2];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Puls über Tempo: ${points.length} Kilometer dieses Laufs gegen die Gerade aus ${line.runs} Läufen.`}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      <Svg width={width} height={CHART_HEIGHT}>
        {[minHr, (minHr + maxHr) / 2, maxHr].map(hr => (
          <React.Fragment key={hr}>
            <Line
              x1={CHART_MARGIN.left}
              x2={width - CHART_MARGIN.right}
              y1={y(hr)}
              y2={y(hr)}
              stroke={color.line}
              strokeWidth={1}
            />
            <SvgText
              x={CHART_MARGIN.left - 6}
              y={y(hr) + 4}
              fill={color.muted}
              fontSize={11}
              textAnchor="end"
            >
              {Math.round(hr)}
            </SvgText>
          </React.Fragment>
        ))}
        {ticks.map(speed => (
          <SvgText
            key={speed}
            x={x(speed)}
            y={CHART_HEIGHT - 6}
            fill={color.muted}
            fontSize={11}
            textAnchor="middle"
          >
            {formatPace(1000 / speed)}
          </SvgText>
        ))}
        <Line
          x1={x(minSpeed)}
          y1={y(line.intercept + line.slope * minSpeed)}
          x2={x(maxSpeed)}
          y2={y(line.intercept + line.slope * maxSpeed)}
          stroke={color.muted}
          strokeWidth={2}
          strokeDasharray="6 4"
        />
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={x(p.speedMps)}
            cy={y(p.heartRate)}
            r={4.5}
            fill={color.series.heart}
          />
        ))}
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View
            style={[styles.legendDot, { backgroundColor: color.series.heart }]}
          />
          <Text style={styles.legendText}>Kilometer dieses Laufs</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: color.muted }]} />
          <Text style={styles.legendText}>Deine letzten {line.runs} Läufe</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compareValue: {
    ...type.label,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  compareDelta: { color: color.muted, ...type.micro, fontWeight: '400' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.xs,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendText: { color: color.muted, ...type.micro, fontWeight: '400' },
});
