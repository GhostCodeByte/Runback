import type { Sport } from './types';
import type { StrengthSession } from './strength';
import type { SorenessReport } from './sorenessInput';

/**
 * Welche Funktionen der Nutzer sehen will und wann Runback fragt.
 *
 * Die Spec verspricht: „Jede Funktion ist abwählbar und erzeugt abgewählt
 * weder Hinweise noch leere Flächen.“ Dieses Modul ist die eine Stelle, an
 * der das entschieden wird. Abschalten versteckt nur; Daten bleiben, damit
 * Wiedereinschalten alles zurückbringt (Grundregel 1 und 10).
 *
 * Fehlende oder kaputte Werte fallen auf den Standard zurück, nie auf einen
 * Fehler. Der Standard entspricht dem bisherigen Verhalten der App — mit einer
 * Ausnahme: Nach Muskelkater fragt Runback jetzt nach Krafttraining statt
 * täglich.
 */
export const FEATURES_VERSION = 1 as const;

export type SorenessPrompt =
  | 'never'
  | 'after_strength'
  | 'daily'
  | 'training_days'
  | 'weekly';
export type RecommendationMode = 'suggest' | 'on_request' | 'off';
export type HomeSection =
  | 'week'
  | 'recommendation'
  | 'goal'
  | 'body'
  | 'recent';
export type RecordingMetric = 'distance' | 'pace' | 'heartRate' | 'target';
export type RecordingPrimary = 'duration' | 'distance' | 'heartRate';
export type AfterRun = 'detail' | 'feeling' | 'home';
export type StatsModule = 'distribution' | 'records' | 'consistency' | 'body';
export type Area = 'running' | 'strength';
export type Tab = 'Heute' | 'Plan' | 'Verlauf' | 'Coach';

export interface FeatureSettings {
  version: typeof FEATURES_VERSION;
  areas: Record<Area, boolean>;
  sports: { cycling: boolean };
  soreness: {
    enabled: boolean;
    prompt: SorenessPrompt;
    map: boolean;
    voice: boolean;
  };
  home: { sections: HomeSection[] };
  planning: { enabled: boolean; suggest: boolean; month: boolean };
  recommendations: {
    running: RecommendationMode;
    strength: RecommendationMode;
    showQueued: boolean;
  };
  recording: {
    metrics: RecordingMetric[];
    primary: RecordingPrimary;
    targets: boolean;
    routes: boolean;
    afterRun: AfterRun;
  };
  strength: {
    restTimer: boolean;
    defaultRestSeconds: number;
    rir: boolean;
    templateOfDay: boolean;
  };
  statistics: { modules: StatsModule[] };
}

export const HOME_SECTIONS: HomeSection[] = [
  'week',
  'recommendation',
  'goal',
  'body',
  'recent',
];
export const RECORDING_METRICS: RecordingMetric[] = [
  'distance',
  'pace',
  'heartRate',
  'target',
];
export const STATS_MODULES: StatsModule[] = [
  'distribution',
  'records',
  'consistency',
  'body',
];
export const SORENESS_PROMPTS: SorenessPrompt[] = [
  'never',
  'after_strength',
  'daily',
  'training_days',
  'weekly',
];
export const RECOMMENDATION_MODES: RecommendationMode[] = [
  'suggest',
  'on_request',
  'off',
];
export const AFTER_RUN_OPTIONS: AfterRun[] = ['detail', 'feeling', 'home'];
export const RECORDING_PRIMARIES: RecordingPrimary[] = [
  'duration',
  'distance',
  'heartRate',
];
export const REST_SECONDS_OPTIONS = [60, 90, 120, 180] as const;
const MIN_REST_SECONDS = 0;
const MAX_REST_SECONDS = 600;

