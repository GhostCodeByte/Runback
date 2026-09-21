import type {
  MovementPhase,
  PacingAnalysis,
  RunSummary,
  SegmentAggregate,
} from './types';
import type { RunSeries, SeriesRow } from './runSeries';
import { formatPace } from './runSeries';
import { segmentIsFlat } from './analysis';

/**
 * Tiefere Einblicke in einen einzelnen Lauf für die Detailseite. Alles hier
 * ist Ableitung aus Aggregaten (Zeitbudget, Phasen, Abschnitte) und der
 * Darstellungsreihe — keine Rohsamples, keine Empfehlung, keine Bewertung
 * der Fitness. Wo ein Modell rechnet (Steigung, Wind, Wärme, Zonen), steht
 * es in der Ausgabe als Schätzung, und ohne Grundlage gibt es `undefined`
 * statt einer erfundenen Zahl (Grundregel 5 und 7).
 */
export const INSIGHTS_VERSION = 'runback-insights-1';

const DAY = 24 * 60 * 60 * 1000;
/** Vergleichsfenster für „deine letzten Läufe“ und die Puls-Tempo-Kurve. */
export const RECENT_WINDOW_DAYS = 120;
export const RECENT_MAX_RUNS = 8;
export const RECENT_MIN_RUNS = 3;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values: number[]): number | undefined =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
const percent = (value: number, reference: number): number =>
  (value / reference - 1) * 100;
const isRunning = (run: RunSummary) => (run.sport ?? 'running') === 'running';

/** Bewegungszeit, sonst Aufzeichnungszeit; undefined ohne belastbare Zeit. */
export function movingSeconds(run: RunSummary): number | undefined {
  const seconds = run.time?.movingSeconds ?? run.durationSeconds;
  return finite(seconds) && seconds > 0 ? seconds : undefined;
}
function paceSecondsPerKm(run: RunSummary): number | undefined {
  const seconds = movingSeconds(run);
  return seconds !== undefined && run.distanceMeters >= 500
    ? seconds / (run.distanceMeters / 1000)
    : undefined;
}

// ---------------------------------------------------------------------------
// Bewegung: Zeitbudget, längster Abschnitt, Wechsel, Puls je Zustand
// ---------------------------------------------------------------------------

export interface TimeBudgetShares {
  runningSeconds: number;
  walkingSeconds: number;
  stoppedSeconds: number;
  pausedSeconds: number;
  /** Basis des Balkens: Laufen + Gehen + Stehen (ohne Pausen, ohne Unbekannt). */
  totalSeconds: number;
}
/** Drei Anteile für den Balken. Ohne Zeitbudget (Altdaten, Importe) undefined. */
export function timeBudgetShares(
  run: RunSummary,
): TimeBudgetShares | undefined {
  const t = run.time;
  if (!t) return undefined;
  const totalSeconds = t.runningSeconds + t.walkingSeconds + t.stoppedSeconds;
  if (!finite(totalSeconds) || totalSeconds <= 0) return undefined;
  return {
    runningSeconds: t.runningSeconds,
    walkingSeconds: t.walkingSeconds,
    stoppedSeconds: t.stoppedSeconds,
    pausedSeconds: t.pausedSeconds,
    totalSeconds,
  };
}

export interface MovementInsight {
  longestRunMeters?: number;
  longestRunSeconds?: number;
  runWalkTransitions: number;
  runningHeartRate?: number;
  walkingHeartRate?: number;
}
export function movementInsight(run: RunSummary): MovementInsight | undefined {
  const m = run.phaseMetrics;
  if (!m) return undefined;
  return {
    longestRunMeters: m.longestRunMeters,
    longestRunSeconds: m.longestRunSeconds,
    runWalkTransitions: m.runWalkTransitions,
    runningHeartRate: m.running.avgHeartRate,
    walkingHeartRate:
      m.walking.seconds >= 30 ? m.walking.avgHeartRate : undefined,
  };
}

// ---------------------------------------------------------------------------
// Puls: Erholung in Gehpausen und nach dem Ende
// ---------------------------------------------------------------------------

function heartRateAt(
  rows: SeriesRow[],
  elapsedSeconds: number,
  toleranceSeconds: number,
): number | undefined {
  const values = rows
    .filter(
      row =>
        row.heartRate !== undefined &&
        Math.abs(row.elapsedSeconds - elapsedSeconds) <= toleranceSeconds,
    )
    .map(row => row.heartRate!);
  return mean(values);
}

