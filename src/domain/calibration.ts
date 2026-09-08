import {
  REGIONS,
  REGIONS_VERSION,
  type RegionBase,
  type RegionId,
} from './regions';
import { CATALOG_VERSION, type Exercise, type StrengthSession } from './strength';
import {
  buildStrengthStimulusContributions,
  combinedImpulseResponse,
  cosineShareSimilarity,
  MUSCLE_MODEL_CONSTANTS,
  partialPoolCoefficient,
  type MuscleModelProvenance,
  type MuscleModelState,
  type MuscleReport,
  type SorenessReport,
  type TimeConstants,
} from './freshness';

export interface CalibrationColumn {
  key: string;
  exerciseId: string;
  regionId: RegionBase;
}

export interface DesignMatrixRow {
  report: MuscleReport;
  regionId: RegionId;
  observedValue: number;
  target: number;
  capacity: number;
  values: number[];
}

export interface DesignMatrix {
  columns: CalibrationColumn[];
  rows: DesignMatrixRow[];
  matrix: number[][];
  targets: number[];
  provenance: MuscleModelProvenance;
}

export interface CalibrationInput {
  sessions: StrengthSession[];
  reports: MuscleReport[];
  exercises?: Exercise[];
  exerciseById?: Record<string, Exercise>;
  unilateralSides?: Record<string, 'l' | 'r'>;
  bodyweightKg?: number;
  bodyweightByExercise?: Record<string, number>;
  bodyweightFractionByExercise?: Record<string, number>;
  capacities?: Partial<Record<RegionBase | RegionId, number>>;
  priors?: Record<string, number>;
  timeConstants?: TimeConstants;
  timeConstantGrid?: readonly TimeConstants[];
}

export interface SolverOptions {
  regularizationLambda?: number;
  huberDelta?: number;
  maxIterations?: number;
  robustPasses?: number;
  convergence?: number;
}

export interface NonNegativeLeastSquaresResult {
  coefficients: number[];
  residuals: number[];
  objective: number;
  iterations: number;
}

export interface RecursiveCalibrationState {
  means: number[];
  covariance: number[][];
  observations: number;
}

export interface IdentifiabilityExplanation {
  code: 'coefficients_not_identifiable';
  first: CalibrationColumn;
  second: CalibrationColumn;
  correlation: number;
  reason: string;
  separatingObservation: string;
}

export interface TimeConstantSelection {
  selected: TimeConstants;
  crossValidatedError: number;
  errors: { candidate: TimeConstants; error: number }[];
}

