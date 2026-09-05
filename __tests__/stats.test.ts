import {
  highlights,
  paceTrend,
  purposeStats,
  rpeStat,
  totals,
  weekBuckets,
} from '../src/ui/Stats';
import type { Run } from '../src/native';

const run = (overrides: Partial<Run> = {}): Run =>
  ({
    id: 'run-1',
    startTime: 0,
    endTime: 1200000,
    durationSeconds: 1200,
    distanceMeters: 2000,
    purpose: 'easy',
    source: 'test',
    status: 'complete',
    ...overrides,
  }) as Run;

// Montag, 2026-08-31 12:00 UTC.
const MONDAY = Date.UTC(2026, 7, 31, 12, 0, 0);

describe('stats', () => {
  it('totals distance, time and average pace', () => {
    const sum = totals([
      run({ distanceMeters: 2000, durationSeconds: 1200 }),
      run({ id: 'run-2', distanceMeters: 3000, durationSeconds: 1500 }),
    ]);
    expect(sum.count).toBe(2);
    expect(sum.km).toBeCloseTo(5, 5);
    expect(sum.seconds).toBe(2700);
    expect(sum.avgSecPerKm).toBeCloseTo(540, 5);
  });

  it('ignores invalid measurements in totals', () => {
    const sum = totals([run({ distanceMeters: NaN, durationSeconds: -5 })]);
    expect(sum.km).toBe(0);
    expect(sum.seconds).toBe(0);
    expect(sum.avgSecPerKm).toBeUndefined();
  });

  it('buckets runs into calendar weeks starting Monday', () => {
    const weeks = weekBuckets(
      [
        run({ id: 'a', startTime: MONDAY, distanceMeters: 2000 }),
        run({
          id: 'b',
          startTime: MONDAY + 6 * 86400000,
          distanceMeters: 3000,
        }),
        run({
          id: 'c',
          startTime: MONDAY + 7 * 86400000,
          distanceMeters: 1000,
        }),
      ],
      2,
      MONDAY + 7 * 86400000,
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[0].km).toBeCloseTo(5, 5);
    expect(weeks[0].count).toBe(2);
    expect(weeks[1].km).toBeCloseTo(1, 5);
    expect(weeks[1].count).toBe(1);
  });

  it('orders the pace trend oldest first and skips short runs', () => {
    const trend = paceTrend(
      [
        run({ id: 'new', startTime: 2000, distanceMeters: 2000, durationSeconds: 1200 }),
        run({ id: 'old', startTime: 1000, distanceMeters: 2000, durationSeconds: 1000 }),
        run({ id: 'tiny', startTime: 3000, distanceMeters: 100, durationSeconds: 60 }),
      ],
      20,
    );
    expect(trend.map(p => p.id)).toEqual(['old', 'new']);
    expect(trend[0].secPerKm).toBeCloseTo(500, 5);
  });

  it('counts purposes and averages RPE', () => {
    const rows = purposeStats([
      run({ purpose: 'easy' }),
      run({ id: 'run-2', purpose: 'long', distanceMeters: 20000 }),
      run({ id: 'run-3', purpose: 'easy' }),
    ]);
    expect(rows[0]).toMatchObject({ purpose: 'easy', count: 2 });
    expect(rows[1].km).toBeCloseTo(20, 5);
    const rpe = rpeStat([
      run({ rpe: { legs: 4, breathing: 6, recordedAt: 1 } }),
      run({ id: 'run-2', rpe: { legs: 8, recordedAt: 2 } }),
    ]);
    expect(rpe.legs).toBeCloseTo(6, 5);
    expect(rpe.breathing).toBeCloseTo(6, 5);
    expect(rpe.count).toBe(2);
  });

  it('finds longest and fastest runs without inventing any', () => {
    const best = highlights([
      run({ id: 'a', startTime: 1000, distanceMeters: 2000, durationSeconds: 1200 }),
      run({ id: 'b', startTime: 2000, distanceMeters: 5000, durationSeconds: 3600 }),
    ]);
    expect(best.longest?.id).toBe('b');
    expect(best.fastest?.id).toBe('a');
    expect(highlights([])).toEqual({});
  });

  it('counts every movement in totals but trains only on runs', () => {
    const mixed = [
      run({ id: 'run', startTime: MONDAY, distanceMeters: 5000, durationSeconds: 1800 }),
      run({
        id: 'hike',
        startTime: MONDAY,
        distanceMeters: 12000,
        durationSeconds: 7200,
        activityKind: 'hike',
      }),
    ];
    expect(totals(mixed).km).toBeCloseTo(17, 5);
    expect(weekBuckets(mixed, 1, MONDAY).at(0)?.km).toBeCloseTo(17, 5);
    expect(paceTrend(mixed, 20).map(p => p.id)).toEqual(['run']);
    const best = highlights(mixed);
    expect(best.longest?.id).toBe('run');
    expect(best.fastest?.id).toBe('run');
  });
});
