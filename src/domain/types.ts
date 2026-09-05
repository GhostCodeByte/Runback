export type RunPurpose = 'easy' | 'long' | 'intervals' | 'race' | 'free' | 'unknown';

/** Erkannte Aktivitätsart aus dem Import. Nur Läufe werden trainiert. */
export type ActivityKind =
  | 'run'
  | 'hike'
  | 'walk'
  | 'ride'
  | 'swim'
  | 'other'
  | 'unknown';

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
  startTime: number;
  endTime: number;
  durationSeconds: number;
  distanceMeters: number;
  purpose: RunPurpose;
  source: string;
  status: string;
  activityKind?: ActivityKind;
  activityKindSource?: string;
  avgHeartRate?: number;
  avgCadence?: number;
  segments?: SegmentAggregate[];
  /** Count only. Raw samples stay in native storage. */
  samples?: number;
  sourceVersion?: string;
  canonicalId?: string;
  context?: {temperatureC?: number; windMps?: number; routeId?: string};
  rpe?: {legs?: number; breathing?: number; recordedAt: number};
}
export interface Provenance {
  model_version: string;
  inputSources: {runId: string; source: string; version: string}[];
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
  factors: {tempo: string; slope: string; wind: string; heat: string};
}
export interface PacingAnalysis {
  firstPaceSecondsPerKm: number;
  lastPaceSecondsPerKm: number;
  fadePercent: number;
  coefficientOfVariation: number;
  segmentIds: string[];
}
export interface Recommendation extends Provenance {
  id: string;
  kind: 'calmer_start';
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
export type ExperimentStatus = 'active' | 'paused' | 'completed' | 'aborted';
export interface Experiment {
  id: string;
  recommendation: Recommendation;
  acceptedAt: number;
  status: ExperimentStatus;
  history: {at: number; status: ExperimentStatus; reason: string}[];
}
export type Adherence = 'yes' | 'no' | 'unknown';
export interface ExperimentEvaluation extends Provenance {
  verdict: 'improved' | 'worsened' | 'no_relevant_effect' | 'insufficient_evidence' | 'not_implemented';
  summary: string;
  eligibleRunIds: string[];
  excluded: {runId: string; reason: string}[];
  adherence: {runId: string; value: Adherence; source: 'reported' | 'derived' | 'unknown'}[];
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
  question?: {id: string; text: string; reason: string};
}