export interface CalibrationState extends MuscleModelState, MuscleModelProvenance {
  modelVersion: string;
  catalogVersion: string;
  coefficients: Record<string, number>;
  priors: Record<string, number>;
  posteriorVariance: Record<string, number>;
  covariance: Record<string, Record<string, number>>;
  timeConstants: TimeConstants;
  batchCoefficients: Record<string, number>;
  observations: number;
  reports: MuscleReport[];
  columns: CalibrationColumn[];
  identifiability: IdentifiabilityExplanation[];
  selection: TimeConstantSelection;
  provenance: MuscleModelProvenance;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonNegative = (value: unknown): value is number =>
  finite(value) && value >= 0;

const reportIsSoreness = (report: MuscleReport): report is SorenessReport =>
  report.kind !== 'nothing_today';

const reportIsValid = (report: MuscleReport): boolean => {
  if (!finite(report.at) || report.at < 0) {
    return false;
  }
  return report.kind === 'nothing_today' ||
    (typeof report.regionId === 'string' &&
      report.regionId.length > 0 &&
      finite(report.value) &&
      report.value >= 0 &&
      report.value <= 10);
};

const baseRegion = (id: string): RegionBase | null => {
  const candidate = id.replace(/_(l|r)$/, '');
  return REGIONS.some(region => region.base === candidate)
    ? (candidate as RegionBase)
    : null;
};

const capacityFor = (
  id: RegionId,
  capacities: Partial<Record<RegionBase | RegionId, number>> | undefined,
): number => {
  const base = baseRegion(id);
  const selected = capacities?.[id] ?? (base ? capacities?.[base] : undefined);
  return nonNegative(selected) && selected > 0
    ? selected
    : MUSCLE_MODEL_CONSTANTS.defaultCapacity;
};

const provenance = (
  sessions: string[],
  reports: MuscleReport[],
): MuscleModelProvenance => ({
  model_version: MUSCLE_MODEL_CONSTANTS.modelVersion,
  regions_version: REGIONS_VERSION,
  catalog_version: CATALOG_VERSION,
  contributing_sessions: Array.from(new Set(sessions)).sort(),
  contributing_reports: reports.filter(reportIsValid).map(report => ({ ...report })),
});

const coefficientKey = (exerciseId: string, region: RegionBase): string =>
  `${exerciseId}|${region}`;

/** Normierte Differenz zweier Exponentialfunktionen für die Matrixzeilen. */
const defaultGrid = (): readonly TimeConstants[] => [
  { fastRiseHours: 0.5, fastDecayHours: 10, slowRiseHours: 12, slowDecayHours: 60, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.5, fastDecayHours: 10, slowRiseHours: 10, slowDecayHours: 50, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.5, fastDecayHours: 10, slowRiseHours: 16, slowDecayHours: 72, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.75, fastDecayHours: 10, slowRiseHours: 10, slowDecayHours: 50, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.75, fastDecayHours: 12, slowRiseHours: 12, slowDecayHours: 60, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.75, fastDecayHours: 12, slowRiseHours: 16, slowDecayHours: 72, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.5, fastDecayHours: 8, slowRiseHours: 10, slowDecayHours: 50, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.5, fastDecayHours: 8, slowRiseHours: 12, slowDecayHours: 60, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 0.5, fastDecayHours: 8, slowRiseHours: 16, slowDecayHours: 72, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 1, fastDecayHours: 12, slowRiseHours: 10, slowDecayHours: 50, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 1, fastDecayHours: 12, slowRiseHours: 12, slowDecayHours: 60, betaFast: 0.4, betaSlow: 0.6 },
  { fastRiseHours: 1, fastDecayHours: 12, slowRiseHours: 16, slowDecayHours: 72, betaFast: 0.4, betaSlow: 0.6 },
];

export const TIME_CONSTANT_GRID: readonly TimeConstants[] = defaultGrid();

const targetFromSoreness = (value: number, capacity: number): number => {
  if (value <= 0) {
    return 0;
  }
  return -capacity * Math.log(
    Math.max(MUSCLE_MODEL_CONSTANTS.sorenessLogFloor, 1 - value / 10),
  );
};

const regionIdsForReport = (
  report: MuscleReport,
  contributions: ReturnType<typeof buildStrengthStimulusContributions>,
): RegionId[] => {
  if (report.kind !== 'nothing_today') {
    return [report.regionId];
  }
  return Array.from(new Set(contributions.map(contribution => contribution.regionId))).sort();
};

/** Erzeugt die lineare Entwurfsmatrix A und die transformierten Ziele y. */
export function buildDesignMatrix(input: CalibrationInput): DesignMatrix {
  const timeConstants = input.timeConstants;
  const contributions = input.sessions.flatMap(session =>
    buildStrengthStimulusContributions(session, {
      exercises: input.exercises,
      exerciseById: input.exerciseById,
      unilateralSides: input.unilateralSides,
      bodyweightKg: input.bodyweightKg,
      bodyweightByExercise: input.bodyweightByExercise,
      bodyweightFractionByExercise: input.bodyweightFractionByExercise,
      reports: input.reports,
    }),
  );
  const columnMap = new Map<string, CalibrationColumn>();
  for (const contribution of contributions) {
    const key = coefficientKey(contribution.exerciseId, contribution.baseRegion);
    columnMap.set(key, {
      key,
      exerciseId: contribution.exerciseId,
      regionId: contribution.baseRegion,
    });
  }
  const columns = Array.from(columnMap.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const columnIndex = new Map(columns.map((column, index) => [column.key, index]));
  const reports = input.reports
    .filter(reportIsValid)
    .map((report, index) => ({ report, index }))
    .sort((left, right) =>
      left.report.at - right.report.at || left.index - right.index,
    )
    .map(item => item.report);
  const rows: DesignMatrixRow[] = [];
  for (const report of reports) {
    for (const regionId of regionIdsForReport(report, contributions)) {
      const capacity = capacityFor(regionId, input.capacities);
      const values = columns.map(() => 0);
      for (const contribution of contributions) {
        if (contribution.regionId !== regionId) {
          continue;
        }
        const index = columnIndex.get(
          coefficientKey(contribution.exerciseId, contribution.baseRegion),
        );
        if (index === undefined || contribution.at > report.at) {
          continue;
        }
        const impulse = combinedImpulseResponse(
          (report.at - contribution.at) / (60 * 60 * 1000),
          timeConstants,
        );
        values[index] += contribution.stimulus * impulse;
      }
      const observedValue = report.kind === 'nothing_today' ? 0 : report.value;
      rows.push({
        report,
        regionId,
        observedValue,
        target: targetFromSoreness(observedValue, capacity),
        capacity,
        values,
      });
    }
  }
  return {
    columns,
    rows,
    matrix: rows.map(row => row.values),
    targets: rows.map(row => row.target),
    provenance: provenance(
      contributions.map(contribution => contribution.sessionId),
      reports,
    ),
  };
}

/** Huber-Verlust für robuste Abweichungen. */
export function huberLoss(
  residual: number,
  delta: number = MUSCLE_MODEL_CONSTANTS.calibrationHuberDelta,
): number {
  const absolute = Math.abs(residual);
  return absolute <= delta
    ? 0.5 * residual * residual
    : delta * (absolute - 0.5 * delta);
}

const dot = (left: number[], right: number[]): number =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);

const objective = (
  matrix: number[][],
  targets: number[],
  coefficients: number[],
  priors: number[],
  options: Required<SolverOptions>,
): number =>
  matrix.reduce(
    (sum, row, index) =>
      sum + huberLoss(dot(row, coefficients) - (targets[index] ?? 0), options.huberDelta),
    0,
  ) +
  options.regularizationLambda *
    coefficients.reduce(
      (sum, value, index) => sum + (value - (priors[index] ?? 1)) ** 2,
      0,
    );

/** Robuste, regularisierte, nichtnegative Lösung per deterministischem Koordinatenabstieg. */
export function solveRegularizedNonNegativeLeastSquares(
  matrix: number[][],
  targets: number[],
  priors: number[] = [],
  solverOptions: SolverOptions = {},
): NonNegativeLeastSquaresResult {
  const columnCount = Math.max(
    priors.length,
    ...matrix.map(row => row.length),
  );
  const options: Required<SolverOptions> = {
    regularizationLambda: solverOptions.regularizationLambda ?? MUSCLE_MODEL_CONSTANTS.regularizationLambda,
    huberDelta: solverOptions.huberDelta ?? MUSCLE_MODEL_CONSTANTS.calibrationHuberDelta,
    maxIterations: solverOptions.maxIterations ?? MUSCLE_MODEL_CONSTANTS.calibrationMaxIterations,
    robustPasses: solverOptions.robustPasses ?? MUSCLE_MODEL_CONSTANTS.calibrationRobustPasses,
    convergence: solverOptions.convergence ?? MUSCLE_MODEL_CONSTANTS.calibrationConvergence,
  };
  const priorValues = Array.from(
    { length: columnCount },
    (_, index) => {
      const value = priors[index];
      return nonNegative(value) ? value : 1;
    },
  );
  const coefficients = [...priorValues];
  if (!columnCount || !matrix.length) {
    return {
      coefficients,
      residuals: matrix.map(row => dot(row, coefficients)),
      objective: objective(matrix, targets, coefficients, priorValues, options),
      iterations: 0,
    };
  }
  let iterations = 0;
  let weights = matrix.map(() => 1);
  let predictions = matrix.map(row => dot(row, coefficients));
  for (let pass = 0; pass < options.robustPasses; pass += 1) {
    for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
      iterations += 1;
      let maximumChange = 0;
      for (let column = 0; column < columnCount; column += 1) {
        let denominator = options.regularizationLambda;
        let numerator = options.regularizationLambda * priorValues[column];
        for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
          const value = matrix[rowIndex][column] ?? 0;
          if (value === 0) {
            continue;
          }
          const other = predictions[rowIndex] - value * coefficients[column];
          const weight = weights[rowIndex];
          denominator += weight * value * value;
          numerator += weight * value * (targets[rowIndex] - other);
        }
        const next = Math.max(0, numerator / Math.max(denominator, Number.MIN_VALUE));
        maximumChange = Math.max(maximumChange, Math.abs(next - coefficients[column]));
        const difference = next - coefficients[column];
        coefficients[column] = next;
        if (difference !== 0) {
          for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
            predictions[rowIndex] += (matrix[rowIndex][column] ?? 0) * difference;
          }
        }
      }
      if (maximumChange <= options.convergence) {
        break;
      }
    }
    weights = matrix.map((row, index) => {
      const residual = dot(row, coefficients) - targets[index];
      const absolute = Math.abs(residual);
      return absolute <= options.huberDelta || absolute === 0
        ? 1
        : options.huberDelta / absolute;
    });
  }
  const residuals = matrix.map((row, index) => dot(row, coefficients) - targets[index]);
  return {
    coefficients,
    residuals,
    objective: objective(matrix, targets, coefficients, priorValues, options),
    iterations,
  };
}

