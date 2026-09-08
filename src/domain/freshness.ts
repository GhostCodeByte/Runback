import type { RunSummary, SegmentAggregate } from './types';
import {
  allRegionIds,
  regionDefinition,
  regionId,
  REGIONS,
  REGIONS_VERSION,
  type RegionBase,
  type RegionId,
  type Side,
} from './regions';
import {
  CATALOG_VERSION,
  epley1RM,
  type Exercise,
  type LoggedSet,
  type StrengthSession,
} from './strength';
import { catalogExercise } from './catalog';

/**
 * Versionierte Ausgangsannahmen des Muskelmodells.
 *
 * Alle Zahlen aus der Parameterübersicht der Spezifikation liegen hier an
 * einer Stelle. Die zusätzlichen Werte machen numerische Randfälle und die
 * noch nicht im Katalog hinterlegten Startannahmen sichtbar.
 */
export const MUSCLE_MODEL_CONSTANTS = Object.freeze({
  modelVersion: 'muscle-model-v1',
  effectiveRepLambda: 4,
  relativeLoadGamma: 1,
  fastRiseHours: 0.5,
  fastDecayHours: 10,
  slowRiseHours: 12,
  slowDecayHours: 60,
  betaFast: 0.4,
  betaSlow: 0.6,
  downhillFactor: 12,
  uphillFactor: 8,
  referenceSpeedMps: 3,
  regularizationLambda: 1,
  processNoiseQ: 0.01,
  defaultCapacity: 10,
  uncertaintyThresholdFreshnessPoints: 15,
  modelHorizonDays: 7,
  posteriorCorrelationThreshold: 0.9,
  isometricReferenceSeconds: 12,
  bodyweightCatalogKg: 75,
  defaultBodyweightFraction: 1,
  pushUpBodyweightFraction: 0.65,
  runCoefficientCalfGastroc: 12,
  runCoefficientCalfSoleus: 12,
  runCoefficientQuad: 8,
  runCoefficientHamstring: 6,
  runCoefficientGlute: 5,
  runCoefficientTibialis: 6,
  runReferenceHardCalfSets: 3,
  calibrationHuberDelta: 2,
  calibrationMeasurementVariance: 1,
  calibrationPriorVariance: 1,
  calibrationBins: 5,
  calibrationMeanGapPoints: 2,
  calibrationMaxIterations: 120,
  calibrationRobustPasses: 8,
  calibrationConvergence: 0.0000001,
  sorenessLogFloor: 0.000001,
  stabilityMaxShiftPoints: 15,
  timePeakToleranceHours: 36,
  timeCheckStepHours: 0.25,
  e1rmLookbackWeeks: 8,
  maxEpleyRepetitions: 30,
} as const);

export const MUSCLE_MODEL_VERSION = MUSCLE_MODEL_CONSTANTS.modelVersion;

/** Eine einzelne Meldung mit einer Skala von 0 bis 10. */
export interface SorenessReport {
  at: number;
  regionId: string;
  value: number;
  note?: string;
  kind?: 'soreness';
}

/** Explizite Meldung, dass heute keine Region gemeldet wird. */
export interface NothingTodayReport {
  kind: 'nothing_today';
  at: number;
  note?: string;
}

export type MuscleReport = SorenessReport | NothingTodayReport;

/** Provenienz, die jede Ableitung des Modells mitführt. */
export interface MuscleModelProvenance {
  model_version: string;
  regions_version: string;
  catalog_version: string;
  contributing_sessions: string[];
  contributing_reports: MuscleReport[];
}

export interface TimeConstants {
  fastRiseHours: number;
  fastDecayHours: number;
  slowRiseHours: number;
  slowDecayHours: number;
  betaFast: number;
  betaSlow: number;
}

export interface MuscleModelState {
  modelVersion?: string;
  coefficients?: Record<string, number>;
  priors?: Record<string, number>;
  posteriorVariance?: Record<string, number>;
  covariance?: Record<string, Record<string, number>>;
  capacities?: Partial<Record<RegionBase | RegionId, number>>;
  timeConstants?: TimeConstants;
}

export interface SetStimulusOptions {
  e1rmEstimate?: number;
  recentSessions?: StrengthSession[];
  at?: number;
  bodyweightKg?: number;
  bodyweightByExercise?: Record<string, number>;
  bodyweightFractionByExercise?: Record<string, number>;
  unilateralSide?: Side;
  sessionId?: string;
  reports?: MuscleReport[];
}

export interface StimulusUncertainty {
  standardDeviation: number;
  reasons: string[];
}

export interface SetStimulusResult extends MuscleModelProvenance {
  kind: 'set_stimulus';
  exerciseId: string;
  sessionId?: string;
  setId?: string;
  e1rmEstimate: number | null;
  relativeLoad: number | null;
  rir: number | null;
  effectiveReps: number | null;
  stimulus: number | null;
  nEff: number | null;
  L: number | null;
  RIR: number | null;
  s: number | null;
  uncertainty: StimulusUncertainty;
  valid: boolean;
  reason?: string;
}

export interface StrengthStimulusContribution extends MuscleModelProvenance {
  kind: 'strength_contribution';
  sessionId: string;
  setId: string;
  exerciseId: string;
  regionId: RegionId;
  baseRegion: RegionBase;
  at: number;
  baseStimulus: number;
  share: number;
  stimulus: number;
  source: 'strength';
  exerciseOrigin: Exercise['origin'];
  catalogReliable: boolean;
  uncertainty: StimulusUncertainty;
}

export interface StrengthStimulusOptions extends SetStimulusOptions {
  exercises?: Exercise[];
  exerciseById?: Record<string, Exercise>;
  unilateralSides?: Record<string, Side>;
}

