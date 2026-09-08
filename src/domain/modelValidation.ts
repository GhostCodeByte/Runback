import {
  allRegionIds,
  REGIONS_VERSION,
  type RegionId,
} from './regions';
import { CATALOG_VERSION, type Exercise, type StrengthSession } from './strength';
import {
  calculateFreshness,
  buildRegionalStimulusContributions,
  combinedImpulseResponse,
  isValidMuscleReport,
  MUSCLE_MODEL_CONSTANTS,
  predictSoreness,
  type FreshnessInput,
  type MuscleModelProvenance,
  type MuscleModelState,
  type MuscleReport,
  type SorenessReport,
} from './freshness';
import {
  calibrateModel,
  type CalibrationInput,
  type CalibrationState,
} from './calibration';

export interface ModelValidationInput {
  sessions: StrengthSession[];
  reports: MuscleReport[];
  runs?: FreshnessInput['runs'];
  exercises?: Exercise[];
  exerciseById?: Record<string, Exercise>;
  unilateralSides?: Record<string, 'l' | 'r'>;
  bodyweightKg?: number;
  bodyweightByExercise?: Record<string, number>;
  bodyweightFractionByExercise?: Record<string, number>;
  capacities?: FreshnessInput['capacities'];
  calibration?: CalibrationState;
}

export interface ValidationOptions {
  timeConstantGrid?: CalibrationInput['timeConstantGrid'];
  minimumHoldouts?: number;
}

export interface HoldoutObservation {
  regionId: RegionId;
  at: number;
  observed: number;
  predicted: number | null;
  personalMedian: number | null;
  repeatLast: number | null;
  alwaysZero: number;
  trainingReportCount: number;
}

export interface HoldoutCheck {
  count: number;
  modelMae: number | null;
  personalMedianMae: number | null;
  repeatLastMae: number | null;
  alwaysZeroMae: number | null;
  beatsAllBaselines: boolean;
  passes: boolean;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  predictedMean: number | null;
  observedMean: number | null;
  absoluteGap: number | null;
}

export interface CalibrationCheck {
  bins: CalibrationBin[];
  meanAbsoluteGap: number | null;
  passes: boolean;
  reason: string;
}

export interface TimeBehaviourCheck {
  expectedPeakHours: number;
  observedPeakHours: number | null;
  observations: number;
  toleranceHours: number;
  passes: boolean;
  reason: string;
}

export interface StabilityCheck {
  maximumShiftPoints: number | null;
  limitPoints: number;
  observations: number;
  passes: boolean;
  reason: string;
}

export interface FailureCheck {
  noReportsStayUnknown: boolean;
  unknownExerciseStaysUnknown: boolean;
  oldContributionStaysUnknown: boolean;
  contradictoryReportsDoNotThrow: boolean;
  passes: boolean;
  reason: string;
}

export interface ModelValidationResult extends MuscleModelProvenance {
  kind: 'model_validation';
  holdouts: HoldoutObservation[];
  holdout: HoldoutCheck;
  calibration: CalibrationCheck;
  timeBehaviour: TimeBehaviourCheck;
  stability: StabilityCheck;
  failures: FailureCheck;
  passes: boolean;
}

export interface ModelUnlockReason {
  code:
    | 'not_enough_holdouts'
    | 'naive_baseline_not_beaten'
    | 'calibration_gap'
    | 'time_behaviour'
    | 'stability'
    | 'failure_case';
  reason: string;
}

export interface ModelUnlockVerdict extends MuscleModelProvenance {
  kind: 'model_unlock_verdict';
  unlocked: boolean;
  reasons: ModelUnlockReason[];
  checks: ModelValidationResult;
}

const reportIsSoreness = (report: MuscleReport): report is SorenessReport =>
  report.kind !== 'nothing_today';

const sortedReports = (reports: MuscleReport[]): MuscleReport[] =>
  reports
    .filter(isValidMuscleReport)
    .map((report, index) => ({ report, index }))
    .sort((left, right) => left.report.at - right.report.at || left.index - right.index)
    .map(item => item.report);

