import type {
  GaitDevice,
  GaitPlacement,
  GaitValues,
  RunSummary,
} from './types';
import {
  RECENT_MAX_RUNS,
  RECENT_MIN_RUNS,
  RECENT_WINDOW_DAYS,
  formatSignedPercent,
  type Rating,
} from './insights';

/**
 * Laufstil auf der Detailseite: Sätze und Vergleiche aus den Laufstil-Werten,
 * die Kotlin je Gerät gerechnet hat (`Gait`, `GaitSummary`). Alles hier ist
 * Beobachtung, keine Empfehlung und keine Effizienzzahl. Verglichen wird nur
 * mit eigenen Läufen, bei denen dasselbe Gerät am selben Ort saß; ein
 * Trageort liefert nur, was er messen kann. Die Wortgrenzen (gleichmäßig,
 * quer, wenig Auf und Ab) sind grobe Orientierung und mit versioniert.
 */
export const GAIT_VIEW_VERSION = 'gait-view-1';

/** Auswahl beim Start; die Uhr sitzt immer am Handgelenk. */
export const PHONE_PLACEMENTS: { value: GaitPlacement; label: string }[] = [
  { value: 'hand', label: 'In der Hand' },
  { value: 'waist', label: 'Am Gürtel' },
  { value: 'pocket', label: 'In der Tasche' },
  { value: 'upper_arm', label: 'Am Oberarm' },
  { value: 'chest', label: 'Am Oberkörper' },
  { value: 'unknown', label: 'Weiß nicht' },
];
export function placementWords(placement: GaitPlacement): string {
  return {
    hand: 'in der Hand',
    waist: 'am Gürtel',
    pocket: 'in der Tasche',
    upper_arm: 'am Oberarm',
    chest: 'am Oberkörper',
    wrist: 'am Handgelenk',
    unknown: 'ohne Angabe',
  }[placement];
}
export function normalizePlacement(value: unknown): GaitPlacement {
  return PHONE_PLACEMENTS.some(item => item.value === value)
    ? (value as GaitPlacement)
    : 'unknown';
}
const isArm = (placement: GaitPlacement) =>
  placement === 'hand' || placement === 'upper_arm' || placement === 'wrist';
const isTrunk = (placement: GaitPlacement) =>
  placement === 'waist' || placement === 'chest';

export type GaitDeviceKey = 'phone' | 'watch';
export type GaitMetric =
  | 'armSwingDeg'
  | 'crossShare'
  | 'regularity'
  | 'oscillationCm'
  | 'verticalRatio'
  | 'contactMs'
  | 'impactG'
  | 'brakingMps'
  | 'leanDeg';

/** Mindestens eine Minute mit erkanntem Schritt. */
const MIN_USABLE_WINDOWS = 6;
/** Ab so vielen Fenstern „ziemlich sicher“ (fünf Minuten). */
const CONFIDENT_WINDOWS = 30;

/**
 * Richtung und Schwelle (Prozent) je Wert. `neutral`: mehr ist weder gut
 * noch schlecht, nur anders — dann keine Farbe.
 */
const RULES: Record<
  GaitMetric,
  { direction: 'lower' | 'higher' | 'neutral'; threshold: number }
> = {
  armSwingDeg: { direction: 'neutral', threshold: 5 },
  crossShare: { direction: 'lower', threshold: 15 },
  regularity: { direction: 'higher', threshold: 4 },
  oscillationCm: { direction: 'lower', threshold: 5 },
  verticalRatio: { direction: 'lower', threshold: 5 },
  contactMs: { direction: 'lower', threshold: 3 },
  impactG: { direction: 'lower', threshold: 5 },
  brakingMps: { direction: 'lower', threshold: 8 },
  leanDeg: { direction: 'neutral', threshold: 15 },
};

const DAY = 24 * 60 * 60 * 1000;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const number = (value: number, digits = 0) =>
  value.toFixed(digits).replace('.', ',');

/** Gerät mit genug gelaufenen Fenstern, dessen Signal zum Trageort passt. */
export function signalMismatch(device: GaitDevice | undefined): boolean {
  return Boolean(
    device &&
      device.checked >= MIN_USABLE_WINDOWS &&
      device.mismatch / device.checked > 0.5,
  );
}
export function usableDevice(
  device: GaitDevice | undefined,
): GaitDevice | undefined {
  return device &&
    device.usable >= MIN_USABLE_WINDOWS &&
    !signalMismatch(device)
    ? device
    : undefined;
}

