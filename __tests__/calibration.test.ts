import {
  buildDesignMatrix,
  calibrateModel,
  detectIdentifiability,
  partialPoolCoefficient,
  resetCalibration,
  selectTimeConstants,
  solveRegularizedNonNegativeLeastSquares,
  updateRecursiveCalibration,
  createRecursiveCalibrationState,
  type CalibrationColumn,
} from '../src/domain/calibration';
import { catalogExercise } from '../src/domain/catalog';
import type { StrengthSession } from '../src/domain/strength';

const hour = 60 * 60 * 1000;
const base = 2_000_000;

const session: StrengthSession = {
  id: 'calibration-session',
  kind: 'strength',
  name: 'Kalibrierung',
  startTime: base,
  endTime: base + 60 * 1000,
  status: 'finished',
  currentExercise: 0,
  modelVersion: 'strength-v1',
  catalogVersion: 'catalog-v1',
  exercises: [{
    exerciseId: 'leg_extension',
    name: 'Beinstrecker',
    sets: [{
      id: 'calibration-set',
      planned: {
        kind: 'failure',
        loadKind: 'kg',
        reps: 10,
        weightKg: 60,
        restSeconds: 60,
      },
      actualReps: 10,
      actualWeightKg: 60,
      completedAt: base,
    }],
  }],
};

describe('Kalibrierung', () => {
  it('bildet Meldungen linear in eine Entwurfsmatrix ab', () => {
    const result = buildDesignMatrix({
      sessions: [session],
      reports: [{ at: base + 24 * hour, regionId: 'quad_l', value: 5 }],
    });
    expect(result.columns.map(column => column.key)).toEqual(['leg_extension|quad']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].target).toBeGreaterThan(0);
    expect(result.matrix[0][0]).toBeGreaterThan(0);
  });

  it('hält die Lösung nichtnegativ und robust gegen einen Ausreißer', () => {
    const result = solveRegularizedNonNegativeLeastSquares(
      [[1], [1], [1]],
      [2, 2, 50],
      [1],
      { huberDelta: 2, regularizationLambda: 0.1 },
    );
    expect(result.coefficients[0]).toBeGreaterThanOrEqual(0);
    expect(result.coefficients[0]).toBeLessThan(20);
  });

  it('senkt die Posteriorvarianz bei einer rekursiven Beobachtung', () => {
    const initial = createRecursiveCalibrationState(1, [1]);
    const updated = updateRecursiveCalibration(initial, [1], 3);
    expect(updated.means[0]).toBeGreaterThan(initial.means[0]);
    expect(updated.covariance[0][0]).toBeLessThan(initial.covariance[0][0]);
  });

  it('erklärt stark korrelierte Koeffizienten maschinenlesbar', () => {
    const columns: CalibrationColumn[] = [
      { key: 'a|quad', exerciseId: 'a', regionId: 'quad' },
      { key: 'b|quad', exerciseId: 'b', regionId: 'quad' },
    ];
    const result = detectIdentifiability(columns, [[1, 0.95], [0.95, 1]]);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('coefficients_not_identifiable');
    expect(result[0].first.exerciseId).toBe('a');
    expect(result[0].second.exerciseId).toBe('b');
    expect(result[0].separatingObservation).toContain('isolierte');
  });

  it('wählt das Zeitraster deterministisch und bewahrt Meldungen beim Zurücksetzen', () => {
    const input = {
      sessions: [session],
      reports: [
        { at: base + 12 * hour, regionId: 'quad_l', value: 3 },
        { at: base + 24 * hour, regionId: 'quad_l', value: 5 },
        { at: base + 48 * hour, regionId: 'quad_l', value: 2 },
      ],
    };
    const first = selectTimeConstants(input);
    const second = selectTimeConstants(input);
    expect(first).toEqual(second);
    const calibrated = calibrateModel(input);
    expect(calibrated.observations).toBe(3);
    expect(calibrated.reports).toHaveLength(3);
    const reset = resetCalibration(calibrated);
    expect(reset.reports).toHaveLength(3);
    expect(reset.coefficients['leg_extension|quad']).toBe(1);
  });

  it('überträgt gelernte Werte per Anteilsähnlichkeit auf neue Übungen', () => {
    const target = {
      id: 'user-leg-extension',
      name: 'Eigene Beinstreckung',
      equipment: 'machine' as const,
      unilateral: false,
      eccentric: 1,
      shares: { quad: 1 },
      origin: 'user' as const,
    };
    const source = catalogExercise('leg_extension')!;
    const result = partialPoolCoefficient(
      target,
      'quad',
      {
        coefficients: { 'leg_extension|quad': 2 },
        posteriorVariance: { 'leg_extension|quad': 0.2 },
      },
      [source],
    );
    expect(result.source).toBe('similarity');
    expect(result.value).toBeCloseTo(2, 8);
  });
});