const commonFreshnessInput = (
  input: ModelValidationInput,
  at: number,
  reports: MuscleReport[],
  state?: MuscleModelState,
): FreshnessInput => ({
  at,
  sessions: input.sessions,
  runs: input.runs,
  reports,
  exercises: input.exercises,
  exerciseById: input.exerciseById,
  unilateralSides: input.unilateralSides,
  bodyweightKg: input.bodyweightKg,
  bodyweightByExercise: input.bodyweightByExercise,
  bodyweightFractionByExercise: input.bodyweightFractionByExercise,
  capacities: input.capacities,
  state,
});

const calibrationFor = (
  input: ModelValidationInput,
  reports: MuscleReport[],
  options: ValidationOptions,
): CalibrationState | undefined => {
  if (!reports.length) {
    return undefined;
  }
  if (input.calibration) {
    return input.calibration;
  }
  return calibrateModel({
    sessions: input.sessions,
    reports,
    exercises: input.exercises,
    exerciseById: input.exerciseById,
    unilateralSides: input.unilateralSides,
    bodyweightKg: input.bodyweightKg,
    bodyweightByExercise: input.bodyweightByExercise,
    bodyweightFractionByExercise: input.bodyweightFractionByExercise,
    capacities: input.capacities,
    timeConstantGrid: options.timeConstantGrid,
  });
};

const median = (values: number[]): number | null => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const meanAbsoluteError = (
  values: Array<number | null>,
  observed: number[],
): number | null => {
  if (values.some(value => value === null)) {
    return null;
  }
  const errors: number[] = [];
  values.forEach((value, index) => {
    if (value !== null) {
      errors.push(Math.abs(value - observed[index]));
    }
  });
  return errors.length
    ? errors.reduce((sum, value) => sum + value, 0) / errors.length
    : null;
};

const reportsBefore = (
  reports: MuscleReport[],
  target: MuscleReport,
): MuscleReport[] => {
  const sorted = sortedReports(reports);
  const targetIndex = sorted.findIndex(report => report === target);
  return targetIndex < 0 ? sorted.filter(report => report.at < target.at) : sorted.slice(0, targetIndex);
};

const makeHoldouts = (
  input: ModelValidationInput,
  options: ValidationOptions,
): HoldoutObservation[] => {
  const reports = sortedReports(input.reports).filter(reportIsSoreness);
  const observations: HoldoutObservation[] = [];
  for (const report of reports) {
    const trainingReports = reportsBefore(input.reports, report);
    const sameRegion = trainingReports.filter(
      candidate => reportIsSoreness(candidate) && candidate.regionId === report.regionId,
    ) as SorenessReport[];
    if (!sameRegion.length) {
      continue;
    }
    const state = calibrationFor(input, trainingReports, options);
    const predicted = predictSoreness(
      commonFreshnessInput(input, report.at, trainingReports, state),
      report.regionId,
    );
    const values = sameRegion.map(candidate => candidate.value);
    observations.push({
      regionId: report.regionId,
      at: report.at,
      observed: report.value,
      predicted,
      personalMedian: median(values),
      repeatLast: values[values.length - 1] ?? null,
      alwaysZero: 0,
      trainingReportCount: trainingReports.length,
    });
  }
  return observations;
};

const holdoutCheck = (
  observations: HoldoutObservation[],
  minimumHoldouts: number,
): HoldoutCheck => {
  const observed = observations.map(observation => observation.observed);
  const modelMae = meanAbsoluteError(
    observations.map(observation => observation.predicted),
    observed,
  );
  const medianMae = meanAbsoluteError(
    observations.map(observation => observation.personalMedian),
    observed,
  );
  const repeatMae = meanAbsoluteError(
    observations.map(observation => observation.repeatLast),
    observed,
  );
  const zeroMae = meanAbsoluteError(
    observations.map(observation => observation.alwaysZero),
    observed,
  );
  const beatsAllBaselines =
    modelMae !== null &&
    medianMae !== null &&
    repeatMae !== null &&
    zeroMae !== null &&
    modelMae < medianMae &&
    modelMae < repeatMae &&
    modelMae < zeroMae;
  return {
    count: observations.length,
    modelMae,
    personalMedianMae: medianMae,
    repeatLastMae: repeatMae,
    alwaysZeroMae: zeroMae,
    beatsAllBaselines,
    passes: observations.length >= minimumHoldouts && beatsAllBaselines,
  };
};

