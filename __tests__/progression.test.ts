import {
  assessExerciseProgression,
  assessPlateau,
  buildE1RMSeries,
  type ProgressionAssessment,
} from '../src/domain/progression';
import type { StrengthSession } from '../src/domain/strength';

const DAY = 24 * 60 * 60 * 1000;

function session(
  id: string,
  day: number,
  weightKg: number,
  reps = 5,
  status: StrengthSession['status'] = 'finished',
): StrengthSession {
  const at = day * DAY;
  return {
    id,
    kind: 'strength',
    name: 'Unterkörper',
    startTime: at,
    endTime: at + 60 * 60 * 1000,
    status,
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v1',
    exercises: [
      {
        exerciseId: 'squat',
        name: 'Kniebeuge',
        sets: [
          {
            id: `${id}-warmup`,
            planned: {
              kind: 'warmup',
              loadKind: 'kg',
              weightKg: weightKg * 4,
              reps,
              restSeconds: 60,
            },
            actualWeightKg: weightKg * 4,
            actualReps: reps,
            completedAt: at + 100,
          },
          {
            id: `${id}-work`,
            planned: {
              kind: 'normal',
              loadKind: 'kg',
              weightKg,
              reps,
              restSeconds: 120,
            },
            actualWeightKg: weightKg,
            actualReps: reps,
            completedAt: at + 200,
          },
        ],
      },
    ],
  };
}

describe('Kraftprogression', () => {
  it('führt nur abgeschlossene Arbeitssätze in die e1RM-Serie ein', () => {
    const series = buildE1RMSeries(
      [session('finished', 0, 100), session('active', 7, 200, 5, 'active')],
      'squat',
    );
    expect(series).toHaveLength(1);
    expect(series[0].weightKg).toBe(100);
  });

  it('erreicht den Keep-going-Verdikt eigenständig', () => {
    const result = assessExerciseProgression(
      [session('s1', 0, 100), session('s2', 7, 100), session('s3', 14, 101)],
      'squat',
    );
    expect(result.verdict).toBe('keep_going');
    expect(result.suggestion?.verdict).toBe('keep_going');
  });

  it('macht ein Prüfkriterium für jeden erzeugten Vorschlag verpflichtend', () => {
    const results: ProgressionAssessment[] = [
      assessExerciseProgression(
        [session('s1', 0, 100), session('s2', 7, 105), session('s3', 14, 110)],
        'squat',
      ),
      assessExerciseProgression(
        [session('s1', 0, 100), session('s2', 7, 100), session('s3', 14, 100)],
        'squat',
      ),
    ];
    for (const result of results) {
      expect(result.suggestion).not.toBeNull();
      expect(result.suggestion?.reason).toBeTruthy();
      expect(result.suggestion?.targetRange).toBeTruthy();
      expect(result.suggestion?.expectedEffort).toBeTruthy();
      expect(result.suggestion?.checkCriterion).toBeTruthy();
    }
  });

  it('lässt ein einzelnes schlechtes Training den Trend nicht kippen', () => {
    const result = assessExerciseProgression(
      [
        session('s1', 0, 100, 1),
        session('s2', 5, 105, 1),
        session('bad-day', 10, 80, 1),
        session('s4', 15, 115, 1),
      ],
      'squat',
    );
    expect(result.trend?.slopePerWeek).toBeGreaterThan(-1);
    expect(result.verdict).not.toBe('reduce');
    expect(result.cusum?.changePoints).toEqual([]);
  });

  it('unterscheidet das Vier-Wochen-Plateau von einer Dreierregel', () => {
    const series = buildE1RMSeries(
      [session('s1', 0, 100), session('s2', 7, 100), session('s3', 14, 100), session('s4', 28, 100)],
      'squat',
    );
    const trend = assessExerciseProgression(
      [session('s1', 0, 100), session('s2', 7, 100), session('s3', 14, 100), session('s4', 28, 100)],
      'squat',
    ).trend;
    expect(assessPlateau(series, trend).isPlateau).toBe(true);
    expect(assessPlateau(series.slice(0, 3), trend).isPlateau).toBe(false);
  });

  it('liefert bei zu wenig Evidenz keine Zahl und keinen Scheinvorschlag', () => {
    const result = assessExerciseProgression([session('s1', 0, 100)], 'squat');
    expect(result.verdict).toBe('not_assessable');
    expect(result.suggestion).toBeNull();
    expect(result.trend).toBeNull();
  });
});
