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
const initial = run('initial', 0);
const accepted = acceptRecommendation(
  analyzeRun(initial).recommendation!,
  2000000,
);
const options = { today: '2026-09-12', now: 5000000 };

describe('Selection and follow-up preview', () => {
  it.each(['active', 'paused'] as const)(
    'offers a different later recommendation while %s without touching the snapshot',
    status => {
      const active = { ...accepted, status };
      const before = JSON.stringify(active);
      const later = run('later', 3000000, 'long');
      const result = selectRecommendations([initial, later], {
        ...options,
        active,
        experiments: [active],
      });
      expect(result.selected?.purpose).toBe('long');
      expect(result.selected?.criteria.baselineRunIds).toEqual(['later']);
      expect(JSON.stringify(active)).toBe(before);
    },
  );
  it('does not repackage the same action or pre-acceptance evidence as a follow-up', () => {
    const result = selectRecommendations(
      [run('old-long', 1000000, 'long'), run('same-action', 3000000)],
      { ...options, active: accepted },
    );
    expect(result.selected).toBeUndefined();
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].reason).toContain(
      'bereits deine laufende Empfehlung',
    );
  });
  it('explains real rejections, deduplicates sources and is independent of input order', () => {
    const usable = run('a', 3000000, 'long');
    const other = run('b', 3000001, 'long');
    const dismissed = run('dismissed', 3000002, 'long');
    const insufficient = { ...run('missing', 3000003), segments: [] };
    const all = [
      initial,
      usable,
      { ...usable, id: 'copy', canonicalId: 'a', startTime: 2999999 },
      other,
      dismissed,
      insufficient,
    ];
    const params = {
      ...options,
      active: accepted,
      experiments: [accepted],
      dismissed: [analyzeRun(dismissed).recommendation!.id],
    };
    const result = selectRecommendations(all, params);
    expect(selectRecommendations([...all].reverse(), params)).toEqual(result);
    expect(result.selected?.criteria.baselineRunIds).toEqual(['a']);
    expect(result.alternatives.map(item => item.runId).sort()).toEqual([
      'b',
      'dismissed',
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
      selectRecommendations([run('later', 3000000, 'long')], {
        ...options,
        active: accepted,
        postponedUntil: options.now + 1,
      }).selected,
    ).toBeUndefined();
  });
  it('continues from surviving later data when the original comparison run was deleted', () => {
    const result = selectRecommendations([run('later', 3000000, 'long')], {
      ...options,
      active: accepted,
    });
    expect(result.selected).toBeDefined();
    expect(accepted.recommendation.criteria.baselineRunIds).toEqual([
      'initial',
    ]);
  });
});