const calibrationCheck = (observations: HoldoutObservation[]): CalibrationCheck => {
  const usable = observations.filter(
    observation => observation.predicted !== null,
  );
  const bins: CalibrationBin[] = Array.from(
    { length: MUSCLE_MODEL_CONSTANTS.calibrationBins },
    (_, index) => {
      const lower = index * (10 / MUSCLE_MODEL_CONSTANTS.calibrationBins);
      const upper = (index + 1) * (10 / MUSCLE_MODEL_CONSTANTS.calibrationBins);
      const members = usable.filter(observation => {
        const predicted = observation.predicted ?? 0;
        return index === MUSCLE_MODEL_CONSTANTS.calibrationBins - 1
          ? predicted >= lower && predicted <= upper
          : predicted >= lower && predicted < upper;
      });
      const predictedMean = members.length
        ? members.reduce((sum, member) => sum + (member.predicted ?? 0), 0) / members.length
        : null;
      const observedMean = members.length
        ? members.reduce((sum, member) => sum + member.observed, 0) / members.length
        : null;
      return {
        lower,
        upper,
        count: members.length,
        predictedMean,
        observedMean,
        absoluteGap:
          predictedMean !== null && observedMean !== null
            ? Math.abs(predictedMean - observedMean)
            : null,
      };
    },
  );
  const gaps = bins
    .map(bin => bin.absoluteGap)
    .filter((gap): gap is number => gap !== null);
  const meanAbsoluteGap = gaps.length
    ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
    : null;
  return {
    bins,
    meanAbsoluteGap,
    passes: usable.length > 0 &&
      meanAbsoluteGap !== null &&
      meanAbsoluteGap <= MUSCLE_MODEL_CONSTANTS.calibrationMeanGapPoints,
    reason: usable.length
      ? 'Kalibrierung wurde über Vorhersageklassen geprüft.'
      : 'Für eine Kalibrierung fehlen Vorhersagen.',
  };
};

const expectedPeakHours = (timeConstants: CalibrationState['timeConstants'] | undefined): number => {
  const constants = timeConstants ?? {
    fastRiseHours: MUSCLE_MODEL_CONSTANTS.fastRiseHours,
    fastDecayHours: MUSCLE_MODEL_CONSTANTS.fastDecayHours,
    slowRiseHours: MUSCLE_MODEL_CONSTANTS.slowRiseHours,
    slowDecayHours: MUSCLE_MODEL_CONSTANTS.slowDecayHours,
    betaFast: MUSCLE_MODEL_CONSTANTS.betaFast,
    betaSlow: MUSCLE_MODEL_CONSTANTS.betaSlow,
  };
  let bestHour = 0;
  let bestValue = -Infinity;
  for (
    let hour = 0;
    hour <= MUSCLE_MODEL_CONSTANTS.modelHorizonDays * 24;
    hour += MUSCLE_MODEL_CONSTANTS.timeCheckStepHours
  ) {
    const value = combinedImpulseResponse(hour, constants);
    if (value > bestValue) {
      bestValue = value;
      bestHour = hour;
    }
  }
  return bestHour;
};

const timeBehaviourCheck = (
  input: ModelValidationInput,
  observations: HoldoutObservation[],
): TimeBehaviourCheck => {
  const contributions = buildRegionalStimulusContributions({
    ...commonFreshnessInput(input, input.sessions[0]?.startTime ?? 0, input.reports),
  });
  const state = input.calibration;
  const expected = expectedPeakHours(state?.timeConstants);
  const peaks: number[] = [];
  for (const id of allRegionIds()) {
    const first = contributions
      .filter(contribution => contribution.regionId === id)
      .sort((left, right) => left.at - right.at)[0];
    if (!first) {
      continue;
    }
    const regionObservations = observations.filter(
      observation => observation.regionId === id && observation.at >= first.at,
    );
    if (regionObservations.length < 2) {
      continue;
    }
    const peak = regionObservations.reduce(
      (best, current) => current.observed > best.observed ? current : best,
      regionObservations[0],
    );
    peaks.push((peak.at - first.at) / (60 * 60 * 1000));
  }
  const observed = median(peaks);
  const tolerance = MUSCLE_MODEL_CONSTANTS.timePeakToleranceHours;
  return {
    expectedPeakHours: expected,
    observedPeakHours: observed,
    observations: peaks.length,
    toleranceHours: tolerance,
    passes: observed !== null && Math.abs(observed - expected) <= tolerance,
    reason: observed !== null
      ? 'Der zeitliche Anstieg liegt innerhalb der festgelegten Toleranz.'
      : 'Für das Zeitverhalten fehlen wiederholte Meldungen nach einem Beitrag.',
  };
};