export interface RunSegmentStimulusOptions {
  at?: number;
  runId?: string;
  sourceVersion?: string;
  coefficients?: Partial<Record<RegionBase, number>>;
}

export interface RunSegmentStimulusResult extends MuscleModelProvenance {
  kind: 'run_segment_stimulus';
  segmentId: string;
  at: number;
  speedMps: number | null;
  durationHours: number | null;
  stimulusByRegion: Partial<Record<RegionId, number>>;
  uncertainty: StimulusUncertainty;
  valid: boolean;
  reason?: string;
}

export interface RunStimulusContribution extends MuscleModelProvenance {
  kind: 'run_contribution';
  runId: string;
  segmentId: string;
  regionId: RegionId;
  baseRegion: RegionBase;
  at: number;
  stimulus: number;
  source: 'run';
  catalogReliable: true;
  uncertainty: StimulusUncertainty;
}

export type RegionalStimulusContribution =
  | StrengthStimulusContribution
  | RunStimulusContribution;

export interface FreshnessUncertainty {
  standardDeviationPoints: number;
  lowerPoints: number;
  upperPoints: number;
  reasons: string[];
}

export type FreshnessUnknownReason =
  | 'no_reliable_shares'
  | 'uncertainty_too_high'
  | 'outside_horizon_without_report'
  | 'missing_reports'
  | 'invalid_input';

export interface KnownFreshness extends MuscleModelProvenance {
  kind: 'freshness';
  regionId: RegionId;
  at: number;
  value: number;
  residualLoad: number;
  sorenessPrediction: number;
  uncertainty: FreshnessUncertainty;
  isPrediction: boolean;
  assumptions: string[];
  contributing: RegionalStimulusContribution[];
}

export interface UnknownFreshness extends MuscleModelProvenance {
  kind: 'unknown';
  regionId: RegionId;
  at: number;
  value: null;
  residualLoad: number | null;
  sorenessPrediction: null;
  uncertainty: FreshnessUncertainty;
  isPrediction: boolean;
  reasonCode: FreshnessUnknownReason;
  reason: string;
  contributing: RegionalStimulusContribution[];
}

export type RegionFreshness = KnownFreshness | UnknownFreshness;

export interface FreshnessInput {
  at: number;
  sessions: StrengthSession[];
  reports: MuscleReport[];
  runs?: RunSummary[];
  exercises?: Exercise[];
  exerciseById?: Record<string, Exercise>;
  unilateralSides?: Record<string, Side>;
  bodyweightKg?: number;
  bodyweightByExercise?: Record<string, number>;
  bodyweightFractionByExercise?: Record<string, number>;
  state?: MuscleModelState;
  capacities?: Partial<Record<RegionBase | RegionId, number>>;
}

