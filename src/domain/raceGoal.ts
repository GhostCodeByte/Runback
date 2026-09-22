import type { Run } from '../native';
import { validRun } from './statistics';

/**
 * Wettkampfziel: Strecke, Datum, Zielzeit — und eine Schätzung, wie nah der
 * Nutzer dran ist.
 *
 * Die Schätzung ist eine Rechnung nach Riegel (T2 = T1 · (D2/D1)^1,06) aus
 * einem tatsächlichen Lauf. Sie ist keine Messung und kein Versprechen; jede
 * Ausgabe nennt den Lauf, aus dem sie stammt, und ihre Grenzen. Fehlt ein
 * passender Lauf, bleibt sie leer statt zu raten.
 */
export const RACE_GOAL_VERSION = 'race-goal-v1';
/** Riegel-Exponent für Ausdauerläufe. Redaktionell, nicht gelernt. */
export const RIEGEL_EXPONENT = 1.06;
/** Nur Läufe der letzten acht Wochen tragen die Schätzung. */
export const REFERENCE_WINDOW_DAYS = 56;
/** Ein Referenzlauf ist mindestens ein Viertel der Zielstrecke, sonst wird die Extrapolation zu weit. */
export const REFERENCE_MIN_SHARE = 0.25;
export const REFERENCE_MIN_KM = 3;

export const HALF_MARATHON_KM = 21.0975;
export const MARATHON_KM = 42.195;

const DAY = 86400000;

const NAMED_DISTANCES: { pattern: RegExp; km: number }[] = [
  { pattern: /halb\s*-?\s*marathon|\bhm\b|\bhalf\b/i, km: HALF_MARATHON_KM },
  { pattern: /\bultra/i, km: 0 },
  { pattern: /marathon/i, km: MARATHON_KM },
];

/**
 * Liest die Strecke aus dem Zieltext: „Halbmarathon“, „HM“, „Marathon“,
 * „10 km“, „5k“, „21,1 Kilometer“. Ultra ohne Zahl bleibt unbekannt.
 */
export function parseGoalDistanceKm(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const numeric = value.match(/(\d+(?:[.,]\d+)?)\s*(?:km|k\b|kilometer(?:n)?)/i);
  if (numeric) {
    const km = Number(numeric[1].replace(',', '.'));
    return Number.isFinite(km) && km > 0 ? km : undefined;
  }
  for (const named of NAMED_DISTANCES) {
    if (named.pattern.test(value)) {
      return named.km > 0 ? named.km : undefined;
    }
  }
  return undefined;
}

/**
 * Zielzeit als „h:mm:ss“ oder „mm:ss“. Zwei Teile gelten ab 15 km als
 * „h:mm“, wenn die erste Zahl einstellig ist — niemand schreibt einen
 * Halbmarathon in Minuten:Sekunden, aber „59:30“ bleiben Minuten.
 */
export function parseGoalTime(
  text: string,
  distanceKm?: number,
): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const numbers = parts.map(part => (/^\d{1,2}$/.test(part) ? Number(part) : NaN));
  if (numbers.some(part => !Number.isFinite(part))) return undefined;
  const [a, b, c] = numbers;
  let seconds: number;
  if (parts.length === 3) {
    if (b > 59 || c > 59) return undefined;
    seconds = a * 3600 + b * 60 + c;
  } else if (distanceKm !== undefined && distanceKm >= 15 && a <= 9) {
    if (b > 59) return undefined;
    seconds = a * 3600 + b * 60;
  } else {
    if (b > 59) return undefined;
    seconds = a * 60 + b;
  }
  return seconds > 0 ? seconds : undefined;
}

