import { exactLowerRank, finite, median, robustScale } from './inference';
import { epley1RM, type LoggedSet, type StrengthSession } from './strength';

/**
 * v2: exakte Kendall-Verteilung statt Normalapproximation bei kleinem n,
 * Richtungsaussage erst ab fünf Trainingstagen, Plateau als Äquivalenzprüfung,
 * Relevanzschwelle 4 % statt 2 % (Test-Retest-Streuung von 1RM ≈ 2–3 %).
 */
export const PROGRESSION_MODEL_VERSION = 'strength-progression-v2';
export const PROGRESSION_CHECK_METHOD = 'strength-e1rm-v2';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const PLATEAU_MS = 4 * WEEK_MS;
/** Unter fünf Tagen ist selbst eine perfekt monotone Reihe zu häufig Zufall. */
export const MINIMUM_SESSIONS_FOR_DIRECTION = 5;
/** Kleinste Änderung des e1RM, die über der Tagesform liegt (Setzung). */
export const MINIMUM_RELEVANT_CHANGE_PERCENT = 4;
/** „Stabil“ heißt: die Wochensteigung liegt sicher innerhalb ± dieses Anteils. */
export const PLATEAU_EQUIVALENCE_PERCENT_PER_WEEK = 0.5;
/** Bis hierhin wird die exakte Verteilung gerechnet, darüber die Näherung. */
const EXACT_DISTRIBUTION_MAX_POINTS = 12;

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
    const weightKg = set.actualWeightKg;
    const reps = set.actualReps;
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
    (set.planned.kind === 'normal' || set.planned.kind === 'failure') &&
    set.planned.loadKind === 'kg' &&
    finite(set.actualWeightKg) &&
    finite(set.actualReps)
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
  /** true: exakte Permutationsverteilung; false: Normalnäherung (n > 12). */
  exact: boolean;
}

/**
 * Rangbasierte Schranke für dieselben paarweisen Steigungen wie Theil-Sen.
 * Bis zwölf Punkten exakt über die Verteilung der Inversionen; darüber die
 * Normalnäherung nach Gilbert (1987) mit Bindungskorrektur. Kein Ergebnis,
 * wenn n das gewünschte Niveau nicht tragen kann – das ist kein Fehler.
 */
export function rankConfidenceInterval(
  slopes: number[],
  observations: number,
  confidenceLevel = 0.95,
  tieGroupSizes: number[] = [],
): RankConfidenceInterval | null {
  const finiteSlopes = slopes.filter(finite).sort((a, b) => a - b);
  const expectedPairs = (observations * (observations - 1)) / 2;
  if (
    !finiteSlopes.length ||
    observations < 2 ||
    finiteSlopes.length !== expectedPairs
  ) {
    return null;
  }
  const confidence = Math.min(
    0.999,
    Math.max(0.5, finite(confidenceLevel) ? confidenceLevel : 0.95),
  );
  const alpha = (1 - confidence) / 2;
  const n = finiteSlopes.length;
  if (observations <= EXACT_DISTRIBUTION_MAX_POINTS) {
    const lowerRank = exactLowerRank(observations, alpha);
    if (lowerRank === null) {
      return null;
    }
    const upperRank = n - 1 - lowerRank;
    return {
      lower: finiteSlopes[lowerRank],
      upper: finiteSlopes[upperRank],
      confidenceLevel: confidence,
      lowerRank,
      upperRank,
      exact: true,
    };
  }
  const z =
    confidence >= 0.985
      ? 2.326
      : confidence >= 0.94
      ? 1.96
      : confidence >= 0.89
      ? 1.645
      : 1.282;
  const tieTerm = tieGroupSizes
    .filter(size => size > 1)
    .reduce((sum, size) => sum + size * (size - 1) * (2 * size + 5), 0);
  const variance =
    (observations * (observations - 1) * (2 * observations + 5) - tieTerm) / 18;
  const rankHalfWidth = z * Math.sqrt(Math.max(0, variance));
  // Gilbert: M1 = (N − C)/2 ist ein 1-basierter Rang, hier 0-basiert.
  const lowerRank = Math.max(
    0,
    Math.min(n - 1, Math.floor((n - rankHalfWidth) / 2) - 1),
  );
  const upperRank = Math.max(
    lowerRank,
    Math.min(n - 1, Math.ceil((n + rankHalfWidth) / 2)),
  );
  return {
    lower: finiteSlopes[lowerRank],
    upper: finiteSlopes[upperRank],
    confidenceLevel: confidence,
    lowerRank,
    upperRank,
    exact: false,
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

/** Zwei Einheiten am selben Tag sind ein Beobachtungstag; die bessere zählt. */
export function collapseToDays(series: E1RMPoint[]): E1RMPoint[] {
  const byDay = new Map<number, E1RMPoint>();
  for (const point of series) {
    if (!finite(point.at) || !finite(point.e1rm)) {
      continue;
    }
    const day = Math.floor(point.at / DAY_MS);
    const existing = byDay.get(day);
    if (!existing || point.e1rm > existing.e1rm) {
      byDay.set(day, point);
    }
  }
  return [...byDay.values()].sort(
    (a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId),
  );
}

/** Theil-Sen-Schätzung mit Zeitachse in Wochen ab dem ersten Punkt. */
export function theilSenSlope(
  series: E1RMPoint[],
  confidenceLevel = 0.95,
): TheilSenTrend | null {
  const points = collapseToDays(series);
  if (points.length < 2) {
    return null;
  }
  const firstAt = points[0].at;
  const x = (at: number) => (at - firstAt) / WEEK_MS;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const deltaX = x(points[j].at) - x(points[i].at);
      slopes.push((points[j].e1rm - points[i].e1rm) / deltaX);
    }
  }
  const tieGroups = new Map<number, number>();
  for (const point of points) {
    tieGroups.set(point.e1rm, (tieGroups.get(point.e1rm) ?? 0) + 1);
  }
  const confidenceInterval = rankConfidenceInterval(
    slopes,
    points.length,
    confidenceLevel,
    [...tieGroups.values()],
  );
  if (!confidenceInterval) {
    return null;
  }
  const slopePerWeek = median(slopes);
  const intercept = median(
    points.map(point => point.e1rm - slopePerWeek * x(point.at)),
  );
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
      minimumConsecutive: Math.max(
        2,
        Math.floor(options.minimumConsecutive ?? 2),
      ),
    };
  }
  // MAD der Residuen selbst (nicht der Beträge): sonst halbiert sich σ.
  const baseline = Math.max(
    0.5,
    median(points.map(point => point.e1rm)) * 0.005,
  );
  const scale = Math.max(
    baseline,
    robustScale(residuals.map(item => item.residual)),
  );
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

