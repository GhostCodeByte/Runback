/**
 * Laufbericht und Analyse-Export zum Teilen.
 *
 * Drei Dateien: der Markdown-Bericht für Menschen (mit kompakter JSON-
 * Zusammenfassung), `…_analysis.json` für Auswertungen und die 5-s-Zeitreihe
 * `…_timeseries.csv`, die nativ geschrieben wird. Rohdaten, bereinigte Daten
 * und abgeleitete Kennzahlen bleiben getrennt: Zeitbudget, Phasen, Höhe und
 * Datenqualität tragen ihre Modellversion; Abdeckungen sind gemessen, es gibt
 * keinen erfundenen Gesamtscore.
 *
 * Was fehlt, fehlt: keine Nullen, keine erfundenen Werte. Rohsamples bleiben
 * nativ; der Zeitverlauf kommt als begrenztes Aggregat aus Kotlin.
 */
import type {
  Adherence,
  ElevationSummary,
  MovementPhase,
  MovementState,
  QualityIssue,
  RunAnalysis,
  RunSummary,
  SegmentAggregate,
  TimeBudget,
} from './types';
import { runTitle, purposeLabel } from './runTitle';
import {
  isAccidentalRun,
  normalizeSport,
  runValidity,
  sportWords,
  usesPace,
} from './sport';
import { runTargetLabel, type RunTarget } from './runTarget';
import { focusLabel, type TrainingFocus } from './focus';
import { QUALITY_VERSION } from './analysis';

export const RUN_REPORT_VERSION = 'runback-report-2';
export const RUN_ANALYSIS_EXPORT_VERSION = 'runback-analysis-1';

export interface ReportRoutePoint {
  latitude: number;
  longitude: number;
  time?: number;
  gap?: boolean;
}
export interface ReportEvent {
  type?: string;
  at?: number;
  message?: string;
  data?: Record<string, unknown>;
}
export interface TimelineRow {
  /** Sekunden seit dem Start, Pausen eingeschlossen (Fensterende). */
  elapsedSeconds: number;
  /** Zurückgelegte Strecke am Fensterende, in m. */
  distanceMeters: number;
  stepDistanceMeters: number;
  /** Sekunden mit gültigen GPS-Schritten im Fenster — keine Bewegungszeit. */
  gpsCoveredSeconds: number;
  avgHeartRate?: number;
  avgCadence?: number;
  altitudeM?: number;
}
export interface RunTimeline {
  version?: string;
  stepSeconds: number;
  rows: TimelineRow[];
}
export interface ReportRun extends RunSummary {
  note?: string;
  route?: ReportRoutePoint[];
  events?: ReportEvent[];
  target?: RunTarget;
}
export interface RunReportContext {
  goal?: string;
  goalTargetDate?: string;
  focus?: TrainingFocus | null;
  adherence?: Adherence;
  /** Andere Läufe für Wochenumfang und Einordnung; der Lauf selbst darf enthalten sein. */
  history?: RunSummary[];
}
export interface RunReportInput {
  run: ReportRun;
  analysis?: RunAnalysis | null;
  timeline?: RunTimeline | null;
  context?: RunReportContext;
  /** Zeitpunkt des Exports; Standard: jetzt. */
  now?: number;
}

const DAY = 24 * 3600 * 1000;

const fmt = (value: number, digits = 1) =>
  Number.isFinite(value)
    ? value.toLocaleString('de-DE', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '–';
const int = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value)
    ? Math.round(value).toLocaleString('de-DE')
    : '–';
const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};
/** Tempo in m:ss /km; unter 20 m Strecke oder ohne Zeit nicht bestimmbar. */
const formatPace = (meters: number, seconds: number) =>
  meters >= 20 && seconds > 0
    ? `${formatDuration(seconds / (meters / 1000))} /km`
    : '–';
const formatSpeed = (meters: number, seconds: number) =>
  meters >= 20 && seconds > 0
    ? `${fmt(meters / 1000 / (seconds / 3600), 1)} km/h`
    : '–';
const dateTime = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const clock = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const iso = (timestamp: number | undefined) =>
  timestamp && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
const percent = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value)
    ? '–'
    : `${Math.round(value * 100)} %`;
const escapeCell = (value: string) => value.replace(/\|/g, '\\|');
const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
const quote = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join('\n');

const SOURCE_LABELS: Record<string, string> = {
  phone: 'Telefon (Runback)',
  wear: 'Uhr (Runback Wear)',
  import: 'Import',
  healthconnect: 'Health Connect',
};
const sourceLabel = (source: string) =>
  SOURCE_LABELS[source] ||
  (source.startsWith('import') ? `Import (${source})` : source);

const EVENT_LABELS: Record<string, string> = {
  start: 'Start',
  pause: 'Pause',
  resume: 'Weiter',
  stop: 'Ende',
  completed: 'Ende',
  interrupted: 'Unterbrochen',
  target_cue: 'Hinweis zum Ziel',
  warning: 'Warnung',
  feedback: 'Feedback gespeichert',
};

const phaseLabel = (phase: SegmentAggregate['phase']) =>
  ((
    {
      warmup: 'Einlaufen',
      work: 'Belastung',
      recovery: 'Erholung',
      cooldown: 'Auslaufen',
      pause: 'Pause',
    } as Record<string, string>
  )[phase || ''] || '');

const STATE_LABELS: Record<MovementState, string> = {
  RUN: 'Laufen',
  WALK: 'Gehen',
  STOPPED: 'Stillstand',
  PAUSED: 'Pause',
  UNKNOWN: 'Unbekannt',
};
const ELEVATION_REASONS: Record<string, string> = {
  NO_ELEVATION_SOURCE: 'keine Höhenquelle',
  NO_VERTICAL_ACCURACY: 'GPS-Höhe ohne Genauigkeitsangabe',
  VERTICAL_ACCURACY_TOO_LOW: 'GPS-Höhe zu ungenau',
};