export interface WalkRecovery {
  /** Gehpausen ab 60 s nach einem Laufabschnitt, mit Puls an beiden Enden. */
  pauses: number;
  /** Median des Pulsabfalls in der ersten Minute je Pause (bpm). */
  dropFirstMinute: number;
  /** Tiefster Pulswert innerhalb der gewerteten Pausen. */
  lowestHeartRate?: number;
}
/**
 * Wie schnell sich der Puls beim Gehen beruhigt. Gewertet werden nur
 * Gehphasen von mindestens 60 s direkt nach einer Laufphase; der Abfall ist
 * Puls am Pausenbeginn minus Puls 60 s später.
 */
export function walkRecovery(
  run: RunSummary,
  series: RunSeries | null,
): WalkRecovery | undefined {
  if (!series || !run.phases?.length) return undefined;
  const rows = series.rows;
  const tolerance = Math.max(series.stepSeconds, 5);
  const drops: number[] = [];
  let lowest: number | undefined;
  run.phases.forEach((phase, index) => {
    const previous = run.phases![index - 1];
    if (
      phase.state !== 'WALK' ||
      previous?.state !== 'RUN' ||
      phase.endElapsedSeconds - phase.startElapsedSeconds < 60
    )
      return;
    const start = heartRateAt(rows, phase.startElapsedSeconds, tolerance);
    const later = heartRateAt(rows, phase.startElapsedSeconds + 60, tolerance);
    if (start === undefined || later === undefined) return;
    drops.push(start - later);
    rows
      .filter(
        row =>
          row.heartRate !== undefined &&
          row.elapsedSeconds >= phase.startElapsedSeconds &&
          row.elapsedSeconds <= phase.endElapsedSeconds,
      )
      .forEach(row => {
        lowest =
          lowest === undefined
            ? row.heartRate
            : Math.min(lowest, row.heartRate!);
      });
  });
  const drop = median(drops);
  if (drop === undefined) return undefined;
  return {
    pauses: drops.length,
    dropFirstMinute: drop,
    lowestHeartRate: lowest,
  };
}

export interface EndRecovery {
  /** Pulsabfall in der ersten Minute nach dem letzten Laufabschnitt (bpm). */
  dropFirstMinute: number;
  heartRateAtEnd: number;
}
/**
 * Erholung nach dem Ende: Puls am Ende der letzten Laufphase minus Puls 60 s
 * später. Braucht mindestens 60 s Aufzeichnung danach mit Pulswerten.
 */
export function endRecovery(
  run: RunSummary,
  series: RunSeries | null,
): EndRecovery | undefined {
  if (!series || !run.phases?.length) return undefined;
  const lastRun = [...run.phases].reverse().find(p => p.state === 'RUN');
  if (!lastRun) return undefined;
  const after = run.phases.filter(
    p =>
      p.startElapsedSeconds >= lastRun.endElapsedSeconds && p.state !== 'RUN',
  );
  const trailing = after.reduce(
    (sum, p) => sum + (p.endElapsedSeconds - p.startElapsedSeconds),
    0,
  );
  if (trailing < 60) return undefined;
  const tolerance = Math.max(series.stepSeconds, 5);
  const atEnd = heartRateAt(series.rows, lastRun.endElapsedSeconds, tolerance);
  const later = heartRateAt(
    series.rows,
    lastRun.endElapsedSeconds + 60,
    tolerance,
  );
  if (atEnd === undefined || later === undefined) return undefined;
  return { dropFirstMinute: atEnd - later, heartRateAtEnd: atEnd };
}

// ---------------------------------------------------------------------------
// Pacing: Split, Gleichmäßigkeit, schnellster/langsamster km, Drift, GAP
// ---------------------------------------------------------------------------

export type SplitKind = 'negative' | 'positive' | 'even';
export type Evenness = 'sehr gleichmäßig' | 'gleichmäßig' | 'wechselhaft';
export interface PacingVerdict {
  split: SplitKind;
  fadePercent: number;
  coefficientOfVariation: number;
  evenness: Evenness;
  /** Index im Abschnittsarray des Laufs, nicht in der km-Tabelle. */
  fastestSegmentIndex?: number;
  slowestSegmentIndex?: number;
  fastestSecondsPerKm?: number;
  slowestSecondsPerKm?: number;
  sentence: string;
}
/** Nur volle, bewegte Abschnitte ohne größere GPS-Lücke zählen als Kilometer. */
function ratedSegments(run: RunSummary) {
  return (run.segments ?? [])
    .map((s, index) => ({ s, index }))
    .filter(
      ({ s }) =>
        s.distanceMeters >= 900 &&
        (s.gapSeconds ?? 0) < 5 &&
        (s.movingSeconds ?? s.durationSeconds) > 0 &&
        (!s.phase || s.phase === 'work'),
    );
}
const segmentPace = (s: SegmentAggregate) =>
  ((s.movingSeconds ?? s.durationSeconds) / s.distanceMeters) * 1000;

