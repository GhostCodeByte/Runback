import { analyzeRun } from '../src/domain/analysis';
import {
  activeExperimentFor,
  couplingGate,
  influencedAreas,
  recommendationArea,
} from '../src/domain/areas';
import {
  acceptRecommendation,
  evaluateAnyExperiment,
} from '../src/domain/experiments';
import { focusTypesFor, suggestedFocus } from '../src/domain/focus';
import { relevance } from '../src/domain/prioritization';
import { selectRecommendations } from '../src/domain/recommendationSelection';
import type { StrengthSession } from '../src/domain/strength';
import {
  evaluateStrengthExperiment,
  selectStrengthRecommendation,
  strengthRecommendationFor,
} from '../src/domain/strengthRecommendation';
import type { RunSummary, StrengthRecommendation } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;

function session(
  id: string,
  day: number,
  weightKg: number,
  exerciseId = 'barbell_back_squat',
  reps = 5,
): StrengthSession {
  const at = day * DAY;
  return {
    id,
    kind: 'strength',
    name: 'Unterkörper',
    startTime: at,
    endTime: at + 3600000,
    status: 'finished',
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v1',
    exercises: [
      {
        exerciseId,
        name: exerciseId === 'barbell_back_squat' ? 'Kniebeuge' : 'Bankdrücken',
        sets: [
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
const run = (id: string, startTime: number): RunSummary => ({
  id,
  startTime,
  endTime: startTime + 1320000,
  durationSeconds: 1320,
  distanceMeters: 2000,
  purpose: 'easy',
  source: 'test',
  status: 'complete',
  segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
    id: `${id}:${index}`,
    durationSeconds,
    distanceMeters: 500,
    gradePercent: 0,
  })),
});
const legSessions = [
  session('s1', 0, 100),
  session('s2', 7, 105),
  session('s3', 14, 110),
];
const benchSessions = [
  session('b1', 0, 60, 'barbell_bench_press'),
  session('b2', 7, 62.5, 'barbell_bench_press'),
  session('b3', 14, 65, 'barbell_bench_press'),
];
const now = 20 * DAY;
const options = { today: '2026-09-12', now };

describe('Zwei Bereiche', () => {
  it('ordnet Empfehlungen ihrem Bereich zu; ohne Feld gilt Laufen', () => {
    const running = analyzeRun(run('r', 0)).recommendation!;
    const strength = strengthRecommendationFor(
      legSessions,
      'barbell_back_squat',
      now,
    ).recommendation!;
    expect(recommendationArea(running)).toBe('running');
    expect(recommendationArea({ ...running, area: undefined })).toBe('running');
    expect(recommendationArea(strength)).toBe('strength');
    expect(strength.kind).toBe('strength_load');
    expect(strength.direction).toBe('increase');
    expect(strength.criteria.baselineSessionIds).toEqual(['s1', 's2', 's3']);
  });

  it('erlaubt je Bereich eine aktive Empfehlung, aber nie zwei im selben', () => {
    const running = acceptRecommendation(
      analyzeRun(run('r', 0)).recommendation!,
      1000,
    );
    const bench = strengthRecommendationFor(
      benchSessions,
      'barbell_bench_press',
      now,
    ).recommendation!;
    // Anderer Bereich blockiert die Annahme nicht.
    const strength = acceptRecommendation(bench, 2000, running);
    const all = [running, strength];
    expect(activeExperimentFor(all, 'running')?.id).toBe(running.id);
    expect(activeExperimentFor(all, 'strength')?.id).toBe(strength.id);
    // Gleicher Bereich: erst beenden.
    expect(() => acceptRecommendation(bench, 3000, strength)).toThrow(
      'Zuerst die bestehende Empfehlung beenden.',
    );
  });

  it('sperrt Beinlast-Empfehlungen, solange eine Laufempfehlung geprüft wird', () => {
    const running = acceptRecommendation(
      analyzeRun(run('r', 0)).recommendation!,
      1000,
    );
    const squat = strengthRecommendationFor(
      legSessions,
      'barbell_back_squat',
      now,
    ).recommendation!;
    const bench = strengthRecommendationFor(
      benchSessions,
      'barbell_bench_press',
      now,
    ).recommendation!;
    expect(influencedAreas(squat)).toEqual(['running']);
    expect(influencedAreas(bench)).toEqual([]);
    expect(couplingGate(squat, [running]).blocked).toMatch(/Laufen/);
    expect(couplingGate(bench, [running]).blocked).toBeUndefined();
    // Symmetrisch: eine laufende Beinlast-Empfehlung sperrt Laufvorschläge.
    const legs = acceptRecommendation(squat, 1000);
    expect(
      couplingGate(analyzeRun(run('r2', 0)).recommendation!, [legs]).blocked,
    ).toMatch(/Krafttraining/);
    const selection = selectRecommendations([run('r3', 5000)], {
      ...options,
      otherActive: [legs],
    });
    expect(selection.selected).toBeUndefined();
    expect(selection.alternatives[0].reason).toMatch(/Krafttraining/);
  });

  it('wählt im Krafttraining höchstens eine Empfehlung und zeigt den Rest als Alternative', () => {
    const result = selectStrengthRecommendation(
      [...legSessions, ...benchSessions],
      {
        ...options,
        focus: {
          version: 'focus-v1',
          kind: 'strength',
          label: '',
          area: 'strength',
        },
      },
    );
    expect(result.selected?.kind).toBe('strength_load');
    expect(result.selected?.priority).toEqual({
      version: 'relevance-v2',
      focusLabel: 'Stärker werden',
      weight: 5,
    });
    expect(result.alternatives).toHaveLength(1);
    // Reihenfolge der Eingabe ändert die Auswahl nicht.
    expect(
      selectStrengthRecommendation([...benchSessions, ...legSessions], options)
        .selected?.id,
    ).toBe(
      selectStrengthRecommendation([...legSessions, ...benchSessions], options)
        .selected?.id,
    );
  });

  it('prüft eine Lastempfehlung an späteren Einheiten mit getrennter Umsetzung', () => {
    const squat = strengthRecommendationFor(
      legSessions,
      'barbell_back_squat',
      now,
    ).recommendation!;
    const experiment = acceptRecommendation(squat, now);
    const inRange = squat.criteria.targetMinKg;
    const later = [
      session('s4', 21, inRange),
      session('s5', 28, inRange),
      session('s6', 35, inRange),
    ];
    const evaluation = evaluateStrengthExperiment(experiment, [
      ...legSessions,
      ...later,
    ]);
    expect(evaluation.eligibleRunIds).toEqual(['s4', 's5', 's6']);
    expect(evaluation.adherence.every(item => item.value === 'yes')).toBe(true);
    expect(evaluation.causalClaim).toBe(false);
    expect(['improved', 'insufficient_evidence']).toContain(evaluation.verdict);
    // Nicht umgesetzt heißt nicht widerlegt.
    const skipped = evaluateStrengthExperiment(experiment, [
      ...legSessions,
      session('s4', 21, 50),
      session('s5', 28, 50),
      session('s6', 35, 50),
    ]);
    expect(skipped.verdict).toBe('not_implemented');
    expect(
      evaluateAnyExperiment(experiment, [], [...legSessions, ...later]).verdict,
    ).toBe(evaluation.verdict);
  });

  it('hat je Bereich eigene Fokus-Arten und Vorschläge', () => {
    expect(focusTypesFor('strength').map(item => item.value)).toContain(
      'strength',
    );
    expect(focusTypesFor('running').map(item => item.value)).not.toContain(
      'strength',
    );
    expect(suggestedFocus('100 kg Kniebeuge', 'strength')).toBe('strength');
    expect(suggestedFocus('Halbmarathon', 'running')).toBe('endurance');
    expect(relevance('strength_load', 'strength').weight).toBe(5);
    expect(relevance('strength_load', 'fitness').weight).toBe(0);
    expect(relevance('volume', 'injury_free').blocked).toBeTruthy();
  });
});

// Typprobe: die Snapshot-Struktur bleibt serialisierbar.
const _probe: StrengthRecommendation['criteria']['method'] = 'strength-e1rm-v1';
void _probe;
