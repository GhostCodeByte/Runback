import type { RunPurpose } from './types';

export const RUN_TARGET_VERSION = 1 as const;

export type RunTargetOutput = 'voice' | 'vibration' | 'both';

export type RunTarget =
  | { kind: 'none'; version: typeof RUN_TARGET_VERSION }
  | {
      kind: 'pace';
      version: typeof RUN_TARGET_VERSION;
      secondsPerKm: number;
      mode: 'ceiling' | 'range';
      output: RunTargetOutput;
    }
  | {
      kind: 'heart_rate';
      version: typeof RUN_TARGET_VERSION;
      minBpm: number;
      maxBpm: number;
      output: RunTargetOutput;
    };

export const NO_RUN_TARGET: RunTarget = {
  kind: 'none',
  version: RUN_TARGET_VERSION,
};

const validOutput = (value: unknown): value is RunTargetOutput =>
  value === 'voice' || value === 'vibration' || value === 'both';

/** Alte oder unvollständige Einstellungen aktivieren niemals still Hinweise. */
export function normalizeRunTarget(value: unknown): RunTarget {
  if (!value || typeof value !== 'object') return NO_RUN_TARGET;
  const raw = value as Record<string, unknown>;
  if (raw.version !== RUN_TARGET_VERSION) return NO_RUN_TARGET;
  if (raw.kind === 'pace') {
    const secondsPerKm = Number(raw.secondsPerKm);
    if (
      Number.isFinite(secondsPerKm) &&
      secondsPerKm >= 120 &&
      secondsPerKm <= 1200 &&
      (raw.mode === 'ceiling' || raw.mode === 'range') &&
      validOutput(raw.output)
    ) {
      return {
        kind: 'pace',
        version: RUN_TARGET_VERSION,
        secondsPerKm,
        mode: raw.mode,
        output: raw.output,
      };
    }
  }
  if (raw.kind === 'heart_rate') {
    const minBpm = Number(raw.minBpm);
    const maxBpm = Number(raw.maxBpm);
    if (
      Number.isFinite(minBpm) &&
      Number.isFinite(maxBpm) &&
      minBpm >= 40 &&
      maxBpm <= 240 &&
      maxBpm - minBpm >= 5 &&
      validOutput(raw.output)
    ) {
      return {
        kind: 'heart_rate',
        version: RUN_TARGET_VERSION,
        minBpm,
        maxBpm,
        output: raw.output,
      };
    }
  }
  return NO_RUN_TARGET;
}

export function parsePaceInput(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return seconds >= 120 && seconds <= 1200 ? seconds : null;
}

export function formatTargetPace(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(
    2,
    '0',
  )} /km`;
}

export function runTargetLabel(target: RunTarget): string {
  if (target.kind === 'pace') {
    return target.mode === 'ceiling'
      ? `Nicht schneller als ${formatTargetPace(target.secondsPerKm)}`
      : formatTargetPace(target.secondsPerKm);
  }
  if (target.kind === 'heart_rate') {
    return `${target.minBpm}–${target.maxBpm} bpm`;
  }
  return 'Ohne Ziel';
}

/** Locker und lang bleiben Obergrenzen; ein Pacemaker darf den Zweck nicht verdrängen. */
export function targetForPurpose(
  target: RunTarget,
  purpose: RunPurpose,
): RunTarget {
  if (target.kind !== 'pace') return target;
  return {
    ...target,
    mode: purpose === 'easy' || purpose === 'long' ? 'ceiling' : 'range',
  };
}