export const DEFAULT_FEATURES: FeatureSettings = {
  version: FEATURES_VERSION,
  areas: { running: true, strength: true },
  sports: { cycling: true },
  soreness: { enabled: true, prompt: 'after_strength', map: true, voice: true },
  home: { sections: [...HOME_SECTIONS] },
  planning: { enabled: true, suggest: true, month: true },
  recommendations: {
    running: 'suggest',
    strength: 'suggest',
    showQueued: true,
  },
  recording: {
    metrics: ['distance', 'pace', 'target'],
    primary: 'duration',
    targets: true,
    routes: true,
    afterRun: 'detail',
  },
  strength: {
    restTimer: true,
    defaultRestSeconds: 120,
    rir: true,
    templateOfDay: true,
  },
  statistics: { modules: [...STATS_MODULES] },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;
const oneOf = <T extends string>(value: unknown, allowed: T[], fallback: T) =>
  typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
/** Teilmenge einer festen Liste in deren Reihenfolge; Unbekanntes fällt weg. */
const subset = <T extends string>(
  value: unknown,
  allowed: T[],
  fallback: T[],
) =>
  Array.isArray(value)
    ? allowed.filter(item => value.includes(item))
    : [...fallback];

/**
 * Liest gespeicherte Einstellungen. `legacy` trägt ältere Einzelschalter, die
 * vor diesem Modul existierten; sie gelten nur, solange `features` fehlt.
 */
export function normalizeFeatures(
  raw: unknown,
  legacy: { showHeartRate?: boolean } = {},
): FeatureSettings {
  const d = DEFAULT_FEATURES;
  if (!isRecord(raw)) {
    const metrics = legacy.showHeartRate
      ? [...d.recording.metrics, 'heartRate' as const]
      : [...d.recording.metrics];
    return {
      ...d,
      areas: { ...d.areas },
      sports: { ...d.sports },
      soreness: { ...d.soreness },
      home: { sections: [...d.home.sections] },
      planning: { ...d.planning },
      recommendations: { ...d.recommendations },
      recording: {
        ...d.recording,
        metrics: RECORDING_METRICS.filter(item => metrics.includes(item)),
      },
      strength: { ...d.strength },
      statistics: { modules: [...d.statistics.modules] },
    };
  }
  const areas = isRecord(raw.areas) ? raw.areas : {};
  const sports = isRecord(raw.sports) ? raw.sports : {};
  const soreness = isRecord(raw.soreness) ? raw.soreness : {};
  const home = isRecord(raw.home) ? raw.home : {};
  const planning = isRecord(raw.planning) ? raw.planning : {};
  const recommendations = isRecord(raw.recommendations)
    ? raw.recommendations
    : {};
  const recording = isRecord(raw.recording) ? raw.recording : {};
  const strength = isRecord(raw.strength) ? raw.strength : {};
  const statistics = isRecord(raw.statistics) ? raw.statistics : {};
  const running = bool(areas.running, d.areas.running);
  const strengthArea = bool(areas.strength, d.areas.strength);
  const restSeconds = Number(strength.defaultRestSeconds);
  return {
    version: FEATURES_VERSION,
    // Mindestens ein Bereich bleibt an, sonst gäbe es nichts zu starten.
    areas:
      running || strengthArea
        ? { running, strength: strengthArea }
        : { ...d.areas },
    sports: { cycling: bool(sports.cycling, d.sports.cycling) },
    soreness: {
      enabled: bool(soreness.enabled, d.soreness.enabled),
      prompt: oneOf(soreness.prompt, SORENESS_PROMPTS, d.soreness.prompt),
      map: bool(soreness.map, d.soreness.map),
      voice: bool(soreness.voice, d.soreness.voice),
    },
    home: {
      sections: subset(home.sections, HOME_SECTIONS, d.home.sections),
    },
    planning: {
      enabled: bool(planning.enabled, d.planning.enabled),
      suggest: bool(planning.suggest, d.planning.suggest),
      month: bool(planning.month, d.planning.month),
    },
    recommendations: {
      running: oneOf(
        recommendations.running,
        RECOMMENDATION_MODES,
        d.recommendations.running,
      ),
      strength: oneOf(
        recommendations.strength,
        RECOMMENDATION_MODES,
        d.recommendations.strength,
      ),
      showQueued: bool(
        recommendations.showQueued,
        d.recommendations.showQueued,
      ),
    },
    recording: {
      metrics: subset(
        recording.metrics,
        RECORDING_METRICS,
        d.recording.metrics,
      ),
      primary: oneOf(
        recording.primary,
        RECORDING_PRIMARIES,
        d.recording.primary,
      ),
      targets: bool(recording.targets, d.recording.targets),
      routes: bool(recording.routes, d.recording.routes),
      afterRun: oneOf(
        recording.afterRun,
        AFTER_RUN_OPTIONS,
        d.recording.afterRun,
      ),
    },
    strength: {
      restTimer: bool(strength.restTimer, d.strength.restTimer),
      defaultRestSeconds:
        Number.isInteger(restSeconds) &&
        restSeconds >= MIN_REST_SECONDS &&
        restSeconds <= MAX_REST_SECONDS
          ? restSeconds
          : d.strength.defaultRestSeconds,
      rir: bool(strength.rir, d.strength.rir),
      templateOfDay: bool(strength.templateOfDay, d.strength.templateOfDay),
    },
    statistics: {
      modules: subset(statistics.modules, STATS_MODULES, d.statistics.modules),
    },
  };
}

/** Schaltet einen Bereich; der letzte aktive Bereich lässt sich nicht abwählen. */
export function withArea(
  features: FeatureSettings,
  area: Area,
  enabled: boolean,
): FeatureSettings {
  const next = { ...features.areas, [area]: enabled };
  if (!next.running && !next.strength) {
    return features;
  }
  return { ...features, areas: next };
}

/** Sportarten, die in der Auswahl vor einer Aufzeichnung stehen. */
export function enabledSports(features: FeatureSettings): Sport[] {
  const sports: Sport[] = [];
  if (features.areas.running) {
    sports.push('running');
  }
  if (features.sports.cycling) {
    sports.push('cycling');
  }
  return sports;
}

/** Tabs in Anzeigereihenfolge. Ohne Planung bleiben drei. */
export function visibleTabs(features: FeatureSettings): Tab[] {
  return (['Heute', 'Plan', 'Verlauf', 'Coach'] as Tab[]).filter(
    tab => tab !== 'Plan' || features.planning.enabled,
  );
}

/** Ob eine Empfehlung dieses Bereichs überhaupt gerechnet und gezeigt wird. */
export function recommendationsShown(
  features: FeatureSettings,
  area: Area,
): boolean {
  return features.areas[area] && features.recommendations[area] !== 'off';
}

/** Ob die Empfehlung dieses Bereichs ungefragt auf Heute und nach der Einheit steht. */
export function recommendationsSuggested(
  features: FeatureSettings,
  area: Area,
): boolean {
  return features.areas[area] && features.recommendations[area] === 'suggest';
}

/**
 * Blöcke auf Heute, die der Nutzer angehakt hat und deren Funktion an ist.
 * Eine abgeschaltete Funktion nimmt ihren Block mit — er steht dann auch
 * nicht mehr zur Auswahl. Die Startkarte ist kein Block; sie bleibt immer.
 */
export function availableHomeSections(
  features: FeatureSettings,
): HomeSection[] {
  return HOME_SECTIONS.filter(section => {
    switch (section) {
      case 'week':
        return features.planning.enabled;
      case 'body':
        return features.soreness.enabled;
      case 'goal':
        return features.areas.running;
      case 'recommendation':
        return (
          recommendationsSuggested(features, 'running') ||
          recommendationsSuggested(features, 'strength')
        );
      default:
        return true;
    }
  });
}

export function visibleHomeSections(features: FeatureSettings): HomeSection[] {
  const available = availableHomeSections(features);
  return available.filter(section => features.home.sections.includes(section));
}

const HOUR = 3600 * 1000;
/** Muskelkater kommt verzögert: gefragt wird frühestens 8 und spätestens 72 Stunden nach der Einheit. */
const AFTER_STRENGTH_MIN = 8 * HOUR;
const AFTER_STRENGTH_MAX = 72 * HOUR;

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};
/** Montag 0:00 Ortszeit der Woche, in der `at` liegt. */
const weekStart = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.getTime();
};

