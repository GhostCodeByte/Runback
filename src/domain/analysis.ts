import {
  EffortEstimate,
  Experiment,
  PacingAnalysis,
  Provenance,
  QualityIssue,
  QualityReport,
  Recommendation,
  RunAnalysis,
  RunSummary,
  SegmentAggregate,
} from './types';

import { finite, median } from './inference';

/**
 * v2: Vergleichsbasis ist der Median mehrerer vergleichbarer Läufe statt
 * eines einzelnen auffälligen Laufs (Regression zur Mitte), Prüfung per
 * Vorzeichentest, Kadenz-Lock auch bei Schritten pro Fuß, Flachheit über
 * Auf- und Abstieg statt Nettohöhe, Belastung als RPE × Minuten.
 */
export const MODEL_VERSION = 'runback-rules-2.0.0';
/** Regeln der Datenqualitätsprüfung; 2: Lücken je Abschnitt werden wirksam (gapSeconds aus Distanzmodell 3.0). */
export const QUALITY_VERSION = 'runback-quality-2';
export const PACING_METHOD = 'pacing-fade-v2';
export const MAX_SEGMENTS = 500;
/** Ab diesem Median des späten Tempoabfalls wird ein ruhigerer Start vorgeschlagen (Setzung). */
export const FADE_TRIGGER_PERCENT = 8;
/** Vergleichsbasis: mindestens drei, höchstens fünf vergleichbare Läufe. */
export const MINIMUM_BASELINE_RUNS = 3;
export const MAXIMUM_BASELINE_RUNS = 5;
const BASELINE_WINDOW_DAYS = 90;
const DURATION_TOLERANCE_PERCENT = 20;
const DISTANCE_TOLERANCE_PERCENT = 15;
/** Prozentpunkte, unterhalb derer eine Änderung des Tempoabfalls als Bindung zählt (Setzung). */
export const MINIMUM_RELEVANT_CHANGE_PERCENT_POINTS = 3;
export const SIGN_TEST_ALPHA = 0.05;
/** Auf- plus Abstieg je Strecke, bis zu dem ein Abschnitt als flach gilt. */
export const FLAT_GRADE_PERCENT = 2;
const DAY = 86400000;
export const segmentId = (s: SegmentAggregate, i: number): string =>
  s.id ?? `split-${i + 1}`;
export const provenance = (
  runs: RunSummary[],
  segmentIds: string[] = [],
): Provenance => ({
  model_version: MODEL_VERSION,
  inputSources: runs.map(r => ({
    runId: r.id,
    source: r.source,
    version: r.sourceVersion ?? 'native-aggregate-v1',
  })),
  segmentIds,
});
/**
 * Optische Pulssensoren rasten auf die Schrittfrequenz ein. BLE meldet
 * Schritte pro Minute (~170), FIT/TCX oft Schritte pro Fuß (~85); deshalb
 * wird gegen beide Einheiten geprüft.
 */
export function cadenceLocked(
  heartRate: number | undefined,
  cadence: number | undefined,
): boolean {
  if (!finite(heartRate) || !finite(cadence)) {
    return false;
  }
  const perMinute = cadence < 120 ? cadence * 2 : cadence;
  return (
    Math.abs(heartRate - cadence) <= 3 || Math.abs(heartRate - perMinute) <= 3
  );
}

