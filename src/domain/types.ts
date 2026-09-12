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
  durationSeconds: number;
  avgHeartRate?: number;
  avgCadence?: number;
  gradePercent?: number;
  gapSeconds?: number;
  phase?: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'pause';
  sourceVersion?: string;
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
  avgHeartRate?: number;
  avgCadence?: number;
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
  accumulatedIndexMinutes?: number;
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
  method: 'pacing-fade-v1';
  baselineRunIds: string[];
  baselineFadePercent: number;
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
  method: 'strength-e1rm-v1';
  exerciseId: string;
  baselineSessionIds: string[];
  /** Median des besten Arbeits-e1RM der Vergleichseinheiten, in kg. */
  baselineE1RM: number;
  targetMinKg: number;
  targetMaxKg: number;
  targetReps: number;
  outcome: 'best_working_e1rm_percent';
  minimumRelevantChangePercent: number;
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
