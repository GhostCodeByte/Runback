import {
  buildRunReport,
  runReportFileName,
  RUN_REPORT_VERSION,
  type ReportRun,
  type RunTimeline,
} from '../src/domain/runReport';
import { analyzeRun } from '../src/domain/analysis';

const start = new Date(2024, 4, 12, 7, 30).getTime();
const run: ReportRun = {
  id: 'run-1',
  name: 'Feierabendrunde',
  startTime: start,
  endTime: start + 46 * 60 * 1000,
  durationSeconds: 45 * 60,
  distanceMeters: 8520,
  purpose: 'easy',
  sport: 'running',
  source: 'phone',
  status: 'completed',
  avgHeartRate: 148.4,
  heartRateCoverage: 0.96,
  avgCadence: 172,
  samples: 2710,
  context: { temperatureC: 14.2, windMps: 3.1 },
  target: {
    kind: 'pace',
    version: 1,
    secondsPerKm: 330,
    mode: 'ceiling',
    output: 'voice',
  },
  rpe: { legs: 4, breathing: 3, recordedAt: start + 3600_000 },
  note: 'Leichte Beine,\nzweite Hälfte etwas schneller.',
  segments: Array.from({ length: 8 }, (_, i) => ({
    id: `run-1:${i}`,
    distanceMeters: 1000,
    durationSeconds: 315 + i * 2,
    gradePercent: 0.4,
    ascentMeters: 6,
    descentMeters: 4,
  })).concat([
    {
      id: 'run-1:8',
      distanceMeters: 520,
      durationSeconds: 170,
      gradePercent: -0.2,
      ascentMeters: 0,
      descentMeters: 3,
    },
  ]),
  events: [
    { type: 'start', at: start },
    { type: 'pause', at: start + 20 * 60_000 },
    { type: 'resume', at: start + 21 * 60_000 },
    {
      type: 'target_cue',
      at: start + 30 * 60_000,
      data: { code: 'pace_fast', message: 'Etwas langsamer.' },
    },
    { type: 'feedback', at: start + 3600_000 },
  ],
  route: [
    { latitude: 52.52001, longitude: 13.40495, time: start },
    { latitude: 52.5301, longitude: 13.41, time: start + 20 * 60_000 },
    { latitude: 52.52002, longitude: 13.40496, time: start + 46 * 60_000 },
  ],
};
const timeline: RunTimeline = {
  stepSeconds: 60,
  rows: [
    {
      elapsedSeconds: 60,
      distanceMeters: 190,
      stepDistanceMeters: 190,
      movingSeconds: 59,
      avgHeartRate: 131.2,
      avgCadence: 168,
      altitudeM: 41.3,
    },
    {
      elapsedSeconds: 120,
      distanceMeters: 380,
      stepDistanceMeters: 190,
      movingSeconds: 60,
      avgHeartRate: 142.8,
      altitudeM: 42.1,
    },
    {
      elapsedSeconds: 1260,
      distanceMeters: 3800,
      stepDistanceMeters: 0,
      movingSeconds: 0,
      avgHeartRate: 120,
    },
  ],
};
const history = [
  {
    ...run,
    id: 'run-0',
    startTime: start - 2 * 86400_000,
    distanceMeters: 6000,
    durationSeconds: 1900,
  },
  {
    ...run,
    id: 'run-old',
    startTime: start - 20 * 86400_000,
    distanceMeters: 12000,
    durationSeconds: 3900,
  },
  { ...run, id: 'run-later', startTime: start + 86400_000 },
];