export interface FreshnessSnapshot extends MuscleModelProvenance {
  kind: 'freshness_snapshot' | 'freshness_prediction';
  at: number;
  isPrediction: boolean;
  regions: Record<RegionId, RegionFreshness>;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonNegativeFinite = (value: unknown): value is number =>
  finite(value) && value >= 0;

export function isNothingTodayReport(
  report: MuscleReport,
): report is NothingTodayReport {
  return report.kind === 'nothing_today';
}

/** Prüft eine Meldung, ohne ungültige Werte still zu verändern. */
export function isValidMuscleReport(report: MuscleReport): boolean {
  if (!finite(report.at) || report.at < 0) {
    return false;
  }
  if (isNothingTodayReport(report)) {
    return true;
  }
  return (
    typeof report.regionId === 'string' &&
    report.regionId.length > 0 &&
    finite(report.value) &&
    report.value >= 0 &&
    report.value <= 10
  );
}

/** Erzeugt eine explizite, deterministische „heute nichts“-Meldung. */
export function nothingTodayReport(at: number, note?: string): NothingTodayReport {
  return note === undefined
    ? { kind: 'nothing_today', at }
    : { kind: 'nothing_today', at, note };
}

const provenance = (
  sessions: string[] = [],
  reports: MuscleReport[] = [],
): MuscleModelProvenance => ({
  model_version: MUSCLE_MODEL_VERSION,
  regions_version: REGIONS_VERSION,
  catalog_version: CATALOG_VERSION,
  contributing_sessions: Array.from(new Set(sessions)).sort(),
  contributing_reports: reports.filter(isValidMuscleReport).map(report => ({
    ...report,
  })),
});

const segmentIdentifier = (segment: SegmentAggregate, index: number): string =>
  segment.id ?? `split-${index + 1}`;

const baseRegionFromId = (id: string): RegionBase | null => {
  const match = /^(.*?)(?:_(?:l|r))?$/.exec(id);
  const base = match?.[1];
  if (!base || !REGIONS.some(region => region.base === base)) {
    return null;
  }
  return base as RegionBase;
};

const isSided = (base: RegionBase): boolean => regionDefinition(base).sided;

const capacityFor = (
  id: RegionId,
  capacities: Partial<Record<RegionBase | RegionId, number>> | undefined,
): number => {
  const base = baseRegionFromId(id);
  const selected = capacities?.[id] ?? (base ? capacities?.[base] : undefined);
  return nonNegativeFinite(selected) && selected > 0
    ? selected
    : MUSCLE_MODEL_CONSTANTS.defaultCapacity;
};

const defaultTimeConstants = (): TimeConstants => ({
  fastRiseHours: MUSCLE_MODEL_CONSTANTS.fastRiseHours,
  fastDecayHours: MUSCLE_MODEL_CONSTANTS.fastDecayHours,
  slowRiseHours: MUSCLE_MODEL_CONSTANTS.slowRiseHours,
  slowDecayHours: MUSCLE_MODEL_CONSTANTS.slowDecayHours,
  betaFast: MUSCLE_MODEL_CONSTANTS.betaFast,
  betaSlow: MUSCLE_MODEL_CONSTANTS.betaSlow,
});

const bodyweightFraction = (
  exercise: Exercise,
  options: SetStimulusOptions,
): number => {
  const selected = options.bodyweightFractionByExercise?.[exercise.id];
  if (finite(selected) && selected > 0) {
    return selected;
  }
  if (exercise.id === 'push_up') {
    return MUSCLE_MODEL_CONSTANTS.pushUpBodyweightFraction;
  }
  return MUSCLE_MODEL_CONSTANTS.defaultBodyweightFraction;
};

interface SetLoad {
  weightKg: number | null;
  uncertain: boolean;
  reasons: string[];
}

const setLoad = (set: LoggedSet, exercise: Exercise, options: SetStimulusOptions): SetLoad => {
  const raw = set.actualWeightKg ?? set.planned.weightKg;
  const loadKind = set.planned.loadKind;
  const reasons: string[] = [];
  let uncertain = false;
  if (loadKind === 'kg') {
    return {
      weightKg: finite(raw) && raw > 0 ? raw : null,
      uncertain: false,
      reasons,
    };
  }
  const providedBodyweight =
    options.bodyweightByExercise?.[exercise.id] ?? options.bodyweightKg;
  const bodyweight =
    finite(providedBodyweight) && providedBodyweight > 0
      ? providedBodyweight
      : MUSCLE_MODEL_CONSTANTS.bodyweightCatalogKg;
  if (!(finite(providedBodyweight) && providedBodyweight > 0)) {
    uncertain = true;
    reasons.push('Körpergewicht fehlt; der Katalogwert wird verwendet.');
  }
  const movedBodyweight = bodyweight * bodyweightFraction(exercise, options);
  if (loadKind === 'bodyweight') {
    return { weightKg: movedBodyweight, uncertain, reasons };
  }
  if (loadKind === 'assisted') {
    if (!finite(raw) || raw < 0 || raw >= movedBodyweight) {
      return {
        weightKg: null,
        uncertain,
        reasons: [...reasons, 'Unterstützung oder Körpergewicht ist ungültig.'],
      };
    }
    return { weightKg: movedBodyweight - raw, uncertain, reasons };
  }
  if (!finite(raw) || raw < 0) {
    return { weightKg: null, uncertain, reasons };
  }
  return { weightKg: movedBodyweight + raw, uncertain, reasons };
};

/** Geschätztes Einwiederholungsmaximum mit der im Projekt vorhandenen Epley-Funktion. */
export function estimateE1RM(weightKg: number, repetitions: number): number | null {
  return epley1RM(weightKg, repetitions);
}

/** Bester beobachteter Epley-Wert innerhalb der letzten acht Wochen. */
export function bestExerciseE1RM(
  exerciseId: string,
  sessions: StrengthSession[],
  at: number,
): number | null {
  const eightWeeksMs =
    MUSCLE_MODEL_CONSTANTS.e1rmLookbackWeeks * 7 * 24 * 60 * 60 * 1000;
  let best: number | null = null;
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      if (exercise.exerciseId !== exerciseId) {
        continue;
      }
      for (const set of exercise.sets) {
        if (
          set.skipped ||
          set.completedAt === undefined ||
          set.completedAt < at - eightWeeksMs ||
          set.completedAt > at
        ) {
          continue;
        }
        const weight = set.actualWeightKg ?? set.planned.weightKg;
        const repetitions = set.actualReps ?? set.planned.reps;
        if (!finite(weight) || !finite(repetitions)) {
          continue;
        }
        const estimate = epley1RM(weight, repetitions);
        if (estimate !== null && (best === null || estimate > best)) {
          best = estimate;
        }
      }
    }
  }
  return best;
}

/** Summe der effektiven Wiederholungen nach der dokumentierten Exponentialform. */
export function effectiveRepetitions(repetitions: number, rir: number): number {
  if (!(repetitions > 0) || !(rir >= 0)) {
    return 0;
  }
  let result = 0;
  for (let index = 1; index <= Math.floor(repetitions); index += 1) {
    result += Math.exp(
      -(rir + Math.floor(repetitions) - index) /
        MUSCLE_MODEL_CONSTANTS.effectiveRepLambda,
    );
  }
  return result;
}

/** Effektive Wiederholungen für einen Zeit- oder Isometriesatz. */
export function effectiveRepetitionsFromSeconds(seconds: number): number {
  return finite(seconds) && seconds > 0
    ? seconds / MUSCLE_MODEL_CONSTANTS.isometricReferenceSeconds
    : 0;
}

