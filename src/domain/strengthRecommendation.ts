import { couplingGate, isStrengthRecommendation } from './areas';
import { catalogExercise } from './catalog';
import { focusTypesFor, type TrainingFocus } from './focus';
import { relevance, RELEVANCE_VERSION } from './prioritization';
import {
  assessExerciseProgression,
  bestWorkingSet,
  PROGRESSION_MODEL_VERSION,
} from './progression';
import type { StrengthSession } from './strength';
import type {
  Adherence,
  Experiment,
  ExperimentEvaluation,
  ExperimentStatus,
  StrengthRecommendation,
} from './types';

/**
 * Empfehlungen im Bereich Krafttraining. Eine freigeschaltete Handlungsklasse:
 * die Last einer Übung (`strength_load`), abgeleitet aus dem e1RM-Verlauf in
 * progression.ts. Aufbau, Annahme und Prüfung folgen denselben Regeln wie beim
 * Laufen: vorher festlegen, Umsetzung und Ergebnis trennen, keine Ursache
 * behaupten.
 */
export const STRENGTH_RECOMMENDATION_VERSION = 'strength-load-v1';
const DAY = 86400000;
/** Anteil, ab dem eine Region als Hauptregion der Übung zählt. */
const MAIN_REGION_SHARE = 0.15;

const kg = (value: number) =>
  value.toLocaleString('de-DE', { maximumFractionDigits: 1 });

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function exerciseRegions(exerciseId: string): string[] {
  const shares = catalogExercise(exerciseId)?.shares ?? {};
  return Object.entries(shares)
    .filter(([, share]) => (share ?? 0) >= MAIN_REGION_SHARE)
    .map(([region]) => region)
    .sort();
}

/** Baut aus dem Verlauf einer Übung höchstens eine Empfehlung. */
export function strengthRecommendationFor(
  sessions: StrengthSession[],
  exerciseId: string,
  now: number,
): { recommendation?: StrengthRecommendation; reason: string } {
  const finished = sessions.filter(session => session.status === 'finished');
  const assessment = assessExerciseProgression(finished, exerciseId, {
    nextSessionAt: now,
  });
  const suggestion = assessment.suggestion;
  if (!suggestion || assessment.verdict === 'not_assessable') {
    return { reason: assessment.reason };
  }
  if (suggestion.verdict === 'keep_going') {
    return { reason: assessment.reason };
  }
  const name =
    finished
      .flatMap(session => session.exercises)
      .find(exercise => exercise.exerciseId === exerciseId)?.name ??
    catalogExercise(exerciseId)?.name ??
    exerciseId;
  const range = suggestion.targetRange;
  const last = assessment.series[assessment.series.length - 1];
  const baseline = assessment.series.slice(-3);
  const target = `${kg(range.minKg)}–${kg(range.maxKg)} kg × ${range.reps}`;
  const direction = suggestion.verdict;
  const action =
    direction === 'increase'
      ? `Geh bei ${name} auf ${target}.`
      : direction === 'reduce'
      ? `Nimm bei ${name} etwas raus: ${target}.`
      : `Probiere bei ${name} drei Einheiten ${target}.`;
  return {
    recommendation: {
      model_version: STRENGTH_RECOMMENDATION_VERSION,
      inputSources: assessment.inputSources,
      segmentIds: baseline.map(point => point.setId),
      id: `strength_load:${exerciseId}:${last.sessionId}:${direction}`,
      kind: 'strength_load',
      area: 'strength',
      title: 'Last anpassen',
      action,
      reason: suggestion.reason,
      goal: `Nach ${suggestion.checkCriterion.reviewAfterSessions} passenden Einheiten liegt dein bestes Arbeits-e1RM bei ${name} mindestens ${suggestion.checkCriterion.minimumRelevantChangePercent} % über den Vergleichseinheiten.`,
      exerciseId,
      exerciseName: name,
      direction,
      regions: exerciseRegions(exerciseId),
      criteria: {
        method: 'strength-e1rm-v1',
        exerciseId,
        baselineSessionIds: baseline.map(point => point.sessionId),
        baselineE1RM: median(baseline.map(point => point.e1rm)),
        targetMinKg: range.minKg,
        targetMaxKg: range.maxKg,
        targetReps: range.reps,
        outcome: 'best_working_e1rm_percent',
        minimumRelevantChangePercent:
          suggestion.checkCriterion.minimumRelevantChangePercent,
        minimumObservations: 3,
        reviewAfterSessions: suggestion.checkCriterion.reviewAfterSessions,
        maxDays: 42,
        exclusions: [
          'Aufwärm-, Drop- und Zeitsätze zählen nicht.',
          'Einheiten ohne abgeschlossenen Arbeitssatz dieser Übung zählen nicht.',
        ],
        stopConditions: [
          'Schmerzen oder starker gemeldeter Muskelkater in den beteiligten Regionen: Empfehlung pausieren.',
        ],
      },
    },
    reason: assessment.reason,
  };
}