export const regularizedNonNegativeLeastSquares =
  solveRegularizedNonNegativeLeastSquares;

const zeroMatrix = (size: number): number[][] =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => 0));

/** Erstellt den rekursiven Filter mit Katalogwerten als Prior. */
export function createRecursiveCalibrationState(
  columnCount: number,
  priors: number[] = [],
): RecursiveCalibrationState {
  const covariance = zeroMatrix(columnCount);
  for (let index = 0; index < columnCount; index += 1) {
    covariance[index][index] = MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance;
  }
  return {
    means: Array.from(
      { length: columnCount },
      (_, index) => {
        const value = priors[index];
        return nonNegative(value) ? value : 1;
      },
    ),
    covariance,
    observations: 0,
  };
}

/** Eine Kalman-Form-Aktualisierung mit Huber-Dämpfung und Prozessrauschen. */
export function updateRecursiveCalibration(
  state: RecursiveCalibrationState,
  values: number[],
  target: number,
): RecursiveCalibrationState {
  const count = state.means.length;
  const prediction = dot(values, state.means);
  const error = target - prediction;
  const absolute = Math.abs(error);
  const robustWeight = absolute <= MUSCLE_MODEL_CONSTANTS.calibrationHuberDelta || absolute === 0
    ? 1
    : MUSCLE_MODEL_CONSTANTS.calibrationHuberDelta / absolute;
  const scaledMeasurementVariance =
    MUSCLE_MODEL_CONSTANTS.calibrationMeasurementVariance / robustWeight;
  const projected = Array.from({ length: count }, (_, index) =>
    state.covariance[index].reduce(
      (sum, value, covarianceIndex) => sum + value * (values[covarianceIndex] ?? 0),
      0,
    ),
  );
  const denominator = dot(values, projected) + scaledMeasurementVariance;
  const gain = denominator > 0
    ? projected.map(value => value / denominator)
    : projected.map(() => 0);
  const means = state.means.map((mean, index) =>
    Math.max(0, mean + gain[index] * error),
  );
  const covariance = zeroMatrix(count);
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      covariance[row][column] =
        state.covariance[row][column] - gain[row] * projected[column] +
        (row === column ? MUSCLE_MODEL_CONSTANTS.processNoiseQ : 0);
    }
  }
  for (let row = 0; row < count; row += 1) {
    for (let column = row + 1; column < count; column += 1) {
      const symmetric = (covariance[row][column] + covariance[column][row]) / 2;
      covariance[row][column] = symmetric;
      covariance[column][row] = symmetric;
    }
    covariance[row][row] = Math.max(0, covariance[row][row]);
  }
  return {
    means,
    covariance,
    observations: state.observations + 1,
  };
}

