import type { Run } from '../native';
import type { RunPurpose } from './types';
import { average, mondayStart, validRun } from './statistics';

/**
 * Vertiefte Auswertung für die Statistikseite.
 *
 * `aggregateStatistics` beantwortet eine feste Frage („Wie sahen die letzten
 * acht Wochen aus?“). `buildStatisticsView` beantwortet dieselbe Frage für
 * einen wählbaren Zeitraum und liefert zusätzlich Vergleich, Verteilung,
 * Bestwerte und Konsistenz — jeweils nur, wenn die Daten sie hergeben.
 *
 * Reine Funktionen. Die einzige Zeitquelle ist der Parameter `now`.
 */

export type StatsRange = '4w' | '12w' | '1y' | 'all';
export type StatsMetric = 'distance' | 'duration' | 'count' | 'pace' | 'effort';
export type BucketUnit = 'week' | 'month' | 'year';

export interface StatsBucket {
  startTime: number;
  /** Exklusiv. */
  endTime: number;
  /** Kurze Achsenbeschriftung. */
  label: string;
  /** Ausgeschriebener Zeitraum für Vorlesetext und Detailzeile. */
  fullLabel: string;
  runCount: number;
  distanceKm: number;
  durationSeconds: number;
  paceSecondsPerKm: number | null;
  effort: number | null;
  averageHeartRate: number | null;
}

export interface StatsDelta {
  current: number | null;
  previous: number | null;
  /** Relative Veränderung: 0,12 bedeutet plus zwölf Prozent. */
  changeRatio: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

export interface PurposeShare {
  purpose: RunPurpose;
  label: string;
  runCount: number;
  distanceKm: number;
  /** Anteil an der Gesamtstrecke des Zeitraums, 0 bis 1. */
  share: number;
}

export interface StatsRecord {
  id: string;
  label: string;
  value: string;
  detail: string | null;
  runId: string | null;
}

export interface StatsTotals {
  runCount: number;
  distanceKm: number;
  durationSeconds: number;
  paceSecondsPerKm: number | null;
  averageLegsRpe: number | null;
  averageBreathingRpe: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
  averageDistanceKm: number | null;
  activeDays: number;
  runsPerWeek: number | null;
}

export interface StatsConsistency {
  weekCount: number;
  activeWeeks: number;
  longestStreakWeeks: number;
  currentStreakWeeks: number;
  activeDays: number;
}

export interface RunStatisticsView {
  range: StatsRange;
  bucketUnit: BucketUnit;
  windowStart: number;
  /** Exklusiv. */
  windowEnd: number;
  buckets: StatsBucket[];
  totals: StatsTotals;
  deltas: Record<'distance' | 'duration' | 'count' | 'pace', StatsDelta>;
  /** Benennt den Vergleichszeitraum. `null`, wenn es keinen gibt. */
  comparisonLabel: string | null;
  purposes: PurposeShare[];
  records: StatsRecord[];
  consistency: StatsConsistency;
  /** Steuert, welche Kennzahlen überhaupt angeboten werden. */
  available: { pace: boolean; effort: boolean; heartRate: boolean };
  runs: Run[];
}

const RANGE_WEEKS: Record<Exclude<StatsRange, 'all'>, number> = {
  '4w': 4,
  '12w': 12,
  '1y': 52,
};

export const STATS_RANGES: { value: StatsRange; label: string }[] = [
  { value: '4w', label: '4 Wochen' },
  { value: '12w', label: '12 Wochen' },
  { value: '1y', label: '1 Jahr' },
  { value: 'all', label: 'Alles' },
];

const RANGE_COMPARISONS: Record<StatsRange, string> = {
  '4w': 'die 4 Wochen davor',
  '12w': 'die 12 Wochen davor',
  '1y': 'das Jahr davor',
  all: 'den Zeitraum davor',
};

const PURPOSE_LABELS: Record<RunPurpose, string> = {
  easy: 'Locker',
  long: 'Lang',
  intervals: 'Intervalle',
  race: 'Wettkampf',
  free: 'Frei',
  unknown: 'Ohne Zweck',
};

const dayFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
});
const dayLongFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const monthShortFormat = new Intl.DateTimeFormat('de-DE', { month: 'short' });
const monthLongFormat = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
});

function dedupe(runs: Run[], now: number): Run[] {
  const unique = new Map<string, Run>();
  runs.forEach((run, index) => {
    if (!validRun(run, now)) {
      return;
    }
    const identity =
      typeof run.canonicalId === 'string' && run.canonicalId.trim()
        ? run.canonicalId
        : run.id || `run-${index}`;
    if (!unique.has(identity)) {
      unique.set(identity, run);
    }
  });
  return Array.from(unique.values()).sort((a, b) => a.startTime - b.startTime);
}

