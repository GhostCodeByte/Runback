import { NativeModules } from 'react-native';
import type {
  RunSummary,
  RunPurpose,
  Experiment,
  Adherence,
} from './domain/types';

export interface Preset {
  id: string;
  name: string;
  purpose: RunPurpose;
  minutes: number;
  cues: boolean;
}
export interface Settings {
  goal?: string;
  minutes?: number;
  purpose?: RunPurpose;
  trainingDays?: number[];
  cues?: boolean;
  weather?: boolean;
  showHeartRate?: boolean;
  presets?: Preset[];
  experiments?: Experiment[];
  dismissedRecommendations?: string[];
  adherence?: Record<string, Adherence>;
  postponedUntil?: number;
  onboardedAt?: number;
  onboardingSkipped?: boolean;
  [key: string]: unknown;
}
export interface RoutePoint {
  latitude: number;
  longitude: number;
  time?: number;
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
  healthConnect?: string;
  [key: string]: unknown;
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
};
