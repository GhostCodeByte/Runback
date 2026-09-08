import {
  epley1RM,
  type LoggedSet,
  type StrengthSession,
} from './strength';

export const PROGRESSION_MODEL_VERSION = 'strength-progression-v1';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PLATEAU_MS = 4 * WEEK_MS;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    throw new Error('Der Median braucht mindestens einen Wert.');
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export interface E1RMPoint {
  sessionId: string;
  at: number;
  e1rm: number;
  weightKg: number;
  reps: number;
  setId: string;
}

/** Ein Arbeitsset wird nur aus einer abgeschlossenen Einheit übernommen. */
export function bestWorkingSet(
  session: StrengthSession,
  exerciseId: string,
): E1RMPoint | null {
  if (session.status !== 'finished') {
    return null;
  }
  const exercise = session.exercises.find(
    candidate => candidate.exerciseId === exerciseId,
  );
  const at = session.endTime ?? session.startTime;
  if (!exercise || !finite(at)) {
    return null;
  }
  let best: E1RMPoint | null = null;
  for (const set of exercise.sets) {
    if (!isCompletedWorkingSet(set)) {
      continue;
    }
    const weightKg = set.actualWeightKg ?? set.planned.weightKg;
    const reps = set.actualReps ?? set.planned.reps;
    if (!finite(weightKg) || !finite(reps)) {
      continue;
    }
    const e1rm = epley1RM(weightKg, reps);
    if (e1rm === null) {
      continue;
    }
    const point: E1RMPoint = {
      sessionId: session.id,
      at,
      e1rm,
      weightKg,
      reps,
      setId: set.id,
    };
    if (
      best === null ||
      point.e1rm > best.e1rm ||
      (point.e1rm === best.e1rm && point.setId.localeCompare(best.setId) < 0)
    ) {
      best = point;
    }
  }
  return best;
}

function isCompletedWorkingSet(set: LoggedSet): boolean {
  return (
    set.completedAt !== undefined &&
    !set.skipped &&
    set.planned.kind !== 'warmup'
  );
}

/** Serie je Übung; offene, unterbrochene und Aufwärmsätze bleiben draußen. */
export function buildE1RMSeries(
  sessions: StrengthSession[],
  exerciseId: string,
): E1RMPoint[] {
  return sessions
    .map(session => bestWorkingSet(session, exerciseId))
    .filter((point): point is E1RMPoint => point !== null)
    .sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
}

export interface RankConfidenceInterval {
  lower: number;
  upper: number;
  confidenceLevel: number;
  lowerRank: number;
  upperRank: number;
}

/**
 * Rangbasierte Schranke für dieselben paarweisen Steigungen wie Theil-Sen.
 * Es wird keine parametrische Regression als Ersatz eingeführt.
 */
export function rankConfidenceInterval(
  slopes: number[],
  observations: number,
  confidenceLevel = 0.95,
): RankConfidenceInterval | null {
  const finiteSlopes = slopes
    .filter(finite)
    .sort((a, b) => a - b);
  if (!finiteSlopes.length || observations < 2) {
    return null;
  }
  const confidence = Math.min(
    0.999,
    Math.max(0.5, finite(confidenceLevel) ? confidenceLevel : 0.95),
  );
  const z =
    confidence >= 0.985
      ? 2.326
      : confidence >= 0.94
      ? 1.96
      : confidence >= 0.89
      ? 1.645
      : 1.282;
  const variance =
    (observations * (observations - 1) * (2 * observations + 5)) / 18;
  const rankHalfWidth = z * Math.sqrt(variance);
  const lowerRank = Math.max(
    0,
    Math.min(
      finiteSlopes.length - 1,
      Math.floor((finiteSlopes.length - rankHalfWidth) / 2),
    ),
  );
  const upperRank = Math.max(
    lowerRank,
    Math.min(
      finiteSlopes.length - 1,
      Math.ceil((finiteSlopes.length + rankHalfWidth) / 2),
    ),
  );
  return {
    lower: finiteSlopes[lowerRank],
    upper: finiteSlopes[upperRank],
    confidenceLevel: confidence,
    lowerRank,
    upperRank,
  };
}

export interface TheilSenTrend {
  slopePerWeek: number;
  intercept: number;
  confidenceInterval: RankConfidenceInterval;
  pairwiseSlopeCount: number;
  firstAt: number;
  lastAt: number;
  pointCount: number;
  predictAt: (at: number) => number;
}