describe('buildRunReport', () => {
  const report = buildRunReport({
    run,
    analysis: analyzeRun(run, undefined, history),
    timeline,
    context: {
      goal: 'Halbmarathon unter 1:50',
      goalTargetDate: '2024-10-06',
      focus: {
        version: 'focus-v1',
        kind: 'endurance',
        label: 'Ausdauer aufbauen',
      },
      adherence: 'yes',
      history,
    },
    now: start + 86400_000,
  });

  it('starts with the run title and names the report format', () => {
    expect(report.startsWith('# Feierabendrunde — Lauf vom ')).toBe(true);
    expect(report).toContain(RUN_REPORT_VERSION);
  });

  it('lists the key figures in German format with units', () => {
    expect(report).toContain('| Distanz | 8,52 km |');
    expect(report).toContain('| Bewegungszeit | 45:00 |');
    expect(report).toContain('| Ø Tempo | 5:16 /km |');
    expect(report).toContain(
      '| Ø Puls | 148 bpm (Abdeckung 96 % der Bewegungszeit) |',
    );
    expect(report).toContain('| Ø Schrittfrequenz | 172 /min |');
    expect(report).toContain('| Pausen gesamt | 1:00 |');
    expect(report).toContain('| Wetter | 14 °C · Wind 3,1 m/s |');
    expect(report).toContain(
      '| Begleitung unterwegs | Nicht schneller als 5:30 /km |',
    );
    expect(report).toContain('| Zweck | Locker |');
    expect(report).toContain('| Quelle | Telefon (Runback) |');
  });

  it('renders the kilometre splits with cumulative distance and pace', () => {
    expect(report).toContain('## Abschnitte');
    expect(report).toContain(
      '| 1 | 1,00 | 1,00 km | 5:15 | 5:15 /km | 0,4 % | +6 / −4 m |',
    );
    expect(report).toContain('| 9 | 8,52 | 0,52 km | 2:50 | 5:26 /km |');
    // Puls je Abschnitt ist nicht bekannt, also erscheint keine Pulsspalte.
    expect(report).not.toMatch(/\| # \| Bis km \|.*Ø Puls/);
  });

  it('renders the timeline and leaves unknown pace as a dash', () => {
    expect(report).toContain('## Zeitverlauf');
    expect(report).toContain(
      '| 1:00 | 0,19 | 5:10 /km | 131 bpm | 168 | 41 m |',
    );
    expect(report).toContain('| 21:00 | 3,80 | – | 120 bpm | – | – |');
  });

  it('lists events without the internal feedback entries', () => {
    expect(report).toContain('— Pause');
    expect(report).toContain('— Hinweis zum Ziel: Etwas langsamer.');
    expect(report).not.toContain('Feedback gespeichert');
  });

  it('includes impression, note, analysis and context', () => {
    expect(report).toContain('## Laufgefühl');
    expect(report).toContain('- Beine: 4 von 10');
    expect(report).toContain('- Empfehlung ausprobiert: Ja');
    expect(report).toContain(
      '> Leichte Beine,\n> zweite Hälfte etwas schneller.',
    );
    expect(report).toContain('## Auswertung durch Runback');
    expect(report).toContain('- Modellversion:');
    expect(report).toContain(
      '- Ziel: Halbmarathon unter 1:50 (bis 2024-10-06)',
    );
    expect(report).toContain('- Fokus: Ausdauer aufbauen');
    // Nur frühere Einheiten zählen; der Lauf selbst und spätere nicht.
    expect(report).toContain(
      '- Vorher in den letzten 7 Tagen: 1 Einheit, 6,0 km',
    );
    expect(report).toContain(
      '- Vorher in den letzten 28 Tagen: 2 Einheiten, 18,0 km',
    );
  });

  it('describes the route and appends the full data as JSON', () => {
    expect(report).toContain('## Strecke');
    expect(report).toContain('- Start: 52,52001, 13,40495');
    const json = report.split('```json\n')[1].split('\n```')[0];
    const data = JSON.parse(json);
    expect(data.reportVersion).toBe(RUN_REPORT_VERSION);
    expect(data.run.distanceMeters).toBe(8520);
    expect(data.run.startTime).toBe(new Date(start).toISOString());
    expect(data.segments).toHaveLength(9);
    expect(data.timeline.rows).toHaveLength(3);
    expect(data.route).toHaveLength(3);
    expect(data.route[0]).toEqual([
      52.52001,
      13.40495,
      new Date(start).toISOString(),
    ]);
    expect(data.events.map((e: { type: string }) => e.type)).toEqual([
      'start',
      'pause',
      'resume',
      'target_cue',
    ]);
    expect(data.context.focus).toBe('Ausdauer aufbauen');
  });

  it('leaves out what it does not know instead of inventing values', () => {
    const sparse = buildRunReport({
      run: {
        id: 'run-2',
        startTime: start,
        endTime: start + 600_000,
        durationSeconds: 600,
        distanceMeters: 0,
        purpose: 'unknown',
        source: 'import:garmin',
        status: 'completed',
      },
    });
    expect(sparse).toContain('| Ø Tempo | – |');
    expect(sparse).not.toContain('Ø Puls');
    expect(sparse).not.toContain('## Abschnitte');
    expect(sparse).not.toContain('## Zeitverlauf');
    expect(sparse).not.toContain('## Strecke');
    expect(sparse).not.toContain('## Auswertung');
    expect(sparse).toContain('| Quelle | Import (import:garmin) |');
  });

  it('uses cycling words and speed for rides', () => {
    const ride = buildRunReport({
      run: { ...run, sport: 'cycling', segments: undefined, events: undefined },
    });
    expect(ride).toContain('Radfahrt vom');
    expect(ride).toContain('| Ø Geschwindigkeit | 11,4 km/h |');
    expect(ride).toContain('Ø Trittfrequenz');
  });
});

describe('runReportFileName', () => {
  it('builds a safe file name from date, time and title', () => {
    expect(runReportFileName(run)).toBe(
      'runback_2024-05-12_07-30_feierabendrunde.md',
    );
    expect(
      runReportFileName({ ...run, name: 'Über die Brücke & zurück!' }),
    ).toBe('runback_2024-05-12_07-30_ueber-die-bruecke-zurueck.md');
  });
});