function overviewRows(run: ReportRun): string[][] {
  const sport = normalizeSport(run.sport);
  const pace = usesPace(sport);
  const rows: string[][] = [
    ['Sportart', sportWords(sport).label],
    ['Zweck', purposeLabel(run.purpose)],
    ['Start', dateTime.format(new Date(run.startTime))],
  ];
  if (run.endTime > run.startTime) {
    rows.push(['Ende', clock.format(new Date(run.endTime))]);
  }
  if (isAccidentalRun(run)) {
    rows.push(['Gültigkeit', 'Fehlstart (zählt nicht als Training)']);
  }
  const time = run.time;
  const rate = (meters: number, seconds: number) =>
    pace ? formatPace(meters, seconds) : formatSpeed(meters, seconds);
  if (time) {
    rows.push(['Gesamtzeit (Start bis Ende)', formatDuration(time.elapsedSeconds)]);
    if (time.pausedSeconds >= 1)
      rows.push(['Pausen', formatDuration(time.pausedSeconds)]);
    rows.push(['Aufzeichnungszeit (ohne Pausen)', formatDuration(time.activeSeconds)]);
    rows.push([
      'Bewegungszeit (Laufen + Gehen)',
      `${formatDuration(time.movingSeconds)} (Laufen ${formatDuration(
        time.runningSeconds,
      )} · Gehen ${formatDuration(time.walkingSeconds)})`,
    ]);
    if (time.stoppedSeconds >= 1)
      rows.push(['Stillstand', formatDuration(time.stoppedSeconds)]);
    if (time.unknownSeconds >= 1)
      rows.push(['Ohne Bewegungsdaten', formatDuration(time.unknownSeconds)]);
  } else {
    if (run.endTime > run.startTime) {
      const wall = (run.endTime - run.startTime) / 1000;
      if (wall - run.durationSeconds > 30) {
        rows.push(['Pausen gesamt', formatDuration(wall - run.durationSeconds)]);
      }
    }
    rows.push(['Aufzeichnungszeit (ohne Pausen)', formatDuration(run.durationSeconds)]);
  }
  rows.push(['Distanz', `${fmt(run.distanceMeters / 1000, 2)} km`]);
  const paceWord = pace ? 'Ø Tempo' : 'Ø Geschwindigkeit';
  rows.push([
    `${paceWord} über die Aufzeichnungszeit`,
    rate(run.distanceMeters, time ? time.activeSeconds : run.durationSeconds),
  ]);
  if (time) {
    rows.push([`${paceWord} in Bewegung`, rate(run.distanceMeters, time.movingSeconds)]);
    const running = run.phaseMetrics?.running;
    if (running && running.meters >= 100) {
      rows.push([
        `${paceWord} beim Laufen`,
        `${rate(running.meters, running.seconds)} (nur RUN-Phasen; durch die Erkennungsschwelle schneller als eine Easy Pace)`,
      ]);
    }
  }
  if (run.avgHeartRate) {
    const extremes =
      run.avgHeartRateMax !== undefined && run.avgHeartRateMin !== undefined
        ? `, ${int(run.avgHeartRateMin)}–${int(run.avgHeartRateMax)} bpm`
        : '';
    rows.push([
      'Ø Puls',
      `${int(run.avgHeartRate)} bpm${extremes}${
        run.heartRateCoverage !== undefined
          ? ` (Abdeckung ${percent(run.heartRateCoverage)} der Aufzeichnungszeit)`
          : ''
      }`,
    ]);
  }
  if (run.avgCadence) {
    rows.push([
      pace ? 'Ø Schrittfrequenz' : 'Ø Trittfrequenz',
      `${int(run.avgCadence)} /min${
        run.cadenceCoverage !== undefined
          ? ` (Abdeckung ${percent(run.cadenceCoverage)})`
          : ''
      }`,
    ]);
  }
  const elevation = run.elevation;
  if (elevation?.available) {
    rows.push([
      'Anstieg / Abstieg',
      `${int(elevation.ascentMeters)} m / ${int(elevation.descentMeters)} m (${
        elevation.source === 'barometer' ? 'Barometer' : 'GPS, geglättet'
      }${elevation.reference === 'start' ? ', Höhe relativ zum Start' : ''})`,
    ]);
  } else if (elevation) {
    rows.push([
      'Anstieg / Abstieg',
      `nicht bestimmbar (${ELEVATION_REASONS[elevation.reason] || elevation.reason})`,
    ]);
  } else if (run.elevationGainMeters !== undefined) {
    rows.push(['Anstieg gesamt (laut Quelle)', `${int(run.elevationGainMeters)} m`]);
  }
  if (run.calories) rows.push(['Kalorien', `${int(run.calories)} kcal`]);
  if (run.steps) rows.push(['Schritte', int(run.steps)]);
  if (
    run.context?.temperatureC !== undefined ||
    run.context?.windMps !== undefined
  ) {
    const parts: string[] = [];
    if (run.context.temperatureC !== undefined)
      parts.push(`${fmt(run.context.temperatureC, 0)} °C`);
    if (run.context.windMps !== undefined)
      parts.push(`Wind ${fmt(run.context.windMps, 1)} m/s`);
    rows.push(['Wetter', parts.join(' · ')]);
  }
  if (run.target && run.target.kind !== 'none') {
    rows.push(['Begleitung unterwegs', runTargetLabel(run.target)]);
  }
  rows.push(['Quelle', sourceLabel(run.source)]);
  if (run.sourceActivityType)
    rows.push(['Aktivitätstyp der Quelle', run.sourceActivityType]);
  return rows;
}