/** Berechnet den Grundreiz eines einzelnen protokollierten Satzes. */
export function calculateSetStimulus(
  set: LoggedSet,
  exercise: Exercise,
  options: SetStimulusOptions = {},
): SetStimulusResult {
  const load = setLoad(set, exercise, options);
  const at = options.at ?? set.completedAt ?? 0;
  const provenanceValue = provenance(
    options.sessionId ? [options.sessionId] : [],
    options.reports ?? [],
  );
  const uncertaintyReasons = [...load.reasons];
  const timedSeconds = set.actualSeconds ?? set.planned.seconds;
  const repetitions = set.actualReps ?? set.planned.reps;
  const isTimed = set.planned.kind === 'timed' || finite(timedSeconds);
  const nEff = isTimed
    ? effectiveRepetitionsFromSeconds(timedSeconds ?? 0)
    : finite(repetitions)
      ? (() => {
          const estimate =
            options.e1rmEstimate ??
            (options.recentSessions
              ? bestExerciseE1RM(exercise.id, options.recentSessions, at)
              : null) ??
            (finite(load.weightKg) && finite(repetitions)
              ? epley1RM(load.weightKg, repetitions)
              : null);
          if (estimate === null || !finite(load.weightKg) || !(load.weightKg > 0)) {
            return 0;
          }
          const relative = Math.min(
            1,
            Math.max(0, load.weightKg / estimate),
          );
          const reserve =
            set.planned.kind === 'failure'
              ? 0
              : Math.max(
                  0,
                  30 * (1 / relative - 1) - repetitions,
                );
          return effectiveRepetitions(repetitions, reserve);
        })()
      : 0;
  const e1rm =
    finite(load.weightKg) && finite(repetitions)
      ? options.e1rmEstimate ??
        (options.recentSessions
          ? bestExerciseE1RM(exercise.id, options.recentSessions, at)
          : null) ??
        epley1RM(load.weightKg, repetitions)
      : null;
  const relativeLoad =
    finite(load.weightKg) && finite(e1rm) && e1rm > 0
      ? Math.min(1, Math.max(0, load.weightKg / e1rm))
      : isTimed && finite(load.weightKg)
        ? 1
        : null;
  const rir =
    relativeLoad !== null && finite(repetitions) && !isTimed
      ? set.planned.kind === 'failure'
        ? 0
        : Math.max(0, 30 * (1 / relativeLoad - 1) - repetitions)
      : null;
  if (isTimed && !(nEff > 0)) {
    uncertaintyReasons.push('Spannungsdauer fehlt oder ist ungültig.');
  }
  if (!isTimed && !(nEff > 0)) {
    uncertaintyReasons.push('Last oder Wiederholungen fehlen oder sind ungültig.');
  }
  if (exercise.origin !== 'catalog') {
    uncertaintyReasons.push('Eigene Übung: Anteile sind keine Katalogannahme.');
  }
  const stimulus =
    nEff > 0 && relativeLoad !== null
      ? nEff * relativeLoad ** MUSCLE_MODEL_CONSTANTS.relativeLoadGamma * exercise.eccentric
      : null;
  const standardDeviation =
    (load.uncertain ? 8 : 3) + (exercise.origin === 'catalog' ? 0 : 5);
  const valid = stimulus !== null && finite(stimulus) && stimulus >= 0;
  return {
    ...provenanceValue,
    kind: 'set_stimulus',
    exerciseId: exercise.id,
    sessionId: options.sessionId,
    setId: set.id,
    e1rmEstimate: e1rm,
    relativeLoad,
    rir,
    effectiveReps: nEff,
    stimulus,
    nEff,
    L: relativeLoad,
    RIR: rir,
    s: stimulus,
    uncertainty: {
      standardDeviation,
      reasons: Array.from(new Set(uncertaintyReasons)),
    },
    valid,
    reason: valid ? undefined : 'Satz kann nicht als Reiz berechnet werden.',
  };
}

/** Verteilt einen Reiz auf konkrete Regionen und Seiten. */
export function distributeStimulus(
  exercise: Exercise,
  stimulus: number,
  unilateralSide?: Side,
): Partial<Record<RegionId, number>> {
  const result: Partial<Record<RegionId, number>> = {};
  if (!finite(stimulus) || stimulus < 0) {
    return result;
  }
  for (const [baseValue, share] of Object.entries(exercise.shares)) {
    const base = baseValue as RegionBase;
    if (!finite(share) || share <= 0) {
      continue;
    }
    if (!isSided(base)) {
      result[regionId(base)] = stimulus * share;
      continue;
    }
    if (exercise.unilateral) {
      if (unilateralSide) {
        result[regionId(base, unilateralSide)] = stimulus * share;
      }
      continue;
    }
    result[regionId(base, 'l')] = stimulus * share / 2;
    result[regionId(base, 'r')] = stimulus * share / 2;
  }
  return result;
}

const resolveExercise = (
  exerciseId: string,
  options: StrengthStimulusOptions,
): Exercise | undefined => {
  const fromMap = options.exerciseById?.[exerciseId];
  if (fromMap) {
    return fromMap;
  }
  const fromList = options.exercises?.find(exercise => exercise.id === exerciseId);
  return fromList ?? catalogExercise(exerciseId);
};

const unilateralSideFor = (
  set: LoggedSet,
  exerciseId: string,
  options: StrengthStimulusOptions,
): Side | undefined => {
  const withSide = set as LoggedSet & { side?: Side };
  return (
    withSide.side ??
    options.unilateralSides?.[set.id] ??
    options.unilateralSides?.[exerciseId] ??
    options.unilateralSide
  );
};

/** Baut alle regionalen Beiträge einer Krafteinheit aus den protokollierten Sätzen. */
export function buildStrengthStimulusContributions(
  session: StrengthSession,
  options: StrengthStimulusOptions = {},
): StrengthStimulusContribution[] {
  const result: StrengthStimulusContribution[] = [];
  for (const sessionExercise of session.exercises) {
    const exercise = resolveExercise(sessionExercise.exerciseId, options);
    if (!exercise) {
      continue;
    }
    for (const set of sessionExercise.sets) {
      if (set.skipped || set.completedAt === undefined) {
        continue;
      }
      const calculated = calculateSetStimulus(set, exercise, {
        ...options,
        recentSessions: options.recentSessions ?? [session],
        at: set.completedAt,
        sessionId: session.id,
        unilateralSide: unilateralSideFor(set, exercise.id, options),
      });
      if (!calculated.valid || calculated.stimulus === null) {
        continue;
      }
      const distributed = distributeStimulus(
        exercise,
        calculated.stimulus,
        unilateralSideFor(set, exercise.id, options),
      );
      for (const [id, stimulus] of Object.entries(distributed)) {
        const region = baseRegionFromId(id);
        if (!region || !finite(stimulus) || stimulus <= 0) {
          continue;
        }
        const share =
          calculated.stimulus > 0 ? stimulus / calculated.stimulus : 0;
        result.push({
          ...provenance([session.id], options.reports ?? []),
          kind: 'strength_contribution',
          sessionId: session.id,
          setId: set.id,
          exerciseId: exercise.id,
          regionId: id,
          baseRegion: region,
          at: set.completedAt,
          baseStimulus: calculated.stimulus,
          share,
          stimulus,
          source: 'strength',
          exerciseOrigin: exercise.origin,
          catalogReliable: finiteShareSet(exercise),
          uncertainty: calculated.uncertainty,
        });
      }
    }
  }
  return result;
}

