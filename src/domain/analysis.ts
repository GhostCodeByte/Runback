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

export const MODEL_VERSION = 'runback-rules-1.0.0';
export const MAX_SEGMENTS = 500;
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
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
      'Bewegungszeit überschreitet die Aufzeichnungsdauer.',
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
    if (
      finite(s.avgHeartRate) &&
      finite(s.avgCadence) &&
      Math.abs(s.avgHeartRate - s.avgCadence) <= 3
    ) {
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
    const segmentLock =
      possibleLock &&
      finite(s.avgHeartRate) &&
      finite(s.avgCadence) &&
      Math.abs(s.avgHeartRate - s.avgCadence) <= 3;
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
  return {
    ...provenance([run], quality.usablePaceSegmentIds),
    kind: 'estimate',
    speedIndex,
    accumulatedIndexMinutes:
      speedIndex === undefined
        ? undefined
        : (speedIndex * run.durationSeconds) / 60,
    unit: 'index (100 = 3 m/s)',
    uncertainty:
      'Keine validierte Unsicherheitsspanne. Der Tempoindex erfasst weder persönliche Leistungsfähigkeit noch Umweltbelastung.',
    assumptions: [
      'Version 1: 100 Indexpunkte entsprechen 3 m/s; linearer Tempoindex.',
      'Nur gleichmäßige Laufbewegung mit plausibler Zeit und Distanz; keine physiologische Gesamtbewertung.',
      'Gesamtumfang: Tempoindex × Bewegungsminuten; nicht mit RPE oder mechanischer Arbeit gleichsetzen.',
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

export function flatPacingContext(
  run: RunSummary,
  pacing: PacingAnalysis,
): boolean {
  const ids = new Set(pacing.segmentIds);
  return (run.segments ?? [])
    .filter((s, i) => ids.has(segmentId(s, i)))
    .every(s => finite(s.gradePercent) && Math.abs(s.gradePercent) <= 2);
}

export function analyzeRun(run: RunSummary, active?: Experiment): RunAnalysis {
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
          ? 'Dein Arbeitsthema ist pausiert.'
          : 'Dein Arbeitsthema bleibt: ruhiger beginnen.',
      nextAction:
        active.status === 'paused'
          ? 'Setze den Versuch fort, wenn er wieder in deinen Alltag passt.'
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
        'Für diesen Zweck ist noch keine geprüfte Handlungsklasse freigeschaltet.',
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
        'Steigungen sind unbekannt oder zu unterschiedlich für eine Pacing-Empfehlung.',
      nextAction:
        'Tempoverteilung als Beobachtung nutzen. Für die Prüfung fehlen vergleichbar flache Abschnitte.',
    };
  }
  if (pacing.fadePercent < 8) {
    return {
      ...result,
      state: 'maintain',
      focus:
        'Kein deutlicher später Tempoabfall nach der einfachen Pacing-Regel.',
      nextAction:
        'Die bisherige Einteilung für diesen Laufzweck beibehalten. Andere Trainingsaspekte bleiben offen.',
    };
  }
  const opening = pacing.firstPaceSecondsPerKm * 1.05;
  const recommendation: Recommendation = {
    ...provenance([run], pacing.segmentIds),
    id: `calmer-start:${run.id}:${MODEL_VERSION}`,
    kind: 'calmer_start',
    title: 'Ruhiger beginnen',
    action: `Beginne den nächsten vergleichbar flachen ${
      run.purpose === 'long' ? 'langen' : 'lockeren'
    } Lauf in der ersten Hälfte etwa 5 % ruhiger (${formatPace(
      opening,
    )} min/km). Behalte Zweck und geplanten Umfang bei.`,
    reason:
      'Die spätere Hälfte war mindestens 8 % langsamer. Ein ruhigerer Start ist ein prüfbarer Versuch; Gelände, Wetter und Tagesform können mitwirken.',
    purpose: run.purpose,
    goal: 'Weniger später Tempoabfall bei erhaltenem Zweck und Umfang.',
    criteria: {
      method: 'pacing-fade-v1',
      baselineRunIds: [run.id],
      baselineFadePercent: pacing.fadePercent,
      baselineDurationSeconds: run.durationSeconds,
      baselineDistanceMeters: run.distanceMeters,
      baselineContext: run.context ? { ...run.context } : undefined,
      openingPaceSecondsPerKm: opening,
      openingPaceTolerancePercent: 3,
      outcome: 'late_pace_fade_percent',
      minimumRelevantChangePercentPoints: 3,
      durationTolerancePercent: 20,
      distanceTolerancePercent: 15,
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
        'Beschwerden: Versuch aussetzen, keine Diagnose',
        'Geändertes Trainingsziel',
        'Modellfehler oder gelöschte Baseline',
        'Nach 56 Tagen ohne ausreichende Evidenz neu entscheiden',
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
