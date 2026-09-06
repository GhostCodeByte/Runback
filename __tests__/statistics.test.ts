import { aggregateStatistics } from '../src/domain/statistics';
import type { Run } from '../src/native';

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-1',
  startTime: Date.UTC(2026, 0, 5, 9),
  endTime: Date.UTC(2026, 0, 5, 10),
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'easy',
  source: 'test',
  status: 'completed',
  ...overrides,
});

describe('aggregateStatistics', () => {
  it('filters unfinished, malformed, and future records', () => {
    const stats = aggregateStatistics(
      [
        run({ id: 'good' }),
        run({ id: 'future', startTime: Date.UTC(2026, 0, 7) }),
        run({ id: 'paused', status: 'paused' }),
        run({ id: 'bad-time', startTime: Number.NaN }),
        run({ id: 'bad-distance', distanceMeters: Number.POSITIVE_INFINITY }),
      ],
      Date.UTC(2026, 0, 6),
    );

    expect(stats.runCount).toBe(1);
    expect(stats.totalDistanceKm).toBe(10);
  });

  it('deduplicates canonical records and weights pace by distance', () => {
    const stats = aggregateStatistics(
      [
        run({
          id: 'phone',
          canonicalId: 'watch-1',
          distanceMeters: 1000,
          durationSeconds: 600,
        }),
        run({
          id: 'duplicate',
          canonicalId: 'watch-1',
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
        run({ id: 'short', distanceMeters: 100, durationSeconds: 1000 }),
      ],
      Date.UTC(2026, 0, 6),
    );

    expect(stats.runCount).toBe(2);
    expect(stats.paceSecondsPerKm).toBe(600);
  });

  it('keeps local Monday weeks aligned across the spring DST change', () => {
    const now = new Date(2026, 2, 30, 12).getTime();
    const stats = aggregateStatistics([run({ startTime: now })], now);

    expect(new Date(stats.weeks[6].startTime).getDate()).toBe(23);
    expect(new Date(stats.weeks[7].startTime).getDate()).toBe(30);
    expect(stats.weeks[7].startTime - stats.weeks[6].startTime).toBe(
      6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000,
    );
  });

  it('does not invent a pace for a zero-duration run', () => {
    const stats = aggregateStatistics(
      [run({ durationSeconds: 0, distanceMeters: 1000 })],
      Date.UTC(2026, 0, 6),
    );

    expect(stats.paceSecondsPerKm).toBeNull();
  });

  it('returns eight local weeks and averages only recorded RPE values', () => {
    const stats = aggregateStatistics(
      [
        run({ rpe: { legs: 6, breathing: 8, recordedAt: 1 } }),
        run({ id: 'second', rpe: { legs: 8, recordedAt: 1 } }),
      ],
      Date.UTC(2026, 0, 7),
    );

    expect(stats.weeks).toHaveLength(8);
    expect(stats.averageLegsRpe).toBe(7);
    expect(stats.averageBreathingRpe).toBe(8);
  });
});