export function assessQuality(run: RunSummary): QualityReport {
  const issues: QualityIssue[] = [];
  const issue = (
    sensor: QualityIssue['sensor'],
    code: string,
    message: string,
    id?: string,
    suspected = false,
  ) => issues.push({ sensor, code, message, segmentId: id, suspected });
  const validTime =
    finite(run.durationSeconds) &&
    run.durationSeconds > 0 &&
    finite(run.startTime) &&
    finite(run.endTime) &&
    run.endTime > run.startTime;
  const validDistance = finite(run.distanceMeters) && run.distanceMeters > 0;
  if (!validTime) {
    issue('time', 'invalid_time', 'Zeitdaten fehlen oder widersprechen sich.');
  }
  if (!validDistance) {
    issue('gps', 'invalid_distance', 'Keine verlässliche Distanz vorhanden.');
  }
  if (
    validTime &&
    run.durationSeconds > (run.endTime - run.startTime) / 1000 + 5
  ) {
    issue(
      'time',
      'duration_mismatch',
      'Aufzeichnungszeit überschreitet die Spanne zwischen Start und Ende.',
    );
  }
  if ((run.segments?.length ?? 0) > MAX_SEGMENTS) {
    issue(
      'time',
      'aggregate_limit',
      'Zu viele Abschnitte: Detailauswertung bleibt aus.',
    );
  }
  const usablePaceSegmentIds: string[] = [];
  const usableHeartRateSegmentIds: string[] = [];
  const segments =
    (run.segments?.length ?? 0) <= MAX_SEGMENTS ? run.segments ?? [] : [];
  let lockCount = 0;
  for (const s of segments) {
    if (cadenceLocked(s.avgHeartRate, s.avgCadence)) {
      lockCount++;
    }
  }
  const possibleLock =
    lockCount >= 3 && lockCount / Math.max(1, segments.length) >= 0.6;
  segments.forEach((s, i) => {
    const id = segmentId(s, i);
    const timeOK = finite(s.durationSeconds) && s.durationSeconds > 0;
    const distanceOK = finite(s.distanceMeters) && s.distanceMeters > 0;
    const speed =
      timeOK && distanceOK ? s.distanceMeters / s.durationSeconds : NaN;
    if (!timeOK) {
      issue(
        'time',
        'invalid_segment_time',
        'Abschnitt mit ungültiger Dauer ausgeschlossen.',
        id,
      );
    }
    if (!distanceOK || (finite(speed) && speed > 12)) {
      issue(
        'gps',
        'suspected_jump',
        'Distanz unplausibel; möglicher GPS-Sprung.',
        id,
        true,
      );
    }
    const hasGap = finite(s.gapSeconds) && s.gapSeconds > 5;
    if (hasGap) {
      issue(
        'time',
        'gap',
        'Messlücke: Abschnitt für Pacing nicht geeignet.',
        id,
      );
    }
    if (finite(s.gradePercent) && Math.abs(s.gradePercent) > 40) {
      issue(
        'elevation',
        'suspected_elevation',
        'Unplausible Steigung; Höhenquelle prüfen.',
        id,
        true,
      );
    }
    if (
      timeOK &&
      distanceOK &&
      speed <= 12 &&
      speed >= 0.5 &&
      !hasGap &&
      s.phase !== 'pause'
    ) {
      usablePaceSegmentIds.push(id);
    }
    const hrOK =
      finite(s.avgHeartRate) && s.avgHeartRate >= 35 && s.avgHeartRate <= 230;
    if (s.avgHeartRate !== undefined && !hrOK) {
      issue(
        'heartRate',
        'implausible_hr',
        'Pulswert außerhalb des unterstützten Bereichs.',
        id,
      );
    }
    const segmentLock = possibleLock && cadenceLocked(s.avgHeartRate, s.avgCadence);
    if (segmentLock) {
      issue(
        'heartRate',
        'possible_cadence_lock',
        'Puls folgt möglicherweise der Kadenz; kein sicherer Gerätefehler.',
        id,
        true,
      );
    }
    if (
      s.avgCadence !== undefined &&
      (!finite(s.avgCadence) || s.avgCadence < 40 || s.avgCadence > 260)
    ) {
      issue(
        'cadence',
        'implausible_cadence',
        'Kadenz außerhalb des unterstützten Bereichs.',
        id,
      );
    }
    if (
      hrOK &&
      !segmentLock &&
      timeOK &&
      s.durationSeconds >= 180 &&
      !hasGap &&
      s.phase !== 'pause' &&
      s.phase !== 'recovery'
    ) {
      usableHeartRateSegmentIds.push(id);
    }
  });
  const speed = run.distanceMeters / run.durationSeconds;
  const paceUsable =
    validTime &&
    validDistance &&
    speed >= 0.5 &&
    speed <= 12 &&
    !issues.some(i => i.code === 'duration_mismatch');
  const heartRateUsable =
    segments.length > 0
      ? usableHeartRateSegmentIds.length > 0
      : finite(run.avgHeartRate) &&
        run.avgHeartRate >= 35 &&
        run.avgHeartRate <= 230;
  if (!heartRateUsable) {
    issue(
      'heartRate',
      'no_usable_hr',
      'Keine geeigneten Pulsdaten; Tempo bleibt separat auswertbar.',
    );
  }
  return {
    issues,
    paceUsable,
    heartRateUsable,
    usablePaceSegmentIds,
    usableHeartRateSegmentIds,
  };
}