function finiteShareSet(exercise: Exercise): boolean {
  const entries = Object.entries(exercise.shares);
  return (
    entries.length > 0 &&
    entries.every(([base, share]) =>
      REGIONS.some(region => region.base === base) && finite(share) && share > 0,
    ) &&
    Math.abs(entries.reduce((sum, [, share]) => sum + (share ?? 0), 0) - 1) < 0.005
  );
}

const runCoefficients = (): Record<RegionBase, number> => ({
  neck: 0,
  trap_upper: 0,
  trap_mid: 0,
  rhomboid: 0,
  lat: 0,
  lower_back: 0,
  shoulder_front: 0,
  shoulder_side: 0,
  shoulder_rear: 0,
  chest_upper: 0,
  chest_mid: 0,
  biceps: 0,
  triceps: 0,
  forearm: 0,
  abs_upper: 0,
  abs_lower: 0,
  oblique: 0,
  hip_flexor: 0,
  adductor: 0,
  quad: MUSCLE_MODEL_CONSTANTS.runCoefficientQuad,
  hamstring: MUSCLE_MODEL_CONSTANTS.runCoefficientHamstring,
  glute: MUSCLE_MODEL_CONSTANTS.runCoefficientGlute,
  calf_gastroc: MUSCLE_MODEL_CONSTANTS.runCoefficientCalfGastroc,
  calf_soleus: MUSCLE_MODEL_CONSTANTS.runCoefficientCalfSoleus,
  tibialis: MUSCLE_MODEL_CONSTANTS.runCoefficientTibialis,
});

/** Berechnet den direkten Reiz eines Laufabschnitts nach §4. */
export function runSegmentStimulus(
  segment: SegmentAggregate,
  options: RunSegmentStimulusOptions = {},
): RunSegmentStimulusResult {
  const segmentId = segmentIdentifier(segment, 0);
  const at = options.at ?? 0;
  const provenanceValue = provenance(options.runId ? [options.runId] : []);
  const durationSeconds = segment.durationSeconds;
  const distanceMeters = segment.distanceMeters;
  const validTime = finite(durationSeconds) && durationSeconds > 0;
  const validDistance = finite(distanceMeters) && distanceMeters > 0;
  const speedMps = validTime && validDistance ? distanceMeters / durationSeconds : null;
  const coefficient = { ...runCoefficients(), ...options.coefficients };
  const uncertaintyReasons: string[] = [];
  if (segment.phase === 'pause') {
    uncertaintyReasons.push('Pausenabschnitt erzeugt keinen Reiz.');
  }
  if (!finite(segment.gradePercent)) {
    uncertaintyReasons.push('Steigung fehlt; ebene Strecke wird als Ausgangsannahme verwendet.');
  }
  if (speedMps === null || segment.phase === 'pause') {
    return {
      ...provenanceValue,
      kind: 'run_segment_stimulus',
      segmentId,
      at,
      speedMps,
      durationHours: validTime ? durationSeconds / 3600 : null,
      stimulusByRegion: {},
      uncertainty: {
        standardDeviation: speedMps === null ? 15 : 5,
        reasons: [...uncertaintyReasons, 'Dauer oder Distanz des Abschnitts ist ungültig.'],
      },
      valid: false,
      reason: 'Laufabschnitt kann nicht als Reiz berechnet werden.',
    };
  }
  const durationHours = durationSeconds / 3600;
  const speedRatio = speedMps / MUSCLE_MODEL_CONSTANTS.referenceSpeedMps;
  const grade = (segment.gradePercent ?? 0) / 100;
  const downhill = Math.max(0, -grade);
  const uphill = Math.max(0, grade);
  const baseStimulus: Partial<Record<RegionBase, number>> = {
    calf_gastroc: coefficient.calf_gastroc * durationHours * speedRatio ** 1.5,
    calf_soleus: coefficient.calf_soleus * durationHours * speedRatio ** 1.2,
    quad:
      coefficient.quad * durationHours * speedRatio ** 1.2 *
      (1 + MUSCLE_MODEL_CONSTANTS.downhillFactor * downhill),
    hamstring:
      coefficient.hamstring * durationHours * speedRatio ** 1.5 *
      (1 + MUSCLE_MODEL_CONSTANTS.uphillFactor * uphill),
    glute:
      coefficient.glute * durationHours * speedRatio ** 1.2 *
      (1 + MUSCLE_MODEL_CONSTANTS.uphillFactor * uphill),
    tibialis:
      coefficient.tibialis * durationHours * speedRatio ** 1.2 *
      (1 + MUSCLE_MODEL_CONSTANTS.downhillFactor * downhill),
  };
  const stimulusByRegion: Partial<Record<RegionId, number>> = {};
  for (const [baseValue, value] of Object.entries(baseStimulus)) {
    const base = baseValue as RegionBase;
    if (!finite(value) || value <= 0) {
      continue;
    }
    if (isSided(base)) {
      stimulusByRegion[regionId(base, 'l')] = value / 2;
      stimulusByRegion[regionId(base, 'r')] = value / 2;
    } else {
      stimulusByRegion[regionId(base)] = value;
    }
  }
  return {
    ...provenanceValue,
    kind: 'run_segment_stimulus',
    segmentId,
    at,
    speedMps,
    durationHours,
    stimulusByRegion,
    uncertainty: {
      standardDeviation: uncertaintyReasons.length ? 8 : 4,
      reasons: uncertaintyReasons,
    },
    valid: true,
  };
}