export type PlateauStatus = 'changing' | 'stable' | 'unclear';

export interface PlateauAssessment {
  /** true nur bei `status === 'stable'`; „Intervall enthält 0“ reicht nicht. */
  isPlateau: boolean;
  status: PlateauStatus;
  spanWeeks: number;
  /** Zulässige Wochensteigung in kg, innerhalb derer „stabil“ gilt. */
  equivalenceMarginKgPerWeek: number | null;
  criterion: string;
}

/**
 * Äquivalenzprüfung statt „kein Nachweis“: Stabil heißt, das gesamte
 * Steigungsintervall liegt innerhalb ± Marge. Ein breites Intervall um 0
 * ist „noch nicht klar“, kein Plateau.
 */
export function assessPlateau(
  series: E1RMPoint[],
  trend: TheilSenTrend | null,
): PlateauAssessment {
  const points = collapseToDays(series);
  const spanWeeks =
    points.length > 1
      ? (points[points.length - 1].at - points[0].at) / WEEK_MS
      : 0;
  const margin =
    points.length > 0
      ? (median(points.map(point => point.e1rm)) *
          PLATEAU_EQUIVALENCE_PERCENT_PER_WEEK) /
        100
      : null;
  const criterion =
    'Stabil bedeutet: das Steigungsintervall liegt vollständig innerhalb ±0,5 % des e1RM pro Woche und umfasst mindestens vier Wochen. Ein breites Intervall um 0 heißt nur „noch nicht klar“.';
  if (!trend || margin === null) {
    return {
      isPlateau: false,
      status: 'unclear',
      spanWeeks,
      equivalenceMarginKgPerWeek: margin,
      criterion,
    };
  }
  const { lower, upper } = trend.confidenceInterval;
  const status: PlateauStatus =
    lower > 0 || upper < 0
      ? 'changing'
      : spanWeeks * WEEK_MS >= PLATEAU_MS && lower >= -margin && upper <= margin
      ? 'stable'
      : 'unclear';
  return {
    isPlateau: status === 'stable',
    status,
    spanWeeks,
    equivalenceMarginKgPerWeek: margin,
    criterion,
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
  method: typeof PROGRESSION_CHECK_METHOD;
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
    Math.max(
      1,
      Math.round(finite(options.targetReps) ? options.targetReps : 5),
    ),
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
  const targetPercentOfE1RM = 1 / (1 + (targetReps + targetRir) / 30);
  const freshness = finite(options.regionFreshness)
    ? Math.min(100, Math.max(0, options.regionFreshness as number))
    : null;
  const freshnessFactor =
    freshness === null ? 1 : 0.92 + 0.08 * (freshness / 100);
  const rawTarget = estimatedE1RM * targetPercentOfE1RM * freshnessFactor;
  const previous = series[series.length - 1].weightKg;
  const lowerCap = previous * 0.95;
  const upperCap = previous * 1.05;
  // The verdict and the suggested target must point in the same direction.
  // Freshness can therefore hold an increase at the previous load, but it can
  // never turn an increase into an unlabelled reduction (or vice versa).
  const directionalTarget =
    verdict === 'increase'
      ? Math.max(previous, rawTarget)
      : verdict === 'reduce'
      ? Math.min(previous, rawTarget)
      : rawTarget;
  const targetKg = Math.min(upperCap, Math.max(lowerCap, directionalTarget));
  const stepCapApplied = Math.abs(targetKg - rawTarget) > 0.000001;
  const minKg =
    verdict === 'increase'
      ? Math.max(previous, Math.max(lowerCap, targetKg * 0.975))
      : Math.min(targetKg, Math.max(lowerCap, targetKg * 0.975));
  const maxKg =
    verdict === 'reduce'
      ? Math.min(
          previous,
          Math.max(targetKg, Math.min(upperCap, targetKg * 1.025)),
        )
      : Math.max(targetKg, Math.min(upperCap, targetKg * 1.025));
  const freshnessText =
    freshness === null
      ? 'Die Frische ist unbekannt; deshalb wird keine Frischemodulation behauptet.'
      : `Die Frischemodulation bleibt mit ${(
          freshnessFactor * 100 -
          100
        ).toFixed(1)} % unter der 8-%-Grenze.`;
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
      method: PROGRESSION_CHECK_METHOD,
      baselineSessionIds: series.slice(-3).map(point => point.sessionId),
      outcome: 'bestes Arbeits-e1RM',
      minimumRelevantChangePercent: MINIMUM_RELEVANT_CHANGE_PERCENT,
      reviewAfterSessions: 3,
      check:
        'Ab sechs umgesetzten Einheiten per Vorzeichentest prüfen, ob das beste Arbeits-e1RM häufiger als zufällig mindestens 4 % über dem Median der Vergleichseinheiten liegt; die Ausführung bleibt maßgeblich.',
    },
  };
}