export interface ConsideredStrengthRecommendation {
  exerciseId: string;
  exerciseName: string;
  recommendation?: StrengthRecommendation;
  reason: string;
}

/** Gleiche Übung, gleiche Richtung: dieselbe Empfehlung. */
export function sameStrengthRecommendation(
  a: StrengthRecommendation,
  b: StrengthRecommendation,
): boolean {
  return a.exerciseId === b.exerciseId && a.direction === b.direction;
}

/** Read-only Auswahl je Übung; höchstens eine Empfehlung kommt heraus. */
export function selectStrengthRecommendation(
  sessions: StrengthSession[],
  options: {
    active?: Experiment;
    /** Aktive Empfehlungen anderer Bereiche für die Kopplungssperre. */
    otherActive?: Experiment[];
    experiments?: Experiment[];
    dismissed?: string[];
    postponedUntil?: number;
    focus?: TrainingFocus | null;
    targetDate?: string;
    today: string;
    now: number;
  },
): {
  selected?: StrengthRecommendation;
  alternatives: ConsideredStrengthRecommendation[];
} {
  const finished = sessions.filter(session => session.status === 'finished');
  const names = new Map<string, string>();
  for (const session of finished) {
    for (const exercise of session.exercises) {
      if (!names.has(exercise.exerciseId)) {
        names.set(exercise.exerciseId, exercise.name);
      }
    }
  }
  const alternatives: ConsideredStrengthRecommendation[] = [];
  const eligible: {
    recommendation: StrengthRecommendation;
    quality: number;
  }[] = [];
  for (const [exerciseId, exerciseName] of [...names.entries()].sort()) {
    // Daten nach der Annahme dürfen eine Vorschau tragen, nicht die alten.
    const usable = options.active
      ? finished.filter(
          session =>
            session.startTime > (options.active as Experiment).acceptedAt,
        )
      : finished;
    const { recommendation, reason } = strengthRecommendationFor(
      usable,
      exerciseId,
      options.now,
    );
    const reject = (why: string) =>
      alternatives.push({
        exerciseId,
        exerciseName,
        recommendation,
        reason: why,
      });
    if (!recommendation) {
      reject(reason);
      continue;
    }
    if (
      options.experiments?.some(
        item =>
          item.recommendation.id === recommendation.id ||
          (isStrengthRecommendation(item.recommendation) &&
            item.recommendation.criteria.baselineSessionIds.some(id =>
              recommendation.criteria.baselineSessionIds.includes(id),
            )),
      )
    ) {
      reject(
        'Diese Einheiten wurden bereits für eine angenommene Empfehlung verwendet.',
      );
      continue;
    }
    if (options.dismissed?.includes(recommendation.id)) {
      reject('Diesen Vorschlag hast du abgelehnt.');
      continue;
    }
    if (
      options.active &&
      isStrengthRecommendation(options.active.recommendation) &&
      sameStrengthRecommendation(recommendation, options.active.recommendation)
    ) {
      reject('Das ist bereits deine laufende Empfehlung.');
      continue;
    }
    const priority = relevance(
      'strength_load',
      options.focus?.kind,
      options.targetDate,
      options.today,
    );
    if (priority.blocked) {
      reject(priority.blocked);
      continue;
    }
    const coupling = couplingGate(recommendation, options.otherActive ?? []);
    if (coupling.blocked) {
      reject(coupling.blocked);
      continue;
    }
    if (options.postponedUntil && options.postponedUntil > options.now) {
      reject('Du hast die Entscheidung auf später verschoben.');
      continue;
    }
    eligible.push({
      recommendation: {
        ...recommendation,
        priority: {
          version: RELEVANCE_VERSION,
          focusLabel:
            focusTypesFor('strength').find(
              item => item.value === options.focus?.kind,
            )?.label || 'Kein Fokus',
          weight: priority.weight,
        },
      },
      quality: recommendation.inputSources.length,
    });
  }
  // Mehr Einheiten im Verlauf heißt tragfähigere Grundlage. Danach feste ID.
  eligible.sort(
    (a, b) =>
      b.recommendation.priority!.weight - a.recommendation.priority!.weight ||
      b.quality - a.quality ||
      a.recommendation.id.localeCompare(b.recommendation.id),
  );
  const selected = eligible[0]?.recommendation;
  for (const item of eligible.slice(1)) {
    alternatives.push({
      exerciseId: item.recommendation.exerciseId,
      exerciseName: item.recommendation.exerciseName,
      recommendation: item.recommendation,
      reason:
        item.quality < eligible[0].quality
          ? 'Für den gewählten Vorschlag liegen mehr Einheiten im Verlauf vor.'
          : 'Gleich gut geeignet. Bei Gleichstand entscheidet eine feste Reihenfolge.',
    });
  }
  return { selected, alternatives };
}

