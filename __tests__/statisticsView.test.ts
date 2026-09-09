import {
  bucketValue,
  buildStatisticsView,
} from '../src/domain/statisticsView';
import type { Run } from '../src/native';

// Montag, 9. März 2026, lokale Zeit.
const NOW = new Date(2026, 2, 9, 12).getTime();
const days = (count: number) => count * 24 * 60 * 60 * 1000;

const run = (overrides: Partial<Run> = {}): Run => ({
  id: `run-${overrides.startTime ?? 0}`,
  startTime: NOW - 3_600_000,
  endTime: NOW,
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'easy',
  source: 'test',
  status: 'completed',
  ...overrides,
});

describe('buildStatisticsView', () => {
  it('scopes every number to the selected range', () => {
    const runs = [
      run({ id: 'inside', startTime: NOW - days(3) }),
      run({ id: 'outside', startTime: NOW - days(60) }),
    ];

    const short = buildStatisticsView(runs, '4w', NOW);
    const long = buildStatisticsView(runs, '12w', NOW);

    expect(short.totals.runCount).toBe(1);
    expect(short.totals.distanceKm).toBe(10);
    expect(long.totals.runCount).toBe(2);
    expect(long.buckets).toHaveLength(12);
  });

  it('compares against the equally long window before it', () => {
    const view = buildStatisticsView(
      [
        run({ id: 'now', startTime: NOW - days(3), distanceMeters: 12000 }),
        run({ id: 'before', startTime: NOW - days(31), distanceMeters: 6000 }),
      ],
      '4w',
      NOW,
    );

    expect(view.totals.distanceKm).toBe(12);
    expect(view.deltas.distance.previous).toBe(6);
    expect(view.deltas.distance.changeRatio).toBe(1);
    expect(view.deltas.distance.direction).toBe('up');
    expect(view.comparisonLabel).toBe('die 4 Wochen davor');
  });

  it('reports no comparison instead of inventing one', () => {
    const view = buildStatisticsView(
      [run({ startTime: NOW - days(2) })],
      '4w',
      NOW,
    );

    expect(view.comparisonLabel).toBeNull();
    expect(view.deltas.distance.direction).toBe('unknown');
    expect(view.deltas.distance.changeRatio).toBeNull();
  });

  it('groups a year into months and everything into the run history', () => {
    const view = buildStatisticsView(
      [run({ startTime: NOW - days(200) })],
      '1y',
      NOW,
    );
    expect(view.bucketUnit).toBe('month');
    expect(view.buckets).toHaveLength(13);

    const all = buildStatisticsView(
      [run({ startTime: NOW - days(40) })],
      'all',
      NOW,
    );
    expect(all.bucketUnit).toBe('month');
    expect(all.windowStart).toBeLessThanOrEqual(NOW - days(40));
    expect(all.totals.runCount).toBe(1);
  });

  it('offers pace and effort only when the runs carry them', () => {
    const bare = buildStatisticsView(
      [run({ distanceMeters: 300, durationSeconds: 120 })],
      '4w',
      NOW,
    );
    expect(bare.available.pace).toBe(false);
    expect(bare.available.effort).toBe(false);

    const rich = buildStatisticsView(
      [run({ rpe: { legs: 6, breathing: 8, recordedAt: 1 }, avgHeartRate: 150 })],
      '4w',
      NOW,
    );
    expect(rich.available.pace).toBe(true);
    expect(rich.available.effort).toBe(true);
    expect(rich.available.heartRate).toBe(true);
    expect(rich.buckets[rich.buckets.length - 1].effort).toBe(7);
  });

  it('splits distance by purpose, largest share first', () => {
    const view = buildStatisticsView(
      [
        run({ id: 'a', purpose: 'easy', distanceMeters: 3000 }),
        run({ id: 'b', purpose: 'long', distanceMeters: 12000 }),
        run({ id: 'c', purpose: 'unknown', distanceMeters: 5000 }),
      ],
      '4w',
      NOW,
    );

    expect(view.purposes.map(entry => entry.purpose)).toEqual([
      'long',
      'unknown',
      'easy',
    ]);
    expect(view.purposes[0].share).toBeCloseTo(0.6, 5);
    expect(view.purposes.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(
      1,
      5,
    );
  });

  it('awards the pace record only to runs of at least five kilometres', () => {
    const view = buildStatisticsView(
      [
        run({ id: 'sprint', distanceMeters: 1000, durationSeconds: 180 }),
        run({ id: 'long', distanceMeters: 10000, durationSeconds: 3000 }),
      ],
      '4w',
      NOW,
    );

    const pace = view.records.find(entry => entry.id === 'fastest-pace');
    expect(pace?.value).toBe('5:00 /km');
    expect(pace?.runId).toBe('long');
  });

  it('counts weekly streaks without breaking on the young current week', () => {
    const view = buildStatisticsView(
      [
        run({ id: 'w1', startTime: NOW - days(21) }),
        run({ id: 'w2', startTime: NOW - days(14) }),
        run({ id: 'w3', startTime: NOW - days(7) }),
      ],
      '4w',
      NOW,
    );

    expect(view.consistency.weekCount).toBe(4);
    expect(view.consistency.activeWeeks).toBe(3);
    expect(view.consistency.longestStreakWeeks).toBe(3);
    // Die laufende Woche hat noch keinen Lauf und beendet die Serie nicht.
    expect(view.consistency.currentStreakWeeks).toBe(3);
    expect(view.consistency.activeDays).toBe(3);
  });

  it('drops duplicates and unfinished records like the overview does', () => {
    const view = buildStatisticsView(
      [
        run({ id: 'phone', canonicalId: 'watch-1' }),
        run({ id: 'watch', canonicalId: 'watch-1' }),
        run({ id: 'paused', status: 'paused' }),
        run({ id: 'future', startTime: NOW + days(3) }),
      ],
      '4w',
      NOW,
    );

    expect(view.totals.runCount).toBe(1);
  });

  it('maps every metric onto its bucket value', () => {
    const view = buildStatisticsView(
      [run({ rpe: { legs: 4, breathing: 6, recordedAt: 1 } })],
      '4w',
      NOW,
    );
    const bucket = view.buckets[view.buckets.length - 1];

    expect(bucketValue(bucket, 'distance')).toBe(10);
    expect(bucketValue(bucket, 'duration')).toBe(3600);
    expect(bucketValue(bucket, 'count')).toBe(1);
    expect(bucketValue(bucket, 'pace')).toBe(360);
    expect(bucketValue(bucket, 'effort')).toBe(5);
  });
});
