import {
  acceptRecommendation,
  analyzeRun,
  evaluateExperiment,
  scheduleCue,
  transitionExperiment,
} from '../src/domain';
import type { Recommendation, RunSummary } from '../src/domain';

const segment = (durationSeconds: number, id?: string) => ({
  id,
  distanceMeters: 500,
  durationSeconds,
  gradePercent: 0,
  phase: 'work' as const,
});

const run = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-1',
  startTime: 0,
  endTime: 1200000,
  durationSeconds: 1200,
  distanceMeters: 2000,
  purpose: 'easy',
  source: 'test',
  status: 'complete',
  segments: [
    segment(300, 's1'),
    segment(300, 's2'),
    segment(360, 's3'),
    segment(360, 's4'),
  ],
  ...overrides,
});

const DAY = 86400000;
const BASE_START = 30 * DAY;
/** Zwei vergleichbare Vorläufe mit demselben Tempoabfall. */
const history = (overrides: Partial<RunSummary> = {}): RunSummary[] =>
  [1, 2].map(index =>
    run({
      ...overrides,
      id: `prev-${index}`,
      startTime: BASE_START - index * 7 * DAY,
      endTime: BASE_START - index * 7 * DAY + 1200000,
    }),
  );
const baseline = (overrides: Partial<RunSummary> = {}): RunSummary =>
  run({ startTime: BASE_START, endTime: BASE_START + 1200000, ...overrides });
const recommendation = (): Recommendation => {
  const result = analyzeRun(baseline(), undefined, history());
  expect(result.recommendation).toBeDefined();
  return result.recommendation!;
};

