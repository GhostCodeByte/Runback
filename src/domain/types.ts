export type RunPurpose =
  | 'easy'
  | 'long'
  | 'intervals'
  | 'race'
  | 'free'
  | 'unknown';
/**
 * Sportart einer Aufzeichnung. Fehlt das Feld, ist es ein Lauf — so bleiben
 * ältere Datensätze ohne Migration lesbar. Labels und Regeln: sport.ts.
 */
export type Sport = 'running' | 'cycling';
/**
 * Bereich einer Empfehlung, eines Fokus oder Ziels. Laufen und Krafttraining
 * werden an getrennten Daten geprüft und haben je höchstens eine aktive
 * Empfehlung. Fehlt das Feld, ist es Laufen (ältere Datensätze).
 */
export type Area = 'running' | 'strength';

/** Native, bounded derived splits, never a raw sensor stream. */
export interface SegmentAggregate {
  id?: string;
  distanceMeters: number;
  /** Zeitspanne des Abschnitts ohne Pausen; GPS-Lücken sind enthalten (siehe gapSeconds). */
  durationSeconds: number;
  /** Sekunden in RUN- oder WALK-Phasen innerhalb des Abschnitts (ab Distanzmodell 3.0). */
  movingSeconds?: number;
  startElapsedSeconds?: number;
  endElapsedSeconds?: number;
  avgHeartRate?: number;
  avgCadence?: number;
  /** Nur ab 50 m Strecke und aus geglätteter Höhe (RunElevation). */
  gradePercent?: number;
  /** Summe der Anstiege bzw. Abstiege im Abschnitt (mit Hysterese), in m. */
  ascentMeters?: number;
  descentMeters?: number;
  /** Sekunden ohne gültige GPS-Schritte im Abschnitt; ab 5 s nicht für Pacing geeignet. */
  gapSeconds?: number;
  phase?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'pause';
  sourceVersion?: string;
}
export type MovementState = 'RUN' | 'WALK' | 'STOPPED' | 'PAUSED' | 'UNKNOWN';
/**
 * Zeitbudget einer Aufzeichnung (RunPhases). Geht ohne Rest auf:
 * elapsed = paused + running + walking + stopped + unknown.
 * `activeSeconds` ist die Aufzeichnungszeit ohne Pausen, `movingSeconds`
 * die Bewegungszeit (RUN + WALK). Fehlt das Objekt (Altdaten, Importe),
 * gibt es nur `durationSeconds` — und die ist keine Bewegungszeit.
 */
export interface TimeBudget {
  model_version: string;
  elapsedSeconds: number;
  pausedSeconds: number;
  activeSeconds: number;
  movingSeconds: number;
  runningSeconds: number;
  walkingSeconds: number;
  stoppedSeconds: number;
  unknownSeconds: number;
}
export interface MovementPhase {
  state: MovementState;
  startElapsedSeconds: number;
  endElapsedSeconds: number;
  distanceMeters: number;
  avgHeartRate?: number;
  avgCadence?: number;
}
export interface StateSummary {
  seconds: number;
  meters: number;
  avgHeartRate?: number;
  avgCadence?: number;
}
export interface PhaseMetrics {
  model_version: string;
  longestRunSeconds?: number;
  longestRunMeters?: number;
  longestMovingSeconds?: number;
  runWalkTransitions: number;
  /** STOPPED/UNKNOWN am Ende; ab 5 min vermutlich nicht gestoppt. */
  trailingIdleSeconds: number;
  fastestSustained300sSecondsPerKm?: number;
  running: StateSummary;
  walking: StateSummary;
  stopped: StateSummary;
}
/** Höhenmeter aus RunElevation; ohne belastbare Quelle nur `available: false` mit Grund. */
export type ElevationSummary =
  | {
      model_version: string;
      available: true;
      source: 'barometer' | 'gps';
      reference: 'absolute' | 'start';
      ascentMeters: number;
      descentMeters: number;
      rejectedSamples: number;
      hysteresisMeters: number;
    }
  | { model_version: string; available: false; reason: string };
export interface GpsGap {
  fromElapsedSeconds: number;
  toElapsedSeconds: number;
  reason: 'timeout' | 'accuracy' | 'speed' | 'invalid' | string;
}
/** Trageort eines Geräts beim Laufen; die Uhr ist immer `wrist`. */
export type GaitPlacement =
  | 'hand'
  | 'upper_arm'
  | 'waist'
  | 'pocket'
  | 'chest'
  | 'wrist'
  | 'unknown';