function activeAt(experiment: Experiment, time: number): boolean {
  let status: ExperimentStatus | undefined;
  for (const event of experiment.history) {
    if (event.at <= time) status = event.status;
  }
  return status === 'active';
}

/** Prüft eine angenommene Lastempfehlung an späteren Einheiten. */
export function evaluateStrengthExperiment(
  experiment: Experiment<StrengthRecommendation>,
  sessions: StrengthSession[],
  reported: Record<string, Adherence> = {},
): ExperimentEvaluation {
  const c = experiment.recommendation.criteria;
  const result: ExperimentEvaluation = {
    model_version: PROGRESSION_MODEL_VERSION,
    inputSources: [],
    segmentIds: [],
    verdict: 'insufficient_evidence',
    summary:
      'Noch keine geeigneten Folgeeinheiten. Die Umsetzung und das Ergebnis werden getrennt geprüft.',
    eligibleRunIds: [],
    excluded: [],
    adherence: [],
    causalClaim: false,
  };
  if (
    c.method !== 'strength-e1rm-v1' ||
    experiment.recommendation.model_version !== STRENGTH_RECOMMENDATION_VERSION
  ) {
    return {
      ...result,
      summary:
        'Der gespeicherte Modellstand ist hier nicht verfügbar. Die vor dem Start festgelegten Regeln bleiben erhalten.',
    };
  }
  const outcomes: { sessionId: string; e1rm: number }[] = [];
  const ordered = [...sessions].sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  );
  for (const session of ordered) {
    if (
      session.startTime <= experiment.acceptedAt ||
      c.baselineSessionIds.includes(session.id)
    ) {
      continue;
    }
    const exclude = (reason: string) =>
      result.excluded.push({ runId: session.id, reason });
    if (session.status !== 'finished') {
      exclude('Einheit nicht abgeschlossen.');
      continue;
    }
    if (!activeAt(experiment, session.startTime)) {
      exclude('Empfehlung war bei Beginn der Einheit nicht aktiv.');
      continue;
    }
    if (session.startTime > experiment.acceptedAt + c.maxDays * DAY) {
      exclude('Vorab festgelegter Beobachtungszeitraum abgelaufen.');
      continue;
    }
    const best = bestWorkingSet(session, c.exerciseId);
    if (!best) {
      exclude('Kein abgeschlossener Arbeitssatz dieser Übung.');
      continue;
    }
    result.eligibleRunIds.push(session.id);
    result.inputSources.push({
      runId: session.id,
      source: 'strength-session',
      version: session.modelVersion,
    });
    let value = reported[session.id];
    let source: 'reported' | 'derived' | 'unknown' = value
      ? 'reported'
      : 'derived';
    if (!value) {
      value =
        best.weightKg >= c.targetMinKg - 0.01 &&
        best.weightKg <= c.targetMaxKg + 0.01
          ? 'yes'
          : 'no';
    }
    if (value === 'unknown') source = 'unknown';
    result.adherence.push({ runId: session.id, value, source });
    if (value === 'yes') {
      outcomes.push({ sessionId: session.id, e1rm: best.e1rm });
    }
  }
  if (
    result.adherence.length >= c.reviewAfterSessions &&
    result.adherence.every(item => item.value === 'no')
  ) {
    return {
      ...result,
      verdict: 'not_implemented',
      summary:
        'Du hast die neue Last bisher nicht probiert. Ob sie hilft, bleibt noch offen.',
    };
  }
  if (!outcomes.length) return result;
  const changes = outcomes.map(
    item => ((item.e1rm - c.baselineE1RM) / c.baselineE1RM) * 100,
  );
  result.changePercentPoints =
    changes.reduce((a, b) => a + b, 0) / changes.length;
  result.observedRange = [Math.min(...changes), Math.max(...changes)];
  if (outcomes.length < c.minimumObservations) {
    result.summary = `${outcomes.length} umgesetzte, geeignete Einheiten; Prüfung ab ${c.minimumObservations} Einheiten. Der beobachtete Unterschied beweist keine Ursache.`;
    return result;
  }
  const causal = ' Beobachtung, kein Ursachennachweis.';
  if (changes.every(change => change >= c.minimumRelevantChangePercent)) {
    return {
      ...result,
      verdict: 'improved',
      summary: `Dein bestes Arbeits-e1RM lag in allen ${outcomes.length} umgesetzten Einheiten über den Vergleichseinheiten.${causal}`,
    };
  }
  if (changes.every(change => change <= -c.minimumRelevantChangePercent)) {
    return {
      ...result,
      verdict: 'worsened',
      summary: `Dein bestes Arbeits-e1RM lag in allen ${outcomes.length} umgesetzten Einheiten unter den Vergleichseinheiten.${causal}`,
    };
  }
  return {
    ...result,
    summary: `Noch nicht klar. Der Vergleich zeigt keinen eindeutigen Unterschied.${causal}`,
  };
}