export function pacingVerdict(
  pacing: PacingAnalysis | undefined,
  run: RunSummary,
): PacingVerdict | undefined {
  if (!pacing) return undefined;
  const split: SplitKind =
    pacing.fadePercent <= -2
      ? 'negative'
      : pacing.fadePercent >= 2
      ? 'positive'
      : 'even';
  const cv = pacing.coefficientOfVariation;
  const evenness: Evenness =
    cv < 0.04 ? 'sehr gleichmäßig' : cv < 0.08 ? 'gleichmäßig' : 'wechselhaft';
  const rated = ratedSegments(run);
  let fastest: { index: number; pace: number } | undefined;
  let slowest: { index: number; pace: number } | undefined;
  rated.forEach(({ s, index }) => {
    const pace = segmentPace(s);
    if (!fastest || pace < fastest.pace) fastest = { index, pace };
    if (!slowest || pace > slowest.pace) slowest = { index, pace };
  });
  const change = Math.abs(Math.round(pacing.fadePercent));
  const sentence =
    split === 'negative'
      ? `Zweite Hälfte ${change} % schneller als die erste — ein Negativ-Split.`
      : split === 'positive'
      ? `Zweite Hälfte ${change} % langsamer als die erste.`
      : 'Beide Hälften gleich schnell.';
  return {
    split,
    fadePercent: pacing.fadePercent,
    coefficientOfVariation: cv,
    evenness,
    fastestSegmentIndex: fastest?.index,
    slowestSegmentIndex: slowest?.index,
    fastestSecondsPerKm: fastest?.pace,
    slowestSecondsPerKm: slowest?.pace,
    sentence,
  };
}

export interface HeartRateDrift {
  /** Puls je Geschwindigkeit, zweite Hälfte gegenüber der ersten, in %. */
  percent: number;
  verdict: 'aerob solide' | 'leichte Drift' | 'deutliche Drift';
  segmentCount: number;
}
/**
 * Puls-Drift (aerobe Entkopplung): Verhältnis Puls / Geschwindigkeit in der
 * zweiten Hälfte gegenüber der ersten. Der erste Kilometer bleibt als
 * Einlaufen draußen, wenn danach noch vier Kilometer bleiben.
 */
export function heartRateDrift(run: RunSummary): HeartRateDrift | undefined {
  let rated = ratedSegments(run).filter(({ s }) => finite(s.avgHeartRate));
  if (rated.length >= 5) rated = rated.slice(1);
  if (rated.length < 4) return undefined;
  const half = Math.floor(rated.length / 2);
  const ratio = (items: typeof rated) => {
    const meters = items.reduce((sum, { s }) => sum + s.distanceMeters, 0);
    const seconds = items.reduce(
      (sum, { s }) => sum + (s.movingSeconds ?? s.durationSeconds),
      0,
    );
    const beats = items.reduce(
      (sum, { s }) =>
        sum + s.avgHeartRate! * ((s.movingSeconds ?? s.durationSeconds) / 60),
      0,
    );
    const hr = beats / (seconds / 60);
    return hr / (meters / seconds);
  };
  const first = ratio(rated.slice(0, half));
  const second = ratio(rated.slice(-half));
  const drift = percent(second, first);
  return {
    percent: drift,
    verdict:
      drift < 5
        ? 'aerob solide'
        : drift < 10
        ? 'leichte Drift'
        : 'deutliche Drift',
    segmentCount: rated.length,
  };
}

/** Meter je Herzschlag in Bewegung — vergleichbar über Läufe hinweg. */
export function metersPerBeat(run: RunSummary): number | undefined {
  const seconds = movingSeconds(run);
  if (
    seconds === undefined ||
    !finite(run.avgHeartRate) ||
    run.avgHeartRate <= 0 ||
    run.distanceMeters < 500
  )
    return undefined;
  return run.distanceMeters / (run.avgHeartRate * (seconds / 60));
}

/**
 * Energiekosten des Laufens je Steigung nach Minetti et al. 2002 (J/kg/m),
 * `grade` als Anteil (0,05 = 5 %). Gültig etwa bis ±30 %.
 */
export function minettiCost(grade: number): number {
  const i = Math.max(-0.3, Math.min(0.3, grade));
  return (
    155.4 * i ** 5 -
    30.4 * i ** 4 -
    43.3 * i ** 3 +
    46.3 * i ** 2 +
    19.5 * i +
    3.6
  );
}
export interface GradeAdjustedPace {
  realSecondsPerKm: number;
  adjustedSecondsPerKm: number;
  /** Flach-Äquivalent je Abschnittsindex; nur Abschnitte mit Steigung. */
  perSegment: Record<number, number>;
  coveredMeters: number;
}
/**
 * Höhenkorrigiertes Tempo: welches Tempo derselbe Aufwand in der Ebene
 * ergeben hätte. Schätzung mit Nettosteigung je Abschnitt; Abschnitte ohne
 * Steigungswert bleiben unkorrigiert und zählen nicht als abgedeckt.
 */
