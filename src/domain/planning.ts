import {analyzeRun, assessQuality, formatPace, MODEL_VERSION} from './analysis';
import {uniqueRuns} from './experiments';
import {Experiment, RunAnalysis, RunPurpose, RunSummary} from './types';

export interface RunPreset {
  id: string;
  name: string;
  purpose: RunPurpose;
  durationMinutes: number;
  requiredDeviceIds: string[];
  cuesEnabled: boolean;
  targetPaceSecondsPerKm?: number;
  updatedAt?: number;
}
export const DEFAULT_PRESETS: RunPreset[] = [
  {id: 'easy-30', name: 'Locker · 30 Minuten', purpose: 'easy', durationMinutes: 30, requiredDeviceIds: [], cuesEnabled: false},
  {id: 'long-60', name: 'Lang · 60 Minuten', purpose: 'long', durationMinutes: 60, requiredDeviceIds: [], cuesEnabled: false},
  {id: 'free', name: 'Freier Lauf', purpose: 'free', durationMinutes: 30, requiredDeviceIds: [], cuesEnabled: false},
];
export function validatePreset(preset: RunPreset, connectedDeviceIds: string[], now: number): {ready: boolean; warnings: string[]} {
  const warnings: string[] = [];
  if (!Number.isFinite(preset.durationMinutes) || preset.durationMinutes < 1 || preset.durationMinutes > 360) {warnings.push('Laufdauer muss zwischen 1 und 360 Minuten liegen.');}
  for (const id of preset.requiredDeviceIds) {if (!connectedDeviceIds.includes(id)) {warnings.push(`Gerät ${id} fehlt. Konfiguration vor dem Start anpassen.`);}}
  if (preset.targetPaceSecondsPerKm !== undefined && (!Number.isFinite(preset.targetPaceSecondsPerKm) || preset.targetPaceSecondsPerKm < 120 || preset.targetPaceSecondsPerKm > 1200)) {warnings.push('Tempoziel liegt außerhalb des unterstützten Bereichs.');}
  if (preset.targetPaceSecondsPerKm && (!preset.updatedAt || now - preset.updatedAt > 90 * 86400000)) {warnings.push('Tempoziel ist älter als 90 Tage oder undatiert. Bitte prüfen.');}
  return {ready: warnings.length === 0, warnings};
}

export interface CueRule {id: string; priority: number; cooldownSeconds: number; minimumDeviationPercent: number; direction: 'too_fast' | 'too_slow'; text: string}
export interface CueEvent {ruleId: string; at: number; text: string}
export interface CueInput {now: number; enabled: boolean; purpose: RunPurpose; targetPaceSecondsPerKm?: number; currentPaceSecondsPerKm?: number; history: CueEvent[]; hourlyBudget?: number; rules?: CueRule[]}
export const DEFAULT_CUE_RULES: CueRule[] = [{id: 'ease-start', priority: 100, cooldownSeconds: 300, minimumDeviationPercent: 8, direction: 'too_fast', text: 'Etwas ruhiger laufen.'}];
/** Call on aggregates only. The caller persists events, including across reconnects. */
export function scheduleCue(input: CueInput): CueEvent | undefined {
  if (!input.enabled || !['easy', 'long'].includes(input.purpose) || !Number.isFinite(input.now)) {return undefined;}
  const target = input.targetPaceSecondsPerKm;
  const current = input.currentPaceSecondsPerKm;
  if (!target || !current || !Number.isFinite(target) || !Number.isFinite(current) || target < 120 || current < 120) {return undefined;}
  const recent = input.history.filter(e => e.at > input.now - 3600000 && e.at <= input.now);
  const budget = Math.min(6, Math.max(0, Math.floor(input.hourlyBudget ?? 6)));
  if (recent.length >= budget || input.history.some(e => e.at > input.now) || recent.some(e => input.now - e.at < 60000)) {return undefined;}
  const deviation = (current / target - 1) * 100;
  const candidates = (input.rules ?? DEFAULT_CUE_RULES).filter(rule => Number.isFinite(rule.minimumDeviationPercent) && rule.minimumDeviationPercent > 0 && Number.isFinite(rule.cooldownSeconds) && rule.cooldownSeconds >= 0 && Number.isFinite(rule.priority) && rule.direction === 'too_fast' && deviation <= -rule.minimumDeviationPercent && !input.history.some(e => e.ruleId === rule.id && input.now - e.at < Math.max(60, rule.cooldownSeconds) * 1000));
  const selected = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
  return selected ? {ruleId: selected.id, at: input.now, text: selected.text} : undefined;
}

