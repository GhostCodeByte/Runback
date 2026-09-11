import type { Run } from '../native';
import type { StrengthSession } from './strength';
import { localDateKey as scheduleLocalDateKey } from './schedule';
import type { ScheduleState } from './schedule';
import { isRun } from './sport';

/**
 * Fakten für die Entwicklungsansicht.
 *
 * Die Seite hält drei Dinge bewusst auseinander:
 * - `planPosition` kommt nur aus einem ausdrücklich gespeicherten Plan.
 * - `current` und `previous` werden ausschließlich aus abgeschlossenen
 *   Einheiten berechnet.
 * - `goalEvidence` beschreibt beobachtbare Werte. Sie ist keine Prognose und
 *   erzeugt keinen Bereitschafts- oder Fitnesswert.
 */

const FOUR_WEEKS = 28;

/**
 * The app deliberately loads bounded history pages for the overview screens.
 * Keep the limits next to the facts so a screen can disclose when its totals
 * describe the loaded page rather than the entire native store.
 */
export const DEVELOPMENT_RUN_LOAD_LIMIT = 1000;
export const DEVELOPMENT_STRENGTH_LOAD_LIMIT = 500;

export type { ScheduleState } from './schedule';

export interface DevelopmentInput {
  runs: Run[];
  /** Vollständige Einheiten, nicht nur die gekürzten SessionSummary-Werte. */
  sessions: StrengthSession[];
  goal: string;
  now: number;
  schedule?: ScheduleState | null;
}

export interface DevelopmentPeriod {
  startTime: number;
  endTime: number;
  /** Ein Tag zählt höchstens einmal, auch bei Lauf und Krafttraining am selben Tag. */
  trainingDays: number;
  runCount: number;
  distanceMeters: number;
  durationSeconds: number;
  strengthSessionCount: number;
  strengthCompletedSets: number;
  strengthVolumeKg: number;
  hasTraining: boolean;
}

export interface StrengthHistoryItem {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  completedSets: number;
  volumeKg: number;
}

export interface StrengthHistory {
  sessions: StrengthHistoryItem[];
  totalSessions: number;
  completedSets: number;
  volumeKg: number;
  latestAt: number | null;
  hasData: boolean;
}

export interface PlanPosition {
  label: string;
  phase?: string;
  startDate: string;
  targetDate?: string;
  source: 'schedule';
  timing: 'upcoming' | 'active' | 'ended';
  week?: number;
  totalWeeks?: number;
}

export type GoalEvidenceStatus = 'no_goal' | 'insufficient_data' | 'observed';

export interface GoalEvidence {
  goal: string;
  status: GoalEvidenceStatus;
  message: string;
  targetDistanceKm?: number;
  longestRunDistanceKm?: number;
  longestRunAt?: number;
}

export interface DevelopmentComparison {
  trainingDays: number;
  runCount: number;
  distanceMeters: number;
  durationSeconds: number;
  strengthSessionCount: number;
  strengthCompletedSets: number;
}

export interface DevelopmentFacts {
  planPosition: PlanPosition | null;
  /** Synonyme für Aufrufer, die die beiden Fenster als `periods` lesen. */
  current: DevelopmentPeriod;
  previous: DevelopmentPeriod;
  periods: {
    current: DevelopmentPeriod;
    previous: DevelopmentPeriod;
  };
  comparison: DevelopmentComparison;
  strengthHistory: StrengthHistory;
  goalEvidence: GoalEvidence;
  /** Bekannte Grenzen der Fakten, damit die Oberfläche keine Lücken kaschiert. */
  limits: string[];
}

interface ActualRun {
  run: Run;
  identity: string;
}

interface ActualStrength {
  session: StrengthSession;
  identity: string;
  completedSets: number;
  volumeKg: number;
}