function monthStart(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function yearStart(timestamp: number) {
  return new Date(new Date(timestamp).getFullYear(), 0, 1).getTime();
}

// Kalendarisches Weiterzählen, damit Sommerzeit die Grenzen nicht verschiebt.
function addWeeks(timestamp: number, weeks: number) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + weeks * 7);
  return date.getTime();
}

function startOf(timestamp: number, unit: BucketUnit) {
  return unit === 'week'
    ? mondayStart(timestamp)
    : unit === 'month'
    ? monthStart(timestamp)
    : yearStart(timestamp);
}

function advance(timestamp: number, unit: BucketUnit, steps: number) {
  if (unit === 'week') {
    return addWeeks(timestamp, steps);
  }
  const date = new Date(timestamp);
  return unit === 'month'
    ? new Date(date.getFullYear(), date.getMonth() + steps, 1).getTime()
    : new Date(date.getFullYear() + steps, 0, 1).getTime();
}

function bucketLabels(startTime: number, unit: BucketUnit) {
  const start = new Date(startTime);
  if (unit === 'week') {
    const end = new Date(addWeeks(startTime, 1) - 1);
    return {
      label: dayFormat.format(start),
      fullLabel: `Woche ${dayLongFormat.format(start)} bis ${dayLongFormat.format(end)}`,
    };
  }
  if (unit === 'month') {
    return {
      label: monthShortFormat.format(start).replace('.', ''),
      fullLabel: monthLongFormat.format(start),
    };
  }
  const year = String(start.getFullYear());
  return { label: year, fullLabel: `Jahr ${year}` };
}

/** Nach Strecke gewichtet wie in der Übersicht, ab 500 m — damit ein
 *  abgebrochener Lauf das Tempo nicht verzerrt. */
function weightedPace(runs: Run[]): number | null {
  const usable = runs.filter(
    run => run.distanceMeters >= 500 && run.durationSeconds > 0,
  );
  const distance = usable.reduce((sum, run) => sum + run.distanceMeters, 0);
  const duration = usable.reduce((sum, run) => sum + run.durationSeconds, 0);
  return distance > 0 ? (duration / distance) * 1000 : null;
}

function rated(runs: Run[], key: 'legs' | 'breathing'): number[] {
  return runs
    .map(run => run.rpe?.[key])
    .filter(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 10,
    );
}

/** Ein Wert für „wie hart hat es sich angefühlt“: Mittel aus Beinen und
 *  Atmung, sofern der Lauf überhaupt bewertet wurde. */
function runEffort(run: Run): number | null {
  return average(rated([run], 'legs').concat(rated([run], 'breathing')));
}

function positive(values: (number | undefined)[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
}

function buildBucket(
  startTime: number,
  unit: BucketUnit,
  runs: Run[],
): StatsBucket {
  const efforts = runs
    .map(runEffort)
    .filter((value): value is number => value !== null);
  return {
    startTime,
    endTime: advance(startTime, unit, 1),
    ...bucketLabels(startTime, unit),
    runCount: runs.length,
    distanceKm: runs.reduce((sum, run) => sum + run.distanceMeters / 1000, 0),
    durationSeconds: runs.reduce((sum, run) => sum + run.durationSeconds, 0),
    paceSecondsPerKm: weightedPace(runs),
    effort: average(efforts),
    averageHeartRate: average(positive(runs.map(run => run.avgHeartRate))),
  };
}

function makeDelta(current: number | null, previous: number | null): StatsDelta {
  if (current === null || previous === null || previous === 0) {
    return { current, previous, changeRatio: null, direction: 'unknown' };
  }
  const changeRatio = (current - previous) / previous;
  return {
    current,
    previous,
    changeRatio,
    // Unter einem Prozent ist keine Veränderung, sondern Rauschen.
    direction:
      Math.abs(changeRatio) < 0.01 ? 'flat' : changeRatio > 0 ? 'up' : 'down',
  };
}

function distinctDays(runs: Run[]): number {
  const days = new Set<string>();
  runs.forEach(run => {
    const date = new Date(run.startTime);
    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  });
  return days.size;
}

function buildConsistency(
  runs: Run[],
  windowStart: number,
  windowEnd: number,
): StatsConsistency {
  const weeks: number[] = [];
  for (let start = mondayStart(windowStart); start < windowEnd; start = addWeeks(start, 1)) {
    weeks.push(start);
  }
  const active = new Set(runs.map(run => mondayStart(run.startTime)));
  let longest = 0;
  let running = 0;
  weeks.forEach(start => {
    running = active.has(start) ? running + 1 : 0;
    longest = Math.max(longest, running);
  });
  // Die laufende Serie zählt rückwärts. Eine gerade erst begonnene Woche ohne
  // Lauf beendet sie noch nicht.
  let current = 0;
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    if (active.has(weeks[index])) {
      current += 1;
    } else if (index !== weeks.length - 1) {
      break;
    }
  }
  return {
    weekCount: weeks.length,
    activeWeeks: weeks.filter(start => active.has(start)).length,
    longestStreakWeeks: longest,
    currentStreakWeeks: current,
    activeDays: distinctDays(runs),
  };
}