/**
 * Auf und Ab im Verhältnis zur Schrittlänge (Prozent). Schrittlänge aus dem
 * Lauftempo der RUN-Phasen und der Kadenz desselben Geräts; ohne beides
 * unbekannt.
 */
export function verticalRatio(
  run: RunSummary,
  device: GaitValues | undefined,
): number | undefined {
  const running = run.phaseMetrics?.running;
  if (
    !device ||
    !finite(device.oscillationCm) ||
    !finite(device.cadence) ||
    device.cadence <= 0 ||
    !running ||
    running.seconds < 60 ||
    running.meters <= 0
  )
    return undefined;
  const stepMeters = running.meters / running.seconds / (device.cadence / 60);
  return stepMeters > 0 ? device.oscillationCm / stepMeters : undefined;
}

function metricValue(
  metric: GaitMetric,
  run: RunSummary,
  device: GaitDevice,
): number | undefined {
  if (metric === 'verticalRatio') return verticalRatio(run, device);
  const value = device[metric];
  return finite(value) ? value : undefined;
}

export interface GaitComparison {
  rating: Rating;
  /** „+8 %“ bzw. bei neutralen Werten „8 % mehr als sonst“. */
  delta: string;
  reference: number;
  count: number;
}
/**
 * Gegen den Median der letzten Läufe (120 Tage, höchstens acht), in denen
 * dasselbe Gerät am selben Ort saß. Unter drei solchen Läufen kein Vergleich.
 */
export function compareGait(
  run: RunSummary,
  history: RunSummary[],
  key: GaitDeviceKey,
  metric: GaitMetric,
): GaitComparison | undefined {
  const own = usableDevice(run.gait?.[key]);
  if (!own) return undefined;
  const value = metricValue(metric, run, own);
  if (value === undefined) return undefined;
  const references = history
    .filter(
      other =>
        other.id !== run.id &&
        (other.sport ?? 'running') === 'running' &&
        other.startTime < run.startTime &&
        run.startTime - other.startTime <= RECENT_WINDOW_DAYS * DAY,
    )
    .sort((a, b) => b.startTime - a.startTime)
    .map(other => {
      const device = usableDevice(other.gait?.[key]);
      return device && device.placement === own.placement
        ? metricValue(metric, other, device)
        : undefined;
    })
    .filter(finite)
    .slice(0, RECENT_MAX_RUNS);
  const reference = median(references);
  if (
    reference === undefined ||
    reference === 0 ||
    references.length < RECENT_MIN_RUNS
  )
    return undefined;
  const deltaPercent = (value / reference - 1) * 100;
  const rule = RULES[metric];
  if (rule.direction === 'neutral') {
    const size = Math.round(Math.abs(deltaPercent));
    return {
      rating: 'same',
      delta:
        size < rule.threshold
          ? 'wie sonst'
          : `${size} % ${deltaPercent > 0 ? 'mehr' : 'weniger'} als sonst`,
      reference,
      count: references.length,
    };
  }
  const good = rule.direction === 'higher' ? deltaPercent : -deltaPercent;
  const rating: Rating =
    good >= rule.threshold
      ? 'better'
      : good > -rule.threshold
      ? 'same'
      : good > -rule.threshold * 2
      ? 'slightly_worse'
      : 'worse';
  return {
    rating,
    delta: formatSignedPercent(deltaPercent),
    reference,
    count: references.length,
  };
}

export function regularityWord(value: number): string {
  if (value >= 0.85) return 'sehr gleichmäßig';
  if (value >= 0.7) return 'gleichmäßig';
  return 'unruhig';
}
export function crossWord(share: number): string {
  if (share < 0.2) return 'eher nach vorn';
  if (share < 0.35) return 'etwas quer';
  return 'deutlich quer vor dem Körper';
}
export function bounceWord(ratioPercent: number): string {
  if (ratioPercent < 7) return 'wenig';
  if (ratioPercent <= 9) return 'mittel';
  return 'viel';
}

export interface GaitLine {
  metric: GaitMetric;
  device: GaitDeviceKey;
  title: string;
  subtitle: string;
  comparison?: GaitComparison;
}
export interface GaitInsight {
  version: string;
  /** Die auffälligste Beobachtung in einem Satz. */
  headline?: string;
  /** Signal passt nicht zum Trageort; die Werte dieses Geräts fehlen deshalb. */
  notice?: string;
  lines: GaitLine[];
  /** Letztes gegen erstes Drittel, als kurze Aufzählung. */
  late?: string;
  details: string[];
}