/** A transparent speed-only index, explicitly not metabolic power or fitness. */
export function estimateEffort(
  run: RunSummary,
  quality = assessQuality(run),
): EffortEstimate {
  const speedIndex = quality.paceUsable
    ? (run.distanceMeters / run.durationSeconds / 3) * 100
    : undefined;
  const minutes =
    finite(run.durationSeconds) && run.durationSeconds > 0
      ? run.durationSeconds / 60
      : undefined;
  const rpe = (value: number | undefined) =>
    minutes !== undefined && finite(value) && value >= 1 && value <= 10
      ? value * minutes
      : undefined;
  const legs = rpe(run.rpe?.legs);
  const breathing = rpe(run.rpe?.breathing);
  return {
    ...provenance([run], quality.usablePaceSegmentIds),
    kind: 'estimate',
    speedIndex,
    sessionLoad:
      legs === undefined && breathing === undefined
        ? undefined
        : { legs, breathing },
    unit: 'index (100 = 3 m/s)',
    uncertainty:
      'Keine validierte Unsicherheitsspanne. Der Tempoindex erfasst weder persönliche Leistungsfähigkeit noch Umweltbelastung.',
    assumptions: [
      'Version 2: 100 Indexpunkte entsprechen 3 m/s; linearer Tempoindex.',
      'Nur gleichmäßige Laufbewegung mit plausibler Zeit und Distanz; keine physiologische Gesamtbewertung.',
      'Belastung: RPE × Bewegungsminuten je Skala (Beine, Atmung), angelehnt an Session-RPE; kein Gesamtwert aus beiden.',
    ],
    factors: {
      tempo:
        speedIndex === undefined
          ? 'Nicht bestimmbar'
          : `${Math.round(speedIndex)} Indexpunkte`,
      slope: 'Nicht bestimmbar – kein validiertes Steigungsmodell',
      wind: 'Nicht bestimmbar – kein validiertes Windmodell',
      heat: 'Nicht bestimmbar – kein validiertes Hitzemodell',
    },
  };
}

export function pacingFor(
  run: RunSummary,
  quality = assessQuality(run),
): PacingAnalysis | undefined {
  if (!quality.paceUsable || (run.segments?.length ?? 0) > MAX_SEGMENTS) {
    return undefined;
  }
  const usable = new Set(quality.usablePaceSegmentIds);
  const splits = (run.segments ?? [])
    .map((s, i) => ({ s, id: segmentId(s, i) }))
    .filter(
      ({ s, id }) =>
        usable.has(id) &&
        s.distanceMeters >= 500 &&
        (!s.phase || s.phase === 'work'),
    );
  if (splits.length < 4) {
    return undefined;
  }
  const half = Math.floor(splits.length / 2);
  const pace = (items: typeof splits) =>
    (items.reduce((sum, { s }) => sum + s.durationSeconds, 0) /
      items.reduce((sum, { s }) => sum + s.distanceMeters, 0)) *
    1000;
  const firstPaceSecondsPerKm = pace(splits.slice(0, half));
  const lastPaceSecondsPerKm = pace(splits.slice(-half));
  const paces = splits.map(
    ({ s }) => (s.durationSeconds / s.distanceMeters) * 1000,
  );
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const deviation = Math.sqrt(
    paces.reduce((sum, value) => sum + (value - mean) ** 2, 0) / paces.length,
  );
  return {
    firstPaceSecondsPerKm,
    lastPaceSecondsPerKm,
    fadePercent: (lastPaceSecondsPerKm / firstPaceSecondsPerKm - 1) * 100,
    coefficientOfVariation: deviation / mean,
    segmentIds: splits.map(s => s.id),
  };
}