/** Findet stark gekoppelte Posterior-Koeffizienten und erklärt die fehlende Beobachtung. */
export function detectIdentifiability(
  columns: CalibrationColumn[],
  covariance: number[][],
  threshold = MUSCLE_MODEL_CONSTANTS.posteriorCorrelationThreshold,
): IdentifiabilityExplanation[] {
  const result: IdentifiabilityExplanation[] = [];
  for (let first = 0; first < columns.length; first += 1) {
    for (let second = first + 1; second < columns.length; second += 1) {
      const firstVariance = covariance[first]?.[first] ?? 0;
      const secondVariance = covariance[second]?.[second] ?? 0;
      const denominator = Math.sqrt(firstVariance * secondVariance);
      if (!(denominator > 0)) {
        continue;
      }
      const correlation = (covariance[first]?.[second] ?? 0) / denominator;
      if (Math.abs(correlation) <= threshold) {
        continue;
      }
      result.push({
        code: 'coefficients_not_identifiable',
        first: columns[first],
        second: columns[second],
        correlation,
        reason: `${columns[first].exerciseId} und ${columns[second].exerciseId} werden bisher nicht getrennt beobachtet.`,
        separatingObservation: 'Eine einseitige oder isolierte Übung mit unterschiedlicher Regionsverteilung würde die beiden Koeffizienten trennen.',
      });
    }
  }
  return result;
}

