/**
 * Muskelregionen des Muskelmodells, Version `regions-v1`.
 *
 * Kennungen sind stabil. Eine Region wird nie umbenannt, nur ergänzt oder als
 * veraltet markiert. Übungen tragen ihre Anteile auf den Basisnamen; die
 * Verteilung auf Seiten entsteht erst beim Rechnen, damit einseitige Übungen
 * seitenrichtig eingehen können.
 */
export const REGIONS_VERSION = 'regions-v1';

/** Basisname einer Region, ohne Seite. */
export type RegionBase =
  | 'neck'
  | 'trap_upper'
  | 'trap_mid'
  | 'rhomboid'
  | 'lat'
  | 'lower_back'
  | 'shoulder_front'
  | 'shoulder_side'
  | 'shoulder_rear'
  | 'chest_upper'
  | 'chest_mid'
  | 'biceps'
  | 'triceps'
  | 'forearm'
  | 'abs_upper'
  | 'abs_lower'
  | 'oblique'
  | 'hip_flexor'
  | 'glute'
  | 'quad'
  | 'hamstring'
  | 'adductor'
  | 'calf_gastroc'
  | 'calf_soleus'
  | 'tibialis';

export type Side = 'l' | 'r';

/** Konkrete Region, etwa `quad_l` oder `neck`. */
export type RegionId = string;

export interface RegionDefinition {
  base: RegionBase;
  label: string;
  /** Seitig geführt, ergibt zwei konkrete Regionen. */
  sided: boolean;
  /** Von vorn oder von hinten sichtbar. Für die Körperfigur. */
  view: 'front' | 'back';
}

export const REGIONS: RegionDefinition[] = [
  { base: 'neck', label: 'Nacken', sided: false, view: 'back' },
  { base: 'trap_upper', label: 'Trapez oben', sided: true, view: 'back' },
  { base: 'trap_mid', label: 'Trapez mitte', sided: false, view: 'back' },
  { base: 'rhomboid', label: 'Rautenmuskel', sided: false, view: 'back' },
  { base: 'lat', label: 'Latissimus', sided: true, view: 'back' },
  { base: 'lower_back', label: 'Unterer Rücken', sided: true, view: 'back' },
  { base: 'shoulder_front', label: 'Schulter vorn', sided: true, view: 'front' },
  { base: 'shoulder_side', label: 'Schulter seitlich', sided: true, view: 'front' },
  { base: 'shoulder_rear', label: 'Schulter hinten', sided: true, view: 'back' },
  { base: 'chest_upper', label: 'Brust oben', sided: true, view: 'front' },
  { base: 'chest_mid', label: 'Brust mitte', sided: true, view: 'front' },
  { base: 'biceps', label: 'Bizeps', sided: true, view: 'front' },
  { base: 'triceps', label: 'Trizeps', sided: true, view: 'back' },
  { base: 'forearm', label: 'Unterarm', sided: true, view: 'front' },
  { base: 'abs_upper', label: 'Bauch oben', sided: false, view: 'front' },
  { base: 'abs_lower', label: 'Bauch unten', sided: false, view: 'front' },
  { base: 'oblique', label: 'Seitlicher Bauch', sided: true, view: 'front' },
  { base: 'hip_flexor', label: 'Hüftbeuger', sided: true, view: 'front' },
  { base: 'glute', label: 'Gesäß', sided: true, view: 'back' },
  { base: 'quad', label: 'Quadrizeps', sided: true, view: 'front' },
  { base: 'hamstring', label: 'Ischiocrurale', sided: true, view: 'back' },
  { base: 'adductor', label: 'Adduktoren', sided: true, view: 'front' },
  { base: 'calf_gastroc', label: 'Wade (Zwillingsmuskel)', sided: true, view: 'back' },
  { base: 'calf_soleus', label: 'Wade (Schollenmuskel)', sided: true, view: 'back' },
  { base: 'tibialis', label: 'Schienbeinmuskel', sided: true, view: 'front' },
];

const byBase = new Map(REGIONS.map(region => [region.base, region]));

export function regionDefinition(base: RegionBase): RegionDefinition {
  const definition = byBase.get(base);
  if (!definition) {
    throw new Error(`Unbekannte Muskelregion: ${base}`);
  }
  return definition;
}

/** Konkrete Kennung, etwa `quad_l`. Nicht seitige Regionen ignorieren die Seite. */
export function regionId(base: RegionBase, side?: Side): RegionId {
  return regionDefinition(base).sided && side ? `${base}_${side}` : base;
}

/** Alle konkreten Regionen, seitige zweifach. 45 Einträge in `regions-v1`. */
export function allRegionIds(): RegionId[] {
  return REGIONS.flatMap(region =>
    region.sided ? [`${region.base}_l`, `${region.base}_r`] : [region.base],
  );
}

/** Anzeigename einer konkreten Region, mit Seite, wenn sie geführt wird. */
export function regionLabel(id: RegionId): string {
  const [, base, side] = /^(.*?)(?:_(l|r))?$/.exec(id) || [];
  const definition = base ? byBase.get(base as RegionBase) : undefined;
  if (!definition) {
    return id;
  }
  if (!side) {
    return definition.label;
  }
  return `${definition.label} ${side === 'l' ? 'links' : 'rechts'}`;
}

/**
 * Muskelanteile einer Übung. Werte sind Anteile über Basisregionen und summieren
 * sich auf 1. Ein fehlender Eintrag bedeutet: nicht nennenswert beteiligt.
 */
export type MuscleShares = Partial<Record<RegionBase, number>>;

/** Summiert sich auf 1 (± Toleranz) und enthält nur bekannte Regionen. */
export function sharesAreValid(shares: MuscleShares): boolean {
  const entries = Object.entries(shares) as [RegionBase, number][];
  if (!entries.length) {
    return false;
  }
  if (entries.some(([base, value]) => !byBase.has(base) || !(value > 0))) {
    return false;
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return Math.abs(total - 1) < 0.005;
}
