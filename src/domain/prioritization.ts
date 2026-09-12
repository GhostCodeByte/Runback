import { BROAD_FOCUS, type FocusKind } from './focus';

export const RELEVANCE_VERSION = 'relevance-v2';
export type ActionClass =
  | 'calmer_start'
  | 'heart_rate'
  | 'cadence'
  | 'volume'
  | 'technique'
  | 'taper'
  | 'strength_load';
/**
 * Redaktionelle Gewichte 0–5 je Handlungsklasse und Fokus-Art. `null` ist eine
 * harte Sperre. Fehlt eine Fokus-Art, zählt sie wie „kein Fokus“ (0). Die
 * Gewichte werden nicht aus Nutzerdaten gelernt.
 */
const weights: Record<
  ActionClass,
  Partial<Record<FocusKind, number | null>>
> = {
  calmer_start: { endurance: 5, speed: 3, injury_free: 3, habit: 4 },
  heart_rate: { endurance: 4, speed: 3, injury_free: 2, habit: 1 },
  cadence: { endurance: 2, speed: 4, injury_free: 1, habit: 1 },
  volume: { endurance: 5, speed: 4, injury_free: null, habit: 3 },
  technique: { endurance: 2, speed: 4, injury_free: 1, habit: 1 },
  taper: { endurance: 2, speed: 3, injury_free: 3, habit: 0 },
  strength_load: {
    strength: 5,
    muscle: 4,
    injury_free: 3,
    habit: 2,
    endurance: 1,
    speed: 1,
  },
};
export function relevance(
  action: ActionClass,
  focus?: FocusKind,
  targetDate?: string,
  today?: string,
): { weight: number; blocked?: string } {
  const table = weights[action];
  // `null` ist eine Sperre und darf nicht zu 0 werden.
  const weight =
    focus && !BROAD_FOCUS.includes(focus) && focus in table
      ? (table[focus] as number | null)
      : 0;
  if (weight === null)
    return {
      weight: 0,
      blocked:
        'Bei Fokus „verletzungsfrei bleiben“ sind Empfehlungen für mehr Umfang gesperrt.',
    };
  if (targetDate && today) {
    const days = (Date.parse(targetDate) - Date.parse(today)) / 86400000;
    if (Number.isFinite(days) && days >= 0) {
      if (action === 'technique' && days <= 21)
        return {
          weight,
          blocked: 'So kurz vor deinem Ziel ist ein Technikumbau gesperrt.',
        };
      if (action === 'taper' && days > 84)
        return {
          weight,
          blocked: 'Für die Entlastung vor deinem Ziel ist es noch zu früh.',
        };
    }
  }
  return { weight };
}
