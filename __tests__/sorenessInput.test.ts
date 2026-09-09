import {
  buildReport,
  fromStructured,
  normalizeText,
  parseSoreness,
} from '../src/domain/sorenessInput';

describe('Muskelkater-Eingabe', () => {
  it('normalisiert deutsche Umlaute deterministisch', () => {
    expect(normalizeText('Äußere Schulter, Übung!')).toBe(
      'aussere schulter ubung',
    );
  });

  it('erkennt Seite, Region und Intensität gemeinsam', () => {
    const result = parseSoreness('links starke Wade');
    expect(result.questions).toEqual([]);
    expect(result.proposals).toEqual([
      { regionId: 'calf_gastroc_l', value: 8 },
    ]);
  });

  it('verteilt beide Seiten auf zwei konkrete Regionen', () => {
    const result = parseSoreness('beide Waden 5');
    expect(result.proposals).toEqual([
      { regionId: 'calf_gastroc_l', value: 5 },
      { regionId: 'calf_gastroc_r', value: 5 },
    ]);
  });

  it('fragt bei fehlender Seite und mehrdeutiger Region nach', () => {
    expect(parseSoreness('Wade').questions[0]).toMatchObject({
      kind: 'side',
      candidates: ['calf_gastroc_l', 'calf_gastroc_r'],
    });
    expect(parseSoreness('Rücken 5').questions[0]).toMatchObject({
      kind: 'region',
      candidates: expect.arrayContaining(['lat_l', 'lower_back_l']),
      value: 5,
    });
  });

  it('behandelt „heute nichts“ als bestätigte Antwort', () => {
    expect(parseSoreness('Heute nichts')).toMatchObject({
      nothingToday: true,
      proposals: [],
      questions: [],
    });
  });

  it('verwirft unbekannte strukturierte Regionen statt sie zu erfinden', () => {
    const result = fromStructured([
      { region: 'quad_l', value: 4 },
      { region: 'mysteriöser Muskel', value: 9 },
    ]);
    expect(result.proposals).toEqual([{ regionId: 'quad_l', value: 4 }]);
    expect(result.questions[0].kind).toBe('unknown');
  });

  it('filtert beim Speichern ungültige Regionen und begrenzt Werte', () => {
    const report = buildReport(
      { quad_l: 12, calf_gastroc_r: 4, unknown: 10 } as never,
      1_700_000_000_000,
      'tap',
    );
    expect(report.entries).toEqual([
      { regionId: 'quad_l', value: 10 },
      { regionId: 'calf_gastroc_r', value: 4 },
    ]);
    expect(report.nothingToday).toBe(false);
  });
});

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

  it('keeps consecutive regions with different sides separate', () => {
    expect(parseSoreness('Bizeps links 3 rechts Wade 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 3 },
      { regionId: 'calf_gastroc_r', value: 5 },
    ]);
    expect(parseSoreness('Bizeps links 3 rechts Bizeps 5').proposals).toEqual([
      { regionId: 'biceps_l', value: 3 },
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

  it('does not persist non-finite report values', () => {
    expect(
      buildReport({ biceps_l: Number.NaN, quad_l: Infinity }, 123, 'tap')
        .entries,
    ).toEqual([]);
  });
});