/**
 * Soll die Muskelkater-Abfrage jetzt ungefragt erscheinen? Rein aus
 * Einstellung, Meldungen und Krafteinheiten; wer die Abfrage schon in dieser
 * Sitzung gesehen hat, hält das der Aufrufer fest.
 */
export function shouldPromptSoreness(
  features: FeatureSettings,
  reports: Pick<SorenessReport, 'at'>[],
  sessions: Pick<StrengthSession, 'status' | 'startTime' | 'endTime'>[],
  trainingDays: number[],
  now: number,
): boolean {
  if (!features.soreness.enabled) {
    return false;
  }
  const reportedToday = reports.some(report => sameDay(report.at, now));
  switch (features.soreness.prompt) {
    case 'never':
      return false;
    case 'daily':
      return !reportedToday;
    case 'training_days':
      return !reportedToday && trainingDays.includes(new Date(now).getDay());
    case 'weekly': {
      const start = weekStart(now);
      return !reports.some(report => report.at >= start && report.at <= now);
    }
    case 'after_strength': {
      if (reportedToday) {
        return false;
      }
      return sessions.some(session => {
        if (session.status !== 'finished') {
          return false;
        }
        const end = session.endTime ?? session.startTime;
        const age = now - end;
        if (age < AFTER_STRENGTH_MIN || age > AFTER_STRENGTH_MAX) {
          return false;
        }
        // Einmal je Einheit: eine Meldung nach ihrem Ende genügt.
        return !reports.some(report => report.at >= end);
      });
    }
    default:
      return false;
  }
}