interface WindowBounds {
  startTime: number;
  endTime: number;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const validTimestamp = (value: unknown): value is number =>
  finite(value) && value > 0 && Number.isFinite(new Date(value).getTime());

const lowerStatus = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : '';

/**
 * Native runs use `completed` and `imported`; `finished` is accepted for
 * older exports. Recording, paused and active records never enter history,
 * and neither do other sports: their kilometers are not running kilometers.
 */
const isCompletedRun = (run: Run, now: number): boolean => {
  const status = lowerStatus(run.status);
  if (!['completed', 'imported', 'finished', 'complete'].includes(status)) {
    return false;
  }
  if (!isRun(run)) {
    return false;
  }
  if (
    !validTimestamp(run.startTime) ||
    !validTimestamp(run.endTime) ||
    run.startTime > now ||
    run.endTime > now ||
    run.endTime < run.startTime ||
    !finite(run.distanceMeters) ||
    run.distanceMeters < 0 ||
    !finite(run.durationSeconds) ||
    run.durationSeconds < 0
  ) {
    return false;
  }
  return true;
};

const runIdentity = (run: Run, index: number) => {
  const canonical =
    typeof run.canonicalId === 'string' ? run.canonicalId.trim() : '';
  const id = typeof run.id === 'string' ? run.id.trim() : '';
  return canonical || id || `run-${index}`;
};

const actualRuns = (runs: Run[], now: number): ActualRun[] => {
  const seen = new Set<string>();
  return runs
    .map((run, index) => ({ run, identity: runIdentity(run, index) }))
    .filter(({ run }) => isCompletedRun(run, now))
    .filter(({ identity }) => {
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    });
};

const actualSetValues = (session: StrengthSession, now: number) => {
  const startTime = session.startTime;
  const endTime = session.endTime;
  let completedSets = 0;
  let volumeKg = 0;
  for (const exercise of session.exercises || []) {
    for (const set of exercise.sets || []) {
      const completedAt = set.completedAt;
      if (
        set.skipped ||
        !validTimestamp(completedAt) ||
        completedAt > now ||
        !validTimestamp(startTime) ||
        !validTimestamp(endTime) ||
        completedAt < startTime ||
        completedAt > endTime
      ) {
        continue;
      }
      const hasActual =
        (finite(set.actualReps) && set.actualReps > 0) ||
        (finite(set.actualSeconds) && set.actualSeconds > 0);
      if (!hasActual) {
        continue;
      }
      completedSets += 1;
      if (
        finite(set.actualWeightKg) &&
        set.actualWeightKg > 0 &&
        finite(set.actualReps) &&
        set.actualReps > 0
      ) {
        volumeKg += set.actualWeightKg * set.actualReps;
      }
    }
  }
  return { completedSets, volumeKg };
};

const isCompletedStrength = (session: StrengthSession, now: number): boolean =>
  session.status === 'finished' &&
  validTimestamp(session.startTime) &&
  validTimestamp(session.endTime) &&
  session.startTime <= now &&
  session.endTime <= now &&
  session.endTime >= session.startTime;

const actualStrength = (
  sessions: StrengthSession[],
  now: number,
): ActualStrength[] => {
  const seen = new Set<string>();
  return sessions
    .map((session, index) => ({
      session,
      identity:
        typeof session.id === 'string' && session.id.trim()
          ? session.id.trim()
          : `strength-${index}`,
    }))
    .filter(({ session }) => isCompletedStrength(session, now))
    .filter(({ identity }) => {
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    })
    .map(entry => ({
      ...entry,
      ...actualSetValues(entry.session, now),
    }))
    .filter(entry => entry.completedSets > 0);
};

const localDayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Stepping by local dates keeps the window correct across daylight changes. */
const addLocalDays = (timestamp: number, days: number): number => {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

const localDateKey = (timestamp: number): string =>
  scheduleLocalDateKey(timestamp);

const periodFor = (
  runs: ActualRun[],
  sessions: ActualStrength[],
  bounds: WindowBounds,
): DevelopmentPeriod => {
  const selectedRuns = runs.filter(
    ({ run }) =>
      run.startTime >= bounds.startTime && run.startTime < bounds.endTime,
  );
  const selectedStrength = sessions.filter(
    ({ session }) =>
      session.startTime >= bounds.startTime &&
      session.startTime < bounds.endTime,
  );
  const days = new Set<string>();
  selectedRuns.forEach(({ run }) => days.add(localDateKey(run.startTime)));
  selectedStrength.forEach(({ session }) =>
    days.add(localDateKey(session.startTime)),
  );
  return {
    startTime: bounds.startTime,
    endTime: bounds.endTime,
    trainingDays: days.size,
    runCount: selectedRuns.length,
    distanceMeters: selectedRuns.reduce(
      (sum, { run }) => sum + run.distanceMeters,
      0,
    ),
    durationSeconds: selectedRuns.reduce(
      (sum, { run }) => sum + run.durationSeconds,
      0,
    ),
    strengthSessionCount: selectedStrength.length,
    strengthCompletedSets: selectedStrength.reduce(
      (sum, { completedSets }) => sum + completedSets,
      0,
    ),
    strengthVolumeKg: selectedStrength.reduce(
      (sum, { volumeKg }) => sum + volumeKg,
      0,
    ),
    hasTraining: days.size > 0,
  };
};

const parseGoalDistance = (goal: string): number | undefined => {
  const match = goal.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kilometer(?:n)?)/i);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const goalEvidenceFor = (goal: string, runs: ActualRun[]): GoalEvidence => {
  const cleanGoal = goal.trim();
  if (!cleanGoal) {
    return {
      goal: '',
      status: 'no_goal',
      message: 'Noch kein Ziel hinterlegt.',
    };
  }
  const targetDistanceKm = parseGoalDistance(cleanGoal);
  const longest = runs.reduce<Run | null>(
    (current, { run }) =>
      !current || run.distanceMeters > current.distanceMeters ? run : current,
    null,
  );
  if (!longest) {
    return {
      goal: cleanGoal,
      status: 'insufficient_data',
      message: 'Für einen Zielabgleich fehlen abgeschlossene Läufe.',
      ...(targetDistanceKm === undefined ? {} : { targetDistanceKm }),
    };
  }
  if (targetDistanceKm === undefined) {
    return {
      goal: cleanGoal,
      status: 'observed',
      message:
        'Abgeschlossene Einheiten sind vorhanden. Dieses Ziel enthält keine eindeutig messbare Strecke für einen direkten Abgleich.',
    };
  }
  return {
    goal: cleanGoal,
    status: 'observed',
    message:
      'Die Strecke ist ein beobachteter Trainingswert; daraus folgt keine Prognose.',
    targetDistanceKm,
    longestRunDistanceKm: longest.distanceMeters / 1000,
    longestRunAt: longest.startTime,
  };
};

const planPositionFor = (
  schedule: ScheduleState | null | undefined,
  now: number,
): PlanPosition | null => {
  const goal = schedule?.goal;
  if (!goal) {
    return null;
  }
  const today = scheduleLocalDateKey(now);
  const ordinal = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  };
  const timing =
    today < goal.startDate
      ? 'upcoming'
      : goal.targetDate && today > goal.targetDate
      ? 'ended'
      : 'active';
  return {
    label: goal.name,
    phase: goal.phase,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    source: 'schedule',
    timing,
    week:
      timing === 'active'
        ? Math.floor((ordinal(today) - ordinal(goal.startDate)) / 7) + 1
        : undefined,
    totalWeeks:
      goal.targetDate && goal.targetDate >= goal.startDate
        ? Math.ceil(
            (ordinal(goal.targetDate) - ordinal(goal.startDate) + 1) / 7,
          )
        : undefined,
  };
};