/**
 * Flach heißt: Auf- plus Abstieg ≤ 2 % der Strecke. Die Nettohöhe allein
 * würde „hoch und wieder runter“ als flach zählen. Ohne Auf-/Abstieg
 * (Altdaten, Importe) zählt die Nettosteigung; ohne beides ist es unbekannt.
 */
export function segmentIsFlat(s: SegmentAggregate): boolean {
  if (!finite(s.distanceMeters) || s.distanceMeters <= 0) {
    return false;
  }
  if (finite(s.ascentMeters) && finite(s.descentMeters)) {
    return (
      ((s.ascentMeters + s.descentMeters) / s.distanceMeters) * 100 <=
      FLAT_GRADE_PERCENT
    );
  }
  return finite(s.gradePercent) && Math.abs(s.gradePercent) <= FLAT_GRADE_PERCENT;
}

export function flatPacingContext(
  run: RunSummary,
  pacing: PacingAnalysis,
): boolean {
  const ids = new Set(pacing.segmentIds);
  return (run.segments ?? [])
    .filter((s, i) => ids.has(segmentId(s, i)))
    .every(segmentIsFlat);
}

export interface BaselineRun {
  run: RunSummary;
  pacing: PacingAnalysis;
}

/**
 * Vergleichsläufe für die Basis: gleicher Zweck, flach, ähnlicher Umfang,
 * innerhalb von 90 Tagen davor. Der auslösende Lauf steht vorn, die
 * jüngsten Vorläufe folgen; höchstens fünf insgesamt.
 */
export function comparableBaseline(
  run: RunSummary,
  pacing: PacingAnalysis,
  history: RunSummary[],
): BaselineRun[] {
  const seen = new Set<string>([run.canonicalId ?? run.id, run.id]);
  const previous: BaselineRun[] = [];
  const ordered = [...history].sort(
    (a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id),
  );
  for (const candidate of ordered) {
    const canonical = candidate.canonicalId ?? candidate.id;
    if (seen.has(canonical) || seen.has(candidate.id)) {
      continue;
    }
    if (
      candidate.startTime >= run.startTime ||
      run.startTime - candidate.startTime > BASELINE_WINDOW_DAYS * DAY ||
      candidate.purpose !== run.purpose ||
      (candidate.sport ?? 'running') !== (run.sport ?? 'running')
    ) {
      continue;
    }
    if (
      Math.abs(candidate.durationSeconds / run.durationSeconds - 1) * 100 >
        DURATION_TOLERANCE_PERCENT ||
      Math.abs(candidate.distanceMeters / run.distanceMeters - 1) * 100 >
        DISTANCE_TOLERANCE_PERCENT
    ) {
      continue;
    }
    const candidatePacing = pacingFor(candidate);
    if (!candidatePacing || !flatPacingContext(candidate, candidatePacing)) {
      continue;
    }
    seen.add(canonical);
    previous.push({ run: candidate, pacing: candidatePacing });
    if (previous.length >= MAXIMUM_BASELINE_RUNS - 1) {
      break;
    }
  }
  return [{ run, pacing }, ...previous];
}

/**
 * `history` sind alle bekannten Läufe; daraus wird die Vergleichsbasis
 * gebildet. Ohne Historie kann es keine Empfehlung geben, nur Beobachtung.
 */