/** Theil-Sen-Schätzung mit Zeitachse in Wochen ab dem ersten Punkt. */
export function theilSenSlope(
  series: E1RMPoint[],
  confidenceLevel = 0.95,
): TheilSenTrend | null {
  const points = series
    .filter(point => finite(point.at) && finite(point.e1rm))
    .sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
  if (points.length < 2) {
    return null;
  }
  const firstAt = points[0].at;
  const x = (at: number) => (at - firstAt) / WEEK_MS;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const deltaX = x(points[j].at) - x(points[i].at);
      if (deltaX > 0) {
        slopes.push((points[j].e1rm - points[i].e1rm) / deltaX);
      }
    }
  }
  const confidenceInterval = rankConfidenceInterval(
    slopes,
    points.length,
    confidenceLevel,
  );
  if (!confidenceInterval) {
    return null;
  }
  const slopePerWeek = median(slopes);
  const intercept = median(points.map(point => point.e1rm - slopePerWeek * x(point.at)));
  return {
    slopePerWeek,
    intercept,
    confidenceInterval,
    pairwiseSlopeCount: slopes.length,
    firstAt,
    lastAt: points[points.length - 1].at,
    pointCount: points.length,
    predictAt: (at: number) => intercept + slopePerWeek * x(at),
  };
}

export interface CusumChangePoint {
  index: number;
  sessionId: string;
  at: number;
  direction: 'higher' | 'lower';
  score: number;
  residual: number;
}

export interface CusumAnalysis {
  residuals: { sessionId: string; at: number; residual: number }[];
  changePoints: CusumChangePoint[];
  threshold: number;
  allowance: number;
  minimumConsecutive: number;
}

export interface CusumOptions {
  threshold?: number;
  allowance?: number;
  minimumConsecutive?: number;
}

/** CUSUM auf Trendresiduen; ein einzelner Ausschlag reicht standardmäßig nicht. */
export function detectCusumChangePoints(
  series: E1RMPoint[],
  trend: TheilSenTrend,
  options: CusumOptions = {},
): CusumAnalysis {
  const points = series
    .filter(point => finite(point.at) && finite(point.e1rm))
    .sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
  const residuals = points.map(point => ({
    sessionId: point.sessionId,
    at: point.at,
    residual: point.e1rm - trend.predictAt(point.at),
  }));
  if (!points.length) {
    return {
      residuals,
      changePoints: [],
      threshold: options.threshold ?? 0,
      allowance: options.allowance ?? 0,
      minimumConsecutive: Math.max(2, Math.floor(options.minimumConsecutive ?? 2)),
    };
  }
  const absoluteDeviation = residuals.map(item => Math.abs(item.residual));
  const center = median(absoluteDeviation);
  const mad = median(absoluteDeviation.map(value => Math.abs(value - center)));
  const baseline = Math.max(0.5, median(points.map(point => point.e1rm)) * 0.005);
  const scale = Math.max(baseline, 1.4826 * mad);
  const allowance = Math.max(
    0.1,
    finite(options.allowance) ? options.allowance : scale * 0.5,
  );
  const threshold = Math.max(
    allowance * 2,
    finite(options.threshold) ? options.threshold : scale * 4,
  );
  const minimumConsecutive = Math.max(
    2,
    Math.floor(options.minimumConsecutive ?? 2),
  );
  let positive = 0;
  let negative = 0;
  let positiveStreak = 0;
  let negativeStreak = 0;
  const changePoints: CusumChangePoint[] = [];
  residuals.forEach((item, index) => {
    positive = Math.max(0, positive + item.residual - allowance);
    negative = Math.min(0, negative + item.residual + allowance);
    positiveStreak =
      item.residual > 0 && positive > threshold ? positiveStreak + 1 : 0;
    negativeStreak =
      item.residual < 0 && -negative > threshold ? negativeStreak + 1 : 0;
    if (positiveStreak >= minimumConsecutive) {
      changePoints.push({
        index,
        sessionId: item.sessionId,
        at: item.at,
        direction: 'higher',
        score: positive,
        residual: item.residual,
      });
      positive = 0;
      positiveStreak = 0;
    } else if (negativeStreak >= minimumConsecutive) {
      changePoints.push({
        index,
        sessionId: item.sessionId,
        at: item.at,
        direction: 'lower',
        score: -negative,
        residual: item.residual,
      });
      negative = 0;
      negativeStreak = 0;
    }
    if (item.residual < 0) {
      positive = 0;
      positiveStreak = 0;
    }
    if (item.residual > 0) {
      negative = 0;
      negativeStreak = 0;
    }
  });
  return {
    residuals,
    changePoints,
    threshold,
    allowance,
    minimumConsecutive,
  };
}

export interface PlateauAssessment {
  isPlateau: boolean;
  spanWeeks: number;
  criterion: string;
}

