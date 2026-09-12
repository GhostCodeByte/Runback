import { analyzeRun } from './analysis';
import { FOCUS_TYPES, type TrainingFocus } from './focus';
import { relevance, RELEVANCE_VERSION } from './prioritization';
import type { Experiment, Recommendation, RunSummary } from './types';

export interface ConsideredRecommendation {
  runId: string;
  recommendation?: Recommendation;
  reason: string;
}

/** Compare the actual action and its scope, not IDs or wording. */
export function sameRecommendation(
  a: Recommendation,
  b: Recommendation,
): boolean {
  const within = (value: number, reference: number, tolerance: number) =>
    Math.abs(value / reference - 1) * 100 <= tolerance;
  return (
    a.kind === b.kind &&
    a.purpose === b.purpose &&
    within(
      a.criteria.openingPaceSecondsPerKm,
      b.criteria.openingPaceSecondsPerKm,
      b.criteria.openingPaceTolerancePercent,
    ) &&
    within(
      a.criteria.baselineDurationSeconds,
      b.criteria.baselineDurationSeconds,
      b.criteria.durationTolerancePercent,
    ) &&
    within(
      a.criteria.baselineDistanceMeters,
      b.criteria.baselineDistanceMeters,
      b.criteria.distanceTolerancePercent,
    )
  );
}

/** Read-only selection. Only analyzeRun's released catalog can supply candidates. */
export function selectRecommendations(
  runs: RunSummary[],
  options: {
    active?: Experiment;
    experiments?: Experiment[];
    dismissed?: string[];
    postponedUntil?: number;
    focus?: TrainingFocus | null;
    targetDate?: string;
    today: string;
    now: number;
  },
): { selected?: Recommendation; alternatives: ConsideredRecommendation[] } {
  const ordered = [...runs].sort(
    (a, b) =>
      b.startTime - a.startTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const seen = new Set<string>();
  const alternatives: ConsideredRecommendation[] = [];
  const eligible: { recommendation: Recommendation; quality: number }[] = [];
  for (const run of ordered) {
    const canonical = run.canonicalId || run.id;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    // A follow-up preview must never recycle evidence from before acceptance.
    if (options.active && run.startTime <= options.active.acceptedAt) continue;
    const analysis = analyzeRun(run);
    const recommendation = analysis.recommendation;
    const reject = (reason: string) =>
      alternatives.push({ runId: run.id, recommendation, reason });
    if (!recommendation) {
      reject(analysis.focus);
      continue;
    }
    if (
      options.experiments?.some(
        item =>
          item.recommendation.id === recommendation.id ||
          item.recommendation.criteria.baselineRunIds.some(
            id => id === run.id || id === canonical,
          ),
      )
    ) {
      reject(
        'Diese Daten wurden bereits für eine angenommene Empfehlung verwendet.',
      );
      continue;
    }
    if (options.dismissed?.includes(recommendation.id)) {
      reject('Diesen Vorschlag hast du abgelehnt.');
      continue;
    }
    if (
      options.active &&
      sameRecommendation(recommendation, options.active.recommendation)
    ) {
      reject(
        'Das ist bereits deine laufende Empfehlung, mit vergleichbaren Vorgaben.',
      );
      continue;
    }
    const priority = relevance(
      recommendation.kind,
      options.focus?.kind,
      options.targetDate,
      options.today,
    );
    if (priority.blocked) {
      reject(priority.blocked);
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
            FOCUS_TYPES.find(item => item.value === options.focus?.kind)
              ?.label || 'Kein Fokus',
          weight: priority.weight,
        },
      },
      quality:
        analysis.quality.usablePaceSegmentIds.length /
        Math.max(1, run.segments?.length || 0),
    });
  }
  // Currently one released class: feasibility and effort are equal. Use a
  // stable ID only after relevance and the share of usable pace data tie.
  eligible.sort(
    (a, b) =>
      b.recommendation.priority!.weight - a.recommendation.priority!.weight ||
      b.quality - a.quality ||
      (a.recommendation.id < b.recommendation.id
        ? -1
        : a.recommendation.id > b.recommendation.id
        ? 1
        : 0),
  );
  const selected = eligible[0]?.recommendation;
  for (const item of eligible.slice(1)) {
    alternatives.push({
      runId: item.recommendation.criteria.baselineRunIds[0],
      recommendation: item.recommendation,
      reason:
        item.quality < eligible[0].quality
          ? 'Für den gewählten Vorschlag ist ein größerer Anteil der Tempoabschnitte nutzbar.'
          : 'Gleich gut geeignet. Bei Gleichstand entscheidet eine feste Reihenfolge, damit die Auswahl stabil bleibt.',
    });
  }
  return { selected, alternatives };
}