const comparePeriods = (
  current: DevelopmentPeriod,
  previous: DevelopmentPeriod,
): DevelopmentComparison => ({
  trainingDays: current.trainingDays - previous.trainingDays,
  runCount: current.runCount - previous.runCount,
  distanceMeters: current.distanceMeters - previous.distanceMeters,
  durationSeconds: current.durationSeconds - previous.durationSeconds,
  strengthSessionCount:
    current.strengthSessionCount - previous.strengthSessionCount,
  strengthCompletedSets:
    current.strengthCompletedSets - previous.strengthCompletedSets,
});

/**
 * Erstellt lokale, abgeschlossene Trainingsfakten.
 *
 * „Letzte vier Wochen“ meint 28 lokale Kalendertage einschließlich des heutigen
 * Tages. Die vorherigen vier Wochen liegen direkt davor. Einträge mit einem
 * Zeitpunkt in der Zukunft oder mit einem laufenden Status werden verworfen.
 */
export function buildDevelopmentFacts(
  input: DevelopmentInput,
): DevelopmentFacts {
  const now = finite(input.now) && input.now > 0 ? input.now : 0;
  const today = localDayStart(now);
  const currentStart = addLocalDays(today, -(FOUR_WEEKS - 1));
  const previousStart = addLocalDays(currentStart, -FOUR_WEEKS);
  const end = addLocalDays(today, 1);
  const runs = actualRuns(input.runs || [], now);
  const sessions = actualStrength(input.sessions || [], now);
  const current = periodFor(runs, sessions, {
    startTime: currentStart,
    endTime: end,
  });
  const previous = periodFor(runs, sessions, {
    startTime: previousStart,
    endTime: currentStart,
  });
  const history = [...sessions]
    .sort(
      (a, b) =>
        b.session.startTime - a.session.startTime ||
        a.identity.localeCompare(b.identity),
    )
    .map(({ session, completedSets, volumeKg }) => ({
      id: session.id,
      name: session.name,
      startTime: session.startTime,
      endTime: session.endTime as number,
      completedSets,
      volumeKg,
    }));
  const strengthHistory: StrengthHistory = {
    sessions: history,
    totalSessions: history.length,
    completedSets: history.reduce((sum, item) => sum + item.completedSets, 0),
    volumeKg: history.reduce((sum, item) => sum + item.volumeKg, 0),
    latestAt: history[0]?.startTime ?? null,
    hasData: history.length > 0,
  };
  const limits: string[] = [];
  if (!runs.length) {
    limits.push('Keine abgeschlossenen Läufe mit gültiger Zeit und Distanz.');
  }
  if (!sessions.length) {
    limits.push('Keine abgeschlossenen Krafttrainings mit bestätigten Werten.');
  }
  if (!input.schedule) {
    limits.push('Kein ausdrücklich gespeicherter Planabschnitt vorhanden.');
  }
  return {
    planPosition: planPositionFor(input.schedule, now),
    current,
    previous,
    periods: { current, previous },
    comparison: comparePeriods(current, previous),
    strengthHistory,
    goalEvidence: goalEvidenceFor(input.goal || '', runs),
    limits,
  };
}

/** Namen für Aufrufer aus UI und Tests, ohne eine zweite Berechnung einzuführen. */
export const developmentFacts = buildDevelopmentFacts;
export const calculateDevelopmentFacts = buildDevelopmentFacts;

export {
  actualRuns as completedRunsForDevelopment,
  actualStrength as completedStrengthForDevelopment,
  localDateKey as developmentLocalDateKey,
};
