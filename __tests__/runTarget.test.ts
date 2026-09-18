import {
  NO_RUN_TARGET,
  normalizeRunTarget,
  parsePaceInput,
  runTargetLabel,
  targetForPurpose,
} from '../src/domain/runTarget';

describe('Laufziel', () => {
  it('parses only explicit supported pace values', () => {
    expect(parsePaceInput('5:30')).toBe(330);
    expect(parsePaceInput('05:07')).toBe(307);
    expect(parsePaceInput('5:75')).toBeNull();
    expect(parsePaceInput('schnell')).toBeNull();
  });

  it('keeps invalid or old settings inactive', () => {
    expect(normalizeRunTarget({ kind: 'pace', secondsPerKm: 330 })).toEqual(
      NO_RUN_TARGET,
    );
    expect(
      normalizeRunTarget({
        kind: 'heart_rate',
        version: 1,
        minBpm: 170,
        maxBpm: 150,
        output: 'both',
      }),
    ).toEqual(NO_RUN_TARGET);
  });

  it('uses a pace ceiling for easy and long runs', () => {
    const pace = normalizeRunTarget({
      kind: 'pace',
      version: 1,
      secondsPerKm: 330,
      mode: 'range',
      output: 'both',
    });
    expect(targetForPurpose(pace, 'easy')).toMatchObject({ mode: 'ceiling' });
    expect(targetForPurpose(pace, 'intervals')).toMatchObject({
      mode: 'range',
    });
    expect(runTargetLabel(targetForPurpose(pace, 'easy'))).toBe(
      'Nicht schneller als 5:30 /km',
    );
  });
});