const coupledState = (
  state: RecursiveCalibrationState,
  columns: CalibrationColumn[],
  priors: number[],
  explanations: IdentifiabilityExplanation[],
): RecursiveCalibrationState => {
  const means = [...state.means];
  const covariance = state.covariance.map(row => [...row]);
  for (const explanation of explanations) {
    const first = columns.findIndex(column => column.key === explanation.first.key);
    const second = columns.findIndex(column => column.key === explanation.second.key);
    if (first < 0 || second < 0) {
      continue;
    }
    const ratio = (priors[second] ?? 1) > 0
      ? (priors[first] ?? 1) / (priors[second] ?? 1)
      : 1;
    const scale = (ratio * means[first] + means[second]) / (ratio * ratio + 1);
    means[first] = Math.max(0, ratio * scale);
    means[second] = Math.max(0, scale);
    const variance = Math.max(0, covariance[second][second]);
    covariance[first][first] = ratio * ratio * variance;
    covariance[first][second] = ratio * variance;
    covariance[second][first] = ratio * variance;
    covariance[second][second] = variance;
  }
  return { ...state, means, covariance };
};

const mapCoefficients = (
  columns: CalibrationColumn[],
  values: number[],
): Record<string, number> =>
  Object.fromEntries(columns.map((column, index) => [column.key, values[index] ?? 0]));

const mapCovariance = (
  columns: CalibrationColumn[],
  covariance: number[][],
): Record<string, Record<string, number>> =>
  Object.fromEntries(
    columns.map((row, rowIndex) => [
      row.key,
      Object.fromEntries(
        columns.map((column, columnIndex) => [
          column.key,
          covariance[rowIndex]?.[columnIndex] ?? 0,
        ]),
      ),
    ]),
  );

const defaultPriors = (
  columns: CalibrationColumn[],
  priors: Record<string, number> | undefined,
): number[] =>
  columns.map(column => {
    const value = priors?.[column.key];
    return nonNegative(value) ? value : 1;
  });

const predictRow = (row: DesignMatrixRow, coefficients: number[]): number => {
  const load = Math.max(0, dot(row.values, coefficients));
  return 10 * (1 - Math.exp(-load / row.capacity));
};

