import { analyzeRun } from '../src/domain/analysis';
import { acceptRecommendation } from '../src/domain/experiments';
import { selectRecommendations } from '../src/domain/recommendationSelection';
import type { RunSummary } from '../src/domain/types';

const run = (
  id: string,
  startTime: number,
  purpose: 'easy' | 'long' = 'easy',
): RunSummary => ({
  id,
  startTime,
  endTime: startTime + 1320000,
  durationSeconds: 1320,
  distanceMeters: 2000,
  purpose,
  source: 'test',
  status: 'complete',
  segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
    id: `${id}:${index}`,
    durationSeconds,
    distanceMeters: 500,
    gradePercent: 0,
  })),
});
const DAY = 86400000;
/** Vergleichsbasis: zwei gleichartige Vorläufe je Zweck; erst ihr Median trägt eine Empfehlung. */
const history = (startTime: number, purpose: 'easy' | 'long' = 'easy') => [
  run(`${purpose}-prev-1`, startTime - 7 * DAY, purpose),
  run(`${purpose}-prev-2`, startTime - 14 * DAY, purpose),
];
const initial = run('initial', 20 * DAY);
const initialHistory = history(initial.startTime);
const accepted = acceptRecommendation(
  analyzeRun(initial, undefined, initialHistory).recommendation!,
  20 * DAY + 1000,
);
const laterAt = 40 * DAY;
const laterHistory = history(laterAt, 'long');
const options = { today: '2026-09-12', now: 60 * DAY };

describe('Selection and follow-up preview', () => {
  it.each(['active', 'paused'] as const)(
    'offers a different later recommendation while %s without touching the snapshot',
    status => {
      const active = { ...accepted, status };
      const before = JSON.stringify(active);
      const later = run('later', laterAt, 'long');
      const result = selectRecommendations(
        [initial, ...initialHistory, later, ...laterHistory],
        {
          ...options,
          active,
          experiments: [active],
        },
      );
      expect(result.selected?.purpose).toBe('long');
      expect(result.selected?.criteria.baselineRunIds).toEqual([
        'later',
        'long-prev-1',
        'long-prev-2',
      ]);
      expect(JSON.stringify(active)).toBe(before);
    },
  );
  it('does not repackage the same action or pre-acceptance evidence as a follow-up', () => {
    const result = selectRecommendations(
      [
        run('old-long', 10 * DAY, 'long'),
        run('same-action', laterAt),
        ...history(laterAt),
      ],
      { ...options, active: accepted },
    );
    expect(result.selected).toBeUndefined();
    expect(result.alternatives).toHaveLength(3);
    expect(result.alternatives[0].runId).toBe('same-action');
    expect(result.alternatives[0].reason).toContain(
      'bereits deine laufende Empfehlung',
    );
  });
  it('explains real rejections, deduplicates sources and is independent of input order', () => {
    const usable = run('a', laterAt, 'long');
    const other = run('b', laterAt + 1, 'long');
    const dismissed = run('dismissed', laterAt + 2, 'long');
    const insufficient = { ...run('missing', laterAt + 3), segments: [] };
    const all = [
      initial,
      ...laterHistory,
      usable,
      { ...usable, id: 'copy', canonicalId: 'a', startTime: laterAt - 1 },
      other,
      dismissed,
      insufficient,
    ];
    const params = {
      ...options,
      active: accepted,
      experiments: [accepted],
      dismissed: [analyzeRun(dismissed, undefined, all).recommendation!.id],
    };
    const result = selectRecommendations(all, params);
    expect(selectRecommendations([...all].reverse(), params)).toEqual(result);
    expect(result.selected?.criteria.baselineRunIds).toEqual([
      'a',
      'long-prev-1',
      'long-prev-2',
    ]);
    expect(result.alternatives.map(item => item.runId).sort()).toEqual([
      'b',
      'dismissed',
      'long-prev-1',
      'long-prev-2',
      'missing',
    ]);
    expect(
      result.alternatives.find(item => item.runId === 'dismissed')?.reason,
    ).toContain('abgelehnt');
    expect(
      result.alternatives.find(item => item.runId === 'missing')?.reason,
    ).toContain('fehlen');
    expect(
      result.alternatives.find(item => item.runId === 'b')?.reason,
    ).toContain('Gleichstand');
  });
  it('does not invent a queue from insufficient data, or revive completed and deferred proposals', () => {
    expect(
      selectRecommendations([{ ...run('missing', 3000000), segments: [] }], {
        ...options,
        active: accepted,
      }).selected,
    ).toBeUndefined();
    expect(
      selectRecommendations([initial], {
        ...options,
        experiments: [{ ...accepted, status: 'completed' }],
      }).selected,
    ).toBeUndefined();
    expect(
      selectRecommendations([run('later', laterAt, 'long'), ...laterHistory], {
        ...options,
        active: accepted,
        postponedUntil: options.now + 1,
      }).selected,
    ).toBeUndefined();
  });
  it('trägt aus einem einzelnen auffälligen Lauf keine Empfehlung', () => {
    // Ein Ausreißer allein wäre Regression zur Mitte; der Median entscheidet.
    const alone = selectRecommendations([run('alone', laterAt, 'long')], {
      ...options,
    });
    expect(alone.selected).toBeUndefined();
    expect(alone.alternatives[0].reason).toMatch(/1 von 3/);
  });
  it('continues from surviving later data when the original comparison run was deleted', () => {
    const result = selectRecommendations(
      [run('later', laterAt, 'long'), ...laterHistory],
      {
        ...options,
        active: accepted,
      },
    );
    expect(result.selected).toBeDefined();
    expect(accepted.recommendation.criteria.baselineRunIds).toEqual([
      'initial',
      'easy-prev-1',
      'easy-prev-2',
    ]);
  });
});