export function analyzeRun(
  run: RunSummary,
  active?: Experiment,
  history: RunSummary[] = [],
): RunAnalysis {
  const quality = assessQuality(run);
  const pacing = pacingFor(run, quality);
  const effort = estimateEffort(run, quality);
  const result: RunAnalysis = {
    ...provenance([run], pacing?.segmentIds ?? []),
    classification: quality.paceUsable
      ? 'Zeit und Distanz sind für eine einfache Tempoauswertung nutzbar.'
      : 'Dieser Lauf ist gespeichert; Zeit oder Distanz reichen für eine Tempoauswertung nicht aus.',
    focus: 'Noch nicht ausreichend beurteilbar.',
    nextAction:
      'Beim nächsten Lauf den Zweck angeben und geeignete Abschnitte aufzeichnen.',
    state: 'insufficient',
    quality,
    effort,
    pacing,
  };
  if (active && (active.status === 'active' || active.status === 'paused')) {
    return {
      ...result,
      focus:
        active.status === 'paused'
          ? 'Deine Empfehlung ist pausiert.'
          : 'Deine Empfehlung bleibt bestehen.',
      nextAction:
        active.status === 'paused'
          ? 'Setze die Empfehlung fort, wenn sie wieder in deinen Alltag passt.'
          : active.recommendation.action,
      state: 'active',
    };
  }
  if (run.purpose === 'unknown' || run.purpose === 'free') {
    result.focus =
      'Ohne beabsichtigten Laufzweck bewerten wir wechselndes Tempo nicht als Fehler.';
    result.question = {
      id: `purpose-${run.id}`,
      text: 'War das wechselnde Tempo beabsichtigt?',
      reason:
        'Der Laufzweck entscheidet, ob eine gleichmäßigere Einteilung sinnvoll ist.',
    };
    result.nextAction =
      'Ergänze bei Bedarf den Laufzweck; die Rückfrage ist freiwillig.';
    return result;
  }
  if (run.purpose === 'intervals' || run.purpose === 'race') {
    return {
      ...result,
      focus: 'Temposchwankungen können zu diesem Laufzweck gehören.',
      nextAction:
        'Für diesen Laufzweck gibt es noch keine ausreichend geprüfte Empfehlung.',
    };
  }
  if (!pacing) {
    result.focus =
      'Für die Einteilung fehlen mindestens vier geeignete Abschnitte ab 500 m.';
    result.nextAction =
      'Zweck und geplanten Umfang beibehalten; aus diesen Daten folgt noch keine Änderung.';
    return result;
  }
  result.classification = `Die zweite Laufhälfte war ${Math.abs(
    pacing.fadePercent,
  ).toFixed(1)} % ${
    pacing.fadePercent >= 0 ? 'langsamer' : 'schneller'
  } (geeignete Abschnitte).`;
  if (!flatPacingContext(run, pacing)) {
    return {
      ...result,
      focus:
        'Für eine Empfehlung zur Starteinteilung fehlen vergleichbar flache Abschnitte.',
      nextAction:
        'Tempoverteilung als Beobachtung nutzen. Für die Prüfung fehlen vergleichbar flache Abschnitte.',
    };
  }
  const baseline = comparableBaseline(run, pacing, history);
  const fades = baseline.map(item => item.pacing.fadePercent);
  const medianFade = median(fades);
  if (baseline.length < MINIMUM_BASELINE_RUNS) {
    if (pacing.fadePercent < FADE_TRIGGER_PERCENT) {
      return {
        ...result,
        state: 'maintain',
        focus: 'Du hast zum Ende nicht deutlich an Tempo verloren.',
        nextAction:
          'Die bisherige Einteilung für diesen Laufzweck beibehalten. Andere Trainingsaspekte bleiben offen.',
      };
    }
    return {
      ...result,
      focus: `Heute hat die zweite Hälfte deutlich nachgelassen. Ein einzelner Lauf trägt keine Empfehlung; es fehlen vergleichbare Läufe (${baseline.length} von ${MINIMUM_BASELINE_RUNS}).`,
      nextAction:
        'Zweck und Umfang beibehalten. Entschieden wird über den Median mehrerer vergleichbarer flacher Läufe, nicht über einen Ausreißer.',
    };
  }
  if (medianFade < FADE_TRIGGER_PERCENT) {
    return {
      ...result,
      state: 'maintain',
      focus: `Im Median deiner letzten ${baseline.length} vergleichbaren Läufe war die zweite Hälfte ${medianFade.toFixed(
        1,
      )} % langsamer. Das ist kein Muster, das eine Änderung trägt.`,
      nextAction:
        'Die bisherige Einteilung für diesen Laufzweck beibehalten. Andere Trainingsaspekte bleiben offen.',
    };
  }
  const opening =
    median(baseline.map(item => item.pacing.firstPaceSecondsPerKm)) * 1.05;
  const recommendation: Recommendation = {
    ...provenance(
      baseline.map(item => item.run),
      pacing.segmentIds,
    ),
    id: `calmer-start:${run.id}:${MODEL_VERSION}`,
    kind: 'calmer_start',
    title: 'Ruhiger beginnen',
    action: `Beginne den nächsten vergleichbar flachen ${
      run.purpose === 'long' ? 'langen' : 'lockeren'
    } Lauf in der ersten Hälfte etwa 5 % ruhiger (${formatPace(
      opening,
    )} min/km). Behalte Zweck und geplanten Umfang bei.`,
    reason: `In ${baseline.length} vergleichbaren Läufen war die zweite Hälfte im Median ${medianFade.toFixed(
      1,
    )} % langsamer. Probiere einen ruhigeren Start aus; Gelände, Wetter und Tagesform können mitwirken.`,
    purpose: run.purpose,
    goal: 'Gleichmäßigere Einteilung: weniger später Tempoabfall bei erhaltenem Zweck und Umfang. Das ist keine Aussage über Leistungsfähigkeit.',
    criteria: {
      method: PACING_METHOD,
      baselineRunIds: baseline.map(item => item.run.id),
      baselineFadePercent: medianFade,
      signTestAlpha: SIGN_TEST_ALPHA,
      baselineDurationSeconds: median(
        baseline.map(item => item.run.durationSeconds),
      ),
      baselineDistanceMeters: median(
        baseline.map(item => item.run.distanceMeters),
      ),
      baselineContext: run.context ? { ...run.context } : undefined,
      openingPaceSecondsPerKm: opening,
      openingPaceTolerancePercent: 3,
      outcome: 'late_pace_fade_percent',
      minimumRelevantChangePercentPoints: MINIMUM_RELEVANT_CHANGE_PERCENT_POINTS,
      durationTolerancePercent: DURATION_TOLERANCE_PERCENT,
      distanceTolerancePercent: DISTANCE_TOLERANCE_PERCENT,
      minimumObservations: 6,
      minimumDays: 14,
      reviewAfterRuns: 3,
      maxDays: 56,
      exclusions: [
        'Abweichender Zweck',
        'Dauer außerhalb ±20 % oder Distanz außerhalb ±15 %',
        'Fehlende oder unzureichende Abschnitte',
        'Unbekannte oder nicht flache Steigung',
        'Bekannt deutlich abweichendes Wetter',
      ],
      stopConditions: [
        'Bei Beschwerden die Empfehlung pausieren; das ist keine Diagnose',
        'Geändertes Trainingsziel',
        'Modellfehler oder gelöschte Vergleichsläufe',
        'Nach 56 Tagen mit zu wenig vergleichbaren Läufen neu entscheiden',
      ],
    },
  };
  return {
    ...result,
    state: 'recommendation',
    focus: recommendation.reason,
    nextAction: recommendation.action,
    recommendation,
  };
}

export function formatPace(seconds: number): string {
  if (!finite(seconds) || seconds <= 0) {
    return '–';
  }
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
