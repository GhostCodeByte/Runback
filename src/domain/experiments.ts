import {
  analyzeRun,
  flatPacingContext,
  MODEL_VERSION,
  pacingFor,
  provenance,
} from './analysis';
import {
  Adherence,
  Experiment,
  ExperimentEvaluation,
  ExperimentStatus,
  Recommendation,
  RunSummary,
} from './types';

const DAY = 86400000;
/** Clone before freezing: an accepted experiment never shares mutable proposal state. */
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
export function acceptRecommendation(
  recommendation: Recommendation,
  now: number,
  existing?: Experiment,
): Experiment {
  if (!Number.isFinite(now)) {
    throw new Error('Ungültiger Annahmezeitpunkt.');
  }
  if (
    existing &&
    (existing.status === 'active' || existing.status === 'paused')
  ) {
    throw new Error('Zuerst das bestehende Arbeitsthema beenden.');
  }
  const snapshot = JSON.parse(JSON.stringify(recommendation)) as Recommendation;
  return immutable({
    id: `experiment:${recommendation.id}:${now}`,
    recommendation: snapshot,
    acceptedAt: now,
    status: 'active',
    history: [
      {
        at: now,
        status: 'active',
        reason: 'Handlung und Prüfbedingungen angenommen.',
      },
    ],
  } as Experiment);
}
export function transitionExperiment(
  experiment: Experiment,
  status: ExperimentStatus,
  now: number,
  reason: string,
): Experiment {
  if (!reason.trim()) {
    throw new Error('Ein Zustandswechsel braucht eine Begründung.');
  }
  if (
    !Number.isFinite(now) ||
    now < experiment.history[experiment.history.length - 1].at
  ) {
    throw new Error('Zeitpunkt liegt vor der letzten Änderung.');
  }
  if (experiment.status === 'completed' || experiment.status === 'aborted') {
    throw new Error('Beendete Versuche bleiben unverändert.');
  }
  if (status === experiment.status) {
    return experiment;
  }
  return immutable({
    ...experiment,
    status,
    history: [
      ...experiment.history,
      { at: now, status, reason: reason.trim() },
    ],
  });
}