/** Baut Laufbeiträge für einen Lauf zusammen. */
export function buildRunStimulusContributions(
  run: RunSummary,
  coefficients?: Partial<Record<RegionBase, number>>,
): RunStimulusContribution[] {
  const result: RunStimulusContribution[] = [];
  for (const [index, segment] of (run.segments ?? []).entries()) {
    const calculated = runSegmentStimulus(segment, {
      at: run.startTime +
        (run.segments ?? [])
          .slice(0, index)
          .reduce((sum, previous) => sum + previous.durationSeconds * 1000, 0),
      runId: run.id,
      sourceVersion: segment.sourceVersion ?? run.sourceVersion,
      coefficients,
    });
    for (const [id, stimulus] of Object.entries(calculated.stimulusByRegion)) {
      const baseRegion = baseRegionFromId(id);
      if (!baseRegion || !finite(stimulus) || stimulus <= 0) {
        continue;
      }
      result.push({
        ...provenance([run.id]),
        kind: 'run_contribution',
        runId: run.id,
        segmentId: calculated.segmentId,
        regionId: id,
        baseRegion,
        at: calculated.at,
        stimulus,
        source: 'run',
        catalogReliable: true,
        uncertainty: calculated.uncertainty,
      });
    }
  }
  return result;
}

const normalisedImpulse = (hours: number, rise: number, decay: number): number => {
  if (!(hours >= 0) || !(rise > 0) || !(decay > rise)) {
    return 0;
  }
  const maximumAt = Math.log(decay / rise) / (1 / rise - 1 / decay);
  const peak = Math.exp(-maximumAt / decay) - Math.exp(-maximumAt / rise);
  return peak > 0
    ? (Math.exp(-hours / decay) - Math.exp(-hours / rise)) / peak
    : 0;
};

/** Normierte Differenz zweier Exponentialfunktionen aus §5.1. */
export function impulseResponse(
  hours: number,
  riseHours: number,
  decayHours: number,
): number {
  return normalisedImpulse(hours, riseHours, decayHours);
}

/** Kombinierte schnelle und langsame Impulsantwort. */
export function combinedImpulseResponse(
  hours: number,
  timeConstants: TimeConstants = defaultTimeConstants(),
): number {
  if (!(hours >= 0)) {
    return 0;
  }
  return (
    timeConstants.betaFast *
      normalisedImpulse(hours, timeConstants.fastRiseHours, timeConstants.fastDecayHours) +
    timeConstants.betaSlow *
      normalisedImpulse(hours, timeConstants.slowRiseHours, timeConstants.slowDecayHours)
  );
}

/** Stundenabstand, da alle Modellzeiten als Millisekunden übergeben werden. */
export function hoursSince(at: number, origin: number): number {
  return (at - origin) / (60 * 60 * 1000);
}

const coefficientKey = (exerciseId: string, baseRegion: RegionBase): string =>
  `${exerciseId}|${baseRegion}`;

const coefficientFromState = (
  contribution: StrengthStimulusContribution,
  state: MuscleModelState | undefined,
  exercises: Exercise[],
): { value: number; variance: number; source: 'personal' | 'similarity' | 'catalog' } => {
  const key = coefficientKey(contribution.exerciseId, contribution.baseRegion);
  const direct = state?.coefficients?.[key];
  if (nonNegativeFinite(direct)) {
    return {
      value: direct,
      variance: state?.posteriorVariance?.[key] ?? MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
      source: 'personal',
    };
  }
  const target = exercises.find(exercise => exercise.id === contribution.exerciseId);
  if (target) {
    const pooled = partialPoolCoefficient(target, contribution.baseRegion, state, exercises);
    if (pooled.source === 'similarity') {
      return pooled;
    }
  }
  return {
    value: 1,
    variance: MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
    source: 'catalog',
  };
};

/** Kosinusähnlichkeit der Kataloganteile zweier Übungen. */
export function cosineShareSimilarity(left: Exercise, right: Exercise): number {
  const bases = Array.from(
    new Set([...Object.keys(left.shares), ...Object.keys(right.shares)]),
  );
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const base of bases) {
    const leftValue = left.shares[base as RegionBase] ?? 0;
    const rightValue = right.shares[base as RegionBase] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return leftNorm > 0 && rightNorm > 0
    ? dot / Math.sqrt(leftNorm * rightNorm)
    : 0;
}

export interface PartialPoolResult {
  value: number;
  variance: number;
  source: 'similarity' | 'catalog';
  similarity: number;
}