describe('domain rules', () => {
  it('keeps an unknown purpose neutral and asks whether variable pacing was intentional', () => {
    const result = analyzeRun(run({ purpose: 'unknown' }));

    expect(result.state).toBe('insufficient');
    expect(result.focus).toMatch(/Ohne beabsichtigten Laufzweck/);
    expect(result.question?.id).toBe('purpose-run-1');
    expect(result.recommendation).toBeUndefined();
  });

  it('reports insufficient data without inventing a pacing recommendation', () => {
    const result = analyzeRun(
      run({ durationSeconds: 0, distanceMeters: 0, segments: [] }),
    );

    expect(result.state).toBe('insufficient');
    expect(result.pacing).toBeUndefined();
    expect(result.recommendation).toBeUndefined();
    expect(result.quality.paceUsable).toBe(false);
  });

  it('recommends a calmer start when the median of comparable flat runs fades late', () => {
    const result = analyzeRun(baseline(), undefined, history());

    expect(result.state).toBe('recommendation');
    expect(result.pacing?.fadePercent).toBeCloseTo(20, 5);
    expect(result.recommendation?.kind).toBe('calmer_start');
    expect(result.recommendation?.criteria.method).toBe('pacing-fade-v2');
    expect(result.recommendation?.criteria.baselineRunIds).toEqual([
      'run-1',
      'prev-1',
      'prev-2',
    ]);
    expect(result.recommendation?.criteria.baselineFadePercent).toBeCloseTo(
      20,
      5,
    );
    expect(result.recommendation?.criteria.minimumObservations).toBe(6);
    expect(result.recommendation?.action).toMatch(/5 % ruhiger/);
    expect(result.recommendation?.goal).toMatch(/keine Aussage über Leistung/);
  });

  it('does not build a recommendation on a single outlier run', () => {
    const alone = analyzeRun(baseline());
    expect(alone.state).toBe('insufficient');
    expect(alone.recommendation).toBeUndefined();
    expect(alone.focus).toMatch(/1 von 3/);

    // Zwei normale Vorläufe: der Median liegt unter 8 %, der Ausreißer zählt nicht.
    const calm = history({
      segments: [segment(300), segment(300), segment(306), segment(306)],
    });
    const withCalmHistory = analyzeRun(baseline(), undefined, calm);
    expect(withCalmHistory.state).toBe('maintain');
    expect(withCalmHistory.focus).toMatch(/Median/);
  });

  it('does not use runs of another purpose, another size or a slope as comparison', () => {
    const mismatched = [
      ...history({ purpose: 'long' }),
      ...history({ distanceMeters: 4000 }).map((item, index) => ({
        ...item,
        id: `far-${index}`,
      })),
      ...history({
        segments: [
          { ...segment(300), ascentMeters: 20, descentMeters: 20 },
          segment(300),
          segment(360),
          segment(360),
        ],
      }).map((item, index) => ({ ...item, id: `hilly-${index}` })),
    ];
    expect(analyzeRun(baseline(), undefined, mismatched).state).toBe(
      'insufficient',
    );
  });

  it('freezes an accepted experiment snapshot and enforces immutable terminal states', () => {
    const accepted = acceptRecommendation(recommendation(), 1000);

    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.recommendation)).toBe(true);
    expect(Object.isFrozen(accepted.recommendation.criteria)).toBe(true);
    (accepted.recommendation.criteria as any).minimumObservations = 1;
    expect(accepted.recommendation.criteria.minimumObservations).toBe(6);

    const completed = transitionExperiment(
      accepted,
      'completed',
      2000,
      'Prüfung beendet',
    );
    expect(() =>
      transitionExperiment(completed, 'active', 3000, 'wieder öffnen'),
    ).toThrow(/Beendete Empfehlungen/);
  });

  const followup = (
    id: string,
    index: number,
    lateSeconds: number,
  ): RunSummary =>
    run({
      id,
      startTime: BASE_START + (index + 1) * 3 * DAY,
      endTime: BASE_START + (index + 1) * 3 * DAY + 1200000,
      context: { temperatureC: 10, windMps: 1 },
      segments: [
        segment(300),
        segment(300),
        segment(lateSeconds),
        segment(lateSeconds),
      ],
    });

  it('tracks adherence while keeping evaluation explicitly non-causal', () => {
    const base = baseline({
      id: 'baseline',
      context: { temperatureC: 10, windMps: 1 },
    });
    const accepted = acceptRecommendation(
      analyzeRun(base, undefined, history()).recommendation!,
      BASE_START + 1000,
    );
    const followups = Array.from({ length: 6 }, (_, index) =>
      followup(`follow-${index + 1}`, index, 330),
    );

    const result = evaluateExperiment(
      accepted,
      [base, ...followups],
      Object.fromEntries(followups.map(r => [r.id, 'yes'])),
    );

    expect(result.verdict).toBe('improved');
    expect(result.signTest).toMatchObject({ positives: 6, negatives: 0 });
    expect(result.signTest?.pValue).toBeCloseTo(2 / 64, 6);
    expect(result.summary).toMatch(/gleichmäßiger/);
    expect(result.summary).toMatch(/sagt das nichts/);
    expect(result.eligibleRunIds).toHaveLength(6);
    expect(
      result.adherence.every(a => a.value === 'yes' && a.source === 'reported'),
    ).toBe(true);
    expect(result.causalClaim).toBe(false);
    expect(result.summary).toMatch(/kein Ursachennachweis/);
  });

  it('enforces cue hourly budget and per-rule cooldown', () => {
    const input = {
      now: 3600000,
      enabled: true,
      purpose: 'easy' as const,
      targetPaceSecondsPerKm: 360,
      currentPaceSecondsPerKm: 320,
      history: [],
      hourlyBudget: 1,
    };
    const first = scheduleCue(input);
    expect(first?.ruleId).toBe('ease-start');

    expect(scheduleCue({ ...input, history: [first!] })).toBeUndefined();
    expect(
      scheduleCue({
        ...input,
        history: [{ ...first!, at: input.now - 60000 }],
      }),
    ).toBeUndefined();
    expect(
      scheduleCue({
        ...input,
        history: [{ ...first!, at: input.now - 3600001 }],
      }),
    ).toBeDefined();
  });

  it('one rainy run does not block the verdict: eight of nine still passes the sign test', () => {
    const base = baseline({
      id: 'baseline',
      context: { temperatureC: 10, windMps: 1 },
    });
    const accepted = acceptRecommendation(
      analyzeRun(base, undefined, history()).recommendation!,
      BASE_START + 1000,
    );
    const seconds = [330, 330, 330, 330, 330, 330, 330, 330, 400];
    const followups = seconds.map((late, index) =>
      followup(`mixed-${index + 1}`, index, late),
    );
    const result = evaluateExperiment(
      accepted,
      [base, ...followups],
      Object.fromEntries(followups.map(r => [r.id, 'yes'])),
    );
    expect(result.signTest).toMatchObject({ positives: 8, negatives: 1 });
    expect(result.verdict).toBe('improved');
  });

  it('keeps pace analysis usable when sample count and heart-rate data are corrupt', () => {
    const result = analyzeRun(
      baseline({ samples: Number.NaN, avgHeartRate: 999 }),
      undefined,
      history(),
    );

    expect(result.quality.paceUsable).toBe(true);
    expect(
      result.quality.issues.some(issue => issue.code === 'implausible_hr'),
    ).toBe(false);
    expect(result.state).toBe('recommendation');
  });

  it('does not turn intentionally varying interval pacing into a recommendation', () => {
    const result = analyzeRun(run({ purpose: 'intervals' }));

    expect(result.state).toBe('insufficient');
    expect(result.recommendation).toBeUndefined();
    expect(result.focus).toMatch(/Temposchwankungen/);
  });

  it('deduplicates canonical duplicate evidence before evaluating adherence', () => {
    const base = baseline({
      id: 'baseline',
      context: { temperatureC: 10, windMps: 1 },
    });
    const accepted = acceptRecommendation(
      analyzeRun(base, undefined, history()).recommendation!,
      BASE_START + 1000,
    );
    const follow = {
      ...followup('follow-original', 0, 330),
      canonicalId: 'native-run-1',
    };
    const duplicate = { ...follow, id: 'follow-duplicate' };

    const result = evaluateExperiment(accepted, [follow, duplicate], {
      [follow.id]: 'yes',
      [duplicate.id]: 'yes',
    });

    expect(result.eligibleRunIds).toEqual(['follow-original']);
    expect(result.adherence).toHaveLength(1);
  });

  it('does not call a tiny stable change a relevant effect', () => {
    const base = baseline({
      id: 'baseline',
      context: { temperatureC: 10, windMps: 1 },
    });
    const accepted = acceptRecommendation(
      analyzeRun(base, undefined, history()).recommendation!,
      BASE_START + 1000,
    );
    const followups = Array.from({ length: 6 }, (_, index) =>
      followup(`tiny-${index + 1}`, index, 363),
    );
    const result = evaluateExperiment(
      accepted,
      [base, ...followups],
      Object.fromEntries(followups.map(r => [r.id, 'yes'])),
    );

    expect(result.verdict).toBe('no_relevant_effect');
    expect(result.signTest?.ties).toBe(6);
    expect(result.summary).toMatch(/innerhalb von ±3/);
    // Baseline fade 20%, follow-up fade 21%: one percentage point worse.
    expect(result.changePercentPoints).toBeCloseTo(-1, 3);
  });

  it('cannot reach a final effect verdict when adherence is unknown', () => {
    const base = baseline({
      id: 'baseline',
      context: { temperatureC: 10, windMps: 1 },
    });
    const accepted = acceptRecommendation(
      analyzeRun(base, undefined, history()).recommendation!,
      BASE_START + 1000,
    );
    const followups = Array.from({ length: 6 }, (_, index) =>
      followup(`unknown-${index + 1}`, index, 330),
    );
    const reported = Object.fromEntries(
      followups.map(r => [r.id, 'unknown']),
    ) as Record<string, 'unknown'>;
    const result = evaluateExperiment(accepted, [base, ...followups], reported);

    expect(result.verdict).toBe('insufficient_evidence');
    expect(result.adherence.every(a => a.value === 'unknown')).toBe(true);
    expect(result.causalClaim).toBe(false);
  });
});