const stateForReports = (
  input: ModelValidationInput,
  reports: MuscleReport[],
): CalibrationState | undefined =>
  reports.length
    ? calibrationFor(input, reports, {})
    : undefined;

const stabilityCheck = (input: ModelValidationInput): StabilityCheck => {
  const reports = sortedReports(input.reports).filter(reportIsSoreness);
  if (!reports.length) {
    return {
      maximumShiftPoints: null,
      limitPoints: MUSCLE_MODEL_CONSTANTS.stabilityMaxShiftPoints,
      observations: 0,
      passes: false,
      reason: 'Für die Stabilitätsprüfung fehlen Meldungen.',
    };
  }
  const fullState = stateForReports(input, input.reports);
  let maximum = 0;
  let count = 0;
  for (const report of reports) {
    const full = predictSoreness(
      commonFreshnessInput(input, report.at, input.reports, fullState),
      report.regionId,
    );
    const without = input.reports.filter(candidate => candidate !== report);
    const reducedState = stateForReports(input, without);
    const reduced = predictSoreness(
      commonFreshnessInput(input, report.at, without, reducedState),
      report.regionId,
    );
    if (full !== null && reduced !== null) {
      maximum = Math.max(maximum, Math.abs(full - reduced));
      count += 1;
    }
  }
  return {
    maximumShiftPoints: count ? maximum : null,
    limitPoints: MUSCLE_MODEL_CONSTANTS.stabilityMaxShiftPoints,
    observations: count,
    passes: count > 0 && maximum <= MUSCLE_MODEL_CONSTANTS.stabilityMaxShiftPoints,
    reason: count
      ? 'Einzelne zusätzliche Meldungen verschieben die Schätzung nur begrenzt.'
      : 'Für die Stabilitätsprüfung ließ sich keine Vergleichsschätzung bilden.',
  };
};

const failureChecks = (input: ModelValidationInput): FailureCheck => {
  const noReports = calculateFreshness(
    commonFreshnessInput(input, input.sessions[0]?.startTime ?? 0, []),
  );
  const noReportsStayUnknown = Object.values(noReports.regions).every(
    region => region.kind === 'unknown',
  );
  const unknownSession: StrengthSession = {
    id: 'validation-unknown-exercise',
    kind: 'strength',
    name: 'Prüfung',
    startTime: 1,
    endTime: 2,
    status: 'finished',
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: CATALOG_VERSION,
    exercises: [{
      exerciseId: 'unknown-exercise',
      name: 'Unbekannt',
      sets: [{
        id: 'unknown-set',
        planned: { kind: 'normal', loadKind: 'kg', reps: 8, weightKg: 40, restSeconds: 60 },
        actualReps: 8,
        actualWeightKg: 40,
        completedAt: 2,
      }],
    }],
  };
  const unknownResult = calculateFreshness(
    commonFreshnessInput(
      { ...input, sessions: [unknownSession] },
      2,
      [],
    ),
  );
  const unknownExerciseStaysUnknown = Object.values(unknownResult.regions).every(
    region => region.kind === 'unknown',
  );
  const oldSession = input.sessions[0]
    ? { ...input.sessions[0], startTime: 1, endTime: 2 }
    : unknownSession;
  const oldResult = calculateFreshness(
    commonFreshnessInput(
      { ...input, sessions: [oldSession] },
      1 + MUSCLE_MODEL_CONSTANTS.modelHorizonDays * 24 * 60 * 60 * 1000 + 1,
      [],
    ),
  );
  const oldContributionStaysUnknown = Object.values(oldResult.regions).every(
    region => region.kind === 'unknown',
  );
  let contradictoryReportsDoNotThrow = true;
  try {
    calculateFreshness(commonFreshnessInput(input, input.sessions[0]?.startTime ?? 0, [
      { at: 1, regionId: 'quad_l', value: 0 },
      { at: 1, regionId: 'quad_l', value: 10 },
    ]));
  } catch {
    contradictoryReportsDoNotThrow = false;
  }
  const passes =
    noReportsStayUnknown &&
    unknownExerciseStaysUnknown &&
    oldContributionStaysUnknown &&
    contradictoryReportsDoNotThrow;
  return {
    noReportsStayUnknown,
    unknownExerciseStaysUnknown,
    oldContributionStaysUnknown,
    contradictoryReportsDoNotThrow,
    passes,
    reason: passes
      ? 'Ausfallfälle liefern unbekannte Ergebnisse oder bleiben stabil.'
      : 'Mindestens ein Ausfallfall lieferte eine unzulässige Zahl oder einen Fehler.',
  };
};