/** Anzeigename je Option. Für Zeilenuntertitel, die den aktuellen Wert nennen. */
export const SORENESS_PROMPT_LABELS: Record<SorenessPrompt, string> = {
  never: 'Nie – nur selbst melden',
  after_strength: 'Nach Krafttraining',
  daily: 'Täglich beim ersten Öffnen',
  training_days: 'An Trainingstagen',
  weekly: 'Einmal pro Woche',
};
export const RECOMMENDATION_MODE_LABELS: Record<RecommendationMode, string> = {
  suggest: 'Vorschlagen',
  on_request: 'Nur auf Nachfrage',
  off: 'Aus',
};
export const AFTER_RUN_LABELS: Record<AfterRun, string> = {
  detail: 'Detailseite öffnen',
  feeling: 'Nur Gefühl abfragen',
  home: 'Direkt zurück zu Heute',
};
export const HOME_SECTION_LABELS: Record<HomeSection, string> = {
  week: 'Wochenleiste',
  recommendation: 'Empfehlung',
  goal: 'Zielnähe',
  body: 'Muskelkater melden',
  recent: 'Zuletzt',
};
export const RECORDING_METRIC_LABELS: Record<RecordingMetric, string> = {
  distance: 'Kilometer',
  pace: 'Tempo',
  heartRate: 'Herzfrequenz',
  target: 'Laufen nach',
};
export const RECORDING_PRIMARY_LABELS: Record<RecordingPrimary, string> = {
  duration: 'Dauer',
  distance: 'Kilometer',
  heartRate: 'Herzfrequenz',
};
export const STATS_MODULE_LABELS: Record<StatsModule, string> = {
  distribution: 'Verteilung',
  records: 'Bestwerte',
  consistency: 'Konsistenz',
  body: 'Körperwerte',
};
