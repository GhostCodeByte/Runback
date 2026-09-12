export const FOCUS_VERSION = 'focus-v1';
export const FOCUS_TYPES = [
  { value: 'endurance', label: 'Ausdauer aufbauen' },
  { value: 'speed', label: 'Schneller werden' },
  { value: 'injury_free', label: 'Verletzungsfrei bleiben' },
  { value: 'habit', label: 'Gewohnheit aufbauen' },
  { value: 'fitness', label: 'Allgemeine Fitness' },
] as const;
export type FocusKind = (typeof FOCUS_TYPES)[number]['value'];
export interface TrainingFocus {
  version: typeof FOCUS_VERSION;
  kind: FocusKind;
  label: string;
}
export function focusLabel(focus?: TrainingFocus | null): string {
  return (
    focus?.label ||
    FOCUS_TYPES.find(item => item.value === focus?.kind)?.label ||
    'Noch kein Fokus'
  );
}
/** A suggestion needs a goal; the user's focus label is never interpreted. */
export function suggestedFocus(goal: string): FocusKind | undefined {
  if (!goal.trim()) return undefined;
  return /unter|schneller|bestzeit/i.test(goal) ? 'speed' : 'endurance';
}