export function assessPlateau(
  series: E1RMPoint[],
  trend: TheilSenTrend | null,
): PlateauAssessment {
  const points = [...series].sort((a, b) => a.at - b.at);
  const spanWeeks =
    points.length > 1
      ? (points[points.length - 1].at - points[0].at) / WEEK_MS
      : 0;
  const isPlateau =
    trend !== null &&
    spanWeeks * WEEK_MS >= PLATEAU_MS &&
    trend.confidenceInterval.lower <= 0 &&
    trend.confidenceInterval.upper >= 0;
  return {
    isPlateau,
    spanWeeks,
    criterion:
      'Plateau bedeutet: rangbasiertes Steigungsintervall enthält 0 und umfasst mindestens vier Wochen; drei nicht gesteigerte Einheiten allein reichen nicht.',
  };
}

export interface ProgressionOptions {
  nextSessionAt?: number;
  targetReps?: number;
  targetRir?: number;
  regionFreshness?: number | null;
  confidenceLevel?: number;
}

export interface TargetRange {
  minKg: number;
  targetKg: number;
  maxKg: number;
  reps: number;
  targetPercentOfE1RM: number;
  estimatedE1RM: number;
  freshnessFactor: number;
  stepCapApplied: boolean;
}

export interface ProgressionCheckCriterion {
  method: 'strength-e1rm-v1';
  baselineSessionIds: string[];
  outcome: 'bestes Arbeits-e1RM';
  minimumRelevantChangePercent: number;
  reviewAfterSessions: number;
  check: string;
}

export type ProgressionVerdict =
  | 'increase'
  | 'reduce'
  | 'plateau'
  | 'keep_going'
  | 'not_assessable';

export interface ProgressionSuggestion {
  kind: 'strength_load';
  verdict: Exclude<ProgressionVerdict, 'not_assessable'>;
  reason: string;
  targetRange: TargetRange;
  expectedEffort: { rir: number; text: string };
  checkCriterion: ProgressionCheckCriterion;
}

export interface ProgressionAssessment {
  model_version: string;
  inputSources: { runId: string; source: string; version: string }[];
  exerciseId: string;
  inputSessionIds: string[];
  series: E1RMPoint[];
  trend: TheilSenTrend | null;
  plateau: PlateauAssessment;
  cusum: CusumAnalysis | null;
  verdict: ProgressionVerdict;
  suggestion: ProgressionSuggestion | null;
  reason: string;
}

function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeSuggestion(
  verdict: Exclude<ProgressionVerdict, 'not_assessable'>,
  reason: string,
  series: E1RMPoint[],
  trend: TheilSenTrend,
  options: ProgressionOptions,
): ProgressionSuggestion {
  const targetReps = Math.min(
    30,
    Math.max(1, Math.round(finite(options.targetReps) ? options.targetReps : 5)),
  );
  const targetRir = Math.min(
    5,
    Math.max(0, finite(options.targetRir) ? options.targetRir : 2),
  );
  const nextAt =
    finite(options.nextSessionAt) && options.nextSessionAt >= trend.lastAt
      ? options.nextSessionAt
      : trend.lastAt;
  const estimatedE1RM = Math.max(0.01, trend.predictAt(nextAt));
  const targetPercentOfE1RM =
    1 / (1 + (targetReps + targetRir) / 30);
  const freshness = finite(options.regionFreshness)
    ? Math.min(100, Math.max(0, options.regionFreshness as number))
    : null;
  const freshnessFactor =
    freshness === null ? 1 : 0.92 + 0.08 * (freshness / 100);
  const rawTarget = estimatedE1RM * targetPercentOfE1RM * freshnessFactor;
  const previous = series[series.length - 1].weightKg;
  const lowerCap = previous * 0.95;
  const upperCap = previous * 1.05;
  const targetKg = Math.min(upperCap, Math.max(lowerCap, rawTarget));
  const stepCapApplied = Math.abs(targetKg - rawTarget) > 0.000001;
  const minKg = Math.min(targetKg, Math.max(lowerCap, targetKg * 0.975));
  const maxKg = Math.max(targetKg, Math.min(upperCap, targetKg * 1.025));
  const freshnessText =
    freshness === null
      ? 'Die Frische ist unbekannt; deshalb wird keine Frischemodulation behauptet.'
      : `Die Frischemodulation bleibt mit ${(freshnessFactor * 100 - 100).toFixed(1)} % unter der 8-%-Grenze.`;
  return {
    kind: 'strength_load',
    verdict,
    reason: `${reason} ${freshnessText}`,
    targetRange: {
      minKg: roundWeight(minKg),
      targetKg: roundWeight(targetKg),
      maxKg: roundWeight(maxKg),
      reps: targetReps,
      targetPercentOfE1RM,
      estimatedE1RM,
      freshnessFactor,
      stepCapApplied,
    },
    expectedEffort: {
      rir: targetRir,
      text: `Ziel sind etwa ${targetRir} Wiederholungen im Tank (RIR); die Ausführung bleibt maßgeblich.`,
    },
    checkCriterion: {
      method: 'strength-e1rm-v1',
      baselineSessionIds: series.slice(-3).map(point => point.sessionId),
      outcome: 'bestes Arbeits-e1RM',
      minimumRelevantChangePercent: 2,
      reviewAfterSessions: 3,
      check:
        'Nach drei vergleichbaren abgeschlossenen Einheiten prüfen, ob mindestens zwei beste Arbeits-e1RM den Zielbereich erreichen und die Ausführung beurteilbar bleibt.',
    },
  };
}

