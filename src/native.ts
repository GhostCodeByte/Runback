import { NativeModules } from 'react-native';
import type { TrainingFocus } from './domain/focus';
import type {
  RunSummary,
  RunPurpose,
  Sport,
  Experiment,
  Adherence,
} from './domain/types';
import { normalizeSport } from './domain/sport';
import type {
  StrengthSession,
  StrengthState,
  WorkoutTemplate,
} from './domain/strength';
import { summarize } from './domain/strength';
import type { ScheduleState } from './domain/schedule';
import type {
  SorenessReport as CapturedSorenessReport,
  StructuredSorenessItem,
} from './domain/sorenessInput';

export interface Preset {
  id: string;
  name: string;
  purpose: RunPurpose;
  minutes: number;
  cues: boolean;
}
export interface Settings {
  schedule?: ScheduleState;
  goal?: string;
  goalTargetDate?: string;
  trainingFocus?: TrainingFocus | null;
  minutes?: number;
  purpose?: RunPurpose;
  /** Zuletzt gewählte Sportart für die freie Aufzeichnung. */
  sport?: Sport;
  trainingDays?: number[];
  cues?: boolean;
  weather?: boolean;
  showHeartRate?: boolean;
  presets?: Preset[];
  experiments?: Experiment[];
  dismissedRecommendations?: string[];
  adherence?: Record<string, Adherence>;
  postponedUntil?: number;
  [key: string]: unknown;
}
export interface RoutePoint {
  latitude: number;
  longitude: number;
  time?: number;
  gap?: boolean;
}
export interface Run extends RunSummary {
  note?: string;
  route?: RoutePoint[];
  events?: { type?: string; at?: number; message?: string }[];
}
export interface Capabilities {
  gps?: boolean;
  barometer?: boolean;
  accelerometer?: boolean;
  locationPermission?: boolean;
  notificationPermission?: boolean;
  bluetoothPermission?: boolean;
  microphonePermission?: boolean;
  speechRecognition?: boolean;
  healthConnect?: string;
  [key: string]: unknown;
}
export interface SorenessTranscript {
  text: string;
  structured?: StructuredSorenessItem[];
}
export interface AppState {
  runs: Run[];
  recording: Run | null;
  settings: Settings;
  capabilities: Capabilities;
}
const module = NativeModules.Runback;
export async function nativeCall<T = unknown>(
  method: string,
  ...args: unknown[]
): Promise<T> {
  if (!module || typeof module[method] !== 'function') {
    throw new Error('Diese Funktion ist in diesem Build noch nicht verfügbar.');
  }
  const result = await module[method](...args);
  return (typeof result === 'string' ? JSON.parse(result) : result) as T;
}
export function normalizeRun(raw: any): Run {
  const feedback = raw.feedback || {};
  return {
    ...raw,
    startTime: raw.startTime ?? raw.startedAt ?? 0,
    endTime: raw.endTime ?? raw.endedAt ?? 0,
    durationSeconds:
      raw.durationSeconds ?? raw.durationSec ?? (raw.elapsedMs || 0) / 1000,
    distanceMeters: raw.distanceMeters ?? raw.distanceM ?? 0,
    source: raw.source || 'phone',
    purpose: feedback.purpose ?? raw.purpose ?? 'unknown',
    sport: normalizeSport(feedback.sport ?? raw.sport),
    samples: raw.samples ?? raw.rawSampleCount ?? 0,
    sourceVersion: raw.sourceVersion || 'native-v1',
    rpe: raw.rpe ?? feedback.rpe,
    note: raw.note ?? feedback.note,
    route: raw.route ?? raw.geometry,
  };
}
export const native = {
  async state(): Promise<AppState> {
    const raw = await nativeCall<any>('getState');
    return {
      runs: (raw.runs || []).map(normalizeRun),
      recording: raw.recording ? normalizeRun(raw.recording) : null,
      settings: raw.settings || {},
      capabilities: raw.capabilities || {},
    };
  },
  async run(id: string): Promise<Run> {
    return normalizeRun(await nativeCall('getRun', id));
  },
  async saveSettings(settings: Settings) {
    await nativeCall('saveSettings', JSON.stringify(settings));
  },
  async feedback(id: string, feedback: unknown) {
    await nativeCall('updateRunFeedback', id, JSON.stringify(feedback));
  },
  // Krafttraining. Der native Speicher legt die laufende Einheit getrennt von
  // der Historie ab, damit ein bestätigter Satz eine kleine Schreiboperation
  // bleibt.
  async strength(): Promise<StrengthState> {
    return normalizeStrength(await nativeCall<any>('getStrengthState'));
  },
  async saveStrengthTemplates(
    templates: WorkoutTemplate[],
  ): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>('saveStrengthTemplates', JSON.stringify(templates)),
    );
  },
  async saveStrengthSession(session: StrengthSession): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>('saveStrengthSession', JSON.stringify(session)),
    );
  },
  async discardStrengthSession(): Promise<StrengthState> {
    return normalizeStrength(await nativeCall<any>('discardStrengthSession'));
  },
  async finishStrengthSession(
    session: StrengthSession,
  ): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>(
        'finishStrengthSession',
        JSON.stringify(session),
        JSON.stringify(summarize(session)),
      ),
    );
  },
  async strengthSession(id: string): Promise<StrengthSession> {
    return (await nativeCall<any>('getStrengthSession', id)) as StrengthSession;
  },
  async strengthSessions(limit = 100): Promise<StrengthSession[]> {
    const raw = await nativeCall<any>('getStrengthSessions', limit);
    return Array.isArray(raw?.sessions)
      ? (raw.sessions as StrengthSession[])
      : [];
  },
  async deleteStrengthSession(id: string): Promise<StrengthState> {
    return normalizeStrength(
      await nativeCall<any>('deleteStrengthSession', id),
    );
  },
  async sorenessReports(): Promise<CapturedSorenessReport[]> {
    const raw = await nativeCall<any>('getSorenessReports');
    return Array.isArray(raw?.reports)
      ? (raw.reports as CapturedSorenessReport[])
      : [];
  },
  async saveSorenessReport(
    report: CapturedSorenessReport,
  ): Promise<CapturedSorenessReport[]> {
    const raw = await nativeCall<any>(
      'saveSorenessReport',
      JSON.stringify(report),
    );
    return Array.isArray(raw?.reports)
      ? (raw.reports as CapturedSorenessReport[])
      : [];
  },
  async requestSorenessVoicePermissions(): Promise<Capabilities> {
    return nativeCall<Capabilities>('requestSorenessVoicePermissions');
  },
  async transcribeSoreness(): Promise<SorenessTranscript> {
    return nativeCall<SorenessTranscript>('transcribeSoreness');
  },
};

/** Fehlende Felder ergeben einen leeren, benutzbaren Zustand statt eines Fehlers. */
export function normalizeStrength(raw: any): StrengthState {
  return {
    templates: Array.isArray(raw?.templates) ? raw.templates : [],
    active:
      raw?.active && raw.active.id ? (raw.active as StrengthSession) : null,
    history: Array.isArray(raw?.history) ? raw.history : [],
  };
}