/** Überträgt gelernte Werte per Kosinusähnlichkeit auf eine neue Übung. */
export function partialPoolCoefficient(
  target: Exercise,
  baseRegion: RegionBase,
  state: MuscleModelState | undefined,
  exercises: Exercise[],
): PartialPoolResult {
  const values: { value: number; variance: number; similarity: number }[] = [];
  for (const candidate of exercises) {
    if (candidate.id === target.id) {
      continue;
    }
    const similarity = cosineShareSimilarity(target, candidate);
    const key = coefficientKey(candidate.id, baseRegion);
    const value = state?.coefficients?.[key];
    if (similarity > 0 && nonNegativeFinite(value)) {
      values.push({
        value,
        variance: state?.posteriorVariance?.[key] ?? MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
        similarity,
      });
    }
  }
  if (!values.length) {
    return {
      value: 1,
      variance: MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
      source: 'catalog',
      similarity: 0,
    };
  }
  const totalWeight = values.reduce((sum, item) => sum + item.similarity, 0);
  return {
    value: values.reduce((sum, item) => sum + item.value * item.similarity, 0) / totalWeight,
    variance:
      values.reduce((sum, item) => sum + item.variance * item.similarity, 0) / totalWeight,
    source: 'similarity',
    similarity: Math.max(...values.map(item => item.similarity)),
  };
}

const allExercises = (input: FreshnessInput): Exercise[] => {
  const provided = [
    ...(input.exercises ?? []),
    ...Object.values(input.exerciseById ?? {}),
  ];
  const byId = new Map<string, Exercise>();
  for (const exercise of provided) {
    byId.set(exercise.id, exercise);
  }
  for (const session of input.sessions) {
    for (const sessionExercise of session.exercises) {
      const exercise = input.exerciseById?.[sessionExercise.exerciseId] ??
        input.exercises?.find(candidate => candidate.id === sessionExercise.exerciseId) ??
        catalogExercise(sessionExercise.exerciseId);
      if (exercise) {
        byId.set(exercise.id, exercise);
      }
    }
  }
  return Array.from(byId.values());
};

/** Alle Beiträge aus Kraft- und Laufdaten in einem gemeinsamen Zeitbuch. */
export function buildRegionalStimulusContributions(
  input: FreshnessInput,
): RegionalStimulusContribution[] {
  const strengthOptions: StrengthStimulusOptions = {
    exercises: input.exercises,
    exerciseById: input.exerciseById,
    unilateralSides: input.unilateralSides,
    bodyweightKg: input.bodyweightKg,
    bodyweightByExercise: input.bodyweightByExercise,
    bodyweightFractionByExercise: input.bodyweightFractionByExercise,
    reports: input.reports,
  };
  const strength = input.sessions.flatMap(session =>
    buildStrengthStimulusContributions(session, strengthOptions),
  );
  const runs = (input.runs ?? []).flatMap(run => buildRunStimulusContributions(run));
  return [...strength, ...runs].sort((left, right) =>
    left.at - right.at || left.regionId.localeCompare(right.regionId),
  );
}

const reportsForRegion = (reports: MuscleReport[], id: RegionId): MuscleReport[] =>
  reports.filter(report =>
    isValidMuscleReport(report) &&
    (isNothingTodayReport(report) || report.regionId === id),
  );

const modelStateCoefficient = (
  contribution: StrengthStimulusContribution,
  state: MuscleModelState | undefined,
  exercises: Exercise[],
): { value: number; variance: number; source: 'personal' | 'similarity' | 'catalog' } =>
  coefficientFromState(contribution, state, exercises);

const regionProvenance = (
  contributions: RegionalStimulusContribution[],
  reports: MuscleReport[],
): MuscleModelProvenance =>
  provenance(
    contributions.flatMap(contribution =>
      contribution.source === 'strength'
        ? [contribution.sessionId]
        : [contribution.runId],
    ),
    reports,
  );

const regionContributions = (
  contributions: RegionalStimulusContribution[],
  id: RegionId,
): RegionalStimulusContribution[] =>
  contributions.filter(contribution => contribution.regionId === id);

