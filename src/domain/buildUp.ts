import type { Run } from '../native';
import type { RunSlotPlan, ScheduleDate, ScheduleRoutine } from './schedule';
import { startOfWeek } from './schedule';
import { peakLongRunKm, formatDistanceKm } from './raceGoal';
import { validRun } from './statistics';
import { median } from './inference';

/**
 * Aufbau zum Wettkampf: welcher lange Lauf in welche Woche gehört.
 *
 * Feste, versionierte Regeln — kein lernendes Profil:
 * - Der lange Lauf wächst um höchstens zehn Prozent je Woche, ausgehend vom
 *   Median der längsten Läufe der letzten vier Wochen.
 * - Jede vierte Aufbauwoche ist eine Erholungswoche mit vier Fünfteln.
 * - Die Woche vor dem Wettkampf ist Entlastung (60 %), die Wettkampfwoche
 *   enthält nur den Wettkampf und einen kurzen lockeren Lauf.
 * - Der Aufbau endet beim angepeilten langen Lauf (`peakLongRunKm`).
 * Reicht das bis zum Zieldatum nicht, sagt der Aufbau, wie weit er kommt —
 * er verkürzt weder die Regel noch die Zeit.
 */
export const BUILD_UP_VERSION = 'buildup-v1';
export const MAX_WEEKLY_GROWTH = 1.1;
export const RECOVERY_SHARE = 0.8;
export const TAPER_SHARE = 0.6;
export const BASE_WINDOW_DAYS = 28;
export const PACE_WINDOW_DAYS = 56;
/** Kurzer lockerer Lauf in der Wettkampfwoche, in Minuten. */
export const RACE_WEEK_EASY_MINUTES = 30;

const DAY = 86400000;

export type { RunSlotPlan } from './schedule';

export type BuildUpPhase = 'build' | 'recovery' | 'taper' | 'race';

export interface BuildUpInput {
  goal: { name: string; distanceKm: number; targetDate: ScheduleDate };
  runs: Run[];
  routine: ScheduleRoutine;
  weekStart: ScheduleDate;
  today: ScheduleDate;
  now: number;
}

export type BuildUpStatus =
  | 'ready'
  | 'past_target'
  | 'no_days'
  | 'insufficient_data';

export interface BuildUpWeek {
  version: typeof BUILD_UP_VERSION;
  status: BuildUpStatus;
  /** Wochen von dieser Woche bis zur Wettkampfwoche; 0 ist die Wettkampfwoche. */
  weeksToGo: number;
  phase?: BuildUpPhase;
  peakLongRunKm: number;
  baseLongRunKm?: number;
  longRunKm?: number;
  /** Was der Aufbau bis zur letzten Aufbauwoche erreicht. */
  reachableKm?: number;
  paceSecondsPerKm?: number;
  slots: RunSlotPlan[];
  rationale: string[];
  limits: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const roundMinutes = (value: number) => Math.max(10, Math.round(value / 5) * 5);

const weekKeyOf = (run: Run) => startOfWeek(run.startTime);

/** Median der längsten Läufe je Woche im Fenster; braucht zwei Wochen. */
export function baseLongRunKm(
  runs: Run[],
  now: number,
): { km?: number; weeks: number } {
  const windowStart = now - BASE_WINDOW_DAYS * DAY;
  const byWeek = new Map<string, number>();
  for (const run of runs) {
    if (!validRun(run, now) || run.startTime < windowStart) continue;
    const km = run.distanceMeters / 1000;
    if (km <= 0) continue;
    const key = weekKeyOf(run);
    byWeek.set(key, Math.max(byWeek.get(key) ?? 0, km));
  }
  const values = [...byWeek.values()];
  if (values.length < 2) {
    return { weeks: values.length };
  }
  return { km: round1(median(values)), weeks: values.length };
}

/** Median-Tempo ruhiger Läufe ab 5 km in den letzten acht Wochen. */
export function longRunPace(runs: Run[], now: number): number | undefined {
  const windowStart = now - PACE_WINDOW_DAYS * DAY;
  const paces = runs
    .filter(
      run =>
        validRun(run, now) &&
        run.startTime >= windowStart &&
        run.distanceMeters >= 5000 &&
        run.durationSeconds > 0 &&
        run.purpose !== 'intervals' &&
        run.purpose !== 'race',
    )
    .map(run => run.durationSeconds / (run.distanceMeters / 1000));
  return paces.length ? median(paces) : undefined;
}

const weeksBetween = (from: ScheduleDate, to: ScheduleDate): number => {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = new Date(fy, fm - 1, fd, 12).getTime();
  const b = new Date(ty, tm - 1, td, 12).getTime();
  return Math.round((b - a) / DAY / 7);
};

const weekdayOf = (date: ScheduleDate): number => {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).getDay();
  return (day + 6) % 7;
};

/**
 * Lange Läufe je Aufbauwoche ab der aktuellen Woche, bis zur letzten
 * Aufbauwoche vor der Entlastung. Index 0 ist die aktuelle Woche.
 */
export function longRunSequence(
  baseKm: number,
  peakKm: number,
  buildWeeks: number,
): { km: number; recovery: boolean }[] {
  const sequence: { km: number; recovery: boolean }[] = [];
  let line = baseKm;
  for (let index = 0; index < buildWeeks; index += 1) {
    const recovery = (index + 1) % 4 === 0 && index + 1 < buildWeeks;
    if (recovery) {
      sequence.push({ km: round1(line * RECOVERY_SHARE), recovery: true });
      continue;
    }
    line = Math.min(peakKm, line * MAX_WEEKLY_GROWTH);
    sequence.push({ km: round1(line), recovery: false });
  }
  return sequence;
}