export function gradeAdjustedPace(
  run: RunSummary,
): GradeAdjustedPace | undefined {
  const rated = ratedSegments(run).filter(({ s }) => finite(s.gradePercent));
  if (!rated.length) return undefined;
  const perSegment: Record<number, number> = {};
  let realSeconds = 0;
  let adjustedSeconds = 0;
  let meters = 0;
  rated.forEach(({ s, index }) => {
    const seconds = s.movingSeconds ?? s.durationSeconds;
    const factor = minettiCost(0) / minettiCost(s.gradePercent! / 100);
    perSegment[index] = segmentPace(s) * factor;
    realSeconds += seconds;
    adjustedSeconds += seconds * factor;
    meters += s.distanceMeters;
  });
  const total = (run.segments ?? []).reduce(
    (sum, s) => sum + s.distanceMeters,
    0,
  );
  // Ohne Steigung auf mindestens der Hälfte der Strecke ist die Zahl kein
  // Tempo des Laufs, sondern nur eines Ausschnitts.
  if (total > 0 && meters / total < 0.5) return undefined;
  return {
    realSecondsPerKm: (realSeconds / meters) * 1000,
    adjustedSecondsPerKm: (adjustedSeconds / meters) * 1000,
    perSegment,
    coveredMeters: meters,
  };
}

// ---------------------------------------------------------------------------
// Pulszonen mit Maxpuls aus Einstellung oder Schätzung
// ---------------------------------------------------------------------------

export interface MaxHeartRate {
  value: number;
  source: 'setting' | 'estimate';
  /** Läufe, aus denen geschätzt wurde (nur bei `estimate`). */
  runs?: number;
}
/**
 * Maxpuls: eingestellt gewinnt. Sonst der höchste Wert aus den höchsten
 * Pulswerten der letzten Läufe, ohne den größten Einzelwert (Ausreißer eines
 * Gurts). Unter drei Läufen mit Puls gibt es keine Schätzung.
 */
export function maxHeartRate(
  setting: number | undefined,
  history: RunSummary[],
): MaxHeartRate | undefined {
  if (finite(setting) && setting >= 100 && setting <= 230)
    return { value: Math.round(setting), source: 'setting' };
  const peaks = history
    .filter(isRunning)
    .map(run => run.avgHeartRateMax)
    .filter((value): value is number => finite(value) && value > 100)
    .sort((a, b) => b - a);
  if (peaks.length < RECENT_MIN_RUNS) return undefined;
  return {
    value: Math.round(peaks[1]),
    source: 'estimate',
    runs: peaks.length,
  };
}

export interface HeartRateZone {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string;
  fromPercent: number;
  seconds: number;
  share: number;
}
export interface HeartRateZones {
  max: MaxHeartRate;
  zones: HeartRateZone[];
  coveredSeconds: number;
}
const ZONES: { zone: 1 | 2 | 3 | 4 | 5; label: string; from: number }[] = [
  { zone: 1, label: 'sehr locker', from: 0 },
  { zone: 2, label: 'locker', from: 60 },
  { zone: 3, label: 'moderat', from: 70 },
  { zone: 4, label: 'hart', from: 80 },
  { zone: 5, label: 'maximal', from: 90 },
];
/** Zeit in fünf Zonen als Anteil vom Maxpuls, aus der Darstellungsreihe. */
export function heartRateZones(
  series: RunSeries | null,
  max: MaxHeartRate | undefined,
): HeartRateZones | undefined {
  if (!series || !max) return undefined;
  const seconds = ZONES.map(() => 0);
  let covered = 0;
  series.rows.forEach(row => {
    if (row.heartRate === undefined) return;
    const share = (row.heartRate / max.value) * 100;
    let index = 0;
    ZONES.forEach((zone, i) => {
      if (share >= zone.from) index = i;
    });
    seconds[index] += series.stepSeconds;
    covered += series.stepSeconds;
  });
  if (covered < 120) return undefined;
  return {
    max,
    coveredSeconds: covered,
    zones: ZONES.map((zone, i) => ({
      zone: zone.zone,
      label: zone.label,
      fromPercent: zone.from,
      seconds: seconds[i],
      share: seconds[i] / covered,
    })),
  };
}

// ---------------------------------------------------------------------------
// Ermüdungsmuster: Tempo, Puls, Kadenz, Schrittlänge – erstes vs. letztes Drittel
// ---------------------------------------------------------------------------

