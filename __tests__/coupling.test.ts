import {
  evaluateCoupling,
  searchMonthlyPlan,
  simulatePlannedFreshness,
  type CoupledRun,
} from '../src/domain/coupling';
import type { RunSummary } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;

function run(id: string, index: number, fadePercent: number): RunSummary {
  const startTime = index * DAY;
  const lateDuration = 300 * (1 + fadePercent / 100);
  return {
    id,
    startTime,
    endTime: startTime + 20 * 60 * 1000,
    durationSeconds: 20 * 60,
    distanceMeters: 4000,
    purpose: 'easy',
    source: 'test',
    status: 'finished',
    segments: [
      { id: `${id}-1`, distanceMeters: 1000, durationSeconds: 300 },
      { id: `${id}-2`, distanceMeters: 1000, durationSeconds: 300 },
      { id: `${id}-3`, distanceMeters: 1000, durationSeconds: lateDuration },
      { id: `${id}-4`, distanceMeters: 1000, durationSeconds: lateDuration },
    ],
  };
}

function coupledRuns(count: number): CoupledRun[] {
  return Array.from({ length: count }, (_, index) => ({
    run: run(`run-${index}`, index, 4 + index),
    regionBase: 'legs',
  }));
}

describe('Kopplung von Lauf und Krafttraining', () => {
  it('kann vollständig abgeschaltet werden, ohne die Frischequelle aufzurufen', () => {
    const result = evaluateCoupling({
      enabled: false,
      runs: coupledRuns(10),
      freshness: () => {
        throw new Error('darf bei abgeschalteter Kopplung nicht laufen');
      },
    });
    expect(result.mode).toBe('separate');
    expect(result.couplingEnabled).toBe(false);
    expect(result.adjustedFadePercent).toBeNull();
    expect(result.causalClaim).toBe(false);
  });

  it('verwendet unter zehn Läufen nur den 10-Punkte-Caliper', () => {
    const entries = coupledRuns(3);
    const freshness: Record<string, number> = {
      '0': 50,
      '1': 55,
      '2': 90,
    };
    const result = evaluateCoupling({
      enabled: true,
      runs: entries,
      freshness: (_region, at) => freshness[String(at / DAY)] ?? null,
    });
    expect(result.assessment).toBe('observation');
    expect(result.method).toBe('caliper_matching');
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.matchedPairs?.[0].freshnessDifference).toBeLessThanOrEqual(10);
  });

  it('orientiert Caliper-Paare nach Frische statt nach Datum', () => {
    const result = evaluateCoupling({
      enabled: true,
      runs: [
        { run: run('älter', 0, 8), regionBase: 'legs' },
        { run: run('frischer', 1, 3), regionBase: 'legs' },
      ],
      freshness: (_region, at) => (at === 0 ? 50 : 55),
    });
    expect(result.matchedPairs?.[0]).toMatchObject({
      firstRunId: 'frischer',
      secondRunId: 'älter',
      freshnessDifference: 5,
    });
    expect(result.matchedPairs?.[0].fadeDifferencePercent).toBeCloseTo(5);
  });

  it('wählt den größten Regionsproxy unabhängig von der Eingabereihenfolge', () => {
    const runs = coupledRuns(5).map((entry, index) => ({
      ...entry,
      regionBase: index < 2 ? 'calf' : 'legs',
    }));
    const freshness = (_region: string, at: number) => 50 + at / DAY;
    const forward = evaluateCoupling({ enabled: true, runs, freshness });
    const reversed = evaluateCoupling({
      enabled: true,
      runs: [...runs].reverse(),
      freshness,
    });
    expect(forward.comparableRunIds).toEqual(['run-2', 'run-3', 'run-4']);
    expect(reversed.comparableRunIds).toEqual(forward.comparableRunIds);
  });

  it('wechselt ab zehn vergleichbaren Läufen zur kleinen Regression', () => {
    const entries = coupledRuns(10);
    const result = evaluateCoupling({
      enabled: true,
      runs: entries,
      freshness: (_region, at) => 90 - (at / DAY) * 2,
    });
    expect(result.assessment).toBe('observation');
    expect(result.method).toBe('covariate_regression');
    expect(result.regression?.covariates).toEqual(['100_minus_leg_freshness']);
    expect(result.causalClaim).toBe(false);
  });

  it('gibt bei nicht ausreichenden Daten keine Zahl zurück', () => {
    const result = evaluateCoupling({
      enabled: true,
      runs: [coupledRuns(1)[0]],
      freshness: () => 50,
    });
    expect(result.assessment).toBe('insufficient_evidence');
    expect(result.adjustedFadePercent).toBeNull();
  });

  it('simuliert geplante Frische je Termin und Region', () => {
    const result = simulatePlannedFreshness(
      [
        {
          id: 'lauf',
          kind: 'run',
          at: 100,
          regionBases: ['quad', 'calf'],
          important: true,
        },
      ],
      (region, at) => (region === 'quad' ? at : 80),
    );
    expect(result[0].minimumFreshness).toBe(80);
    expect(result[0].assessment).toBe('observation');
  });

  it('zählt den kleinen Wochentagsraum vollständig durch und hält Fixtermine ein', () => {
    const weekStartAt = 0;
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt,
      weeks: 4,
      freshness: (_region, at) => 50 + ((at / DAY) % 7),
      sessions: [
        {
          id: 'wichtig',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
          existingWeekday: 0,
        },
        {
          id: 'fix',
          kind: 'strength',
          regionBases: ['legs'],
          important: false,
          fixedWeekday: 2,
        },
      ],
    });
    expect(result.assessment).toBe('observation');
    expect(result.selected?.assignments).toContainEqual({
      sessionId: 'fix',
      weekday: 2,
    });
    expect(result.selected?.assignments).toContainEqual({
      sessionId: 'wichtig',
      weekday: 6,
    });
    expect(result.verdict).toBe('change_plan');
    expect(result.suggestion?.checkCriterion).toBeTruthy();
  });

  it('liefert ohne Frischequelle im Plan ausdrücklich keine Bewertung', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      sessions: [
        {
          id: 'wichtig',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });

  it('verwirft eine Planung mit kollidierenden Fixterminen', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      freshness: () => 80,
      sessions: [
        {
          id: 'lauf',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
          fixedWeekday: 2,
        },
        {
          id: 'kraft',
          kind: 'strength',
          regionBases: ['legs'],
          important: false,
          fixedWeekday: 2,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });

  it('verwirft doppelte Sitzungskennungen statt sie in der Zuordnung zu überschreiben', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      freshness: () => 80,
      sessions: [
        {
          id: 'doppelt',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
        },
        {
          id: 'doppelt',
          kind: 'strength',
          regionBases: ['legs'],
          important: false,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });

  it('verwirft Termine außerhalb des Tagesfensters', () => {
    const result = searchMonthlyPlan({
      enabled: true,
      weekStartAt: 0,
      freshness: () => 80,
      sessions: [
        {
          id: 'lauf',
          kind: 'run',
          regionBases: ['legs'],
          important: true,
          timeOfDayMs: 24 * DAY,
        },
      ],
    });
    expect(result.verdict).toBe('not_assessable');
    expect(result.selected).toBeNull();
  });
});
