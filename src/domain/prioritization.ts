import type { FocusKind } from './focus';

export const RELEVANCE_VERSION = 'relevance-v1';
export type ActionClass =
  | 'calmer_start'
  | 'heart_rate'
  | 'cadence'
  | 'volume'
  | 'technique'
  | 'taper';
const weights: Record<
  ActionClass,
  readonly [number, number, number | null, number]
> = {
  calmer_start: [5, 3, 3, 4],
  heart_rate: [4, 3, 2, 1],
  cadence: [2, 4, 1, 1],
  volume: [5, 4, null, 3],
  technique: [2, 4, 1, 1],
  taper: [2, 3, 3, 0],
};
const columns = { endurance: 0, speed: 1, injury_free: 2, habit: 3 } as const;
export function relevance(
  action: ActionClass,
  focus?: FocusKind,
  targetDate?: string,
  today?: string,
): { weight: number; blocked?: string } {
  const weight =
    focus && focus !== 'fitness' ? weights[action][columns[focus]] : 0;
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