export function formatGoalTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)} h`
    : `${minutes}:${pad(rest)} min`;
}

/** Riegel: Zeit über D2 aus einer Zeit über D1. */
export function riegelSeconds(
  durationSeconds: number,
  fromKm: number,
  toKm: number,
): number {
  return durationSeconds * Math.pow(toKm / fromKm, RIEGEL_EXPONENT);
}

/**
 * Der lange Lauf, den der Aufbau anpeilt: neun Zehntel der Strecke bis 25 km,
 * darüber drei Viertel, höchstens 32 km. Redaktionelle Setzung.
 */
export function peakLongRunKm(distanceKm: number): number {
  const peak = distanceKm <= 25 ? distanceKm * 0.9 : Math.min(32, distanceKm * 0.75);
  return Math.round(peak * 10) / 10;
}

export interface RaceGoalInput {
  goal: string;
  distanceKm?: number;
  targetDate?: string;
  targetSeconds?: number;
  runs: Run[];
  now: number;
}

export type RacePredictionStatus =
  | 'no_goal'
  | 'no_distance'
  | 'insufficient_data'
  | 'estimated';

export interface RaceReference {
  runId: string;
  distanceKm: number;
  durationSeconds: number;
  startTime: number;
}

export interface RacePrediction {
  version: typeof RACE_GOAL_VERSION;
  status: RacePredictionStatus;
  goal: string;
  /** Ein Satz für die Karte. */
  message: string;
  distanceKm?: number;
  targetDate?: string;
  targetSeconds?: number;
  /** Geschätzte Zielzeit nach Riegel aus `reference`. */
  predictedSeconds?: number;
  predictedPaceSecondsPerKm?: number;
  targetPaceSecondsPerKm?: number;
  /** Geschätztes minus Zieltempo in s/km; positiv heißt: noch zu langsam. */
  paceGapSecondsPerKm?: number;
  reference?: RaceReference;
  /** Längster Lauf im Fenster und der lange Lauf, den der Aufbau anpeilt. */
  longestRunKm?: number;
  peakLongRunKm?: number;
  /** Anteil 0–1: längster Lauf gegen den angepeilten langen Lauf. */
  distanceShare?: number;
  /** Anteil 0–1: Zielzeit gegen geschätzte Zeit. Nur mit Zielzeit. */
  timeShare?: number;
  /**
   * Zielnähe 0–1 für den Ring: das kleinere von Strecken- und Zeitanteil.
   * Fehlt die Schätzung, fehlt auch die Zielnähe.
   */
  progress?: number;
  /** Welche Größe die Zielnähe gerade begrenzt. */
  limitedBy?: 'distance' | 'time';
  daysToGo?: number;
  limits: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function effectiveGoalDistanceKm(input: {
  /** Zieltext; `name` für ein Ziel aus dem Plan. */
  goal?: string;
  name?: string;
  distanceKm?: number;
}): number | undefined {
  if (
    typeof input.distanceKm === 'number' &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm > 0
  ) {
    return input.distanceKm;
  }
  return parseGoalDistanceKm(input.goal ?? input.name ?? '');
}

export function daysUntil(targetDate: string, now: number): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return undefined;
  const [year, month, day] = targetDate.split('-').map(Number);
  const target = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target - today.getTime()) / DAY);
  return Number.isFinite(days) ? days : undefined;
}

/** Schätzt, wie nah der Nutzer an seinem Wettkampfziel ist. */
export function predictRace(input: RaceGoalInput): RacePrediction {
  const goal = input.goal.trim();
  const base = {
    version: RACE_GOAL_VERSION as typeof RACE_GOAL_VERSION,
    goal,
    limits: [] as string[],
  };
  if (!goal) {
    return { ...base, status: 'no_goal', message: 'Noch kein Ziel hinterlegt.' };
  }
  const distanceKm = effectiveGoalDistanceKm(input);
  const daysToGo =
    input.targetDate === undefined ? undefined : daysUntil(input.targetDate, input.now);
  const targetSeconds =
    typeof input.targetSeconds === 'number' &&
    Number.isFinite(input.targetSeconds) &&
    input.targetSeconds > 0
      ? input.targetSeconds
      : undefined;
  if (distanceKm === undefined) {
    return {
      ...base,
      status: 'no_distance',
      message: 'Trage eine Strecke ein, dann schätzt Runback deine Zielzeit.',
      targetDate: input.targetDate,
      daysToGo,
    };
  }
  const peak = peakLongRunKm(distanceKm);
  const windowStart = input.now - REFERENCE_WINDOW_DAYS * DAY;
  const seen = new Set<string>();
  const recent = input.runs.filter(run => {
    if (!validRun(run, input.now) || run.startTime < windowStart) return false;
    if (run.distanceMeters <= 0 || run.durationSeconds <= 0) return false;
    const key = run.canonicalId || run.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const longest = recent.reduce<Run | null>(
    (current, run) =>
      !current || run.distanceMeters > current.distanceMeters ? run : current,
    null,
  );
  const longestRunKm = longest ? round1(longest.distanceMeters / 1000) : undefined;
  const minReferenceKm = Math.max(REFERENCE_MIN_KM, distanceKm * REFERENCE_MIN_SHARE);
  // Der beste Lauf ist der mit der kleinsten hochgerechneten Zielzeit, nicht
  // der längste: ein flotter 10er sagt mehr als ein zäher 15er.
  let reference: RaceReference | undefined;
  let predictedSeconds: number | undefined;
  for (const run of recent) {
    const km = run.distanceMeters / 1000;
    if (km < minReferenceKm) continue;
    const projected = riegelSeconds(run.durationSeconds, km, distanceKm);
    if (predictedSeconds === undefined || projected < predictedSeconds) {
      predictedSeconds = projected;
      reference = {
        runId: run.id,
        distanceKm: round1(km),
        durationSeconds: run.durationSeconds,
        startTime: run.startTime,
      };
    }
  }
  const common = {
    ...base,
    distanceKm,
    targetDate: input.targetDate,
    targetSeconds,
    longestRunKm,
    peakLongRunKm: peak,
    daysToGo,
  };
  if (!reference || predictedSeconds === undefined) {
    return {
      ...common,
      status: 'insufficient_data',
      message: `Für eine Schätzung fehlt ein Lauf über mindestens ${formatDistanceKm(
        minReferenceKm,
      )} aus den letzten acht Wochen.`,
    };
  }
  const distanceShare = Math.min(1, (longestRunKm ?? 0) / peak);
  const timeShare =
    targetSeconds === undefined ? undefined : Math.min(1, targetSeconds / predictedSeconds);
  const limitedBy: 'distance' | 'time' =
    timeShare !== undefined && timeShare < distanceShare ? 'time' : 'distance';
  const progress = limitedBy === 'time' ? (timeShare as number) : distanceShare;
  const predictedPace = predictedSeconds / distanceKm;
  const targetPace = targetSeconds === undefined ? undefined : targetSeconds / distanceKm;
  const paceGap = targetPace === undefined ? undefined : predictedPace - targetPace;
  const limits = [
    `Die Schätzung rechnet deinen Lauf über ${formatDistanceKm(
      reference.distanceKm,
    )} nach Riegel hoch und nimmt an, dass du ihn mit vollem Einsatz gelaufen bist.`,
    'Schätzung, keine Messung. Sie ersetzt keinen Testlauf über die Zielstrecke.',
  ];
  const message =
    targetSeconds === undefined
      ? `Nach deinem Lauf über ${formatDistanceKm(reference.distanceKm)} wären etwa ${formatGoalTime(
          predictedSeconds,
        )} möglich.`
      : paceGap !== undefined && paceGap <= 0
      ? `Nach deinem Lauf über ${formatDistanceKm(
          reference.distanceKm,
        )} liegt dein Ziel von ${formatGoalTime(targetSeconds)} rechnerisch drin.`
      : `Etwa ${formatGoalTime(
          predictedSeconds,
        )} sind rechnerisch drin — für ${formatGoalTime(
          targetSeconds,
        )} fehlen noch ${formatPaceGap(paceGap as number)} pro Kilometer.`;
  return {
    ...common,
    status: 'estimated',
    message,
    predictedSeconds: Math.round(predictedSeconds),
    predictedPaceSecondsPerKm: Math.round(predictedPace),
    targetPaceSecondsPerKm: targetPace === undefined ? undefined : Math.round(targetPace),
    paceGapSecondsPerKm: paceGap === undefined ? undefined : Math.round(paceGap),
    reference,
    distanceShare: Math.round(distanceShare * 100) / 100,
    timeShare: timeShare === undefined ? undefined : Math.round(timeShare * 100) / 100,
    progress: Math.round(progress * 100) / 100,
    limitedBy,
    limits,
  };
}

const kmFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatDistanceKm(km: number): string {
  return `${kmFormatter.format(km)} km`;
}

function formatPaceGap(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} min`;
}
