/**
 * Laufbericht zum Teilen.
 *
 * Eine einzelne Markdown-Datei, die alles über eine Aufzeichnung sagt, was die
 * App weiß: Kennzahlen, Kilometer-Abschnitte, Zeitverlauf, Ereignisse,
 * Eindruck, die Auswertung von Runback und der Trainingskontext. Sie ist für
 * Menschen lesbar und für ein Sprachmodell (z. B. ChatGPT) auswertbar, deshalb
 * stehen Zahlen in Tabellen mit Einheiten und am Ende noch einmal als JSON.
 *
 * Was fehlt, fehlt: keine Nullen, keine erfundenen Werte. Rohsamples bleiben
 * nativ; der Zeitverlauf kommt als begrenztes Aggregat aus Kotlin.
 */
import type {
  Adherence,
  RunAnalysis,
  RunSummary,
  SegmentAggregate,
} from './types';
import { runTitle, purposeLabel } from './runTitle';
import { normalizeSport, sportWords, usesPace } from './sport';
import { runTargetLabel, type RunTarget } from './runTarget';
import { focusLabel, type TrainingFocus } from './focus';

export const RUN_REPORT_VERSION = 'runback-report-1';

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
  movingSeconds: number;
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
    const wall = (run.endTime - run.startTime) / 1000;
    if (wall - run.durationSeconds > 30) {
      rows.push(['Pausen gesamt', formatDuration(wall - run.durationSeconds)]);
    }
  }
  rows.push(['Bewegungszeit', formatDuration(run.durationSeconds)]);
  rows.push(['Distanz', `${fmt(run.distanceMeters / 1000, 2)} km`]);
  rows.push(
    pace
      ? ['Ø Tempo', formatPace(run.distanceMeters, run.durationSeconds)]
      : [
          'Ø Geschwindigkeit',
          formatSpeed(run.distanceMeters, run.durationSeconds),
        ],
  );
  if (run.avgHeartRate) {
    rows.push([
      'Ø Puls',
      `${int(run.avgHeartRate)} bpm${
        run.heartRateCoverage !== undefined
          ? ` (Abdeckung ${percent(run.heartRateCoverage)} der Bewegungszeit)`
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
  if (run.elevationGainMeters !== undefined) {
    rows.push(['Anstieg gesamt', `${int(run.elevationGainMeters)} m`]);
  } else if (run.segments?.some(s => s.ascentMeters !== undefined)) {
    const ascent = run.segments.reduce((a, s) => a + (s.ascentMeters || 0), 0);
    const descent = run.segments.reduce(
      (a, s) => a + (s.descentMeters || 0),
      0,
    );
    rows.push(['Anstieg / Abstieg', `${int(ascent)} m / ${int(descent)} m`]);
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

function segmentTable(run: ReportRun): string | undefined {
  const segments = run.segments || [];
  if (!segments.length) return undefined;
  const pace = usesPace(normalizeSport(run.sport));
  const hasHeart = segments.some(s => s.avgHeartRate !== undefined);
  const hasCadence = segments.some(s => s.avgCadence !== undefined);
  const hasGrade = segments.some(s => s.gradePercent !== undefined);
  const hasClimb = segments.some(s => s.ascentMeters !== undefined);
  const hasPhase = segments.some(s => s.phase);
  const header = ['#', 'Bis km', 'Länge', 'Zeit', pace ? 'Tempo' : 'Geschw.'];
  if (hasHeart) header.push('Ø Puls');
  if (hasCadence) header.push('Ø Kadenz');
  if (hasGrade) header.push('Steigung');
  if (hasClimb) header.push('Auf / Ab');
  if (hasPhase) header.push('Phase');
  let cumulative = 0;
  const rows = segments.map((s, i) => {
    cumulative += s.distanceMeters;
    const row = [
      String(i + 1),
      fmt(cumulative / 1000, 2),
      `${fmt(s.distanceMeters / 1000, 2)} km`,
      formatDuration(s.durationSeconds),
      pace
        ? formatPace(s.distanceMeters, s.durationSeconds)
        : formatSpeed(s.distanceMeters, s.durationSeconds),
    ];
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
      r.stepDistanceMeters >= 50 && r.movingSeconds > 0
        ? pace
          ? formatPace(r.stepDistanceMeters, r.movingSeconds)
          : formatSpeed(r.stepDistanceMeters, r.movingSeconds)
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

function analysisLines(analysis: RunAnalysis): string[] {
  const lines: string[] = [];
  lines.push(`- Einordnung: ${analysis.classification}`);
  lines.push(`- Nächster Schritt: ${analysis.nextAction}`);
  lines.push(
    `- Datenqualität: Tempo ${
      analysis.quality.paceUsable ? 'nutzbar' : 'nicht nutzbar'
    }, Puls ${analysis.quality.heartRateUsable ? 'nutzbar' : 'nicht nutzbar'}`,
  );
  for (const issue of analysis.quality.issues) {
    lines.push(`  - ${issue.suspected ? 'Vermutet: ' : ''}${issue.message}`);
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
      `- Tempoverlauf: erster Abschnitt ${formatDuration(
        p.firstPaceSecondsPerKm,
      )} /km, letzter ${formatDuration(
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
  const history = (context.history || []).filter(
    r =>
      r.id !== run.id &&
      r.status !== 'recording' &&
      r.startTime < run.startTime,
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
    `- ${points.length} gespeicherte Punkte (ausgedünnt), vollständig im JSON-Anhang als [Breite, Länge, Zeit]`,
  ];
}

/** Maschinenlesbarer Anhang: alles, was oben in Prosa steht, als Zahlen. */
function machineReadable(input: RunReportInput) {
  const { run, analysis, timeline, context } = input;
  const round = (value: number, digits: number) =>
    Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined;
  return {
    reportVersion: RUN_REPORT_VERSION,
    run: {
      id: run.id,
      title: runTitle(run),
      sport: normalizeSport(run.sport),
      purpose: run.purpose,
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
      elevationGainMeters: run.elevationGainMeters,
      context: run.context,
      target: run.target && run.target.kind !== 'none' ? run.target : undefined,
      rpe: run.rpe,
      note: run.note,
      source: run.source,
      sourceActivityType: run.sourceActivityType,
      sourceVersion: run.sourceVersion,
      samples: run.samples,
    },
    segments: run.segments?.map(s => ({
      distanceMeters: round(s.distanceMeters, 1),
      durationSeconds: round(s.durationSeconds, 1),
      avgHeartRate: s.avgHeartRate,
      avgCadence: s.avgCadence,
      gradePercent:
        s.gradePercent !== undefined ? round(s.gradePercent, 2) : undefined,
      ascentMeters:
        s.ascentMeters !== undefined ? round(s.ascentMeters, 1) : undefined,
      descentMeters:
        s.descentMeters !== undefined ? round(s.descentMeters, 1) : undefined,
      phase: s.phase,
    })),
    timeline: timeline
      ? {
          stepSeconds: timeline.stepSeconds,
          rows: timeline.rows.map(r => ({
            elapsedSeconds: r.elapsedSeconds,
            distanceMeters: round(r.distanceMeters, 1),
            stepDistanceMeters: round(r.stepDistanceMeters, 1),
            movingSeconds: round(r.movingSeconds, 1),
            avgHeartRate:
              r.avgHeartRate !== undefined
                ? round(r.avgHeartRate, 1)
                : undefined,
            avgCadence:
              r.avgCadence !== undefined ? round(r.avgCadence, 1) : undefined,
            altitudeM:
              r.altitudeM !== undefined ? round(r.altitudeM, 1) : undefined,
          })),
        }
      : undefined,
    events: run.events
      ?.filter(e => e.type && e.type !== 'feedback')
      .map(e => ({
        type: e.type,
        at: iso(e.at),
        message:
          e.message ||
          (typeof e.data?.message === 'string' ? e.data.message : undefined),
      })),
    analysis: analysis
      ? {
          model_version: analysis.model_version,
          state: analysis.state,
          classification: analysis.classification,
          nextAction: analysis.nextAction,
          quality: analysis.quality,
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
        }
      : undefined,
    route: run.route
      ?.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map(p => [
        round(p.latitude, 5),
        round(p.longitude, 5),
        ...(p.time ? [iso(p.time)] : []),
      ]),
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

  const segments = segmentTable(run);
  if (segments) {
    parts.push(
      `## Abschnitte\n\nAbschnitte enden bei jedem vollen Kilometer oder an einer Pause bzw. GPS-Lücke; der letzte ist meist kürzer.\n\n${segments}`,
    );
  }

  if (timeline) {
    const rows = timelineTable(run, timeline);
    if (rows) {
      parts.push(
        `## Zeitverlauf\n\nFenster von je ${formatDuration(
          timeline.stepSeconds,
        )} min (m:ss) seit dem Start, Pausen eingeschlossen. Tempo bezieht sich nur auf die Bewegung im jeweiligen Fenster; Fenster ohne Messwerte fehlen.\n\n${rows}`,
      );
    }
  }

  const events = eventLines(run);
  if (events.length) parts.push(`## Ereignisse\n\n${events.join('\n')}`);

  if (analysis)
    parts.push(
      `## Auswertung durch Runback\n\n${analysisLines(analysis).join('\n')}`,
    );

  const ctx = contextLines(run, context);
  if (ctx.length) parts.push(`## Trainingskontext\n\n${ctx.join('\n')}`);

  const route = routeLines(run);
  if (route.length) parts.push(`## Strecke\n\n${route.join('\n')}`);

  parts.push(
    `## Daten als JSON\n\nDieselben Daten maschinenlesbar. Zeiten als ISO 8601 (UTC), Strecken in Metern, Dauern in Sekunden.\n\n\`\`\`json\n${JSON.stringify(
      machineReadable(input),
      null,
      1,
    )}\n\`\`\``,
  );
  return parts.join('\n\n') + '\n';
}

/** Dateiname ohne Sonderzeichen: Datum, Uhrzeit und Titel. */
export function runReportFileName(run: ReportRun): string {
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
  return `runback_${stamp}${slug ? `_${slug}` : ''}.md`;
}
