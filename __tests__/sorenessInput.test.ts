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