/** Eine Entscheidung für genau ein Arbeitsthema: die Last dieser Übung. */
export function assessExerciseProgression(
  sessions: StrengthSession[],
  exerciseId: string,
  options: ProgressionOptions = {},
): ProgressionAssessment {
  const series = buildE1RMSeries(sessions, exerciseId);
  const inputSessionIds = series.map(point => point.sessionId);
  const inputSources = series.map(point => {
    const source = sessions.find(session => session.id === point.sessionId);
    return {
      runId: point.sessionId,
      source: 'strength-session',
      version: source?.modelVersion ?? 'unknown',
    };
  });
  const emptyPlateau = assessPlateau(series, null);
  if (series.length < 3) {
    return {
      model_version: PROGRESSION_MODEL_VERSION,
      inputSources,
      exerciseId,
      inputSessionIds,
      series,
      trend: null,
      plateau: emptyPlateau,
      cusum: null,
      verdict: 'not_assessable',
      suggestion: null,
      reason:
        'Noch nicht ausreichend beurteilbar: Für einen robusten Verlauf fehlen mindestens drei abgeschlossene Einheiten mit einem Arbeits-e1RM.',
    };
  }
  const trend = theilSenSlope(series, options.confidenceLevel);
  if (!trend) {
    return {
      model_version: PROGRESSION_MODEL_VERSION,
      inputSources,
      exerciseId,
      inputSessionIds,
      series,
      trend: null,
      plateau: emptyPlateau,
      cusum: null,
      verdict: 'not_assessable',
      suggestion: null,
      reason:
        'Noch nicht ausreichend beurteilbar: Die Zeitabstände ergeben keine belastbare Rangschätzung.',
    };
  }
  const plateau = assessPlateau(series, trend);
  const cusum = detectCusumChangePoints(series, trend);
  const verdict: Exclude<ProgressionVerdict, 'not_assessable'> =
    trend.confidenceInterval.lower > 0
      ? 'increase'
      : trend.confidenceInterval.upper < 0
      ? 'reduce'
      : plateau.isPlateau
      ? 'plateau'
      : 'keep_going';
  const reason =
    verdict === 'increase'
      ? 'Das rangbasierte Steigungsintervall liegt oberhalb von 0; eine kleine Steigerung ist als einzelner, prüfbarer Schritt begründet.'
      : verdict === 'reduce'
      ? 'Das rangbasierte Steigungsintervall liegt unterhalb von 0; die Last wird für den nächsten prüfbaren Schritt vorsichtig reduziert.'
      : verdict === 'plateau'
      ? 'Das rangbasierte Steigungsintervall enthält 0 über mindestens vier Wochen. Das ist ein Plateau, nicht bloß eine Folge von drei unveränderten Einheiten.'
      : 'Das Steigungsintervall enthält 0, ohne das Vier-Wochen-Kriterium für ein Plateau zu erfüllen. So weitermachen ist deshalb eine eigenständige Entscheidung.';
  return {
    model_version: PROGRESSION_MODEL_VERSION,
    inputSources,
    exerciseId,
    inputSessionIds,
    series,
    trend,
    plateau,
    cusum,
    verdict,
    suggestion: makeSuggestion(verdict, reason, series, trend, options),
    reason,
  };
}

export function suggestNextSession(
  series: E1RMPoint[],
  trend: TheilSenTrend,
  verdict: Exclude<ProgressionVerdict, 'not_assessable'>,
  options: ProgressionOptions = {},
): ProgressionSuggestion {
  const reason =
    verdict === 'increase'
      ? 'Die robuste Steigung spricht für eine kleine Steigerung.'
      : verdict === 'reduce'
      ? 'Die robuste Steigung spricht für eine vorsichtige Reduktion.'
      : verdict === 'plateau'
      ? 'Das Steigungsintervall enthält 0 über mindestens vier Wochen.'
      : 'Die Unsicherheit trägt aktuell keine neue getestete Änderung; so weitermachen.';
  return makeSuggestion(verdict, reason, series, trend, options);
}

export const e1rmSeries = buildE1RMSeries;
export const estimateTheilSenTrend = theilSenSlope;
export const detectPlateau = assessPlateau;
export const progressionForExercise = assessExerciseProgression;