const deviceWord = (key: GaitDeviceKey) => (key === 'phone' ? 'Handy' : 'Uhr');

/** Veränderung vom ersten zum letzten Drittel in Prozent. */
function thirdChange(
  device: GaitDevice | undefined,
  key: keyof GaitValues,
): number | undefined {
  const early = device?.early?.[key];
  const late = device?.late?.[key];
  return finite(early) && finite(late) && early !== 0
    ? (late / early - 1) * 100
    : undefined;
}

export function gaitInsight(
  run: RunSummary,
  history: RunSummary[],
): GaitInsight | undefined {
  const gait = run.gait;
  if (!gait || (run.sport ?? 'running') !== 'running') return undefined;
  const devices: { key: GaitDeviceKey; device: GaitDevice }[] = [];
  let notice: string | undefined;
  (['phone', 'watch'] as GaitDeviceKey[]).forEach(key => {
    const raw = gait[key];
    if (signalMismatch(raw) && key === 'phone' && raw) {
      notice = `Das Handy-Signal passt nicht zu „${placementWords(
        raw.placement,
      )}“ — wähl beim nächsten Start den Ort, an dem es wirklich steckt.`;
    }
    const device = usableDevice(raw);
    if (device) devices.push({ key, device });
  });
  if (!devices.length && !notice) return undefined;

  const lines: GaitLine[] = [];
  const line = (
    key: GaitDeviceKey,
    metric: GaitMetric,
    title: string,
    subtitle: string,
  ) =>
    lines.push({
      metric,
      device: key,
      title,
      subtitle,
      comparison: compareGait(run, history, key, metric),
    });
  const armDevices = devices.filter(
    ({ device }) => isArm(device.placement) && finite(device.armSwingDeg),
  );
  const bothArms = armDevices.length === 2;
  const armName = (key: GaitDeviceKey) =>
    key === 'phone' ? 'Arm mit Handy' : 'Arm mit Uhr';

  // Rhythmus einmal, vom Gerät, das am ehesten an jedem Lauf dabei ist.
  const primary = devices.find(item => item.key === 'watch') ?? devices[0];
  if (primary && finite(primary.device.regularity)) {
    line(
      primary.key,
      'regularity',
      'Schrittrhythmus',
      regularityWord(primary.device.regularity),
    );
  }
  armDevices.forEach(({ key, device }) => {
    line(
      key,
      'armSwingDeg',
      'Armschwung',
      `${bothArms ? `${armName(key)} · ` : ''}${Math.round(
        device.armSwingDeg!,
      )}° von vorn bis hinten`,
    );
  });
  armDevices.forEach(({ key, device }) => {
    if (!finite(device.crossShare)) return;
    line(
      key,
      'crossShare',
      'Schwungrichtung',
      `${bothArms ? `${armName(key)} · ` : ''}${crossWord(device.crossShare)}`,
    );
  });
  const trunk = devices.find(({ device }) => isTrunk(device.placement));
  if (trunk) {
    const { key, device } = trunk;
    const ratio = verticalRatio(run, device);
    if (finite(device.oscillationCm)) {
      line(
        key,
        ratio !== undefined ? 'verticalRatio' : 'oscillationCm',
        'Auf und Ab',
        ratio !== undefined
          ? `${number(device.oscillationCm, 1)} cm · ${number(
              ratio,
              1,
            )} % der Schrittlänge · ${bounceWord(ratio)}`
          : `${number(device.oscillationCm, 1)} cm`,
      );
    }
    if (finite(device.contactMs))
      line(
        key,
        'contactMs',
        'Bodenkontakt',
        `ungefähr ${Math.round(device.contactMs)} ms je Schritt`,
      );
    if (finite(device.impactG))
      line(
        key,
        'impactG',
        'Aufkommen',
        `${number(device.impactG, 1)} g Spitze je Schritt`,
      );
    if (finite(device.brakingMps))
      line(
        key,
        'brakingMps',
        'Abbremsen',
        `${number(device.brakingMps, 2)} m/s Tempo-Schwankung je Schritt`,
      );
    if (finite(device.leanDeg))
      line(
        key,
        'leanDeg',
        'Vorlage',
        `etwa ${Math.round(device.leanDeg)}° nach vorn gegenüber dem Stehen`,
      );
  }

  // Letztes gegen erstes Drittel.
  const parts: string[] = [];
  const armPrimary =
    armDevices.find(item => item.key === 'watch') ?? armDevices[0];
  const swingChange = thirdChange(armPrimary?.device, 'armSwingDeg');
  if (swingChange !== undefined && Math.abs(swingChange) >= 8)
    parts.push(`Armschwung ${formatSignedPercent(swingChange)}`);
  const early = primary?.device.early?.regularity;
  const late = primary?.device.late?.regularity;
  if (finite(early) && finite(late) && Math.abs(late - early) >= 0.05)
    parts.push(late < early ? 'Rhythmus unruhiger' : 'Rhythmus ruhiger');
  const bounceChange = thirdChange(trunk?.device, 'oscillationCm');
  if (bounceChange !== undefined && Math.abs(bounceChange) >= 8)
    parts.push(`Auf und Ab ${formatSignedPercent(bounceChange)}`);
  const contactChange = thirdChange(trunk?.device, 'contactMs');
  if (contactChange !== undefined && Math.abs(contactChange) >= 5)
    parts.push(`Bodenkontakt ${formatSignedPercent(contactChange)}`);
  const hasThirds = devices.some(({ device }) => device.early && device.late);
  const lateText = parts.length
    ? parts.join(' · ')
    : hasThirds
    ? 'Bis zum Ende gleich geblieben'
    : undefined;

  // Eine Überschrift: das, woran man am ehesten etwas ändern kann.
  let headline: string | undefined;
  const phoneArm = armDevices.find(
    ({ key, device }) => key === 'phone' && device.placement === 'hand',
  );
  const watchArm = armDevices.find(({ key }) => key === 'watch');
  const asymmetry =
    phoneArm && watchArm
      ? (phoneArm.device.armSwingDeg! / watchArm.device.armSwingDeg! - 1) * 100
      : undefined;
  const crossing = armDevices.find(
    ({ device }) => finite(device.crossShare) && device.crossShare >= 0.35,
  );
  const ratio = trunk ? verticalRatio(run, trunk.device) : undefined;
  if (asymmetry !== undefined && Math.abs(asymmetry) >= 15) {
    headline = `Der Arm mit dem Handy schwingt ${Math.round(
      Math.abs(asymmetry),
    )} % ${asymmetry < 0 ? 'weniger' : 'mehr'} als der mit der Uhr.`;
  } else if (swingChange !== undefined && swingChange <= -10) {
    headline = `Zum Ende hin schwingen deine Arme ${Math.round(
      -swingChange,
    )} % weniger weit.`;
  } else if (crossing) {
    headline = 'Deine Arme schwingen deutlich quer vor dem Körper.';
  } else if (ratio !== undefined && ratio > 9) {
    headline = `Du federst viel auf und ab — ${number(
      ratio,
      1,
    )} % deiner Schrittlänge.`;
  } else if (
    primary &&
    finite(primary.device.regularity) &&
    primary.device.regularity >= 0.85
  ) {
    headline = 'Dein Schrittrhythmus war sehr gleichmäßig.';
  }

  const details = devices.map(
    ({ key, device }) =>
      `${deviceWord(key)} ${placementWords(device.placement)}: ${
        device.usable
      } von ${device.windows} Abschnitten à 10 s · ${
        device.usable >= CONFIDENT_WINDOWS
          ? 'ziemlich sicher'
          : 'eher ein Eindruck'
      }`,
  );
  const phone = gait.phone;
  if (phone && !isTrunk(phone.placement)) {
    details.push(
      'Auf und Ab, Bodenkontakt, Aufkommen und Abbremsen misst das Handy nur am Gürtel oder am Oberkörper.',
    );
  }
  if (!devices.some(({ device }) => isArm(device.placement))) {
    details.push('Den Armschwung misst das Handy in der Hand oder die Uhr.');
  }
  details.push(
    `Modell ${gait.model_version} · ${GAIT_VIEW_VERSION} · Schätzung aus Bewegungssensoren, keine Labormessung.`,
  );

  return {
    version: GAIT_VIEW_VERSION,
    headline,
    notice,
    lines,
    late: lateText,
    details,
  };
}
