import type {
  AnyRecommendation,
  Area,
  Experiment,
  Recommendation,
  StrengthRecommendation,
} from './types';

/**
 * Laufen und Krafttraining sind getrennte Bereiche: eigenes Ziel, eigener
 * Fokus, je höchstens eine aktive Empfehlung. Hier steht, wie Empfehlungen
 * ihrem Bereich zugeordnet werden und wann eine zweite Empfehlung die Prüfung
 * der ersten verfälschen könnte (Kopplungssperre).
 */
export const AREAS: readonly Area[] = ['running', 'strength'];
export const AREA_LABELS: Record<Area, string> = {
  running: 'Laufen',
  strength: 'Krafttraining',
};

/** Regionen, deren Belastung Laufergebnisse spürbar beeinflussen kann. */
const RUNNING_REGIONS = new Set([
  'hip_flexor',
  'glute',
  'quad',
  'hamstring',
  'adductor',
  'calf_gastroc',
  'calf_soleus',
  'tibialis',
]);

export function isRunRecommendation(
  recommendation: AnyRecommendation,
): recommendation is Recommendation {
  return recommendation.kind === 'calmer_start';
}
export function isStrengthRecommendation(
  recommendation: AnyRecommendation,
): recommendation is StrengthRecommendation {
  return recommendation.kind === 'strength_load';
}

/** Ältere Empfehlungen ohne Feld sind Laufempfehlungen. */
export function recommendationArea(recommendation: AnyRecommendation): Area {
  return isStrengthRecommendation(recommendation) ? 'strength' : 'running';
}

export function isOpen(experiment: Experiment): boolean {
  return experiment.status === 'active' || experiment.status === 'paused';
}

export function activeExperimentFor(
  experiments: Experiment[] | undefined,
  area: 'running',
): Experiment<Recommendation> | undefined;
export function activeExperimentFor(
  experiments: Experiment[] | undefined,
  area: 'strength',
): Experiment<StrengthRecommendation> | undefined;
export function activeExperimentFor(
  experiments: Experiment[] | undefined,
  area: Area,
): Experiment | undefined {
  return experiments?.find(
    item => isOpen(item) && recommendationArea(item.recommendation) === area,
  );
}

/**
 * Welche fremden Bereiche eine Empfehlung beeinflussen kann. Ein ruhigerer
 * Start ändert keine Last; eine Lastempfehlung für die Beine wirkt auf Läufe.
 */
export function influencedAreas(recommendation: AnyRecommendation): Area[] {
  if (isStrengthRecommendation(recommendation)) {
    return recommendation.regions.some(region => RUNNING_REGIONS.has(region))
      ? ['running']
      : [];
  }
  return [];
}

/**
 * Kopplungssperre: Eine zweite Empfehlung darf nicht parallel laufen, wenn sie
 * die Zielgröße der ersten beeinflussen kann oder die erste ihre eigene.
 * Dann bleibt sie „Danach vorgesehen“.
 */
export function couplingGate(
  candidate: AnyRecommendation,
  activeOthers: Experiment[],
): { blocked?: string } {
  const area = recommendationArea(candidate);
  for (const other of activeOthers) {
    if (!isOpen(other)) continue;
    const otherArea = recommendationArea(other.recommendation);
    if (otherArea === area) continue;
    if (influencedAreas(candidate).includes(otherArea)) {
      return {
        blocked: `Könnte die laufende Prüfung im Bereich ${AREA_LABELS[otherArea]} verfälschen. Erst danach.`,
      };
    }
    if (influencedAreas(other.recommendation).includes(area)) {
      return {
        blocked: `Deine laufende Empfehlung im Bereich ${AREA_LABELS[otherArea]} kann dieses Ergebnis beeinflussen. Erst danach.`,
      };
    }
  }
  return {};
}
