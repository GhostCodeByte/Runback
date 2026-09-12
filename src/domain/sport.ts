/**
 * Sportart einer Aufzeichnung.
 *
 * Eine Aufzeichnung ist zuerst einmal nur das: Zeit, Strecke, Sensoren. Die
 * Sportart sagt, wie sie zu lesen ist. Laufen ist die Voreinstellung — ältere
 * Datensätze ohne Feld bleiben Läufe und werden weder migriert noch anders
 * ausgewertet. Auswertungen, die nur für Läufe gelten (Tempo, Fokus,
 * Wochenkilometer), erscheinen bei anderen Sportarten gar nicht statt falsch.
 */
import type { Sport } from './types';

export interface SportOption {
  value: Sport;
  label: string;
}

export const SPORTS: SportOption[] = [
  { value: 'running', label: 'Laufen' },
  { value: 'cycling', label: 'Radfahren' },
];

export const DEFAULT_SPORT: Sport = 'running';

/** Unbekannte oder fehlende Werte gelten als Lauf. */
export function normalizeSport(value: unknown): Sport {
  return SPORTS.some(option => option.value === value)
    ? (value as Sport)
    : DEFAULT_SPORT;
}

/** Nur Läufe tragen Tempo-, Fokus- und Kilometerauswertungen. */
export function isRun(record: { sport?: Sport }): boolean {
  return normalizeSport(record.sport) === 'running';
}

/** Wörter, die in der Oberfläche mit der Sportart wechseln. */
export interface SportWords {
  /** „Laufen“ — Auswahl und Filter. */
  label: string;
  /** „Lauf“ — eine einzelne Aufzeichnung. */
  noun: string;
  /** „Läufe“ */
  plural: string;
  /** „Laufzeit“ */
  durationLabel: string;
  /** „Laufgefühl“ */
  feelingLabel: string;
  /** „Weiterlaufen“ — Abbruch der Rückfrage zum Beenden. */
  continueLabel: string;
  /** Titel nach Tageszeit, Reihenfolge wie DAY_PARTS in runTitle.ts. */
  dayParts: {
    night: string;
    evening: string;
    afternoon: string;
    noon: string;
    forenoon: string;
    morning: string;
  };
}

const WORDS: Record<Sport, SportWords> = {
  running: {
    label: 'Laufen',
    noun: 'Lauf',
    plural: 'Läufe',
    durationLabel: 'Laufzeit',
    feelingLabel: 'Laufgefühl',
    continueLabel: 'Weiterlaufen',
    dayParts: {
      night: 'Nachtlauf',
      evening: 'Abendlauf',
      afternoon: 'Nachmittagslauf',
      noon: 'Mittagslauf',
      forenoon: 'Vormittagslauf',
      morning: 'Morgenlauf',
    },
  },
  cycling: {
    label: 'Radfahren',
    noun: 'Radfahrt',
    plural: 'Radfahrten',
    durationLabel: 'Fahrzeit',
    feelingLabel: 'Fahrgefühl',
    continueLabel: 'Weiterfahren',
    dayParts: {
      night: 'Nachtfahrt',
      evening: 'Abendfahrt',
      afternoon: 'Nachmittagsfahrt',
      noon: 'Mittagsfahrt',
      forenoon: 'Vormittagsfahrt',
      morning: 'Morgenfahrt',
    },
  },
};

export function sportWords(sport: Sport | undefined): SportWords {
  return WORDS[normalizeSport(sport)];
}

export function sportLabel(sport: Sport | undefined): string {
  return sportWords(sport).label;
}

/** „Lauf“ bzw. „Radfahrt“ — die Bezeichnung einer einzelnen Aufzeichnung. */
export function sportNoun(sport: Sport | undefined): string {
  return sportWords(sport).noun;
}

/**
 * Läufe werden in min/km gelesen, Radfahrten in km/h. Beides ist dieselbe
 * Messung, nur anders herum — deshalb entscheidet die Sportart, nicht die Zahl.
 */
export function usesPace(sport: Sport | undefined): boolean {
  return normalizeSport(sport) === 'running';
}

/** Ø Geschwindigkeit in km/h; ohne belastbare Strecke oder Zeit `null`. */
export function speedKmh(record: {
  distanceMeters: number;
  durationSeconds: number;
}): number | null {
  if (
    !Number.isFinite(record.distanceMeters) ||
    !Number.isFinite(record.durationSeconds) ||
    record.distanceMeters < 20 ||
    record.durationSeconds <= 0
  ) {
    return null;
  }
  return record.distanceMeters / 1000 / (record.durationSeconds / 3600);
}