export interface FatiguePattern {
  paceChangePercent?: number;
  heartRateChangePercent?: number;
  cadenceChangePercent?: number;
  strideChangePercent?: number;
  verdict: 'muskulär' | 'kreislauf' | 'bewusst' | 'stabil' | 'unklar';
  sentence: string;
}
/**
 * Erstes gegen letztes Drittel der bewegten Strecke. Kadenz und Schrittlänge
 * sinken bei müden Beinen, während der Puls bleibt; steigt der Puls bei
 * gleichem Tempo, war es eher Kreislauf oder Wärme.
 */
export function fatiguePattern(
  run: RunSummary,
  series: RunSeries | null,
): FatiguePattern | undefined {
  if (!series || run.distanceMeters < 3000) return undefined;
  const moving = series.rows.filter(
    row => row.moving && row.speedMps !== undefined && row.speedMps > 0.5,
  );
  if (moving.length < 30) return undefined;
  const third = Math.floor(moving.length / 3);
  const first = moving.slice(0, third);
  const last = moving.slice(-third);
  const stride = (row: SeriesRow) =>
    row.cadence !== undefined && row.cadence > 0 && row.speedMps !== undefined
      ? row.speedMps / (row.cadence / 60)
      : undefined;
  const change = (pick: (row: SeriesRow) => number | undefined) => {
    const a = mean(first.map(pick).filter(finite));
    const b = mean(last.map(pick).filter(finite));
    return a !== undefined && b !== undefined && a > 0
      ? percent(b, a)
      : undefined;
  };
  const speed = change(row => row.speedMps);
  const pace = speed === undefined ? undefined : -speed;
  const hr = change(row => row.heartRate);
  const cadence = change(row => row.cadence);
  const strideChange = change(stride);
  let verdict: FatiguePattern['verdict'] = 'unklar';
  let sentence = 'Zu wenig Werte für ein Ermüdungsmuster.';
  const legsTired =
    (cadence !== undefined && cadence <= -3) ||
    (strideChange !== undefined && strideChange <= -4);
  if (pace !== undefined && hr !== undefined) {
    if (legsTired && hr <= 3) {
      verdict = 'muskulär';
      sentence =
        'Zum Ende sinken Kadenz oder Schrittlänge, der Puls bleibt — eher die Beine als der Kreislauf.';
    } else if (hr >= 5 && Math.abs(pace) <= 3) {
      verdict = 'kreislauf';
      sentence =
        'Gleiches Tempo, aber der Puls steigt zum Ende — eher Kreislauf oder Wärme als die Beine.';
    } else if (pace >= 5 && hr <= -2) {
      verdict = 'bewusst';
      sentence =
        'Zum Ende langsamer und der Puls fällt — du hast bewusst rausgenommen.';
    } else if (Math.abs(pace) < 3 && hr < 5 && !legsTired) {
      verdict = 'stabil';
      sentence = 'Tempo, Puls und Schritt bleiben bis zum Ende stabil.';
    } else {
      sentence = 'Kein eindeutiges Ermüdungsmuster.';
    }
  } else if (pace !== undefined && legsTired) {
    verdict = 'muskulär';
    sentence = 'Zum Ende sinken Kadenz oder Schrittlänge — eher die Beine.';
  }
  return {
    paceChangePercent: pace,
    heartRateChangePercent: hr,
    cadenceChangePercent: cadence,
    strideChangePercent: strideChange,
    verdict,
    sentence,
  };
}

// ---------------------------------------------------------------------------
// Bedingungen: Wetter, Gegenwind-Abschnitte, Wind- und Wärmekosten
// ---------------------------------------------------------------------------

export interface WeatherInsight {
  temperatureC?: number;
  windMps?: number;
  windFromDeg?: number;
  /** Kilometer mit spürbarem Gegenwind (≥ 1,5 m/s im Mittel), als Labels. */
  headwindKilometers: number[];
  tailwindKilometers: number[];
}
export function weatherInsight(
  run: RunSummary,
  series: RunSeries | null,
): WeatherInsight | undefined {
  const temperatureC = run.context?.temperatureC;
  const windMps = series?.wind?.mps ?? run.context?.windMps;
  if (!finite(temperatureC) && !finite(windMps)) return undefined;
  const headwindKilometers: number[] = [];
  const tailwindKilometers: number[] = [];
  if (series) {
    const byKm = new Map<number, number[]>();
    series.rows.forEach(row => {
      if (row.headwindMps === undefined || !row.moving) return;
      const km = Math.floor(row.distanceMeters / 1000) + 1;
      byKm.set(km, [...(byKm.get(km) ?? []), row.headwindMps]);
    });
    [...byKm.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([km, values]) => {
        const avg = mean(values)!;
        if (avg >= 1.5) headwindKilometers.push(km);
        else if (avg <= -1.5) tailwindKilometers.push(km);
      });
  }
  return {
    temperatureC,
    windMps,
    windFromDeg: series?.wind?.fromDeg,
    headwindKilometers,
    tailwindKilometers,
  };
}

