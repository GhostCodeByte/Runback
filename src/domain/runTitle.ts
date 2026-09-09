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
 * Siehe docs/design-language.md § 13.
 */
import type { RunPurpose } from './types';

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

const DAY_PARTS: { fromHour: number; title: string }[] = [
  { fromHour: 22, title: 'Nachtlauf' },
  { fromHour: 18, title: 'Abendlauf' },
  { fromHour: 14, title: 'Nachmittagslauf' },
  { fromHour: 12, title: 'Mittagslauf' },
  { fromHour: 10, title: 'Vormittagslauf' },
  { fromHour: 5, title: 'Morgenlauf' },
];

export function dayPartTitle(startTime: number): string {
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return 'Lauf';
  }
  const hour = new Date(startTime).getHours();
  return DAY_PARTS.find(part => hour >= part.fromHour)?.title || 'Nachtlauf';
}

export function runTitle(run: {
  name?: string;
  startTime: number;
  purpose?: RunPurpose;
}): string {
  if (isMeaningfulRunName(run.name)) {
    return (run.name as string).trim();
  }
  if (hasNamedPurpose(run.purpose)) {
    return purposeLabel(run.purpose);
  }
  return dayPartTitle(run.startTime);
}
