import {
  acceptRecommendation,
  activityKindLabel,
  analyzeRun,
  evaluateExperiment,
  isRunActivity,
  scheduleCue,
  suggestPurpose,
  transitionExperiment,
} from '../src/domain';
import type {Recommendation, RunSummary} from '../src/domain';

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
  segments: [segment(300, 's1'), segment(300, 's2'), segment(360, 's3'), segment(360, 's4')],
  ...overrides,
});

const recommendation = (): Recommendation => {
  const result = analyzeRun(run());
  expect(result.recommendation).toBeDefined();
  return result.recommendation!;
};

describe('domain rules', () => {
  it('keeps an unknown purpose neutral and asks whether variable pacing was intentional', () => {
    const result = analyzeRun(run({purpose: 'unknown'}));

    expect(result.state).toBe('insufficient');
    expect(result.focus).toMatch(/Ohne beabsichtigten Laufzweck/);
    expect(result.question?.id).toBe('purpose-run-1');
    expect(result.recommendation).toBeUndefined();
  });

  it('reports insufficient data without inventing a pacing recommendation', () => {
    const result = analyzeRun(run({durationSeconds: 0, distanceMeters: 0, segments: []}));

    expect(result.state).toBe('insufficient');
    expect(result.pacing).toBeUndefined();
    expect(result.recommendation).toBeUndefined();
    expect(result.quality.paceUsable).toBe(false);
  });

  it('recommends a calmer start for a valid flat run with late fade', () => {
    const result = analyzeRun(run());

    expect(result.state).toBe('recommendation');
    expect(result.pacing?.fadePercent).toBeCloseTo(20, 5);
    expect(result.recommendation?.kind).toBe('calmer_start');
    expect(result.recommendation?.criteria.minimumObservations).toBe(6);
    expect(result.recommendation?.action).toMatch(/5 % ruhiger/);
  });

  it('freezes an accepted experiment snapshot and enforces immutable terminal states', () => {
    const accepted = acceptRecommendation(recommendation(), 1000);

    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.recommendation)).toBe(true);
    expect(Object.isFrozen(accepted.recommendation.criteria)).toBe(true);
    (accepted.recommendation.criteria as any).minimumObservations = 1;
    expect(accepted.recommendation.criteria.minimumObservations).toBe(6);

    const completed = transitionExperiment(accepted, 'completed', 2000, 'Prüfung beendet');
    expect(() => transitionExperiment(completed, 'active', 3000, 'wieder öffnen')).toThrow(/Beendete Versuche/);
  });

  it('tracks adherence while keeping evaluation explicitly non-causal', () => {
    const base = run({id: 'baseline', context: {temperatureC: 10, windMps: 1}});
    const accepted = acceptRecommendation(analyzeRun(base).recommendation!, 1000);
    const followups = Array.from({length: 6}, (_, index) => run({
      id: `follow-${index + 1}`,
      startTime: (index + 1) * 3 * 86400000,
      endTime: (index + 1) * 3 * 86400000 + 1200000,
      context: {temperatureC: 10, windMps: 1},
      segments: [segment(300), segment(300), segment(330), segment(330)],
    }));

    const result = evaluateExperiment(accepted, [base, ...followups], Object.fromEntries(followups.map(r => [r.id, 'yes'])));

    expect(result.verdict).toBe('improved');
    expect(result.eligibleRunIds).toHaveLength(6);
    expect(result.adherence.every(a => a.value === 'yes' && a.source === 'reported')).toBe(true);
    expect(result.causalClaim).toBe(false);
    expect(result.summary).toMatch(/kein Ursachennachweis/);
  });

  it('enforces cue hourly budget and per-rule cooldown', () => {
    const input = {now: 3600000, enabled: true, purpose: 'easy' as const, targetPaceSecondsPerKm: 360, currentPaceSecondsPerKm: 320, history: [], hourlyBudget: 1};
    const first = scheduleCue(input);
    expect(first?.ruleId).toBe('ease-start');

    expect(scheduleCue({...input, history: [first!]})).toBeUndefined();
    expect(scheduleCue({...input, history: [{...first!, at: input.now - 60000}]})).toBeUndefined();
    expect(scheduleCue({...input, history: [{...first!, at: input.now - 3600001}]})).toBeDefined();
  });

  it('keeps pace analysis usable when sample count and heart-rate data are corrupt', () => {
    const result = analyzeRun(run({samples: Number.NaN, avgHeartRate: 999}));

    expect(result.quality.paceUsable).toBe(true);
    expect(result.quality.issues.some(issue => issue.code === 'implausible_hr')).toBe(false);
    expect(result.state).toBe('recommendation');
  });

  it('does not turn intentionally varying interval pacing into a recommendation', () => {
    const result = analyzeRun(run({purpose: 'intervals'}));

    expect(result.state).toBe('insufficient');
    expect(result.recommendation).toBeUndefined();
    expect(result.focus).toMatch(/Temposchwankungen/);
  });

  it('deduplicates canonical duplicate evidence before evaluating adherence', () => {
    const base = run({id: 'baseline', context: {temperatureC: 10, windMps: 1}});
    const accepted = acceptRecommendation(analyzeRun(base).recommendation!, 1000);
    const follow = run({
      id: 'follow-original', canonicalId: 'native-run-1', startTime: 3 * 86400000,
      endTime: 3 * 86400000 + 1200000, context: {temperatureC: 10, windMps: 1},
      segments: [segment(300), segment(300), segment(330), segment(330)],
    });
    const duplicate = {...follow, id: 'follow-duplicate'};

    const result = evaluateExperiment(accepted, [follow, duplicate], {[follow.id]: 'yes', [duplicate.id]: 'yes'});

    expect(result.eligibleRunIds).toEqual(['follow-original']);
    expect(result.adherence).toHaveLength(1);
  });

  it('does not call a tiny stable change a relevant effect', () => {
    const base = run({id: 'baseline', context: {temperatureC: 10, windMps: 1}});
    const accepted = acceptRecommendation(analyzeRun(base).recommendation!, 1000);
    const followups = Array.from({length: 6}, (_, index) => run({
      id: `tiny-${index + 1}`, startTime: (index + 1) * 3 * 86400000,
      endTime: (index + 1) * 3 * 86400000 + 1200000, context: {temperatureC: 10, windMps: 1},
      segments: [segment(300), segment(300), segment(363), segment(363)],
    }));
    const result = evaluateExperiment(accepted, [base, ...followups], Object.fromEntries(followups.map(r => [r.id, 'yes'])));

    expect(result.verdict).toBe('insufficient_evidence');
    expect(result.summary).toMatch(/Kein einheitlicher relevanter Unterschied/);
    expect(result.changePercentPoints).toBeCloseTo(-1, 3);
  });

  it('cannot reach a final effect verdict when adherence is unknown', () => {
    const base = run({id: 'baseline', context: {temperatureC: 10, windMps: 1}});
    const accepted = acceptRecommendation(analyzeRun(base).recommendation!, 1000);
    const followups = Array.from({length: 6}, (_, index) => run({
      id: `unknown-${index + 1}`, startTime: (index + 1) * 3 * 86400000,
      endTime: (index + 1) * 3 * 86400000 + 1200000, context: {temperatureC: 10, windMps: 1},
      segments: [segment(300), segment(300), segment(330), segment(330)],
    }));
    const reported = Object.fromEntries(followups.map(r => [r.id, 'unknown'])) as Record<string, 'unknown'>;
    const result = evaluateExperiment(accepted, [base, ...followups], reported);

    expect(result.verdict).toBe('insufficient_evidence');
    expect(result.adherence.every(a => a.value === 'unknown')).toBe(true);
    expect(result.causalClaim).toBe(false);
  });

  it('suggests a cautious purpose for runs without one', () => {
    expect(suggestPurpose(run({purpose: 'unknown'}))?.purpose).toBe('easy');
    expect(
      suggestPurpose(run({purpose: 'unknown', durationSeconds: 5400}))
        ?.purpose,
    ).toBe('long');
    expect(
      suggestPurpose(run({purpose: 'unknown', distanceMeters: 16000}))
        ?.purpose,
    ).toBe('long');
    expect(suggestPurpose(run({purpose: 'easy'}))).toBeUndefined();
    expect(suggestPurpose(run({purpose: 'intervals'}))).toBeUndefined();
    expect(
      suggestPurpose(run({purpose: 'unknown', durationSeconds: NaN})),
    ).toBeUndefined();
  });

  it('labels activity kinds in German', () => {
    expect(activityKindLabel('run')).toBe('Lauf');
    expect(activityKindLabel('hike')).toBe('Wanderung');
    expect(activityKindLabel('walk')).toBe('Spaziergang');
    expect(activityKindLabel('ride')).toBe('Radfahrt');
    expect(activityKindLabel('swim')).toBe('Schwimmen');
    expect(activityKindLabel('other')).toBe('Andere Aktivität');
    expect(activityKindLabel(undefined)).toBe('Lauf');
    expect(isRunActivity(run({}))).toBe(true);
    expect(isRunActivity(run({activityKind: 'unknown'}))).toBe(true);
    expect(isRunActivity(run({activityKind: 'hike'}))).toBe(false);
  });

  it('keeps non-run activities neutral without inventing training advice', () => {
    const result = analyzeRun(
      run({purpose: 'easy', activityKind: 'hike', distanceMeters: 12000}),
    );
    expect(result.state).toBe('insufficient');
    expect(result.recommendation).toBeUndefined();
    expect(result.classification).toMatch(/Wanderung/);
    expect(result.focus).toMatch(/Gesamtbelastung/);
    expect(result.quality.paceUsable).toBe(true);
  });
});
