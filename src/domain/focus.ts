import type { Area } from './types';

export const FOCUS_VERSION = 'focus-v1';
/** Fokus-Arten fürs Laufen. Die Priorisierung rechnet mit `value`. */
export const FOCUS_TYPES = [
  { value: 'endurance', label: 'Ausdauer aufbauen' },
  { value: 'speed', label: 'Schneller werden' },
  { value: 'injury_free', label: 'Verletzungsfrei bleiben' },
  { value: 'habit', label: 'Gewohnheit aufbauen' },
  { value: 'fitness', label: 'Allgemeine Fitness' },
] as const;
/** Fokus-Arten fürs Krafttraining. Eigener Bereich, eigene Liste. */
export const STRENGTH_FOCUS_TYPES = [
  { value: 'strength', label: 'Stärker werden' },
  { value: 'muscle', label: 'Muskeln aufbauen' },
  { value: 'injury_free', label: 'Verletzungsfrei bleiben' },
  { value: 'habit', label: 'Gewohnheit aufbauen' },
  { value: 'fitness', label: 'Allgemeine Fitness' },
] as const;
export type FocusKind =
  | (typeof FOCUS_TYPES)[number]['value']
  | (typeof STRENGTH_FOCUS_TYPES)[number]['value'];
/** Breite Fokusse liefern keinen Maßstab; sie zählen wie „kein Fokus“. */
export const BROAD_FOCUS: readonly FocusKind[] = ['fitness'];
export interface TrainingFocus {
  version: typeof FOCUS_VERSION;
  kind: FocusKind;
  label: string;
  /** Fehlt das Feld, gehört der Fokus zum Laufen. */
  area?: Area;
}
export function focusTypesFor(
  area: Area,
): readonly { value: FocusKind; label: string }[] {
  return area === 'strength' ? STRENGTH_FOCUS_TYPES : FOCUS_TYPES;
}
export function focusLabel(focus?: TrainingFocus | null): string {
  return (
    focus?.label ||
    [...FOCUS_TYPES, ...STRENGTH_FOCUS_TYPES].find(
      item => item.value === focus?.kind,
    )?.label ||
    'Noch kein Fokus'
  );
}
/** A suggestion needs a goal; the user's focus label is never interpreted. */
export function suggestedFocus(
  goal: string,
  area: Area = 'running',
): FocusKind | undefined {
  if (!goal.trim()) return undefined;
  if (area === 'strength') {
    return /kg|schwer|stärker|kraft|max/i.test(goal) ? 'strength' : 'muscle';
  }
  return /unter|schneller|bestzeit/i.test(goal) ? 'speed' : 'endurance';
}