function phaseTable(run: ReportRun): string | undefined {
  const phases = run.phases || [];
  if (!phases.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasHeart = phases.some(p => p.avgHeartRate !== undefined);
  const header = ['Phase', 'Von', 'Bis', 'Dauer', 'Strecke', pace ? 'Tempo' : 'Geschw.'];
  if (hasHeart) header.push('Ø Puls');
  const rows = phases.map(p => {
    const seconds = p.endElapsedSeconds - p.startElapsedSeconds;
    const moving = p.state === 'RUN' || p.state === 'WALK';
    const row = [
      STATE_LABELS[p.state] || p.state,
      formatDuration(p.startElapsedSeconds),
      formatDuration(p.endElapsedSeconds),
      formatDuration(seconds),
      moving ? `${fmt(p.distanceMeters / 1000, 2)} km` : '–',
      moving
        ? pace
          ? formatPace(p.distanceMeters, seconds)
          : formatSpeed(p.distanceMeters, seconds)
        : '–',
    ];
    if (hasHeart)
      row.push(p.avgHeartRate !== undefined ? `${int(p.avgHeartRate)} bpm` : '–');
    return row;
  });
  return table(header, rows);
}

function phaseMetricLines(run: ReportRun): string[] {
  const m = run.phaseMetrics;
  if (!m) return [];
  const pace = usesPace(normalizeSport(run.sport));
  const lines: string[] = [];
  if (m.longestRunSeconds !== undefined && m.longestRunMeters !== undefined) {
    lines.push(
      `- Längste Laufphase am Stück: ${fmt(m.longestRunMeters / 1000, 2)} km in ${formatDuration(
        m.longestRunSeconds,
      )}`,
    );
  }
  if (m.longestMovingSeconds !== undefined)
    lines.push(`- Längste Bewegung ohne Stillstand: ${formatDuration(m.longestMovingSeconds)}`);
  lines.push(`- Wechsel zwischen Laufen und Gehen: ${m.runWalkTransitions}`);
  if (m.fastestSustained300sSecondsPerKm !== undefined && pace) {
    lines.push(
      `- Schnellste 5 Minuten am Stück: ${formatDuration(
        m.fastestSustained300sSecondsPerKm,
      )} /km`,
    );
  }
  if (m.trailingIdleSeconds >= 300) {
    lines.push(
      `- Am Ende ${formatDuration(
        m.trailingIdleSeconds,
      )} ohne Bewegung: vermutlich wurde die Aufzeichnung nicht gestoppt.`,
    );
  }
  return lines;
}

function segmentTable(run: ReportRun): string | undefined {
  const segments = run.segments || [];
  if (!segments.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasMoving = segments.some(s => s.movingSeconds !== undefined);
  const hasHeart = segments.some(s => s.avgHeartRate !== undefined);
  const hasCadence = segments.some(s => s.avgCadence !== undefined);
  const hasGrade = segments.some(s => s.gradePercent !== undefined);
  const hasClimb = segments.some(s => s.ascentMeters !== undefined);
  const hasGap = segments.some(s => (s.gapSeconds ?? 0) > 0);
  const hasPhase = segments.some(s => s.phase);
  const header = ['#', 'Bis km', 'Länge', 'Zeit'];
  if (hasMoving) header.push('In Bewegung');
  header.push(pace ? 'Tempo' : 'Geschw.');
  if (hasHeart) header.push('Ø Puls');
  if (hasCadence) header.push('Ø Kadenz');
  if (hasGrade) header.push('Steigung');
  if (hasClimb) header.push('Auf / Ab');
  if (hasGap) header.push('GPS-Lücke');
  if (hasPhase) header.push('Phase');
  let cumulative = 0;
  const rows = segments.map((s, i) => {
    cumulative += s.distanceMeters;
    const row = [
      String(i + 1),
      fmt(cumulative / 1000, 2),
      `${fmt(s.distanceMeters / 1000, 2)} km`,
      formatDuration(s.durationSeconds),
    ];
    if (hasMoving)
      row.push(s.movingSeconds !== undefined ? formatDuration(s.movingSeconds) : '–');
    row.push(
      pace
        ? formatPace(s.distanceMeters, s.durationSeconds)
        : formatSpeed(s.distanceMeters, s.durationSeconds),
    );
    if (hasHeart)
      row.push(
        s.avgHeartRate !== undefined ? `${int(s.avgHeartRate)} bpm` : '–',
      );
    if (hasCadence)
      row.push(s.avgCadence !== undefined ? `${int(s.avgCadence)}` : '–');
    if (hasGrade)
      row.push(
        s.gradePercent !== undefined ? `${fmt(s.gradePercent, 1)} %` : '–',
      );
    if (hasClimb)
      row.push(
        s.ascentMeters !== undefined
          ? `+${int(s.ascentMeters)} / −${int(s.descentMeters)} m`
          : '–',
      );
    if (hasGap)
      row.push((s.gapSeconds ?? 0) > 0 ? formatDuration(s.gapSeconds as number) : '–');
    if (hasPhase) row.push(phaseLabel(s.phase));
    return row;
  });
  return table(header, rows);
}

function timelineTable(
  run: ReportRun,
  timeline: RunTimeline,
): string | undefined {
  if (!timeline.rows.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasHeart = timeline.rows.some(r => r.avgHeartRate !== undefined);
  const hasCadence = timeline.rows.some(r => r.avgCadence !== undefined);
  const hasAltitude = timeline.rows.some(r => r.altitudeM !== undefined);
  const header = [
    'Zeit seit Start',
    'km gesamt',
    pace ? 'Tempo im Fenster' : 'Geschw. im Fenster',
  ];
  if (hasHeart) header.push('Ø Puls');
  if (hasCadence) header.push('Ø Kadenz');
  if (hasAltitude) header.push('Höhe');
  const rows = timeline.rows.map(r => {
    const row = [
      formatDuration(r.elapsedSeconds),
      fmt(r.distanceMeters / 1000, 2),
      r.stepDistanceMeters >= 50 && r.gpsCoveredSeconds > 0
        ? pace
          ? formatPace(r.stepDistanceMeters, r.gpsCoveredSeconds)
          : formatSpeed(r.stepDistanceMeters, r.gpsCoveredSeconds)
        : '–',
    ];
    if (hasHeart)
      row.push(
        r.avgHeartRate !== undefined ? `${int(r.avgHeartRate)} bpm` : '–',
      );
    if (hasCadence)
      row.push(r.avgCadence !== undefined ? int(r.avgCadence) : '–');
    if (hasAltitude)
      row.push(r.altitudeM !== undefined ? `${int(r.altitudeM)} m` : '–');
    return row;
  });
  return table(header, rows);
}

function eventLines(run: ReportRun): string[] {
  const events = (run.events || []).filter(
    e => e.type && e.type !== 'feedback' && typeof e.at === 'number',
  );
  return events.map(e => {
    const message =
      e.message ||
      (typeof e.data?.message === 'string' ? (e.data.message as string) : '');
    const label = EVENT_LABELS[e.type as string] || (e.type as string);
    return `- ${clock.format(new Date(e.at as number))} — ${label}${
      message ? `: ${message}` : ''
    }`;
  });
}

function impressionLines(run: ReportRun, context?: RunReportContext): string[] {
  const lines: string[] = [];
  if (run.rpe?.legs !== undefined)
    lines.push(`- Beine: ${run.rpe.legs} von 10`);
  if (run.rpe?.breathing !== undefined)
    lines.push(`- Atmung: ${run.rpe.breathing} von 10`);
  if (context?.adherence) {
    lines.push(
      `- Empfehlung ausprobiert: ${
        { yes: 'Ja', no: 'Nein', unknown: 'Unklar' }[context.adherence]
      }`,
    );
  }
  if (run.note?.trim()) lines.push(`- Notiz:\n\n${quote(run.note)}`);
  return lines;
}

export interface QualityIssueGroup {
  code: string;
  sensor: QualityIssue['sensor'];
  count: number;
  suspected: boolean;
  message: string;
  segmentIds: string[];
  /** Betroffene Zeitbereiche in Sekunden seit Start, wenn die Abschnitte sie kennen. */
  ranges: [number, number][];
}
export interface DataQuality {
  model_version: string;
  gps: {
    /** Anteil der Aufzeichnungszeit mit gültigen GPS-Schritten; fehlt ohne Lückenliste. */
    coverage?: number;
    rejectedSteps?: number;
    gaps?: number;
    usable: boolean;
  };
  heartRate: {
    available: boolean;
    coverage?: number;
    source?: string;
    usable: boolean;
    reason?: 'NO_HR_SOURCE' | 'NO_USABLE_SEGMENTS';
  };
  cadence: { available: boolean; coverage?: number };
  elevation: {
    available: boolean;
    source?: 'barometer' | 'gps';
    rejectedSamples?: number;
    usable: boolean;
    reason?: string;
  };
  issues: QualityIssueGroup[];
}

/**
 * Datenqualität als Zahlen, die gemessen wurden: Abdeckungen, Anzahl, Zeitbereiche.
 * Ein Gesamtscore fehlt absichtlich — er wäre erfunden. `usable` ist die
 * versionierte Entscheidung der Regeln in analysis.ts.
 */
export function dataQualityFor(
  run: ReportRun,
  analysis?: RunAnalysis | null,
): DataQuality {
  const quality = analysis?.quality;
  const segments = run.segments || [];
  const rangeOf = (segmentId: string): [number, number] | undefined => {
    const index = segments.findIndex((s, i) => (s.id ?? `split-${i + 1}`) === segmentId);
    const s = segments[index];
    if (!s || s.startElapsedSeconds === undefined || s.endElapsedSeconds === undefined)
      return undefined;
    return [Math.round(s.startElapsedSeconds), Math.round(s.endElapsedSeconds)];
  };
  const groups = new Map<string, QualityIssueGroup>();
  for (const issue of quality?.issues ?? []) {
    const group = groups.get(issue.code) ?? {
      code: issue.code,
      sensor: issue.sensor,
      count: 0,
      suspected: issue.suspected,
      message: issue.message,
      segmentIds: [],
      ranges: [],
    };
    group.count++;
    if (issue.segmentId) {
      group.segmentIds.push(issue.segmentId);
      const range = rangeOf(issue.segmentId);
      if (range) group.ranges.push(range);
    }
    groups.set(issue.code, group);
  }
  const gapSeconds = (run.gaps || []).reduce(
    (a, g) => a + Math.max(0, g.toElapsedSeconds - g.fromElapsedSeconds),
    0,
  );
  const active = run.time?.activeSeconds ?? run.durationSeconds;
  const sources = run.sensorSources;
  const hrAvailable = run.avgHeartRate !== undefined;
  const elevation = run.elevation;
  const elevationSuspect = groups.has('suspected_elevation');
  return {
    model_version: QUALITY_VERSION,
    gps: {
      coverage:
        run.gaps && active > 0
          ? Math.max(0, Math.min(1, 1 - gapSeconds / active))
          : undefined,
      rejectedSteps: run.gapCount,
      gaps: run.gaps?.length,
      usable: quality?.paceUsable ?? false,
    },
    heartRate: {
      available: hrAvailable,
      coverage: run.heartRateCoverage,
      source: sources?.heartRate,
      usable: quality?.heartRateUsable ?? false,
      reason: !hrAvailable
        ? 'NO_HR_SOURCE'
        : quality && !quality.heartRateUsable
        ? 'NO_USABLE_SEGMENTS'
        : undefined,
    },
    cadence: {
      available: run.avgCadence !== undefined,
      coverage: run.cadenceCoverage,
    },
    elevation: elevation?.available
      ? {
          available: true,
          source: elevation.source,
          rejectedSamples: elevation.rejectedSamples,
          usable: !elevationSuspect,
          reason: elevationSuspect ? 'IMPLAUSIBLE_GRADE' : undefined,
        }
      : {
          available: false,
          usable: false,
          reason: elevation ? elevation.reason : 'NO_ELEVATION_MODEL',
        },
    issues: [...groups.values()],
  };
}

function analysisLines(run: ReportRun, analysis: RunAnalysis): string[] {
  const lines: string[] = [];
  lines.push(`- Einordnung: ${analysis.classification}`);
  lines.push(`- Nächster Schritt: ${analysis.nextAction}`);
  const dq = dataQualityFor(run, analysis);
  lines.push(
    `- Datenqualität (${dq.model_version}): Tempo ${
      dq.gps.usable ? 'nutzbar' : 'nicht nutzbar'
    }${dq.gps.coverage !== undefined ? ` (GPS-Abdeckung ${percent(dq.gps.coverage)})` : ''}; Puls ${
      dq.heartRate.usable ? 'nutzbar' : 'nicht nutzbar'
    }${
      dq.heartRate.coverage !== undefined
        ? ` (Abdeckung ${percent(dq.heartRate.coverage)})`
        : ''
    }${dq.heartRate.reason ? ` [${dq.heartRate.reason}]` : ''}; Höhe ${
      dq.elevation.usable ? 'nutzbar' : 'nicht nutzbar'
    }${dq.elevation.reason ? ` [${dq.elevation.reason}]` : ''}`,
  );
  for (const group of dq.issues) {
    const where = group.ranges.length
      ? ` (${group.ranges
          .slice(0, 6)
          .map(([a, b]) => `${formatDuration(a)}–${formatDuration(b)}`)
          .join(', ')}${group.ranges.length > 6 ? ', …' : ''})`
      : '';
    lines.push(
      `  - ${group.suspected ? 'Vermutet: ' : ''}${group.message} ×${group.count}${where}`,
    );
  }
  const effort = analysis.effort;
  lines.push(
    `- Modellierte Anforderung: ${
      effort.speedIndex === undefined
        ? 'nicht bestimmbar'
        : `Tempoindex ${fmt(effort.speedIndex, 0)} (${effort.unit})`
    }; ${effort.uncertainty}`,
  );
  lines.push(
    `  - Faktoren: Tempo ${effort.factors.tempo} · Steigung ${effort.factors.slope} · Wind ${effort.factors.wind} · Wärme ${effort.factors.heat}`,
  );
  if (
    effort.sessionLoad?.legs !== undefined ||
    effort.sessionLoad?.breathing !== undefined
  ) {
    const parts: string[] = [];
    if (effort.sessionLoad.legs !== undefined)
      parts.push(`Beine ${fmt(effort.sessionLoad.legs, 0)}`);
    if (effort.sessionLoad.breathing !== undefined)
      parts.push(`Atmung ${fmt(effort.sessionLoad.breathing, 0)}`);
    lines.push(`  - Belastung (RPE × Minuten): ${parts.join(' · ')}`);
  }
  if (analysis.pacing) {
    const p = analysis.pacing;
    lines.push(
      `- Tempoverlauf: erste Hälfte ${formatDuration(
        p.firstPaceSecondsPerKm,
      )} /km, zweite ${formatDuration(
        p.lastPaceSecondsPerKm,
      )} /km, Abfall ${fmt(p.fadePercent, 1)} %, Streuung ${fmt(
        p.coefficientOfVariation * 100,
        1,
      )} %`,
    );
  }
  if (analysis.recommendation) {
    const r = analysis.recommendation;
    lines.push(`- Empfehlung „${r.title}“: ${r.action}`);
    lines.push(`  - Begründung: ${r.reason}`);
  }
  if (analysis.question) {
    lines.push(`- Offene Frage der App: ${analysis.question.text}`);
  }
  lines.push(`- Modellversion: ${analysis.model_version}`);
  return lines;
}

/** Frühere, abgeschlossene Einheiten ohne Fehlstarts — dieselbe Regel wie die Statistik. */
function historyBefore(run: ReportRun, context?: RunReportContext): RunSummary[] {
  return (context?.history || []).filter(
    r =>
      r.id !== run.id &&
      r.status !== 'recording' &&
      r.startTime < run.startTime &&
      !isAccidentalRun(r),
  );
}

function contextLines(run: ReportRun, context?: RunReportContext): string[] {
  const lines: string[] = [];
  if (!context) return lines;
  if (context.goal?.trim()) {
    lines.push(
      `- Ziel: ${context.goal.trim()}${
        context.goalTargetDate ? ` (bis ${context.goalTargetDate})` : ''
      }`,
    );
  }
  if (context.focus) lines.push(`- Fokus: ${focusLabel(context.focus)}`);
  const history = historyBefore(run, context);
  const skipped = (context.history || []).filter(
    r => r.id !== run.id && r.startTime < run.startTime && isAccidentalRun(r),
  ).length;
  if (skipped)
    lines.push(
      `- Nicht mitgezählt: ${skipped} Fehlstart${skipped === 1 ? '' : 's'} (unter 60 s und unter 100 m)`,
    );
  if (history.length) {
    const windowStats = (days: number) => {
      const from = run.startTime - days * DAY;
      const runs = history.filter(r => r.startTime >= from);
      const km = runs.reduce((a, r) => a + r.distanceMeters, 0) / 1000;
      return `${runs.length} ${
        runs.length === 1 ? 'Einheit' : 'Einheiten'
      }, ${fmt(km, 1)} km`;
    };
    lines.push(`- Vorher in den letzten 7 Tagen: ${windowStats(7)}`);
    lines.push(`- Vorher in den letzten 28 Tagen: ${windowStats(28)}`);
    const previous = history.reduce((best, r) =>
      r.startTime > best.startTime ? r : best,
    );
    lines.push(
      `- Letzte Einheit davor: ${dateTime.format(
        new Date(previous.startTime),
      )} · ${fmt(previous.distanceMeters / 1000, 2)} km · ${formatDuration(
        previous.durationSeconds,
      )}`,
    );
  }
  return lines;
}

function routeLines(run: ReportRun): string[] {
  const points = (run.route || []).filter(
    p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
  );
  if (points.length < 2) return [];
  const lat = points.map(p => p.latitude);
  const lon = points.map(p => p.longitude);
  const coord = (p: ReportRoutePoint) =>
    `${fmt(p.latitude, 5)}, ${fmt(p.longitude, 5)}`;
  return [
    `- Start: ${coord(points[0])}`,
    `- Ende: ${coord(points[points.length - 1])}`,
    `- Ausdehnung: ${fmt(Math.min(...lat), 5)}–${fmt(
      Math.max(...lat),
      5,
    )} N, ${fmt(Math.min(...lon), 5)}–${fmt(Math.max(...lon), 5)} O`,
    `- ${points.length} gespeicherte Punkte (ausgedünnt); Koordinaten bleiben in der App`,
  ];
}

const round = (value: number | undefined, digits: number) =>
  value !== undefined && Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : undefined;

function historyStats(run: ReportRun, context?: RunReportContext) {
  const history = historyBefore(run, context);
  const window = (days: number) => {
    const runs = history.filter(r => r.startTime >= run.startTime - days * DAY);
    return {
      sessions: runs.length,
      distanceMeters: round(
        runs.reduce((a, r) => a + r.distanceMeters, 0),
        0,
      ),
      durationSeconds: round(
        runs.reduce((a, r) => a + r.durationSeconds, 0),
        0,
      ),
    };
  };
  const previous = history.length
    ? history.reduce((best, r) => (r.startTime > best.startTime ? r : best))
    : undefined;
  return {
    rule: 'Nur abgeschlossene Einheiten derselben Sportart vor diesem Start; Fehlstarts (< 60 s und < 100 m) ausgeschlossen.',
    last7Days: window(7),
    last28Days: window(28),
    previous: previous
      ? {
          id: previous.id,
          startTime: iso(previous.startTime),
          distanceMeters: round(previous.distanceMeters, 0),
          durationSeconds: round(previous.durationSeconds, 0),
        }
      : undefined,
  };
}

function timeAndPace(run: ReportRun) {
  const time: TimeBudget | undefined = run.time;
  const pace = (meters: number, seconds: number) =>
    meters >= 100 && seconds > 0 ? round(seconds / (meters / 1000), 0) : undefined;
  const running = run.phaseMetrics?.running;
  return {
    time: time
      ? {
          model_version: time.model_version,
          elapsedSeconds: round(time.elapsedSeconds, 0),
          pausedSeconds: round(time.pausedSeconds, 0),
          activeSeconds: round(time.activeSeconds, 0),
          movingSeconds: round(time.movingSeconds, 0),
          runningSeconds: round(time.runningSeconds, 0),
          walkingSeconds: round(time.walkingSeconds, 0),
          stoppedSeconds: round(time.stoppedSeconds, 0),
          unknownSeconds: round(time.unknownSeconds, 0),
          definition:
            'elapsed = paused + running + walking + stopped + unknown; active = elapsed − paused; moving = running + walking',
        }
      : {
          elapsedSeconds: round((run.endTime - run.startTime) / 1000, 0),
          activeSeconds: round(run.durationSeconds, 0),
          definition:
            'Ohne Phasenerkennung (Altdaten, Import): nur Aufzeichnungszeit ohne Pausen bekannt; keine Bewegungszeit.',
        },
    pace: {
      activeSecondsPerKm: pace(
        run.distanceMeters,
        time ? time.activeSeconds : run.durationSeconds,
      ),
      movingSecondsPerKm: time ? pace(run.distanceMeters, time.movingSeconds) : undefined,
      runningSecondsPerKm: running ? pace(running.meters, running.seconds) : undefined,
      note: 'runningSecondsPerKm ist das Tempo der als RUN erkannten Phasen und durch die Erkennungsschwelle nach oben verzerrt; es ist keine Easy Pace.',
    },
  };
}

function splitsFor(run: ReportRun) {
  let cumulative = 0;
  return run.segments?.map((s, i) => {
    cumulative += s.distanceMeters;
    return {
      id: s.id ?? `split-${i + 1}`,
      index: i + 1,
      endDistanceMeters: round(cumulative, 1),
      distanceMeters: round(s.distanceMeters, 1),
      elapsedSeconds: round(s.durationSeconds, 1),
      movingSeconds: round(s.movingSeconds, 1),
      gapSeconds: round(s.gapSeconds, 1),
      startElapsedSeconds: round(s.startElapsedSeconds, 1),
      endElapsedSeconds: round(s.endElapsedSeconds, 1),
      avgHeartRate: round(s.avgHeartRate, 1),
      avgCadence: round(s.avgCadence, 1),
      gradePercent: round(s.gradePercent, 2),
      ascentMeters: round(s.ascentMeters, 1),
      descentMeters: round(s.descentMeters, 1),
      phase: s.phase,
    };
  });
}

function phasesFor(run: ReportRun) {
  return run.phases?.map((p: MovementPhase) => ({
    state: p.state,
    startElapsedSeconds: p.startElapsedSeconds,
    endElapsedSeconds: p.endElapsedSeconds,
    seconds: p.endElapsedSeconds - p.startElapsedSeconds,
    distanceMeters: round(p.distanceMeters, 1),
    avgHeartRate: round(p.avgHeartRate, 1),
    avgCadence: round(p.avgCadence, 1),
  }));
}

function sensorFor(run: ReportRun) {
  const sources = run.sensorSources;
  const hr = run.avgHeartRate !== undefined;
  return {
    heartRate: hr
      ? {
          available: true,
          source: sources?.heartRate,
          coverage: round(run.heartRateCoverage, 3),
          avg: round(run.avgHeartRate, 1),
          max: round(run.avgHeartRateMax, 0),
          min: round(run.avgHeartRateMin, 0),
          zones: null,
          zonesReason: 'NO_MAX_HR_CONFIGURED',
        }
      : { available: false, reason: 'NO_HR_SOURCE' },
    cadence:
      run.avgCadence !== undefined
        ? {
            available: true,
            coverage: round(run.cadenceCoverage, 3),
            avg: round(run.avgCadence, 1),
            max: round(run.avgCadenceMax, 0),
            min: round(run.avgCadenceMin, 0),
          }
        : { available: false },
  };
}

function elevationFor(run: ReportRun) {
  const e: ElevationSummary | undefined = run.elevation;
  if (!e) {
    return run.elevationGainMeters !== undefined
      ? { available: true, source: 'import', ascentMeters: round(run.elevationGainMeters, 0) }
      : { available: false, reason: 'NO_ELEVATION_MODEL' };
  }
  return e.available
    ? {
        model_version: e.model_version,
        available: true,
        source: e.source,
        reference: e.reference,
        ascentMeters: round(e.ascentMeters, 0),
        descentMeters: round(e.descentMeters, 0),
        rejectedSamples: e.rejectedSamples,
        hysteresisMeters: e.hysteresisMeters,
      }
    : { model_version: e.model_version, available: false, reason: e.reason };
}

/**
 * `…_analysis.json`: alles, was eine Auswertung braucht, ohne Zeitreihe und
 * ohne Route. Einheiten: Sekunden, Meter, bpm, /min; Zeiten ISO 8601 (UTC).
 */
export function buildRunAnalysisExport(input: RunReportInput) {
  const { run, analysis, context } = input;
  const now = input.now ?? Date.now();
  const m = run.phaseMetrics;
  const pace = (meters: number | undefined, seconds: number | undefined) =>
    meters !== undefined && seconds !== undefined && meters >= 100 && seconds > 0
      ? round(seconds / (meters / 1000), 0)
      : undefined;
  return {
    exportVersion: RUN_ANALYSIS_EXPORT_VERSION,
    exportedAt: iso(now),
    units: {
      time: 's',
      distance: 'm',
      pace: 's/km',
      heartRate: 'bpm',
      cadence: '/min',
      elevation: 'm',
    },
    run: {
      id: run.id,
      title: runTitle(run),
      sport: normalizeSport(run.sport),
      purpose: run.purpose,
      validity: runValidity(run),
      startTime: iso(run.startTime),
      endTime: iso(run.endTime),
      distanceMeters: round(run.distanceMeters, 1),
      source: run.source,
      sourceActivityType: run.sourceActivityType,
      sensorSources: run.sensorSources,
      distanceModelVersion: run.model_version,
      rawSampleCount: run.samples,
      weather: run.context,
      target: run.target && run.target.kind !== 'none' ? run.target : undefined,
      rpe: run.rpe,
      note: run.note,
    },
    ...timeAndPace(run),
    phases: phasesFor(run),
    phaseMetrics: m
      ? {
          model_version: m.model_version,
          longestRunSeconds: m.longestRunSeconds,
          longestRunMeters: round(m.longestRunMeters, 0),
          longestMovingSeconds: m.longestMovingSeconds,
          runWalkTransitions: m.runWalkTransitions,
          trailingIdleSeconds: m.trailingIdleSeconds,
          fastestSustained300sSecondsPerKm: round(m.fastestSustained300sSecondsPerKm, 0),
          running: { ...m.running, meters: round(m.running.meters, 0), secondsPerKm: pace(m.running.meters, m.running.seconds) },
          walking: { ...m.walking, meters: round(m.walking.meters, 0), secondsPerKm: pace(m.walking.meters, m.walking.seconds) },
          stopped: { seconds: round(m.stopped.seconds, 0), avgHeartRate: round(m.stopped.avgHeartRate, 1) },
        }
      : undefined,
    splits: splitsFor(run),
    gaps: run.gaps?.map(g => ({
      fromElapsedSeconds: round(g.fromElapsedSeconds, 1),
      toElapsedSeconds: round(g.toElapsedSeconds, 1),
      reason: g.reason,
    })),
    ...sensorFor(run),
    elevation: elevationFor(run),
    load: analysis?.effort.sessionLoad,
    analysis: analysis
      ? {
          model_version: analysis.model_version,
          state: analysis.state,
          classification: analysis.classification,
          nextAction: analysis.nextAction,
          pacing: analysis.pacing,
          effort: {
            speedIndex: round(analysis.effort.speedIndex, 1),
            unit: analysis.effort.unit,
            uncertainty: analysis.effort.uncertainty,
          },
          recommendation: analysis.recommendation
            ? {
                id: analysis.recommendation.id,
                kind: analysis.recommendation.kind,
                title: analysis.recommendation.title,
                action: analysis.recommendation.action,
                reason: analysis.recommendation.reason,
              }
            : undefined,
          question: analysis.question?.text,
        }
      : undefined,
    dataQuality: dataQualityFor(run, analysis),
    context: {
      goal: context?.goal?.trim() || undefined,
      goalTargetDate: context?.goalTargetDate,
      focus: context?.focus ? focusLabel(context.focus) : undefined,
      adherence: context?.adherence,
      history: historyStats(run, context),
    },
    events: run.events
      ?.filter(e => e.type && e.type !== 'feedback')
      .map(e => ({
        type: e.type,
        at: iso(e.at),
        elapsedSeconds:
          typeof e.at === 'number' ? round((e.at - run.startTime) / 1000, 0) : undefined,
        message:
          e.message ||
          (typeof e.data?.message === 'string' ? e.data.message : undefined),
      })),
  };
}

/** Kompakter JSON-Anhang des Markdown-Berichts: Zusammenfassung ohne Zeitreihe und Route. */
function machineReadable(input: RunReportInput) {
  const { run, analysis, context } = input;
  return {
    reportVersion: RUN_REPORT_VERSION,
    run: {
      id: run.id,
      title: runTitle(run),
      sport: normalizeSport(run.sport),
      purpose: run.purpose,
      validity: runValidity(run),
      startTime: iso(run.startTime),
      endTime: iso(run.endTime),
      durationSeconds: round(run.durationSeconds, 1),
      distanceMeters: round(run.distanceMeters, 1),
      avgHeartRate: run.avgHeartRate,
      heartRateCoverage: run.heartRateCoverage,
      avgCadence: run.avgCadence,
      cadenceCoverage: run.cadenceCoverage,
      calories: run.calories,
      steps: run.steps,
      context: run.context,
      target: run.target && run.target.kind !== 'none' ? run.target : undefined,
      rpe: run.rpe,
      note: run.note,
      source: run.source,
      sourceActivityType: run.sourceActivityType,
      sourceVersion: run.sourceVersion,
      samples: run.samples,
    },
    ...timeAndPace(run),
    phaseMetrics: run.phaseMetrics,
    elevation: elevationFor(run),
    segments: splitsFor(run),
    dataQuality: dataQualityFor(run, analysis),
    analysis: analysis
      ? {
          model_version: analysis.model_version,
          state: analysis.state,
          classification: analysis.classification,
          nextAction: analysis.nextAction,
          effort: analysis.effort,
          pacing: analysis.pacing,
          recommendation: analysis.recommendation
            ? {
                id: analysis.recommendation.id,
                kind: analysis.recommendation.kind,
                title: analysis.recommendation.title,
                action: analysis.recommendation.action,
                reason: analysis.recommendation.reason,
              }
            : undefined,
        }
      : undefined,
    context: context
      ? {
          goal: context.goal?.trim() || undefined,
          goalTargetDate: context.goalTargetDate,
          focus: context.focus ? focusLabel(context.focus) : undefined,
          adherence: context.adherence,
          history: historyStats(run, context),
        }
      : undefined,
  };
}

export function buildRunReport(input: RunReportInput): string {
  const { run, analysis, timeline, context } = input;
  const now = input.now ?? Date.now();
  const words = sportWords(normalizeSport(run.sport));
  const parts: string[] = [];
  parts.push(
    `# ${runTitle(run)} — ${words.noun} vom ${dateTime.format(
      new Date(run.startTime),
    )}`,
  );
  parts.push(
    `Exportiert aus Runback am ${dateTime.format(
      new Date(now),
    )} · Berichtsformat ${RUN_REPORT_VERSION}. Alle Zeiten in der Zeitzone des Geräts; Zahlen im deutschen Format (Komma als Dezimaltrenner). Fehlende Werte sind als „–“ markiert und wurden nicht geschätzt.`,
  );

  parts.push(
    `## Überblick\n\n${table(['Kennzahl', 'Wert'], overviewRows(run))}`,
  );

  const impression = impressionLines(run, context);
  if (impression.length)
    parts.push(`## ${words.feelingLabel}\n\n${impression.join('\n')}`);

  const phases = phaseTable(run);
  if (phases) {
    const metrics = phaseMetricLines(run);
    parts.push(
      `## Bewegungsphasen\n\nErkannt aus Schrittfrequenz, Tempo und Beschleunigung über 15-s-Fenster; eine Phase dauert mindestens 20 s. „Pause“ hat der Nutzer ausgelöst, „Unbekannt“ heißt: keine Daten, die Bewegung oder Stillstand belegen.\n\n${phases}${
        metrics.length ? `\n\n${metrics.join('\n')}` : ''
      }`,
    );
  }

  const segments = segmentTable(run);
  if (segments) {
    parts.push(
      `## Kilometer-Abschnitte\n\nAbschnitte enden bei jedem vollen Kilometer oder an einer Pause; der letzte ist meist kürzer. GPS-Lücken bleiben im Abschnitt und stehen als eigene Spalte.\n\n${segments}`,
    );
  }

  if (timeline) {
    const rows = timelineTable(run, timeline);
    if (rows) {
      parts.push(
        `## Zeitverlauf\n\nFenster von je ${formatDuration(
          timeline.stepSeconds,
        )} min (m:ss) seit dem Start, Pausen eingeschlossen. Tempo bezieht sich nur auf Sekunden mit gültigen GPS-Schritten im Fenster; Fenster ohne Messwerte fehlen. Die feine 5-s-Zeitreihe liegt in der CSV-Datei.\n\n${rows}`,
      );
    }
  }

  const events = eventLines(run);
  if (events.length) parts.push(`## Ereignisse\n\n${events.join('\n')}`);

  if (analysis)
    parts.push(
      `## Auswertung durch Runback\n\n${analysisLines(run, analysis).join('\n')}`,
    );

  const ctx = contextLines(run, context);
  if (ctx.length) parts.push(`## Trainingskontext\n\n${ctx.join('\n')}`);

  const route = routeLines(run);
  if (route.length) parts.push(`## Strecke\n\n${route.join('\n')}`);

  parts.push(
    `## Daten als JSON\n\nZusammenfassung maschinenlesbar. Zeiten als ISO 8601 (UTC), Strecken in Metern, Dauern in Sekunden. Phasen, Lücken und Ereignisse stehen vollständig in der Datei „…_analysis.json“, die Zeitreihe in „…_timeseries.csv“.\n\n\`\`\`json\n${JSON.stringify(
      machineReadable(input),
      null,
      1,
    )}\n\`\`\``,
  );
  return parts.join('\n\n') + '\n';
}

/** Dateiname ohne Sonderzeichen: Datum, Uhrzeit und Titel. */
export function runReportFileName(run: ReportRun): string {
  return `${runExportBaseName(run)}.md`;
}
export function runExportBaseName(run: ReportRun): string {
  const d = new Date(run.startTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const slug = runTitle(run)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `runback_${stamp}${slug ? `_${slug}` : ''}`;
}
/** Die drei Exportdateien eines Laufs. */
export function runExportFileNames(run: ReportRun) {
  const base = runExportBaseName(run);
  return {
    markdown: `${base}.md`,
    analysis: `${base}_analysis.json`,
    timeseries: `${base}_timeseries.csv`,
  };
}