const regionFreshness = (
  id: RegionId,
  input: FreshnessInput,
  contributions: RegionalStimulusContribution[],
  isPrediction: boolean,
  allowUnknown: boolean,
): RegionFreshness => {
  const relevant = regionContributions(contributions, id);
  const reports = reportsForRegion(input.reports, id);
  const state = input.state;
  const timeConstants = state?.timeConstants ?? defaultTimeConstants();
  const exercises = allExercises(input);
  const loadByContribution = relevant.map(contribution => {
    const coefficient = contribution.source === 'strength'
      ? modelStateCoefficient(contribution, state, exercises)
      : { value: 1, variance: 0, source: 'catalog' as const };
    const impulse = combinedImpulseResponse(
      hoursSince(input.at, contribution.at),
      timeConstants,
    );
    return { contribution, coefficient, impulse };
  });
  const residualLoad = loadByContribution.reduce(
    (sum, item) =>
      sum + item.contribution.stimulus * item.coefficient.value * item.impulse,
    0,
  );
  const capacity = capacityFor(id, input.capacities ?? state?.capacities);
  const freshness = 100 * Math.exp(-residualLoad / capacity);
  let variance = 0;
  const uncertaintyReasons: string[] = [];
  for (const item of loadByContribution) {
    const scale =
      (item.contribution.stimulus * item.impulse) / capacity;
    variance += scale * scale * item.coefficient.variance;
    uncertaintyReasons.push(...item.contribution.uncertainty.reasons);
    if (!item.contribution.catalogReliable) {
      uncertaintyReasons.push('Mindestens ein Anteil stammt nicht aus einem belastbaren Katalog.');
    }
  }
  if (!relevant.length) {
    uncertaintyReasons.push('Für diese Region liegt kein relevanter Beitrag vor.');
  }
  if (!reports.length) {
    uncertaintyReasons.push('Keine bestätigende Meldung vorhanden.');
  }
  const standardDeviation = Math.min(
    100,
    Math.sqrt(variance) * 100 + (reports.length ? 0 : 2) +
      (loadByContribution.some(item => item.coefficient.source !== 'personal') ? 8 : 0),
  );
  const lastRelevantAt = relevant.reduce(
    (latest, contribution) => Math.max(latest, contribution.at),
    -Infinity,
  );
  const recentEnough =
    lastRelevantAt !== -Infinity &&
    input.at - lastRelevantAt <=
      MUSCLE_MODEL_CONSTANTS.modelHorizonDays * 24 * 60 * 60 * 1000;
  const hasConfirmation = reports.length > 0;
  const reliableShares = relevant.every(contribution => contribution.catalogReliable);
  let reasonCode: FreshnessUnknownReason | undefined;
  let reason: string | undefined;
  if (!relevant.length) {
    reasonCode = 'no_reliable_shares';
    reason = 'Für diese Region fehlen belastbare Trainingsanteile.';
  } else if (!reliableShares) {
    reasonCode = 'no_reliable_shares';
    reason = 'Die Anteile dieser Region sind noch nicht belastbar hinterlegt.';
  } else if (standardDeviation > MUSCLE_MODEL_CONSTANTS.uncertaintyThresholdFreshnessPoints) {
    reasonCode = 'uncertainty_too_high';
    reason = 'Die Unsicherheit der Regionsschätzung liegt über der festgelegten Schwelle.';
  } else if (!recentEnough && !hasConfirmation) {
    reasonCode = 'outside_horizon_without_report';
    reason = 'Die letzte relevante Einheit liegt außerhalb des Modellhorizonts und es fehlt eine bestätigende Meldung.';
  } else if (!hasConfirmation && freshness === 100) {
    reasonCode = 'missing_reports';
    reason = 'Ohne Meldung wird keine exakte 100 ausgegeben.';
  }
  const uniqueReasons = Array.from(new Set(uncertaintyReasons));
  const uncertainty: FreshnessUncertainty = {
    standardDeviationPoints: standardDeviation,
    lowerPoints: Math.max(0, freshness - standardDeviation),
    upperPoints: Math.min(100, freshness + standardDeviation),
    reasons: uniqueReasons,
  };
  const base = {
    ...regionProvenance(relevant, reports),
    regionId: id,
    at: input.at,
    residualLoad,
    uncertainty,
    isPrediction,
    contributing: relevant,
  };
  if (reasonCode && !allowUnknown) {
    return {
      ...base,
      kind: 'unknown',
      value: null,
      sorenessPrediction: null,
      reasonCode,
      reason: reason ?? 'Für diese Region liegt noch keine belastbare Zahl vor.',
    };
  }
  return {
    ...base,
    kind: 'freshness',
    value: freshness,
    sorenessPrediction: 10 * (1 - freshness / 100),
    assumptions: [
      'Die Impulsantwort wird mit der versionierten Ausgangsannahme berechnet.',
      reports.length
        ? 'Die Regionsschätzung wird durch vorhandene Meldungen eingeordnet.'
        : 'Mangels Meldung wird die Katalogannahme verwendet.',
    ],
  };
};

/** Berechnet die Frische aller konkreten Regionen zum angegebenen Zeitpunkt. */
export function calculateFreshness(
  input: FreshnessInput,
): FreshnessSnapshot {
  const contributions = buildRegionalStimulusContributions(input);
  const regions = Object.fromEntries(
    allRegionIds().map(id => [
      id,
      regionFreshness(id, input, contributions, false, false),
    ]),
  ) as Record<RegionId, RegionFreshness>;
  return {
    ...provenance(
      contributions.flatMap(contribution =>
        contribution.source === 'strength'
          ? [contribution.sessionId]
          : [contribution.runId],
      ),
      input.reports,
    ),
    kind: 'freshness_snapshot',
    at: input.at,
    isPrediction: false,
    regions,
  };
}

/** Zukunftsauswertung derselben Gleichung, ausdrücklich als Prognose markiert. */
export function predictFreshness(input: FreshnessInput): FreshnessSnapshot {
  const contributions = buildRegionalStimulusContributions(input);
  const regions = Object.fromEntries(
    allRegionIds().map(id => [
      id,
      regionFreshness(id, input, contributions, true, false),
    ]),
  ) as Record<RegionId, RegionFreshness>;
  return {
    ...provenance(
      contributions.flatMap(contribution =>
        contribution.source === 'strength'
          ? [contribution.sessionId]
          : [contribution.runId],
      ),
      input.reports,
    ),
    kind: 'freshness_prediction',
    at: input.at,
    isPrediction: true,
    regions,
  };
}

/** Liefert die Modellvorhersage auch dann, wenn §7 die Anzeige als unbekannt markiert. */
export function predictSoreness(
  input: FreshnessInput,
  regionIdValue: RegionId,
): number | null {
  const contributions = buildRegionalStimulusContributions(input);
  const result = regionFreshness(
    regionIdValue,
    input,
    contributions,
    true,
    true,
  );
  return result.kind === 'freshness' ? result.sorenessPrediction : null;
}

/** Kurzname für Aufrufer, die den einzelnen Satz als Reizfunktion verwenden. */
export const setStimulus = calculateSetStimulus;

/** Kurzname für die Laufabschnittsrechnung. */
export const calculateRunSegmentStimulus = runSegmentStimulus;

/** Kurzname für die kombinierte Impulsantwort. */
export const hTotal = combinedImpulseResponse;

/** Liefert die einzelne Region aus einer vollständigen Momentaufnahme. */
export function freshnessAt(
  input: FreshnessInput,
  regionIdValue: RegionId,
): RegionFreshness {
  return calculateFreshness(input).regions[regionIdValue];
}

export { coefficientKey };