/** Führt die vollständige Prüfung vor einer Freischaltung des Modells aus. */
export function validateModel(
  input: ModelValidationInput,
  options: ValidationOptions = {},
): ModelValidationResult {
  const observations = makeHoldouts(input, options);
  const holdout = holdoutCheck(
    observations,
    options.minimumHoldouts ?? 3,
  );
  const calibration = calibrationCheck(observations);
  const timeBehaviour = timeBehaviourCheck(input, observations);
  const stability = stabilityCheck(input);
  const failures = failureChecks(input);
  const sessions = input.sessions.map(session => session.id);
  return {
    kind: 'model_validation',
    model_version: MUSCLE_MODEL_CONSTANTS.modelVersion,
    regions_version: REGIONS_VERSION,
    catalog_version: CATALOG_VERSION,
    contributing_sessions: Array.from(new Set(sessions)).sort(),
    contributing_reports: input.reports.filter(isValidMuscleReport).map(report => ({ ...report })),
    holdouts: observations,
    holdout,
    calibration,
    timeBehaviour,
    stability,
    failures,
    passes: holdout.passes && calibration.passes && timeBehaviour.passes && stability.passes && failures.passes,
  };
}

/** Ein einzelnes, begründetes Ja/Nein-Ergebnis für die Modellfreischaltung. */
export function modelIsUnlocked(
  input: ModelValidationInput,
  options: ValidationOptions = {},
): ModelUnlockVerdict {
  const checks = validateModel(input, options);
  const reasons: ModelUnlockReason[] = [];
  if (checks.holdout.count < (options.minimumHoldouts ?? 3)) {
    reasons.push({
      code: 'not_enough_holdouts',
      reason: 'Es gibt noch nicht genügend aufeinanderfolgende Meldungen für eine Hold-out-Prüfung.',
    });
  }
  if (!checks.holdout.beatsAllBaselines) {
    reasons.push({
      code: 'naive_baseline_not_beaten',
      reason: 'Der mittlere absolute Fehler schlägt nicht alle drei einfachen Vergleichswerte.',
    });
  }
  if (!checks.calibration.passes) {
    reasons.push({
      code: 'calibration_gap',
      reason: checks.calibration.reason,
    });
  }
  if (!checks.timeBehaviour.passes) {
    reasons.push({
      code: 'time_behaviour',
      reason: checks.timeBehaviour.reason,
    });
  }
  if (!checks.stability.passes) {
    reasons.push({
      code: 'stability',
      reason: checks.stability.reason,
    });
  }
  if (!checks.failures.passes) {
    reasons.push({
      code: 'failure_case',
      reason: checks.failures.reason,
    });
  }
  return {
    kind: 'model_unlock_verdict',
    model_version: MUSCLE_MODEL_CONSTANTS.modelVersion,
    regions_version: REGIONS_VERSION,
    catalog_version: CATALOG_VERSION,
    contributing_sessions: checks.contributing_sessions,
    contributing_reports: checks.contributing_reports,
    unlocked: checks.passes && reasons.length === 0,
    reasons,
    checks,
  };
}
