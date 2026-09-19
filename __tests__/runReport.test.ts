import {
  buildRunAnalysisExport,
  buildRunReport,
  dataQualityFor,
  runExportFileNames,
  runReportFileName,
  RUN_ANALYSIS_EXPORT_VERSION,
  RUN_REPORT_VERSION,
  type ReportRun,
  type RunTimeline,
} from '../src/domain/runReport';
import { analyzeRun, QUALITY_VERSION } from '../src/domain/analysis';

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
      gpsCoveredSeconds: 59,
      avgHeartRate: 131.2,
      avgCadence: 168,
      altitudeM: 41.3,
    },
    {
      elapsedSeconds: 120,
      distanceMeters: 380,
      stepDistanceMeters: 190,
      gpsCoveredSeconds: 60,
      avgHeartRate: 142.8,
      altitudeM: 42.1,
    },
    {
      elapsedSeconds: 1260,
      distanceMeters: 3800,
      stepDistanceMeters: 0,
      gpsCoveredSeconds: 0,
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
    // Ohne Phasenerkennung gibt es nur die Aufzeichnungszeit — sie heißt nicht Bewegungszeit.
    expect(report).toContain('| Aufzeichnungszeit (ohne Pausen) | 45:00 |');
    expect(report).not.toContain('Bewegungszeit (Laufen + Gehen)');
    expect(report).toContain('| Ø Tempo über die Aufzeichnungszeit | 5:16 /km |');
    expect(report).toContain(
      '| Ø Puls | 148 bpm (Abdeckung 96 % der Aufzeichnungszeit) |',
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
    expect(report).toContain('## Kilometer-Abschnitte');
    expect(report).not.toContain('GPS-Lücke;');
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

  it('describes the route and appends a summary as JSON without the raw series', () => {
    expect(report).toContain('## Strecke');
    expect(report).toContain('- Start: 52,52001, 13,40495');
    const json = report.split('```json\n')[1].split('\n```')[0];
    const data = JSON.parse(json);
    expect(data.reportVersion).toBe(RUN_REPORT_VERSION);
    expect(data.run.distanceMeters).toBe(8520);
    expect(data.run.validity).toBe('valid');
    expect(data.run.startTime).toBe(new Date(start).toISOString());
    expect(data.segments).toHaveLength(9);
    expect(data.time.activeSeconds).toBe(2700);
    expect(data.time.movingSeconds).toBeUndefined();
    expect(data.pace.activeSecondsPerKm).toBe(317);
    // Zeitreihe und Koordinaten gehören in die anderen Dateien.
    expect(data.timeline).toBeUndefined();
    expect(data.route).toBeUndefined();
    expect(data.dataQuality.model_version).toBe(QUALITY_VERSION);
    expect(data.context.focus).toBe('Ausdauer aufbauen');
    expect(data.context.history.last7Days.sessions).toBe(1);
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
    expect(sparse).toContain('| Ø Tempo über die Aufzeichnungszeit | – |');
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
    expect(ride).toContain(
      '| Ø Geschwindigkeit über die Aufzeichnungszeit | 11,4 km/h |',
    );
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

const phased: ReportRun = {
  ...run,
  id: 'run-3',
  events: undefined,
  route: undefined,
  time: {
    model_version: 'runback-phases-1',
    elapsedSeconds: 3027,
    pausedSeconds: 0,
    activeSeconds: 3027,
    movingSeconds: 2005,
    runningSeconds: 1234,
    walkingSeconds: 771,
    stoppedSeconds: 1000,
    unknownSeconds: 22,
  },
  phases: [
    { state: 'RUN', startElapsedSeconds: 0, endElapsedSeconds: 380, distanceMeters: 1310, avgHeartRate: 151 },
    { state: 'WALK', startElapsedSeconds: 380, endElapsedSeconds: 585, distanceMeters: 310 },
    { state: 'STOPPED', startElapsedSeconds: 585, endElapsedSeconds: 1585, distanceMeters: 0 },
  ],
  phaseMetrics: {
    model_version: 'runback-phases-1',
    longestRunSeconds: 380,
    longestRunMeters: 1310,
    longestMovingSeconds: 585,
    runWalkTransitions: 1,
    trailingIdleSeconds: 1000,
    fastestSustained300sSecondsPerKm: 287,
    running: { seconds: 1234, meters: 4200, avgHeartRate: 155 },
    walking: { seconds: 771, meters: 1100 },
    stopped: { seconds: 1000, meters: 0 },
  },
  elevation: {
    model_version: 'runback-elevation-1',
    available: false,
    reason: 'NO_VERTICAL_ACCURACY',
  },
  gaps: [
    { fromElapsedSeconds: 100, toElapsedSeconds: 140, reason: 'timeout' },
    { fromElapsedSeconds: 900, toElapsedSeconds: 905, reason: 'accuracy' },
  ],
  gapCount: 2,
  sensorSources: { gps: 'phone', heartRate: 'wear' },
  segments: [
    { id: 'run-3:0', distanceMeters: 1000, durationSeconds: 300, movingSeconds: 290, gapSeconds: 40, startElapsedSeconds: 0, endElapsedSeconds: 300 },
    { id: 'run-3:1', distanceMeters: 1000, durationSeconds: 400, movingSeconds: 360, startElapsedSeconds: 300, endElapsedSeconds: 700 },
  ],
};

describe('buildRunReport with movement phases', () => {
  const report = buildRunReport({ run: phased, now: start + 86400_000 });

  it('separates elapsed, active, moving, running, walking and stopped time', () => {
    expect(report).toContain('| Gesamtzeit (Start bis Ende) | 50:27 |');
    expect(report).toContain('| Aufzeichnungszeit (ohne Pausen) | 50:27 |');
    expect(report).toContain(
      '| Bewegungszeit (Laufen + Gehen) | 33:25 (Laufen 20:34 · Gehen 12:51) |',
    );
    expect(report).toContain('| Stillstand | 16:40 |');
    expect(report).toContain('| Ohne Bewegungsdaten | 0:22 |');
    expect(report).toContain('| Ø Tempo über die Aufzeichnungszeit | 5:55 /km |');
    expect(report).toContain('| Ø Tempo in Bewegung | 3:55 /km |');
    expect(report).toMatch(/Ø Tempo beim Laufen \| 4:53 \/km \(nur RUN-Phasen/);
  });

  it('lists phases, phase metrics and the trailing idle hint', () => {
    expect(report).toContain('## Bewegungsphasen');
    expect(report).toContain('| Laufen | 0:00 | 6:20 | 6:20 | 1,31 km | 4:50 /km | 151 bpm |');
    expect(report).toContain('| Stillstand | 9:45 | 26:25 | 16:40 | – | – | – |');
    expect(report).toContain('- Längste Laufphase am Stück: 1,31 km in 6:20');
    expect(report).toContain('- Wechsel zwischen Laufen und Gehen: 1');
    expect(report).toContain('- Schnellste 5 Minuten am Stück: 4:47 /km');
    expect(report).toContain('Am Ende 16:40 ohne Bewegung');
  });

  it('keeps GPS gaps inside the split instead of cutting it', () => {
    expect(report).toContain('| 1 | 1,00 | 1,00 km | 5:00 | 4:50 | 5:00 /km | 0:40 |');
    expect(report).toContain('| 2 | 2,00 | 1,00 km | 6:40 | 6:00 | 6:40 /km | – |');
  });

  it('says why elevation is missing instead of summing noise', () => {
    expect(report).toContain(
      '| Anstieg / Abstieg | nicht bestimmbar (GPS-Höhe ohne Genauigkeitsangabe) |',
    );
  });

  it('exports measured coverage, not an invented score', () => {
    const quality = dataQualityFor(phased, analyzeRun(phased));
    expect(quality.gps.coverage).toBeCloseTo(1 - 45 / 3027, 4);
    expect(quality.gps.gaps).toBe(2);
    expect(quality.heartRate.source).toBe('wear');
    expect(quality.elevation).toEqual({
      available: false,
      usable: false,
      reason: 'NO_VERTICAL_ACCURACY',
    });
    expect(quality).not.toHaveProperty('overall');
    // Der Abschnitt mit 40 s Lücke ist nicht für Pacing geeignet — mit Zeitbereich.
    const gap = quality.issues.find(issue => issue.code === 'gap');
    expect(gap?.count).toBe(1);
    expect(gap?.ranges).toEqual([[0, 300]]);
  });
});

describe('buildRunAnalysisExport', () => {
  const accidental = {
    ...run,
    id: 'run-oops',
    startTime: start - 3 * 86400_000,
    endTime: start - 3 * 86400_000 + 6000,
    durationSeconds: 6,
    distanceMeters: 0,
  };
  const data = buildRunAnalysisExport({
    run: phased,
    analysis: analyzeRun(phased),
    context: { goal: 'Halbmarathon', history: [...history, accidental] },
    now: start + 86400_000,
  });

  it('carries the time budget that adds up, all paces with their definition, and phases', () => {
    expect(data.exportVersion).toBe(RUN_ANALYSIS_EXPORT_VERSION);
    const t = data.time as unknown as Record<string, number>;
    expect(
      t.pausedSeconds + t.runningSeconds + t.walkingSeconds + t.stoppedSeconds + t.unknownSeconds,
    ).toBe(t.elapsedSeconds);
    expect(data.pace).toEqual({
      activeSecondsPerKm: 355,
      movingSecondsPerKm: 235,
      runningSecondsPerKm: 294,
      note: expect.stringContaining('keine Easy Pace'),
    });
    expect(data.phases).toHaveLength(3);
    expect(data.phases?.[0]).toMatchObject({ state: 'RUN', seconds: 380, distanceMeters: 1310 });
    expect(data.phaseMetrics?.running.secondsPerKm).toBe(294);
    expect(data.gaps).toHaveLength(2);
    expect(data.heartRate).toMatchObject({ available: true, source: 'wear', zones: null });
    expect(data.elevation).toEqual({
      model_version: 'runback-elevation-1',
      available: false,
      reason: 'NO_VERTICAL_ACCURACY',
    });
  });

  it('excludes accidental starts from the training history but keeps them stored', () => {
    expect(data.run.validity).toBe('valid');
    expect(data.context.history.last7Days).toEqual({
      sessions: 1,
      distanceMeters: 6000,
      durationSeconds: 1900,
    });
    const own = buildRunAnalysisExport({ run: accidental });
    expect(own.run.validity).toBe('accidental');
    const report = buildRunReport({
      run: phased,
      context: { history: [accidental] },
    });
    expect(report).toContain('- Nicht mitgezählt: 1 Fehlstart (unter 60 s und unter 100 m)');
    expect(report).not.toContain('Vorher in den letzten 7 Tagen');
  });

  it('names the three export files consistently', () => {
    expect(runExportFileNames(run)).toEqual({
      markdown: 'runback_2024-05-12_07-30_feierabendrunde.md',
      analysis: 'runback_2024-05-12_07-30_feierabendrunde_analysis.json',
      timeseries: 'runback_2024-05-12_07-30_feierabendrunde_timeseries.csv',
    });
  });
});