/** Wählt Zeitkonstanten aus einem festen Raster mit Leave-one-out-Fehler. */
export function selectTimeConstants(input: CalibrationInput): TimeConstantSelection {
  const grid = input.timeConstantGrid ?? TIME_CONSTANT_GRID;
  const errors = grid.map(candidate => {
    const matrix = buildDesignMatrix({ ...input, timeConstants: candidate });
    const sorenessRows = matrix.rows.filter(row => reportIsSoreness(row.report));
    if (!sorenessRows.length) {
      return { candidate, error: 0 };
    }
    let totalError = 0;
    for (let holdout = 0; holdout < sorenessRows.length; holdout += 1) {
      const trainingRows = sorenessRows.filter((_, index) => index !== holdout);
      const solved = solveRegularizedNonNegativeLeastSquares(
        trainingRows.map(row => row.values),
        trainingRows.map(row => row.target),
        trainingRows[0]?.values.map(() => 1) ?? [],
      );
      totalError += Math.abs(
        predictRow(sorenessRows[holdout], solved.coefficients) -
          sorenessRows[holdout].observedValue,
      );
    }
    return {
      candidate,
      error: totalError / sorenessRows.length,
    };
  });
  const selected = errors.reduce(
    (best, current) => current.error < best.error ? current : best,
    errors[0] ?? { candidate: TIME_CONSTANT_GRID[0], error: 0 },
  );
  return {
    selected: selected.candidate,
    crossValidatedError: selected.error,
    errors,
  };
}

/** Erstellt den persönlichen Koeffizientenstand aus Meldungen und Trainingsbuch. */
export function calibrateModel(input: CalibrationInput): CalibrationState {
  const selection = input.timeConstants
    ? { selected: input.timeConstants, crossValidatedError: 0, errors: [] }
    : selectTimeConstants(input);
  const matrix = buildDesignMatrix({ ...input, timeConstants: selection.selected });
  const priorValues = defaultPriors(matrix.columns, input.priors);
  const batch = solveRegularizedNonNegativeLeastSquares(
    matrix.matrix,
    matrix.targets,
    priorValues,
  );
  let recursive = createRecursiveCalibrationState(matrix.columns.length, priorValues);
  for (const row of matrix.rows) {
    recursive = updateRecursiveCalibration(recursive, row.values, row.target);
  }
  const preliminaryIdentifiability = detectIdentifiability(
    matrix.columns,
    recursive.covariance,
  );
  recursive = coupledState(
    recursive,
    matrix.columns,
    priorValues,
    preliminaryIdentifiability,
  );
  const posteriorVariance = Object.fromEntries(
    matrix.columns.map((column, index) => [
      column.key,
      recursive.covariance[index]?.[index] ?? MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
    ]),
  );
  const coefficients = mapCoefficients(matrix.columns, recursive.means);
  return {
    ...matrix.provenance,
    modelVersion: MUSCLE_MODEL_CONSTANTS.modelVersion,
    catalogVersion: CATALOG_VERSION,
    coefficients,
    priors: mapCoefficients(matrix.columns, priorValues),
    posteriorVariance,
    covariance: mapCovariance(matrix.columns, recursive.covariance),
    timeConstants: selection.selected,
    batchCoefficients: mapCoefficients(matrix.columns, batch.coefficients),
    observations: recursive.observations,
    reports: input.reports.map(report => ({ ...report })),
    columns: matrix.columns,
    identifiability: preliminaryIdentifiability,
    selection,
    provenance: matrix.provenance,
  };
}

/** Setzt nur den gelernten Koeffizientenstand zurück; Meldungen bleiben erhalten. */
export function resetCalibration(state: CalibrationState): CalibrationState {
  const priors = state.columns.map(column => state.priors[column.key] ?? 1);
  const recursive = createRecursiveCalibrationState(state.columns.length, priors);
  return {
    ...state,
    coefficients: mapCoefficients(state.columns, recursive.means),
    posteriorVariance: Object.fromEntries(
      state.columns.map((column, index) => [
        column.key,
        recursive.covariance[index]?.[index] ?? MUSCLE_MODEL_CONSTANTS.calibrationPriorVariance,
      ]),
    ),
    covariance: mapCovariance(state.columns, recursive.covariance),
    batchCoefficients: mapCoefficients(state.columns, recursive.means),
    observations: 0,
    identifiability: [],
    reports: state.reports.map(report => ({ ...report })),
  };
}

export const resetLearnedCoefficients = resetCalibration;

/** Öffentliche Ähnlichkeitsfunktion für neue oder eigene Übungen. */
export const exerciseSimilarity = cosineShareSimilarity;

/** Öffentliche Partial-Pooling-Funktion für neue Übungen. */
export { partialPoolCoefficient };