/** Laufstil-Werte, jeweils Median der gelaufenen 10-s-Fenster (Kotlin `Gait`). */
export interface GaitValues {
  /** Schritte je Minute. */
  cadence?: number;
  /** Ähnlichkeit eines Doppelschritts mit dem nächsten, 0–1. */
  regularity?: number;
  /** Winkel von ganz vorn bis ganz hinten. */
  armSwingDeg?: number;
  /** Anteil der Armdrehung um die Hochachse, 0–1. */
  crossShare?: number;
  oscillationCm?: number;
  contactMs?: number;
  /** Spitze der Vertikalbeschleunigung je Schritt in g. */
  impactG?: number;
  /** Tempo-Schwankung vor–zurück je Schritt. */
  brakingMps?: number;
  leanDeg?: number;
}
export interface GaitDevice extends GaitValues {
  source: string;
  placement: GaitPlacement;
  /** Gelaufene Fenster. */
  windows: number;
  /** Davon mit erkanntem Schritt. */
  usable: number;
  /** Fenster, deren Signal zum Trageort geprüft werden konnte, und davon unpassende. */
  checked: number;
  mismatch: number;
  early?: GaitValues;
  late?: GaitValues;
}
/** Laufstil eines Laufs je Gerät; fehlt, wenn keins Fenster aufgezeichnet hat. */
export interface RunGait {
  model_version: string;
  phone?: GaitDevice;
  watch?: GaitDevice;
}
export interface RunSummary {
  id: string;
  /** Name aus der Quelle. Für die Anzeige immer runTitle() benutzen. */
  name?: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  distanceMeters: number;
  purpose: RunPurpose;
  sport?: Sport;
  source: string;
  status: string;
  /** Zeitgewichtet. Fehlt die Abdeckung, stammt der Wert aus Altdaten oder Importen. */
  avgHeartRate?: number;
  /** Anteil der Bewegungszeit mit Pulswerten (0–1). */
  heartRateCoverage?: number;
  avgCadence?: number;
  cadenceCoverage?: number;
  calories?: number;
  steps?: number;
  elevationGainMeters?: number;
  avgHeartRateMax?: number;
  avgHeartRateMin?: number;
  avgCadenceMax?: number;
  avgCadenceMin?: number;
  time?: TimeBudget;
  phases?: MovementPhase[];
  phaseMetrics?: PhaseMetrics;
  elevation?: ElevationSummary;
  gaps?: GpsGap[];
  gapCount?: number;
  /** Version des nativen Distanzmodells, mit dem Abschnitte und Distanz abgeleitet wurden. */
  model_version?: string;
  sensorSources?: { gps?: string; heartRate?: string };
  gait?: RunGait;
  sourceActivityId?: string;
  sourceActivityType?: string;
  importVersion?: string;
  importDetails?: Record<string, unknown> | string;
  segments?: SegmentAggregate[];
  /** Count only. Raw samples stay in native storage. */
  samples?: number;
  sourceVersion?: string;
  canonicalId?: string;
  context?: { temperatureC?: number; windMps?: number; routeId?: string };
  rpe?: { legs?: number; breathing?: number; recordedAt: number };
}
export interface Provenance {
  model_version: string;
  inputSources: { runId: string; source: string; version: string }[];
  segmentIds: string[];
}
export interface QualityIssue {
  sensor: 'time' | 'gps' | 'heartRate' | 'cadence' | 'elevation';
  code: string;
  message: string;
  segmentId?: string;
  suspected: boolean;
}
export interface QualityReport {
  issues: QualityIssue[];
  paceUsable: boolean;
  heartRateUsable: boolean;
  usablePaceSegmentIds: string[];
  usableHeartRateSegmentIds: string[];
}
export interface EffortEstimate extends Provenance {
  kind: 'estimate';
  speedIndex?: number;
  /**
   * Belastung nach Session-RPE (Foster 2001): RPE × Bewegungsminuten. Beine
   * und Atmung bleiben getrennt; fehlt eine Angabe, fehlt ihr Wert.
   */
  sessionLoad?: { legs?: number; breathing?: number };
  unit: 'index (100 = 3 m/s)';
  uncertainty: string;
  assumptions: string[];
  factors: { tempo: string; slope: string; wind: string; heat: string };
}
export interface PacingAnalysis {
  firstPaceSecondsPerKm: number;
  lastPaceSecondsPerKm: number;
  fadePercent: number;
  coefficientOfVariation: number;
  segmentIds: string[];
}
export interface Recommendation extends Provenance {
  priority?: { version: string; focusLabel: string; weight: number };
  id: string;
  kind: 'calmer_start';
  area?: 'running';
  title: string;
  action: string;
  reason: string;
  purpose: 'easy' | 'long';
  goal: string;
  criteria: ExperimentCriteria;
}
export interface ExperimentCriteria {
  method: 'pacing-fade-v2';
  /** Auslösender Lauf plus vergleichbare Vorläufe; die Basis ist ihr Median. */
  baselineRunIds: string[];
  /** Median des späten Tempoabfalls der Vergleichsläufe, in Prozent. */
  baselineFadePercent: number;
  /** Vorab festgelegtes Niveau des Vorzeichentests (zweiseitig). */
  signTestAlpha: number;
  baselineDurationSeconds: number;
  baselineDistanceMeters: number;
  baselineContext?: RunSummary['context'];
  openingPaceSecondsPerKm: number;
  openingPaceTolerancePercent: number;
  outcome: 'late_pace_fade_percent';
  minimumRelevantChangePercentPoints: number;
  durationTolerancePercent: number;
  distanceTolerancePercent: number;
  minimumObservations: number;
  minimumDays: number;
  reviewAfterRuns: number;
  maxDays: number;
  exclusions: string[];
  stopConditions: string[];
}
/** Empfehlung im Bereich Krafttraining: die Last einer Übung. */
export interface StrengthCriteria {
  method: 'strength-e1rm-v2';
  exerciseId: string;
  baselineSessionIds: string[];
  /** Median des besten Arbeits-e1RM der Vergleichseinheiten, in kg. */
  baselineE1RM: number;
  targetMinKg: number;
  targetMaxKg: number;
  targetReps: number;
  outcome: 'best_working_e1rm_percent';
  minimumRelevantChangePercent: number;
  /** Vorab festgelegtes Niveau des Vorzeichentests (zweiseitig). */
  signTestAlpha: number;
  minimumObservations: number;
  reviewAfterSessions: number;
  maxDays: number;
  exclusions: string[];
  stopConditions: string[];
}
export interface StrengthRecommendation extends Provenance {
  priority?: { version: string; focusLabel: string; weight: number };
  id: string;
  kind: 'strength_load';
  area: 'strength';
  title: string;
  action: string;
  reason: string;
  goal: string;
  exerciseId: string;
  exerciseName: string;
  direction: 'increase' | 'reduce' | 'plateau';
  /** Hauptregionen der Übung; entscheidet, ob sie Laufergebnisse beeinflusst. */
  regions: string[];
  criteria: StrengthCriteria;
}
export type AnyRecommendation = Recommendation | StrengthRecommendation;
export type ExperimentStatus = 'active' | 'paused' | 'completed' | 'aborted';
export interface Experiment<R extends AnyRecommendation = AnyRecommendation> {
  id: string;
  recommendation: R;
  acceptedAt: number;
  status: ExperimentStatus;
  history: { at: number; status: ExperimentStatus; reason: string }[];
}
export type Adherence = 'yes' | 'no' | 'unknown';
export interface ExperimentEvaluation extends Provenance {
  verdict:
    | 'improved'
    | 'worsened'
    | 'no_relevant_effect'
    | 'insufficient_evidence'
    | 'not_implemented';
  summary: string;
  eligibleRunIds: string[];
  excluded: { runId: string; reason: string }[];
  adherence: {
    runId: string;
    value: Adherence;
    source: 'reported' | 'derived' | 'unknown';
  }[];
  changePercentPoints?: number;
  observedRange?: [number, number];
  /** Vorzeichentest gegen die Relevanzschwelle; Bindungen zählen nicht. */
  signTest?: {
    positives: number;
    negatives: number;
    ties: number;
    pValue: number;
    alpha: number;
  };
  causalClaim: false;
}
export interface RunAnalysis extends Provenance {
  classification: string;
  focus: string;
  nextAction: string;
  state: 'recommendation' | 'maintain' | 'insufficient' | 'active';
  quality: QualityReport;
  effort: EffortEstimate;
  pacing?: PacingAnalysis;
  recommendation?: Recommendation;
  question?: { id: string; text: string; reason: string };
}