function formatKm(value: number) {
  return `${value.toFixed(1).replace('.', ',')} km`;
}

function formatPaceValue(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')} /km`;
}

function formatDurationValue(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function buildRecords(runs: Run[], weekBuckets: StatsBucket[]): StatsRecord[] {
  const result: StatsRecord[] = [];
  const longest = runs.reduce<Run | null>(
    (best, run) => (!best || run.distanceMeters > best.distanceMeters ? run : best),
    null,
  );
  if (longest && longest.distanceMeters > 0) {
    result.push({
      id: 'longest-distance',
      label: 'Längster Lauf',
      value: formatKm(longest.distanceMeters / 1000),
      detail: dayLongFormat.format(new Date(longest.startTime)),
      runId: longest.id || null,
    });
  }
  const longestTime = runs.reduce<Run | null>(
    (best, run) => (!best || run.durationSeconds > best.durationSeconds ? run : best),
    null,
  );
  if (longestTime && longestTime.durationSeconds > 0) {
    result.push({
      id: 'longest-duration',
      label: 'Längste Dauer',
      value: formatDurationValue(longestTime.durationSeconds),
      detail: dayLongFormat.format(new Date(longestTime.startTime)),
      runId: longestTime.id || null,
    });
  }
  // Bestes Tempo nur über Läufe ab 5 km. Kürzere Strecken sind nicht
  // vergleichbar und würden den Rekord dauerhaft an einen Sprint vergeben.
  const paceOf = (run: Run) => run.durationSeconds / (run.distanceMeters / 1000);
  const fastest = runs
    .filter(run => run.distanceMeters >= 5000 && run.durationSeconds > 0)
    .reduce<Run | null>(
      (best, run) => (!best || paceOf(run) < paceOf(best) ? run : best),
      null,
    );
  if (fastest) {
    result.push({
      id: 'fastest-pace',
      label: 'Schnellster Lauf ab 5 km',
      value: formatPaceValue(paceOf(fastest)),
      detail: `${formatKm(fastest.distanceMeters / 1000)} · ${dayLongFormat.format(
        new Date(fastest.startTime),
      )}`,
      runId: fastest.id || null,
    });
  }
  const bestWeek = weekBuckets.reduce<StatsBucket | null>(
    (best, bucket) => (!best || bucket.distanceKm > best.distanceKm ? bucket : best),
    null,
  );
  if (bestWeek && bestWeek.distanceKm > 0) {
    result.push({
      id: 'best-week',
      label: 'Stärkste Woche',
      value: formatKm(bestWeek.distanceKm),
      detail: bestWeek.fullLabel,
      runId: null,
    });
  }
  return result;
}

function purposeShares(runs: Run[]): PurposeShare[] {
  const totalKm = runs.reduce((sum, run) => sum + run.distanceMeters / 1000, 0);
  const groups = new Map<RunPurpose, Run[]>();
  runs.forEach(run => {
    const purpose: RunPurpose =
      run.purpose && PURPOSE_LABELS[run.purpose] ? run.purpose : 'unknown';
    groups.set(purpose, (groups.get(purpose) || []).concat(run));
  });
  return Array.from(groups.entries())
    .map(([purpose, group]) => {
      const distanceKm = group.reduce(
        (sum, run) => sum + run.distanceMeters / 1000,
        0,
      );
      return {
        purpose,
        label: PURPOSE_LABELS[purpose],
        runCount: group.length,
        distanceKm,
        share: totalKm > 0 ? distanceKm / totalKm : 0,
      };
    })
    .sort((a, b) => b.distanceKm - a.distanceKm || b.runCount - a.runCount);
}

function unitFor(
  range: StatsRange,
  windowStart: number,
  windowEnd: number,
): BucketUnit {
  if (range === '4w' || range === '12w') {
    return 'week';
  }
  if (range === '1y') {
    return 'month';
  }
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  return months > 30 ? 'year' : 'month';
}

function bucketize(
  runs: Run[],
  unit: BucketUnit,
  windowStart: number,
  windowEnd: number,
): StatsBucket[] {
  const byStart = new Map<number, Run[]>();
  runs.forEach(run => {
    const start = startOf(run.startTime, unit);
    byStart.set(start, (byStart.get(start) || []).concat(run));
  });
  const buckets: StatsBucket[] = [];
  for (
    let start = startOf(windowStart, unit);
    start < windowEnd;
    start = advance(start, unit, 1)
  ) {
    buckets.push(buildBucket(start, unit, byStart.get(start) || []));
  }
  return buckets;
}

function totalsFor(runs: Run[], weeks: number): StatsTotals {
  const distanceKm = runs.reduce(
    (sum, run) => sum + run.distanceMeters / 1000,
    0,
  );
  return {
    runCount: runs.length,
    distanceKm,
    durationSeconds: runs.reduce((sum, run) => sum + run.durationSeconds, 0),
    paceSecondsPerKm: weightedPace(runs),
    averageLegsRpe: average(rated(runs, 'legs')),
    averageBreathingRpe: average(rated(runs, 'breathing')),
    averageHeartRate: average(positive(runs.map(run => run.avgHeartRate))),
    averageCadence: average(positive(runs.map(run => run.avgCadence))),
    averageDistanceKm: runs.length ? distanceKm / runs.length : null,
    activeDays: distinctDays(runs),
    runsPerWeek: weeks > 0 ? runs.length / weeks : null,
  };
}

/**
 * Vollständige Sicht für die Statistikseite: ein wählbarer Zeitraum, in dem
 * alles konsistent gerechnet ist.
 */
export function buildStatisticsView(
  runs: Run[],
  range: StatsRange = '12w',
  now = Date.now(),
): RunStatisticsView {
  const referenceNow = Number.isFinite(now) ? now : Date.now();
  const all = dedupe(runs, referenceNow);
  // Der Zeitraum endet mit dem Ende der laufenden Woche, damit die aktuelle
  // Woche sichtbar ist statt erst am Montag darauf zu erscheinen.
  const windowEnd = addWeeks(mondayStart(referenceNow), 1);
  const windowStart =
    range === 'all'
      ? mondayStart(all.length ? all[0].startTime : referenceNow)
      : addWeeks(mondayStart(referenceNow), -(RANGE_WEEKS[range] - 1));
  const inRange = all.filter(
    run => run.startTime >= windowStart && run.startTime < windowEnd,
  );
  const unit = unitFor(range, windowStart, windowEnd);
  const buckets = bucketize(inRange, unit, windowStart, windowEnd);
  const weekBuckets =
    unit === 'week' ? buckets : bucketize(inRange, 'week', windowStart, windowEnd);

  const previousStart =
    range === 'all' ? null : windowStart - (windowEnd - windowStart);
  const previous =
    previousStart === null
      ? []
      : all.filter(
          run => run.startTime >= previousStart && run.startTime < windowStart,
        );
  const compare = previous.length > 0;
  const totals = totalsFor(inRange, weekBuckets.length);
  const before = totalsFor(previous, weekBuckets.length);
  const against = (current: number | null, past: number | null) =>
    makeDelta(current, compare ? past : null);

  return {
    range,
    bucketUnit: unit,
    windowStart,
    windowEnd,
    buckets,
    totals,
    deltas: {
      distance: against(totals.distanceKm, before.distanceKm),
      duration: against(totals.durationSeconds, before.durationSeconds),
      count: against(totals.runCount, before.runCount),
      pace: against(totals.paceSecondsPerKm, before.paceSecondsPerKm),
    },
    comparisonLabel: compare ? RANGE_COMPARISONS[range] : null,
    purposes: purposeShares(inRange),
    records: buildRecords(inRange, weekBuckets),
    consistency: buildConsistency(inRange, windowStart, windowEnd),
    available: {
      pace: inRange.some(
        run => run.distanceMeters >= 500 && run.durationSeconds > 0,
      ),
      effort: inRange.some(run => runEffort(run) !== null),
      heartRate: positive(inRange.map(run => run.avgHeartRate)).length > 0,
    },
    runs: inRange,
  };
}

/** Der Wert einer Kennzahl in einem Balken — die einzige Stelle, an der die
 *  Zuordnung Kennzahl → Zahl getroffen wird. */
export function bucketValue(
  bucket: StatsBucket,
  metric: StatsMetric,
): number | null {
  switch (metric) {
    case 'distance':
      return bucket.distanceKm;
    case 'duration':
      return bucket.durationSeconds;
    case 'count':
      return bucket.runCount;
    case 'pace':
      return bucket.paceSecondsPerKm;
    case 'effort':
      return bucket.effort;
  }
}
