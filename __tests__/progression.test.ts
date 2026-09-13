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

  it('verwendet geplante Werte nicht als Trainingsbeleg', () => {
    const plannedOnly = session('planned', 0, 100);
    plannedOnly.exercises[0].sets[1].actualWeightKg = undefined;
    plannedOnly.exercises[0].sets[1].actualReps = undefined;
    expect(buildE1RMSeries([plannedOnly], 'squat')).toEqual([]);
  });

  it('mischt keine Zeitsätze oder andere Lastarten in die Lastserie', () => {
    const timed = session('timed', 0, 100);
    timed.exercises[0].sets[1].planned.kind = 'timed';
    timed.exercises[0].sets[1].planned.seconds = 30;
    const bodyweight = session('bodyweight', 7, 100);
    bodyweight.exercises[0].sets[1].planned.loadKind = 'bodyweight';
    expect(buildE1RMSeries([timed, bodyweight], 'squat')).toEqual([]);
  });

  const rising = [
    session('s1', 0, 100),
    session('s2', 7, 103),
    session('s3', 14, 106),
    session('s4', 21, 109),
    session('s5', 28, 112),
  ];
  const flat = [
    session('s1', 0, 100),
    session('s2', 7, 100),
    session('s3', 14, 100),
    session('s4', 21, 100),
    session('s5', 28, 100),
  ];

  it('lässt Frischemodulation die Richtung eines Vorschlags nicht umkippen', () => {
    const result = assessExerciseProgression(rising, 'squat', {
      regionFreshness: 0,
    });
    expect(result.verdict).toBe('increase');
    expect(result.suggestion?.targetRange.targetKg).toBeGreaterThanOrEqual(112);
    expect(result.suggestion?.targetRange.minKg).toBeGreaterThanOrEqual(112);
  });

  it('behauptet aus drei monotonen Einheiten keine Richtung', () => {
    // 99 → 100 → 101: unter „kein Trend“ ist jede dritte Reihenfolge monoton.
    const result = assessExerciseProgression(
      [session('s1', 0, 99), session('s2', 7, 100), session('s3', 14, 101)],
      'squat',
    );
    expect(result.verdict).toBe('not_assessable');
    expect(result.trend).toBeNull();
    expect(result.suggestion).toBeNull();
    expect(result.reason).toMatch(/fehlen noch 2/);
  });

  it('nutzt ab fünf Tagen die exakte Verteilung: nur perfekt monoton ist eine Richtung', () => {
    const oneDip = assessExerciseProgression(
      [
        session('s1', 0, 100),
        session('s2', 7, 104),
        session('s3', 14, 103),
        session('s4', 21, 108),
        session('s5', 28, 112),
      ],
      'squat',
    );
    expect(oneDip.trend?.confidenceInterval.exact).toBe(true);
    expect(oneDip.trend?.confidenceInterval.lowerRank).toBe(0);
    expect(oneDip.verdict).toBe('keep_going');
    expect(assessExerciseProgression(rising, 'squat').verdict).toBe('increase');
  });

  it('zählt zwei Einheiten am selben Tag als einen Trainingstag', () => {
    const sameDay = [...rising.slice(0, 4), session('s4b', 21, 111)];
    const result = assessExerciseProgression(sameDay, 'squat');
    expect(result.verdict).toBe('not_assessable');
    expect(result.reason).toMatch(/fehlt noch einer/);
  });

  it('erreicht den Keep-going-Verdikt eigenständig', () => {
    const result = assessExerciseProgression(
      [
        session('s1', 0, 100),
        session('s2', 7, 100),
        session('s3', 14, 101),
        session('s4', 21, 99),
        session('s5', 28, 102),
      ],
      'squat',
    );
    expect(result.verdict).toBe('keep_going');
    expect(result.suggestion?.verdict).toBe('keep_going');
    expect(result.plateau.status).toBe('unclear');
  });

  it('macht ein Prüfkriterium für jeden erzeugten Vorschlag verpflichtend', () => {
    const results: ProgressionAssessment[] = [
      assessExerciseProgression(rising, 'squat'),
      assessExerciseProgression(flat, 'squat'),
    ];
    for (const result of results) {
      expect(result.suggestion).not.toBeNull();
      expect(result.suggestion?.reason).toBeTruthy();
      expect(result.suggestion?.targetRange).toBeTruthy();
      expect(result.suggestion?.expectedEffort).toBeTruthy();
      expect(result.suggestion?.checkCriterion.method).toBe('strength-e1rm-v2');
      expect(
        result.suggestion?.checkCriterion.minimumRelevantChangePercent,
      ).toBe(4);
    }
  });

  it('lässt ein einzelnes schlechtes Training den Trend nicht kippen', () => {
    const result = assessExerciseProgression(
      [
        session('s1', 0, 100, 1),
        session('s2', 5, 105, 1),
        session('bad-day', 10, 80, 1),
        session('s4', 15, 115, 1),
        session('s5', 20, 118, 1),
      ],
      'squat',
    );
    expect(result.trend?.slopePerWeek).toBeGreaterThan(-1);
    expect(result.verdict).not.toBe('reduce');
    expect(result.cusum?.changePoints).toEqual([]);
  });

  it('nennt nur ein enges Intervall um null ein Plateau', () => {
    const stable = assessExerciseProgression(flat, 'squat');
    expect(stable.plateau.status).toBe('stable');
    expect(stable.verdict).toBe('plateau');
    // 100 → 160 → 70 → 140 → 100: Intervall −90…+70 kg/Woche ist kein Plateau.
    const noisy = assessExerciseProgression(
      [
        session('s1', 0, 100),
        session('s2', 7, 160),
        session('s3', 14, 70),
        session('s4', 21, 140),
        session('s5', 28, 100),
      ],
      'squat',
    );
    expect(noisy.plateau.status).toBe('unclear');
    expect(noisy.verdict).toBe('keep_going');
    expect(noisy.trend?.confidenceInterval.lower).toBeLessThan(-50);
  });

  it('unterscheidet das Vier-Wochen-Plateau von einer Dreierregel', () => {
    const short = [
      session('s1', 0, 100),
      session('s2', 3, 100),
      session('s3', 6, 100),
      session('s4', 9, 100),
      session('s5', 12, 100),
    ];
    const series = buildE1RMSeries(short, 'squat');
    const trend = assessExerciseProgression(short, 'squat').trend;
    expect(trend).not.toBeNull();
    expect(assessPlateau(series, trend).isPlateau).toBe(false);
    expect(assessPlateau(series, trend).status).toBe('unclear');
    expect(assessExerciseProgression(flat, 'squat').plateau.isPlateau).toBe(
      true,
    );
  });

  it('nimmt Sätze über zwölf Wiederholungen nicht in die e1RM-Serie', () => {
    const series = buildE1RMSeries(
      [session('short', 0, 100, 10), session('long', 7, 60, 20)],
      'squat',
    );
    expect(series.map(point => point.sessionId)).toEqual(['short']);
  });

  it('liefert bei zu wenig Evidenz keine Zahl und keinen Scheinvorschlag', () => {
    const result = assessExerciseProgression([session('s1', 0, 100)], 'squat');
    expect(result.verdict).toBe('not_assessable');
    expect(result.suggestion).toBeNull();
    expect(result.trend).toBeNull();
  });
});
