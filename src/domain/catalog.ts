import type { Exercise } from './strength';
import { CATALOG_VERSION } from './strength';

/**
 * Startkatalog der Übungen, Version `catalog-v1`.
 *
 * `shares` verteilt die Beanspruchung über Basisregionen aus `regions-v1` und
 * summiert sich auf 1. `eccentric` ist der Exzentrik- und Dehnungsfaktor
 * des Muskelmodells (siehe freshness.ts).
 *
 * Alle Werte sind begründete Ausgangsannahmen aus der Bewegungslehre, keine
 * Messungen. Das Muskelmodell lernt sie später je Nutzer nach; bis dahin sind
 * sie als Annahme zu kennzeichnen.
 */
const entries: Omit<Exercise, 'origin' | 'catalogVersion'>[] = [
  // ── Beine ────────────────────────────────────────────────────────────────
  {
    id: 'barbell_back_squat',
    name: 'Kniebeuge (Langhantel)',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.3,
    shares: { quad: 0.45, glute: 0.25, adductor: 0.1, lower_back: 0.1, abs_upper: 0.1 },
  },
  {
    id: 'barbell_front_squat',
    name: 'Frontkniebeuge',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.3,
    shares: { quad: 0.55, glute: 0.15, abs_upper: 0.15, lower_back: 0.1, adductor: 0.05 },
  },
  {
    id: 'leg_press',
    name: 'Beinpresse',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.0,
    shares: { quad: 0.55, glute: 0.3, adductor: 0.15 },
  },
  {
    id: 'leg_extension',
    name: 'Beinstrecker',
    equipment: 'machine',
    unilateral: false,
    eccentric: 0.9,
    shares: { quad: 1 },
  },
  {
    id: 'romanian_deadlift',
    name: 'Rumänisches Kreuzheben',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.7,
    shares: { hamstring: 0.45, glute: 0.3, lower_back: 0.2, forearm: 0.05 },
  },
  {
    id: 'conventional_deadlift',
    name: 'Kreuzheben',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { hamstring: 0.25, glute: 0.25, lower_back: 0.25, quad: 0.15, forearm: 0.1 },
  },
  {
    id: 'lying_leg_curl',
    name: 'Beinbeuger liegend',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.2,
    shares: { hamstring: 0.9, calf_gastroc: 0.1 },
  },
  {
    id: 'hip_thrust',
    name: 'Hip Thrust',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 0.9,
    shares: { glute: 0.7, hamstring: 0.2, quad: 0.1 },
  },
  {
    id: 'walking_lunge',
    name: 'Ausfallschritt gehend',
    equipment: 'dumbbell',
    unilateral: true,
    eccentric: 1.6,
    shares: { quad: 0.4, glute: 0.35, hamstring: 0.15, adductor: 0.1 },
  },
  {
    id: 'bulgarian_split_squat',
    name: 'Bulgarische Kniebeuge',
    equipment: 'dumbbell',
    unilateral: true,
    eccentric: 1.7,
    shares: { quad: 0.4, glute: 0.35, adductor: 0.15, hip_flexor: 0.1 },
  },
  {
    id: 'standing_calf_raise',
    name: 'Wadenheben stehend',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.4,
    shares: { calf_gastroc: 0.75, calf_soleus: 0.25 },
  },
  {
    id: 'seated_calf_raise',
    name: 'Wadenheben sitzend',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.3,
    shares: { calf_soleus: 0.8, calf_gastroc: 0.2 },
  },
  {
    id: 'back_extension',
    name: 'Rückenstrecken',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.1,
    shares: { lower_back: 0.5, glute: 0.3, hamstring: 0.2 },
  },

  // ── Brust ────────────────────────────────────────────────────────────────
  {
    id: 'barbell_bench_press',
    name: 'Bankdrücken',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { chest_mid: 0.45, chest_upper: 0.15, triceps: 0.25, shoulder_front: 0.15 },
  },
  {
    id: 'incline_bench_press',
    name: 'Schrägbankdrücken',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { chest_upper: 0.45, chest_mid: 0.15, shoulder_front: 0.2, triceps: 0.2 },
  },
  {
    id: 'dumbbell_bench_press',
    name: 'Bankdrücken (Kurzhantel)',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.4,
    shares: { chest_mid: 0.45, chest_upper: 0.15, triceps: 0.2, shoulder_front: 0.2 },
  },
  {
    id: 'cable_chest_fly',
    name: 'Fliegende am Kabel',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.5,
    shares: { chest_mid: 0.6, chest_upper: 0.25, shoulder_front: 0.15 },
  },
  {
    id: 'dip',
    name: 'Dips',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.4,
    shares: { chest_mid: 0.35, triceps: 0.35, shoulder_front: 0.2, chest_upper: 0.1 },
  },
  {
    id: 'push_up',
    name: 'Liegestütz',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.1,
    shares: { chest_mid: 0.4, triceps: 0.25, shoulder_front: 0.2, abs_upper: 0.15 },
  },

  // ── Schultern ────────────────────────────────────────────────────────────
  {
    id: 'overhead_press',
    name: 'Schulterdrücken (Langhantel)',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.1,
    shares: { shoulder_front: 0.4, shoulder_side: 0.2, triceps: 0.25, abs_upper: 0.15 },
  },
  {
    id: 'dumbbell_shoulder_press',
    name: 'Schulterdrücken (Kurzhantel)',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { shoulder_front: 0.4, shoulder_side: 0.25, triceps: 0.25, trap_upper: 0.1 },
  },
  {
    id: 'lateral_raise',
    name: 'Seitheben',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.1,
    shares: { shoulder_side: 0.8, trap_upper: 0.2 },
  },
  {
    id: 'rear_delt_fly',
    name: 'Reverse Fly',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.1,
    shares: { shoulder_rear: 0.6, rhomboid: 0.25, trap_mid: 0.15 },
  },
  {
    id: 'face_pull',
    name: 'Face Pull',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.0,
    shares: { shoulder_rear: 0.45, trap_mid: 0.25, rhomboid: 0.2, trap_upper: 0.1 },
  },

  // ── Rücken ───────────────────────────────────────────────────────────────
  {
    id: 'pull_up',
    name: 'Klimmzug (Obergriff)',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.4,
    shares: { lat: 0.5, biceps: 0.15, rhomboid: 0.15, trap_mid: 0.1, forearm: 0.1 },
  },
  {
    id: 'chin_up',
    name: 'Klimmzug (Untergriff)',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.4,
    shares: { lat: 0.45, biceps: 0.3, rhomboid: 0.1, forearm: 0.15 },
  },
  {
    id: 'lat_pulldown',
    name: 'Latzug',
    equipment: 'machine',
    unilateral: false,
    eccentric: 1.2,
    shares: { lat: 0.55, biceps: 0.2, rhomboid: 0.15, forearm: 0.1 },
  },
  {
    id: 'barbell_row',
    name: 'Langhantelrudern',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { lat: 0.35, rhomboid: 0.2, trap_mid: 0.15, lower_back: 0.15, biceps: 0.15 },
  },
  {
    id: 'seated_cable_row',
    name: 'Rudern am Kabel sitzend',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.2,
    shares: { lat: 0.35, rhomboid: 0.25, trap_mid: 0.2, biceps: 0.2 },
  },
  {
    id: 'single_arm_dumbbell_row',
    name: 'Einarmiges Rudern',
    equipment: 'dumbbell',
    unilateral: true,
    eccentric: 1.3,
    shares: { lat: 0.45, rhomboid: 0.2, trap_mid: 0.15, biceps: 0.2 },
  },
  {
    id: 'straight_arm_pulldown',
    name: 'Überzüge am Kabel',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.4,
    shares: { lat: 0.75, triceps: 0.15, abs_upper: 0.1 },
  },
  {
    id: 'shrug',
    name: 'Nackenziehen',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.0,
    shares: { trap_upper: 0.75, forearm: 0.15, neck: 0.1 },
  },

  // ── Arme ─────────────────────────────────────────────────────────────────
  {
    id: 'barbell_curl',
    name: 'Bizepscurl (Langhantel)',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { biceps: 0.8, forearm: 0.2 },
  },
  {
    id: 'incline_dumbbell_curl',
    name: 'Schrägbank-Curl',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.7,
    shares: { biceps: 0.85, forearm: 0.15 },
  },
  {
    id: 'hammer_curl',
    name: 'Hammercurl',
    equipment: 'dumbbell',
    unilateral: false,
    eccentric: 1.2,
    shares: { biceps: 0.6, forearm: 0.4 },
  },
  {
    id: 'triceps_pushdown',
    name: 'Trizepsdrücken am Kabel',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.0,
    shares: { triceps: 1 },
  },
  {
    id: 'overhead_triceps_extension',
    name: 'Trizepsdrücken über Kopf',
    equipment: 'cable',
    unilateral: false,
    eccentric: 1.6,
    shares: { triceps: 0.9, shoulder_front: 0.1 },
  },
  {
    id: 'skull_crusher',
    name: 'Stirndrücken',
    equipment: 'barbell',
    unilateral: false,
    eccentric: 1.5,
    shares: { triceps: 0.9, forearm: 0.1 },
  },

  // ── Rumpf ────────────────────────────────────────────────────────────────
  {
    id: 'plank',
    name: 'Unterarmstütz',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 0.7,
    shares: { abs_upper: 0.35, abs_lower: 0.3, oblique: 0.2, shoulder_front: 0.15 },
  },
  {
    id: 'hanging_leg_raise',
    name: 'Beinheben hängend',
    equipment: 'bodyweight',
    unilateral: false,
    eccentric: 1.3,
    shares: { abs_lower: 0.45, hip_flexor: 0.3, abs_upper: 0.15, forearm: 0.1 },
  },
  {
    id: 'cable_woodchop',
    name: 'Holzhacker am Kabel',
    equipment: 'cable',
    unilateral: true,
    eccentric: 1.1,
    shares: { oblique: 0.6, abs_upper: 0.25, shoulder_front: 0.15 },
  },
];

export const CATALOG: Exercise[] = entries.map(entry => ({
  ...entry,
  origin: 'catalog' as const,
  catalogVersion: CATALOG_VERSION,
}));

const byId = new Map(CATALOG.map(exercise => [exercise.id, exercise]));

/** Katalogübung oder undefined. Eigene Übungen liegen nicht hier. */
export function catalogExercise(id: string): Exercise | undefined {
  return byId.get(id);
}

/** Namenssuche für die Übungsauswahl, ohne Beachtung von Groß- und Kleinschreibung. */
export function searchCatalog(query: string, limit = 20): Exercise[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return CATALOG.slice(0, limit);
  }
  return CATALOG.filter(exercise =>
    exercise.name.toLowerCase().includes(needle),
  ).slice(0, limit);
}
