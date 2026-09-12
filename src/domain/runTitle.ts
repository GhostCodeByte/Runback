/**
 * Lauftitel für die Oberfläche.
 *
 * Importierte Läufe tragen häufig einen Dateinamen (`activity_1234567.fit`) oder
 * einen Platzhalter des Anbieters („Garmin Lauf“) als Namen. Beides sagt nichts
 * über den Lauf aus. `runTitle` ist die einzige Quelle für Lauftitel und wählt in
 * dieser Reihenfolge:
 *
 * 1. einen sprechenden Namen aus der Quelle,
 * 2. den Trainingszweck, sobald er festgelegt ist,
 * 3. die Tageszeit des Starts.
 *
 * Siehe docs/design-language.md, Abschnitt „Zahlen“.
 */
import type { RunPurpose, Sport } from './types';
import { sportWords, type SportWords } from './sport';

export interface RunPurposeOption {
  value: RunPurpose;
  label: string;
  description: string;
}

export const RUN_PURPOSES: RunPurposeOption[] = [
  { value: 'free', label: 'Frei', description: 'Ohne feste Vorgabe' },
  { value: 'easy', label: 'Locker', description: 'Ruhig und gleichmäßig' },
  { value: 'long', label: 'Lang', description: 'Zeit auf den Beinen' },
  {
    value: 'intervals',
    label: 'Intervalle',
    description: 'Belastung und Erholung im Wechsel',
  },
  { value: 'race', label: 'Wettkampf', description: 'Laufen auf Leistung' },
  { value: 'unknown', label: 'Offen', description: 'Zweck später ergänzen' },
];

export function purposeLabel(value: RunPurpose | undefined): string {
  return RUN_PURPOSES.find(p => p.value === value)?.label || 'Lauf';
}

/** Ein Zweck, der etwas über den Lauf aussagt — „frei“ und „offen“ tun das nicht. */
export function hasNamedPurpose(purpose: RunPurpose | undefined): boolean {
  return purpose !== undefined && purpose !== 'unknown' && purpose !== 'free';
}

const GENERIC_NAMES = new Set([
  'lauf',
  'run',
  'running',
  'activity',
  'aktivitat',
  'workout',
  'training',
  'untitled',
  'unbenannt',
  'export',
  'track',
  'importierter lauf',
  'apple health lauf',
  'garmin lauf',
  'google fit lauf',
  'mi fitness lauf',
  'runback activity',
]);

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, m => ({ ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }[m] as string))
    .replace(/\s+/g, ' ');

/**
 * Erkennt technische Namen: Dateinamen, IDs, Zeitstempel und die Platzhalter der
 * Anbieter. Nur was ein Mensch geschrieben haben könnte, überlebt.
 */
export function isMeaningfulRunName(raw: string | undefined): boolean {
  const name = (raw || '').trim();
  if (name.length < 3 || name.length > 120) {
    return false;
  }
  if (!/\p{L}/u.test(name)) {
    return false;
  }
  if (GENERIC_NAMES.has(normalize(name))) {
    return false;
  }
  // Lange Ziffernfolgen sind IDs oder Zeitstempel, keine Titel.
  if (/\d{6,}/.test(name)) {
    return false;
  }
  // ISO-Zeitstempel und Datumsdateinamen: 2024-05-01, 2024_05_01T07-00-00.
  if (/\d{4}[-_.]\d{2}[-_.]\d{2}/.test(name)) {
    return false;
  }
  // UUIDs.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(name)) {
    return false;
  }
  // Dateinamen-Optik: keine Leerzeichen, aber Unterstriche/Punkte und Ziffern.
  if (!/\s/.test(name) && /[_.]/.test(name) && /\d/.test(name)) {
    return false;
  }
  return true;
}

const DAY_PARTS: {
  fromHour: number;
  part: keyof SportWords['dayParts'];
}[] = [
  { fromHour: 22, part: 'night' },
  { fromHour: 18, part: 'evening' },
  { fromHour: 14, part: 'afternoon' },
  { fromHour: 12, part: 'noon' },
  { fromHour: 10, part: 'forenoon' },
  { fromHour: 5, part: 'morning' },
];

export function dayPartTitle(startTime: number, sport?: Sport): string {
  const words = sportWords(sport);
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return words.noun;
  }
  const hour = new Date(startTime).getHours();
  const part =
    DAY_PARTS.find(candidate => hour >= candidate.fromHour)?.part || 'night';
  return words.dayParts[part];
}

export function runTitle(run: {
  name?: string;
  startTime: number;
  purpose?: RunPurpose;
  sport?: Sport;
}): string {
  if (isMeaningfulRunName(run.name)) {
    return (run.name as string).trim();
  }
  if (hasNamedPurpose(run.purpose)) {
    return purposeLabel(run.purpose);
  }
  return dayPartTitle(run.startTime, run.sport);
}