/** Eine Entscheidung für genau eine Empfehlung: die Last dieser Übung. */
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
  const days = collapseToDays(series).length;
  if (days < MINIMUM_SESSIONS_FOR_DIRECTION) {
    const missing = MINIMUM_SESSIONS_FOR_DIRECTION - days;
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
      reason: `Noch nicht klar: Erst ab ${MINIMUM_SESSIONS_FOR_DIRECTION} Trainingstagen mit geeigneten Arbeitssätzen trägt der Verlauf eine Richtung; es ${
        missing === 1 ? 'fehlt noch einer' : `fehlen noch ${missing}`
      }.`,
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
        'Noch nicht klar: Aus diesen Einheiten lässt sich kein Steigungsintervall auf dem gewählten Niveau bilden.',
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
      ? 'Dein Leistungsverlauf spricht für eine kleine Steigerung. Probiere sie aus und prüfe, wie die nächsten Einheiten laufen.'
      : verdict === 'reduce'
      ? 'Dein Leistungsverlauf fällt ab. Die Empfehlung ist, etwas weniger Gewicht auszuprobieren.'
      : verdict === 'plateau'
      ? 'Seit mindestens vier Wochen ist deine Leistung nachweislich stabil; das Steigungsintervall liegt eng um null.'
      : 'Noch nicht klar: Der Verlauf lässt sowohl eine Änderung als auch Stillstand zu. Behalte dein Training vorerst bei.';
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
      ? 'Dein Leistungsverlauf spricht dafür, etwas mehr Gewicht auszuprobieren.'
      : verdict === 'reduce'
      ? 'Dein Leistungsverlauf spricht dafür, etwas weniger Gewicht auszuprobieren.'
      : verdict === 'plateau'
      ? 'Seit mindestens vier Wochen ist deine Leistung nachweislich stabil.'
      : 'Für eine neue Empfehlung ist der Verlauf noch zu unklar. Behalte dein Training vorerst bei.';
  return makeSuggestion(verdict, reason, series, trend, options);
}

export const e1rmSeries = buildE1RMSeries;
export const estimateTheilSenTrend = theilSenSlope;
export const detectPlateau = assessPlateau;
export const progressionForExercise = assessExerciseProgression;
