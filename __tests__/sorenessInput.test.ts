import {
  buildReport,
  fromStructured,
  parseSoreness,
} from '../src/domain/sorenessInput';

describe('Soreness capture parsing', () => {
  it('keeps an explicit left-and-right report on both concrete regions', () => {
    expect(parseSoreness('Bizeps links und rechts 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 5 },
      { regionId: 'biceps_r', value: 5 },
    ]);
  });

  it('combines side words that occur before the region', () => {
    expect(parseSoreness('links und rechts Bizeps 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 5 },
      { regionId: 'biceps_r', value: 5 },
    ]);
  });

  it('does not accept an unknown structured region', () => {
    const result = fromStructured([
      { region: 'shoulder', side: 'l', value: 4 },
    ]);
    expect(result.proposals).toEqual([]);
    expect(result.questions[0]).toMatchObject({
      kind: 'unknown',
      candidates: [],
    });
  });

  it('does not treat an empty structured value as zero', () => {
    const result = fromStructured([{ region: 'biceps_l', value: ' ' }]);
    expect(result.proposals).toEqual([]);
    expect(result.questions[0]).toMatchObject({ kind: 'intensity' });
  });

  it('writes reports in canonical region order regardless of object insertion order', () => {
    const report = buildReport(
      { quad_r: 4, biceps_l: 2, quad_l: 3 },
      123,
      'tap',
    );
    expect(report.entries).toEqual([
      { regionId: 'biceps_l', value: 2 },
      { regionId: 'quad_l', value: 3 },
      { regionId: 'quad_r', value: 4 },
    ]);
  });
});
