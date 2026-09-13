import {
  exactLowerRank,
  inversionCounts,
  median,
  robustScale,
  signTest,
} from '../src/domain/inference';

describe('Statistikbausteine', () => {
  it('zählt Permutationen nach Inversionen (Mahonian-Zahlen)', () => {
    expect(inversionCounts(3)).toEqual([1, 2, 2, 1]);
    expect(inversionCounts(4)).toEqual([1, 3, 5, 6, 5, 3, 1]);
    expect(inversionCounts(5).reduce((a, b) => a + b, 0)).toBe(120);
  });

  it('trägt unter fünf Punkten keine 97,5-%-Schranke', () => {
    expect(exactLowerRank(3, 0.025)).toBeNull();
    expect(exactLowerRank(4, 0.025)).toBeNull();
    // n = 5: nur die perfekt monotone Reihenfolge (1/120) liegt unter 2,5 %.
    expect(exactLowerRank(5, 0.025)).toBe(0);
    // n = 6: 0 oder 1 Inversion sind 6/720 = 0,83 %; 2 Inversionen 20/720 > 2,5 %.
    expect(exactLowerRank(6, 0.025)).toBe(1);
    expect(exactLowerRank(7, 0.025)).toBe(3);
  });

  it('rechnet den exakten zweiseitigen Vorzeichentest', () => {
    expect(signTest([5, 6, 7, 8, 9, 10], 3).pValue).toBeCloseTo(2 / 64, 6);
    expect(signTest([5, 6, 7, 8, 9, -10], 3).pValue).toBeCloseTo(14 / 64, 6);
    const tied = signTest([1, -1, 2, 5], 3);
    expect(tied).toMatchObject({ positives: 1, negatives: 0, ties: 3 });
    expect(tied.pValue).toBe(1);
    expect(signTest([], 3).pValue).toBe(1);
  });

  it('schätzt die robuste Streuung aus dem MAD der Werte selbst', () => {
    const residuals = [-3, 1, -1, 2, 0, 4, -2, 3, -4, 1];
    expect(median(residuals)).toBe(0.5);
    expect(robustScale(residuals)).toBeCloseTo(1.4826 * 2, 6);
  });
});