export interface ModelAvailability {id: string; name: string; enabled: boolean; reason: string}
/** Complex estimates remain gated until a shipped, prospectively validated model exists. */
export function modelAvailability(): ModelAvailability[] {
  return [
    {id: 'pacing', name: 'Pacing & Tempoindex', enabled: true, reason: 'Transparente Ausgangsregeln mit sichtbaren Modellgrenzen.'},
    {id: 'critical-speed', name: 'Critical Speed & D′', enabled: false, reason: 'Zeitlich getrennte Leistungsdaten und Validierung gegen eine einfache Referenz fehlen.'},
    {id: 'fitness', name: 'Fitness & Durability', enabled: false, reason: 'Kein validiertes persönliches Prognosemodell verfügbar.'},
    {id: 'environment', name: 'Persönliche Umweltmodelle', enabled: false, reason: 'Steigung, Hitze und Wind sind noch nicht ausreichend getrennt identifizierbar.'},
    {id: 'race', name: 'Race Simulator & Szenarien', enabled: false, reason: 'Benötigt ein validiertes persönliches Modell samt Gültigkeitsbereich.'},
    {id: 'fuel', name: 'Fuel-Prognose', enabled: false, reason: 'Individuelle Verträglichkeit und validierte Bedarfsannahmen fehlen; kein Glykogen-Messwert.'},
  ];
}

export function compareRuns(a: RunSummary, b: RunSummary): {comparable: boolean; summary: string; limitations: string[]} {
  const limitations: string[] = [];
  if (a.purpose !== b.purpose || ['unknown', 'free', 'intervals', 'race'].includes(a.purpose)) {limitations.push('Kein ausreichend vergleichbarer gleichmäßiger Laufzweck.');}
  if (!assessQuality(a).paceUsable || !assessQuality(b).paceUsable) {limitations.push('Zeit oder Distanz sind nicht ausreichend geeignet.');}
  if (a.canonicalId && a.canonicalId === b.canonicalId || a.id === b.id) {limitations.push('Beide Quellen gehören zum selben Lauf.');}
  if (!a.context || !b.context || a.context.temperatureC === undefined || b.context.temperatureC === undefined || a.context.windMps === undefined || b.context.windMps === undefined) {limitations.push('Wetter fehlt: Keine Rangfolge der äußeren Gesamtanforderung.');}
  else if (Math.abs(a.context.temperatureC - b.context.temperatureC) > 5 || Math.abs(a.context.windMps - b.context.windMps) > 2) {limitations.push('Wetter ist ohne validierte Korrektur nicht ausreichend vergleichbar.');}
  if (!(a.segments?.length && b.segments?.length) || [...a.segments ?? [], ...b.segments ?? []].some(s => s.gradePercent === undefined || Math.abs(s.gradePercent) > 2)) {limitations.push('Streckenprofil fehlt oder liegt außerhalb der einfachen flachen Referenz.');}
  if (limitations.length) {return {comparable: false, summary: 'Keine belastbare Rangfolge. Einzelne Messwerte bleiben sichtbar.', limitations};}
  const faster = a.distanceMeters / a.durationSeconds > b.distanceMeters / b.durationSeconds ? 'Der erste' : 'Der zweite';
  return {comparable: true, summary: `${faster} Lauf hatte das höhere mittlere Tempo. Dauer: ${Math.round(a.durationSeconds / 60)} / ${Math.round(b.durationSeconds / 60)} Minuten. Das ist keine Rangfolge der persönlichen Anstrengung.`, limitations: ['Keine Korrektur für Untergrund, individuellen Windschutz oder Tagesform.']};
}

export type EngineQuestion = 'biggest_problem' | 'why' | 'what_would_change';
export function queryEngine(question: EngineQuestion, runs: RunSummary[], active?: Experiment): {answer: string; model_version: string; runIds: string[]} {
  const latest = uniqueRuns(runs).sort((a, b) => b.startTime - a.startTime || a.id.localeCompare(b.id))[0];
  const analysis: RunAnalysis | undefined = latest ? analyzeRun(latest, active) : undefined;
  const answer = !analysis ? 'Noch keine Läufe vorhanden. Eine wichtigste Trainingsänderung ist nicht beurteilbar.' : question === 'why' ? active?.recommendation.reason ?? analysis.focus : question === 'what_would_change' ? active ? 'Die vorab festgelegte Prüfung geeigneter Folgeläufe, ein geändertes Ziel oder ein Modellfehler. Neue Daten allein ändern dein Arbeitsthema nicht.' : 'Ein passender Laufzweck, mindestens vier geeignete flache Abschnitte und eine belegbare Tempoauffälligkeit können die nächste Einordnung ändern.' : analysis.focus;
  return {answer, model_version: MODEL_VERSION, runIds: latest ? [latest.id] : []};
}
export function nextRunPlan(preset: RunPreset, active?: Experiment): string {
  return `${preset.name}: etwa ${preset.durationMinutes} Minuten.${active?.status === 'active' && active.recommendation.purpose === preset.purpose ? ` ${active.recommendation.action}` : preset.targetPaceSecondsPerKm ? ` Tempoziel ${formatPace(preset.targetPaceSecondsPerKm)} min/km.` : ' Zweck und verfügbaren Umfang beachten.'}`;
}
