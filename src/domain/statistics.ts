import type { Run } from '../native';
import { isRun } from './sport';

export interface StatisticsWeek {
  startTime: number;
  label: string;
  distanceKm: number;
  runCount: number;
}

export interface RunStatistics {
  runs: Run[];
  totalDistanceKm: number;
  totalDurationSeconds: number;
  runCount: number;
  paceSecondsPerKm: number | null;
  averageLegsRpe: number | null;
  averageBreathingRpe: number | null;
  longestRun: Run | null;
  weeks: StatisticsWeek[];
}

const EIGHT_WEEKS = 8;

/** Geteilt mit `statisticsView.ts`, damit beide Sichten dieselben Läufe zählen.
 *  Andere Sportarten zählen nicht: Kilometer und Tempo wären sonst gemischt. */
export function validRun(run: Run, now: number) {
  const start = run.startTime;
  return (
    isRun(run) &&
    (run.status === 'completed' || run.status === 'imported') &&
    Number.isFinite(start) &&
    start > 0 &&
    start <= now &&
    Number.isFinite(new Date(start).getTime()) &&
    Number.isFinite(run.distanceMeters) &&
    run.distanceMeters >= 0 &&
    Number.isFinite(run.durationSeconds) &&
    run.durationSeconds >= 0
  );
}

export function mondayStart(timestamp: number) {
  const date = new Date(timestamp);
  const day = date.getDay();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.getTime();
}

export function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

/** Build local, deliberately modest summaries from finished run records. */
export function aggregateStatistics(
  runs: Run[],
  now = Date.now(),
): RunStatistics {
  const referenceNow = Number.isFinite(now) ? now : Date.now();
  const unique = new Map<string, Run>();
  runs.forEach((run, index) => {
    if (!validRun(run, referenceNow)) {
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

  const valid = Array.from(unique.values());
  const totalDistanceMeters = valid.reduce(
    (sum, run) => sum + run.distanceMeters,
    0,
  );
  const totalDurationSeconds = valid.reduce(
    (sum, run) => sum + run.durationSeconds,
    0,
  );
  const paceRuns = valid.filter(
    run => run.distanceMeters >= 500 && run.durationSeconds > 0,
  );
  const paceDistance = paceRuns.reduce(
    (sum, run) => sum + run.distanceMeters,
    0,
  );
  const paceDuration = paceRuns.reduce(
    (sum, run) => sum + run.durationSeconds,
    0,
  );
  const currentWeek = mondayStart(referenceNow);
  const weeks: StatisticsWeek[] = Array.from(
    { length: EIGHT_WEEKS },
    (_, index) => {
      // Calendar stepping keeps Monday local time correct when DST changes.
      const date = new Date(currentWeek);
      date.setDate(date.getDate() - (EIGHT_WEEKS - 1 - index) * 7);
      const startTime = date.getTime();
      const label = new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
      }).format(new Date(startTime));
      const weekRuns = valid.filter(run => {
        const start = mondayStart(run.startTime);
        return start === startTime;
      });
      return {
        startTime,
        label,
        distanceKm: weekRuns.reduce(
          (sum, run) => sum + run.distanceMeters / 1000,
          0,
        ),
        runCount: weekRuns.length,
      };
    },
  );

  const legs = valid
    .map(run => run.rpe?.legs)
    .filter(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 10,
    );
  const breathing = valid
    .map(run => run.rpe?.breathing)
    .filter(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 10,
    );

  return {
    runs: valid,
    totalDistanceKm: totalDistanceMeters / 1000,
    totalDurationSeconds,
    runCount: valid.length,
    paceSecondsPerKm:
      paceDistance > 0 ? (paceDuration / paceDistance) * 1000 : null,
    averageLegsRpe: average(legs),
    averageBreathingRpe: average(breathing),
    longestRun: valid.reduce<Run | null>(
      (longest, run) =>
        !longest || run.distanceMeters > longest.distanceMeters ? run : longest,
      null,
    ),
    weeks,
  };
}

export const getStatistics = aggregateStatistics;