export function buildUpWeek(input: BuildUpInput): BuildUpWeek {
  const peak = peakLongRunKm(input.goal.distanceKm);
  const raceWeekStart = startOfWeek(input.goal.targetDate);
  const currentWeekStart = startOfWeek(input.today);
  const weeksToGo = weeksBetween(input.weekStart, raceWeekStart);
  const base = {
    version: BUILD_UP_VERSION as typeof BUILD_UP_VERSION,
    weeksToGo,
    peakLongRunKm: peak,
    slots: [] as RunSlotPlan[],
    rationale: [] as string[],
    limits: [] as string[],
  };
  if (weeksToGo < 0) {
    return {
      ...base,
      status: 'past_target',
      rationale: ['Das Zieldatum liegt vor dieser Woche; die Routine gilt wie gewohnt.'],
    };
  }
  const runDays = [...new Set(input.routine.days)].sort((a, b) => a - b);
  if (!runDays.length) {
    return {
      ...base,
      status: 'no_days',
      limits: ['Lege unter „Zeit & Rhythmus“ deine Lauftage fest, dann plant Runback den Aufbau.'],
    };
  }
  const baseline = baseLongRunKm(input.runs, input.now);
  const pace = longRunPace(input.runs, input.now);
  const missing: string[] = [];
  if (baseline.km === undefined) {
    missing.push(
      'Für den Aufbau fehlen Läufe aus mindestens zwei der letzten vier Wochen.',
    );
  }
  if (pace === undefined) {
    missing.push('Für die Dauer fehlt ein Lauf ab 5 km aus den letzten acht Wochen.');
  }
  if (baseline.km === undefined || pace === undefined) {
    return { ...base, status: 'insufficient_data', baseLongRunKm: baseline.km, limits: missing };
  }
  const easy: Omit<RunSlotPlan, 'routineDay'> = {
    minutes: input.routine.minutes,
    purpose: 'easy',
    title: 'Lockerer Lauf',
    effort: 'easy',
  };
  const minutesFor = (km: number) => roundMinutes((km * pace) / 60);
  const longDay = runDays[runDays.length - 1];

  if (weeksToGo === 0) {
    const raceDay = weekdayOf(input.goal.targetDate);
    const slots: RunSlotPlan[] = runDays
      .filter(day => day <= raceDay - 2)
      .map(day => ({
        ...easy,
        routineDay: day,
        minutes: Math.min(input.routine.minutes, RACE_WEEK_EASY_MINUTES),
      }));
    slots.push({
      routineDay: raceDay,
      minutes: minutesFor(input.goal.distanceKm),
      purpose: 'race',
      title: input.goal.name,
      effort: 'hard',
      distanceKm: input.goal.distanceKm,
      stretch: true,
    });
    return {
      ...base,
      status: 'ready',
      phase: 'race',
      baseLongRunKm: baseline.km,
      paceSecondsPerKm: pace,
      slots,
      rationale: [
        `Wettkampfwoche: ${input.goal.name} am ${input.goal.targetDate}, davor nur kurz und locker.`,
      ],
    };
  }

  // Wochen bis zur Entlastung, gerechnet ab der aktuellen Woche, damit ein
  // erneuter Vorschlag nach neuen Läufen vom echten Stand ausgeht.
  const buildWeeksTotal = Math.max(0, weeksBetween(currentWeekStart, raceWeekStart) - 1);
  const sequence = longRunSequence(baseline.km, peak, buildWeeksTotal);
  const reachable = sequence.length ? sequence[sequence.length - 1].km : baseline.km;
  const offset = weeksBetween(currentWeekStart, input.weekStart);
  const limits: string[] = [];
  if (reachable < peak) {
    limits.push(
      `Mit höchstens 10 % mehr pro Woche kommst du bis zum Ziel auf lange Läufe von etwa ${formatDistanceKm(
        reachable,
      )} statt ${formatDistanceKm(peak)}.`,
    );
  }
  let longKm: number;
  let phase: BuildUpPhase;
  if (weeksToGo === 1) {
    phase = 'taper';
    longKm = round1(reachable * TAPER_SHARE);
  } else {
    const entry = sequence[Math.min(offset, sequence.length - 1)];
    phase = entry?.recovery ? 'recovery' : 'build';
    longKm = entry?.km ?? baseline.km;
  }
  const slots: RunSlotPlan[] = runDays.map(day =>
    day === longDay
      ? {
          routineDay: day,
          minutes: minutesFor(longKm),
          purpose: 'long',
          title: `Langer Lauf · ${formatDistanceKm(longKm)}`,
          effort: phase === 'taper' ? 'easy' : 'hard',
          distanceKm: longKm,
          stretch: true,
        }
      : { ...easy, routineDay: day },
  );
  const rationale =
    phase === 'taper'
      ? [`Entlastung: noch eine Woche bis ${input.goal.name}, langer Lauf ${formatDistanceKm(longKm)}.`]
      : phase === 'recovery'
      ? [`Erholungswoche im Aufbau zu ${input.goal.name}: langer Lauf ${formatDistanceKm(longKm)}.`]
      : [
          `Aufbau zu ${input.goal.name}: noch ${weeksToGo} Wochen, langer Lauf ${formatDistanceKm(
            longKm,
          )} von ${formatDistanceKm(peak)}.`,
        ];
  return {
    ...base,
    status: 'ready',
    phase,
    baseLongRunKm: baseline.km,
    longRunKm: longKm,
    reachableKm: reachable,
    paceSecondsPerKm: pace,
    slots,
    rationale,
    limits,
  };
}