/** Luftwiderstand je Meter und kg bei 1,2 kg/m³, CdA 0,45 m², 70 kg. */
const AIR_COST = (0.5 * 1.2 * 0.45) / 70;
/** Geschwindigkeit in ruhender Luft bei gleicher Leistung wie `speed` gegen `headwind`. */
function stillAirSpeed(speed: number, headwind: number): number {
  const power =
    (minettiCost(0) + AIR_COST * Math.max(speed + headwind, 0) ** 2) * speed;
  let low = 0.5;
  let high = 12;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    const p = (minettiCost(0) + AIR_COST * mid ** 2) * mid;
    if (p < power) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
export interface EnvironmentCost {
  /** Sekunden je km, die der Wind gekostet (positiv) oder gebracht hat. */
  windSecondsPerKm?: number;
  /** Anteil der bewegten Strecke mit Windwert. */
  windCoverage?: number;
  /** Sekunden je km über der Wärmeschwelle von 15 °C (0,3 % je Grad). */
  heatSecondsPerKm?: number;
}
/** Grobe Schätzung, was Wind und Wärme am Tempo geändert haben. */
export function environmentCost(
  run: RunSummary,
  series: RunSeries | null,
): EnvironmentCost | undefined {
  const result: EnvironmentCost = {};
  if (series) {
    let deltaSeconds = 0;
    let coveredMeters = 0;
    let movingMeters = 0;
    series.rows.forEach(row => {
      if (!row.moving || row.speedMps === undefined || row.speedMps <= 0.5)
        return;
      const meters = row.speedMps * series.stepSeconds;
      movingMeters += meters;
      if (row.headwindMps === undefined) return;
      const still = stillAirSpeed(row.speedMps, row.headwindMps);
      deltaSeconds += meters / row.speedMps - meters / still;
      coveredMeters += meters;
    });
    if (coveredMeters >= 1000 && movingMeters > 0) {
      result.windSecondsPerKm = deltaSeconds / (coveredMeters / 1000);
      result.windCoverage = coveredMeters / movingMeters;
    }
  }
  const pace = paceSecondsPerKm(run);
  const temperature = run.context?.temperatureC;
  if (pace !== undefined && finite(temperature) && temperature > 15) {
    result.heatSecondsPerKm = pace * (1 - 1 / (1 + 0.003 * (temperature - 15)));
  }
  return result.windSecondsPerKm === undefined &&
    result.heatSecondsPerKm === undefined
    ? undefined
    : result;
}

// ---------------------------------------------------------------------------
// Vergleich mit dir selbst: letzte Läufe, gleiche Strecke, Puls-Tempo-Kurve
// ---------------------------------------------------------------------------

export type Rating = 'better' | 'same' | 'slightly_worse' | 'worse';
export type ComparedMetric =
  | 'pace'
  | 'heartRate'
  | 'metersPerBeat'
  | 'cadence'
  | 'drift'
  | 'fade';
export interface MetricComparison {
  metric: ComparedMetric;
  value: number;
  reference: number;
  /** Abweichung in Prozent, Vorzeichen wie gemessen (Tempo: + = langsamer). */
  deltaPercent: number;
  rating: Rating;
}
export interface RecentComparison {
  /** Anzahl der herangezogenen Läufe. */
  count: number;
  /** Ob alle Vergleichsläufe denselben Zweck hatten. */
  samePurpose: boolean;
  metrics: MetricComparison[];
}
/**
 * Richtung und Schwellen je Kennzahl. `better` heißt: über die Schwelle
 * hinaus in die gute Richtung; `slightly_worse` bis zur doppelten Schwelle
 * in die schlechte, darüber `worse`.
 */
const METRIC_RULES: Record<
  ComparedMetric,
  { higherIsBetter: boolean; thresholdPercent: number }
> = {
  pace: { higherIsBetter: false, thresholdPercent: 3 },
  heartRate: { higherIsBetter: false, thresholdPercent: 3 },
  metersPerBeat: { higherIsBetter: true, thresholdPercent: 3 },
  cadence: { higherIsBetter: true, thresholdPercent: 2 },
  drift: { higherIsBetter: false, thresholdPercent: 30 },
  fade: { higherIsBetter: false, thresholdPercent: 30 },
};
export function rateDelta(
  metric: ComparedMetric,
  deltaPercent: number,
): Rating {
  const rule = METRIC_RULES[metric];
  const good = rule.higherIsBetter ? deltaPercent : -deltaPercent;
  if (good >= rule.thresholdPercent) return 'better';
  if (good > -rule.thresholdPercent) return 'same';
  if (good > -rule.thresholdPercent * 2) return 'slightly_worse';
  return 'worse';
}

/**
 * Deine letzten Läufe: gleiche Sportart, davor, innerhalb von 120 Tagen,
 * höchstens acht. Gibt es drei mit demselben Zweck, zählen nur die; sonst
 * alle. Ein Vergleich braucht mindestens drei.
 */
export function recentRuns(
  run: RunSummary,
  history: RunSummary[],
): RunSummary[] {
  const seen = new Set<string>([run.id, run.canonicalId ?? run.id]);
  const candidates = [...history]
    .filter(
      other =>
        !seen.has(other.id) &&
        !seen.has(other.canonicalId ?? other.id) &&
        (other.sport ?? 'running') === (run.sport ?? 'running') &&
        other.startTime < run.startTime &&
        run.startTime - other.startTime <= RECENT_WINDOW_DAYS * DAY &&
        other.distanceMeters >= 1000 &&
        other.status !== 'accidental',
    )
    .sort((a, b) => b.startTime - a.startTime);
  const samePurpose = candidates.filter(other => other.purpose === run.purpose);
  const chosen =
    run.purpose !== 'unknown' &&
    run.purpose !== 'free' &&
    samePurpose.length >= RECENT_MIN_RUNS
      ? samePurpose
      : candidates;
  return chosen.slice(0, RECENT_MAX_RUNS);
}

function comparedValue(
  metric: ComparedMetric,
  run: RunSummary,
): number | undefined {
  switch (metric) {
    case 'pace':
      return paceSecondsPerKm(run);
    case 'heartRate':
      return finite(run.avgHeartRate) ? run.avgHeartRate : undefined;
    case 'metersPerBeat':
      return metersPerBeat(run);
    case 'cadence':
      return finite(run.avgCadence) ? run.avgCadence : undefined;
    case 'drift':
      return heartRateDrift(run)?.percent;
    case 'fade':
      return undefined;
  }
}

export function recentComparison(
  run: RunSummary,
  history: RunSummary[],
  pacing?: PacingAnalysis,
): RecentComparison | undefined {
  const recent = recentRuns(run, history);
  if (recent.length < RECENT_MIN_RUNS) return undefined;
  const metrics: MetricComparison[] = [];
  const metricsToCompare: ComparedMetric[] = [
    'pace',
    'heartRate',
    'metersPerBeat',
    'cadence',
    'drift',
  ];
  metricsToCompare.forEach(metric => {
    const value = comparedValue(metric, run);
    const references = recent
      .map(other => comparedValue(metric, other))
      .filter(finite);
    const reference = median(references);
    if (value === undefined || reference === undefined) return;
    if (references.length < RECENT_MIN_RUNS) return;
    // Drift ist selbst ein Prozentwert; hier zählt der Unterschied in Punkten,
    // gemessen an einer festen Spanne von 10 Punkten.
    const deltaPercent =
      metric === 'drift'
        ? ((value - reference) / 10) * 100
        : reference === 0
        ? 0
        : percent(value, reference);
    metrics.push({
      metric,
      value,
      reference,
      deltaPercent,
      rating: rateDelta(metric, deltaPercent),
    });
  });
  if (pacing) {
    const references = recent
      .map(other => {
        // Fade der Vergleichsläufe aus deren Abschnitten, ohne Analyseobjekt.
        const rated = ratedSegments(other);
        if (rated.length < 4) return undefined;
        const half = Math.floor(rated.length / 2);
        const pace = (items: typeof rated) =>
          (items.reduce(
            (sum, { s }) => sum + (s.movingSeconds ?? s.durationSeconds),
            0,
          ) /
            items.reduce((sum, { s }) => sum + s.distanceMeters, 0)) *
          1000;
        return percent(pace(rated.slice(-half)), pace(rated.slice(0, half)));
      })
      .filter(finite);
    const reference = median(references);
    if (reference !== undefined && references.length >= RECENT_MIN_RUNS) {
      const deltaPercent = ((pacing.fadePercent - reference) / 10) * 100;
      metrics.push({
        metric: 'fade',
        value: pacing.fadePercent,
        reference,
        deltaPercent,
        rating: rateDelta('fade', deltaPercent),
      });
    }
  }
  if (!metrics.length) return undefined;
  return {
    count: recent.length,
    samePurpose: recent.every(other => other.purpose === run.purpose),
    metrics,
  };
}

export interface SameRouteComparison {
  /** Wievielter Lauf auf dieser Strecke, diesen eingeschlossen. */
  ordinal: number;
  lastSeconds: number;
  currentSeconds: number;
  bestSeconds: number;
  /** Positiv = langsamer als zuletzt. */
  deltaToLastSeconds: number;
}
/** Gleiche Strecke laut `context.routeId`; Zeit ist die Bewegungszeit. */
export function sameRouteComparison(
  run: RunSummary,
  history: RunSummary[],
): SameRouteComparison | undefined {
  const routeId = run.context?.routeId;
  const current = movingSeconds(run);
  if (!routeId || current === undefined) return undefined;
  const earlier = history
    .filter(
      other =>
        other.id !== run.id &&
        other.context?.routeId === routeId &&
        other.startTime < run.startTime &&
        movingSeconds(other) !== undefined,
    )
    .sort((a, b) => b.startTime - a.startTime);
  if (!earlier.length) return undefined;
  const last = movingSeconds(earlier[0])!;
  const best = Math.min(
    current,
    ...earlier.map(other => movingSeconds(other)!),
  );
  return {
    ordinal: earlier.length + 1,
    lastSeconds: last,
    currentSeconds: current,
    bestSeconds: best,
    deltaToLastSeconds: current - last,
  };
}

export interface CurvePoint {
  speedMps: number;
  heartRate: number;
}
export interface HeartRatePaceCurve {
  /** Punkte dieses Laufs: flache, bewegte Kilometer. */
  points: CurvePoint[];
  /** Regressionsgerade aus den letzten Läufen; fehlt bei zu wenig Spannweite. */
  line?: { slope: number; intercept: number; runs: number; points: number };
  /** Mittlere Abweichung dieses Laufs von der Geraden in bpm. */
  residualBpm?: number;
  verdict?: 'effizienter' | 'wie sonst' | 'höher';
}
function curvePoints(run: RunSummary): CurvePoint[] {
  return ratedSegments(run)
    .filter(({ s }) => finite(s.avgHeartRate) && segmentIsFlat(s))
    .map(({ s }) => ({
      speedMps: s.distanceMeters / (s.movingSeconds ?? s.durationSeconds),
      heartRate: s.avgHeartRate!,
    }))
    .filter(p => p.speedMps > 1 && p.speedMps < 8);
}
/**
 * Puls über Tempo: die Kilometer dieses Laufs gegen eine Gerade aus den
 * flachen Kilometern deiner letzten Läufe. Ein Lauf unter der Geraden war
 * bei gleichem Tempo pulsärmer als üblich.
 */
export function heartRatePaceCurve(
  run: RunSummary,
  history: RunSummary[],
): HeartRatePaceCurve | undefined {
  const points = curvePoints(run);
  if (!points.length) return undefined;
  const recent = recentRuns(run, history);
  const pool = recent.flatMap(curvePoints);
  const result: HeartRatePaceCurve = { points };
  const speeds = pool.map(p => p.speedMps);
  if (
    pool.length >= 8 &&
    recent.length >= RECENT_MIN_RUNS &&
    Math.max(...speeds) - Math.min(...speeds) >= 0.3
  ) {
    const mx = mean(speeds)!;
    const my = mean(pool.map(p => p.heartRate))!;
    const sxx = pool.reduce((sum, p) => sum + (p.speedMps - mx) ** 2, 0);
    const sxy = pool.reduce(
      (sum, p) => sum + (p.speedMps - mx) * (p.heartRate - my),
      0,
    );
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    const residual = mean(
      points.map(p => p.heartRate - (intercept + slope * p.speedMps)),
    )!;
    result.line = {
      slope,
      intercept,
      runs: recent.length,
      points: pool.length,
    };
    result.residualBpm = residual;
    result.verdict =
      residual <= -3 ? 'effizienter' : residual >= 3 ? 'höher' : 'wie sonst';
  }
  return result;
}

// ---------------------------------------------------------------------------
// Formatierung für Sätze, die mehrere Flächen teilen
// ---------------------------------------------------------------------------

/** Unter einer Minute als „−12 s“, darüber als „+1:05“. */
export function formatSignedSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  const abs = Math.abs(rounded);
  return abs < 60 ? `${sign}${abs} s` : `${sign}${formatPace(abs)}`;
}
export function formatSignedPercent(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  return `${sign}${Math.abs(rounded).toFixed(digits).replace('.', ',')} %`;
}
/** Wie eine Phase im Satz heißt; hält Glossar und UI zusammen. */
export function phaseWord(state: MovementPhase['state']): string {
  return (
    {
      RUN: 'gelaufen',
      WALK: 'gegangen',
      STOPPED: 'gestanden',
      PAUSED: 'pausiert',
      UNKNOWN: 'unbekannt',
    } as const
  )[state];
}