export function uniqueRuns(runs: RunSummary[]): RunSummary[] {
  const seen = new Set<string>();
  // Native storage owns cross-format deduplication. Canonical IDs preserve independent evidence.
  return runs.filter(run => {
    const id = run.canonicalId ?? run.id;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}
function activeAt(experiment: Experiment, time: number): boolean {
  let status: ExperimentStatus | undefined;
  for (const event of experiment.history) {
    if (event.at <= time) {
      status = event.status;
    }
  }
  return status === 'active';
}
export function evaluateExperiment(
  experiment: Experiment,
  runs: RunSummary[],
  reported: Record<string, Adherence> = {},
): ExperimentEvaluation {
  const c = experiment.recommendation.criteria;
  const result: ExperimentEvaluation = {
    ...provenance([]),
    verdict: 'insufficient_evidence',
    summary:
      'Noch keine geeigneten Folgeläufe. Die Umsetzung und das Ergebnis werden getrennt geprüft.',
    eligibleRunIds: [],
    excluded: [],
    adherence: [],
    causalClaim: false,
  };
  if (
    c.method !== 'pacing-fade-v1' ||
    experiment.recommendation.model_version !== MODEL_VERSION
  ) {
    return {
      ...result,
      summary:
        'Der gespeicherte Modellstand ist hier nicht verfügbar. Ursprüngliche Prüfbedingungen bleiben erhalten.',
    };
  }
  const outcomes: { run: RunSummary; fade: number }[] = [];
  for (const run of uniqueRuns(runs).sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  )) {
    if (
      run.startTime <= experiment.acceptedAt ||
      c.baselineRunIds.includes(run.id)
    ) {
      continue;
    }
    const exclude = (reason: string) =>
      result.excluded.push({ runId: run.id, reason });
    if (!activeAt(experiment, run.startTime)) {
      exclude('Versuch war bei Laufbeginn nicht aktiv.');
      continue;
    }
    if (run.startTime > experiment.acceptedAt + c.maxDays * DAY) {
      exclude('Vorab festgelegter Beobachtungszeitraum abgelaufen.');
      continue;
    }
    if (run.purpose !== experiment.recommendation.purpose) {
      exclude('Anderer Laufzweck.');
      continue;
    }
    if (
      Math.abs(run.durationSeconds / c.baselineDurationSeconds - 1) * 100 >
        c.durationTolerancePercent ||
      Math.abs(run.distanceMeters / c.baselineDistanceMeters - 1) * 100 >
        c.distanceTolerancePercent
    ) {
      exclude('Geplanter Umfang nicht ausreichend erhalten.');
      continue;
    }
    const pacing = pacingFor(run);
    if (!pacing || !flatPacingContext(run, pacing)) {
      exclude('Geeignete flache Pacing-Abschnitte fehlen.');
      continue;
    }
    const base = c.baselineContext;
    const current = run.context;
    if (
      base?.temperatureC !== undefined &&
      current?.temperatureC !== undefined &&
      Math.abs(base.temperatureC - current.temperatureC) > 5
    ) {
      exclude('Temperatur unterscheidet sich um mehr als 5 °C.');
      continue;
    }
    if (
      base?.windMps !== undefined &&
      current?.windMps !== undefined &&
      Math.abs(base.windMps - current.windMps) > 2
    ) {
      exclude('Wind unterscheidet sich um mehr als 2 m/s.');
      continue;
    }
    result.eligibleRunIds.push(run.id);
    let value = reported[run.id];
    let source: 'reported' | 'derived' | 'unknown' = value
      ? 'reported'
      : 'derived';
    if (!value) {
      value =
        Math.abs(pacing.firstPaceSecondsPerKm / c.openingPaceSecondsPerKm - 1) *
          100 <=
        c.openingPaceTolerancePercent
          ? 'yes'
          : 'no';
    }
    if (value === 'unknown') {
      source = 'unknown';
    }
    result.adherence.push({ runId: run.id, value, source });
    if (value === 'yes') {
      outcomes.push({ run, fade: pacing.fadePercent });
    }
  }
  result.inputSources = provenance(outcomes.map(o => o.run)).inputSources;
  if (
    result.adherence.length >= c.reviewAfterRuns &&
    result.adherence.every(a => a.value === 'no')
  ) {
    return {
      ...result,
      verdict: 'not_implemented',
      summary:
        'Der ruhigere Start wurde in den geeigneten Läufen nicht umgesetzt. Das widerlegt die Handlung nicht.',
    };
  }
  if (outcomes.length === 0) {
    return result;
  }
  const changes = outcomes.map(o => c.baselineFadePercent - o.fade);
  result.changePercentPoints =
    changes.reduce((a, b) => a + b, 0) / changes.length;
  result.observedRange = [Math.min(...changes), Math.max(...changes)];
  const enoughTime =
    outcomes[outcomes.length - 1].run.startTime - experiment.acceptedAt >=
    c.minimumDays * DAY;
  if (outcomes.length < c.minimumObservations || !enoughTime) {
    result.summary = `${
      outcomes.length
    } umgesetzte, geeignete Läufe; Prüfung ab ${
      c.minimumObservations
    } Läufen über mindestens ${c.minimumDays} Tage. ${
      outcomes.length >= c.reviewAfterRuns ? 'Zwischenstand verfügbar. ' : ''
    }Der beobachtete Unterschied beweist keine Ursache.`;
    return result;
  }
  const weatherUnknown = outcomes.some(
    o =>
      c.baselineContext?.temperatureC === undefined ||
      c.baselineContext?.windMps === undefined ||
      o.run.context?.temperatureC === undefined ||
      o.run.context?.windMps === undefined,
  );
  const causal = ` Beobachtung, kein Ursachennachweis.${
    weatherUnknown
      ? ' Fehlender Wetterkontext begrenzt die Zuordnung zusätzlich.'
      : ''
  }`;
  if (changes.every(change => change >= c.minimumRelevantChangePercentPoints)) {
    return {
      ...result,
      verdict: 'improved',
      summary: `Bei erhaltenem Zweck und Umfang war der späte Tempoabfall in allen ${outcomes.length} umgesetzten Läufen geringer.${causal}`,
    };
  }
  if (
    changes.every(change => change <= -c.minimumRelevantChangePercentPoints)
  ) {
    return {
      ...result,
      verdict: 'worsened',
      summary: `In allen ${outcomes.length} umgesetzten Läufen war der späte Tempoabfall größer.${causal}`,
    };
  }
  return {
    ...result,
    summary: `Kein einheitlicher relevanter Unterschied. Die einfache Einzellauf-Baseline erlaubt keinen ausreichend präzisen Nachweis „kein relevanter Effekt“.${causal}`,
  };
}

export function recommend(run: RunSummary, active?: Experiment) {
  return analyzeRun(run, active);
}
