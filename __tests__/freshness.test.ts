import {
  calculateFreshness,
  calculateSetStimulus,
  buildRunStimulusContributions,
  combinedImpulseResponse,
  distributeStimulus,
  effectiveRepetitionsFromSeconds,
  isValidMuscleReport,
  impulseResponse,
  MUSCLE_MODEL_CONSTANTS,
  nothingTodayReport,
  predictFreshness,
  runSegmentStimulus,
  type FreshnessInput,
} from '../src/domain/freshness';
import type { LoggedSet, StrengthSession } from '../src/domain/strength';
import { catalogExercise } from '../src/domain/catalog';

const hour = 60 * 60 * 1000;
const sessionAt = 1_000_000;

const set = (id: string, completedAt: number, overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id,
  planned: {
    kind: 'normal',
    loadKind: 'kg',
    reps: 5,
    weightKg: 100,
    restSeconds: 120,
  },
  actualReps: 5,
  actualWeightKg: 100,
  completedAt,
  ...overrides,
});

const strengthSession = (exerciseId = 'barbell_back_squat'): StrengthSession => ({
  id: 'session-1',
  kind: 'strength',
  name: 'Einheit',
  startTime: sessionAt,
  endTime: sessionAt + 10 * 60 * 1000,
  status: 'finished',
  currentExercise: 0,
  modelVersion: 'strength-v1',
  catalogVersion: 'catalog-v1',
  exercises: [{
    exerciseId,
    name: catalogExercise(exerciseId)?.name ?? exerciseId,
    sets: [set('set-1', sessionAt)],
  }],
});

describe('Reiz- und Frischemodell', () => {
  it('berechnet effektive Wiederholungen für Zeit- und Lastsätze', () => {
    expect(effectiveRepetitionsFromSeconds(24)).toBe(2);
    const exercise = catalogExercise('leg_extension');
    expect(exercise).toBeDefined();
    const result = calculateSetStimulus(set('set-1', sessionAt), exercise!, {
      e1rmEstimate: 125,
    });
    expect(result.valid).toBe(true);
    expect(result.relativeLoad).toBeCloseTo(0.8, 8);
    expect(result.rir).toBeCloseTo(2.5, 8);
    expect(result.stimulus).toBeGreaterThan(0);
    const timed = calculateSetStimulus({
      ...set('timed', sessionAt),
      planned: {
        kind: 'timed',
        loadKind: 'kg',
        seconds: 36,
        weightKg: 30,
        restSeconds: 60,
      },
      actualReps: undefined,
      actualSeconds: 36,
      actualWeightKg: 30,
    }, exercise!);
    expect(timed.effectiveReps).toBe(3);
  });

  it('verteilt bilaterale und einseitige Übungen korrekt', () => {
    const bilateral = distributeStimulus(
      catalogExercise('barbell_back_squat')!,
      10,
    );
    expect(bilateral.quad_l).toBeCloseTo(bilateral.quad_r ?? 0, 8);
    expect(bilateral.quad_l).toBeCloseTo(2.25, 8);
    const unilateral = distributeStimulus(
      catalogExercise('walking_lunge')!,
      10,
      'r',
    );
    expect(unilateral.quad_l).toBeUndefined();
    expect(unilateral.quad_r).toBeCloseTo(4, 8);
  });

  it('normiert beide Impulsantworten auf ihr Maximum', () => {
    const rise = 12;
    const decay = 60;
    const peak = Math.log(decay / rise) / (1 / rise - 1 / decay);
    expect(impulseResponse(peak, rise, decay)).toBeCloseTo(1, 8);
    expect(combinedImpulseResponse(-1)).toBe(0);
    expect(combinedImpulseResponse(0)).toBe(0);
  });

  it('berechnet Laufbeiträge mit Geschwindigkeit, Dauer und Gefälle', () => {
    const level = runSegmentStimulus({
      id: 'flat',
      distanceMeters: 3 * 3600,
      durationSeconds: 3600,
      gradePercent: 0,
    });
    const downhill = runSegmentStimulus({
      id: 'downhill',
      distanceMeters: 3 * 3600,
      durationSeconds: 3600,
      gradePercent: -10,
    });
    expect(level.stimulusByRegion.calf_gastroc_l).toBeCloseTo(
      MUSCLE_MODEL_CONSTANTS.runCoefficientCalfGastroc / 2,
      8,
    );
    expect(downhill.stimulusByRegion.quad_l).toBeGreaterThan(
      level.stimulusByRegion.quad_l ?? 0,
    );
  });

  it('liefert unbekannt statt einer künstlichen 100 ohne Meldung', () => {
    const input: FreshnessInput = {
      at: sessionAt,
      sessions: [strengthSession()],
      reports: [],
    };
    const result = calculateFreshness(input).regions.quad_l;
    expect(result.kind).toBe('unknown');
    expect(result.value).toBeNull();
    if (result.kind === 'unknown') {
      expect(result.reasonCode).toBe('missing_reports');
    }
    expect(result.model_version).toBe(MUSCLE_MODEL_CONSTANTS.modelVersion);
    expect(result.regions_version).toBe('regions-v1');
    expect(result.catalog_version).toBe('catalog-v1');
  });

  it('markiert eine Zukunftsauswertung ausdrücklich als Prognose', () => {
    const input: FreshnessInput = {
      at: sessionAt + 24 * hour,
      sessions: [strengthSession()],
      reports: [{ at: sessionAt + hour, regionId: 'quad_l', value: 3 }],
    };
    const result = predictFreshness(input);
    expect(result.kind).toBe('freshness_prediction');
    expect(result.isPrediction).toBe(true);
    expect(result.regions.quad_l.kind).toBe('freshness');
    expect(result.regions.quad_l.value).toBeLessThan(100);
  });

  it('behandelt eine explizite Heute-nichts-Meldung als Eingabe', () => {
    const report = nothingTodayReport(sessionAt + hour);
    const result = calculateFreshness({
      at: sessionAt + 2 * hour,
      sessions: [strengthSession()],
      reports: [report],
    });
    expect(report.kind).toBe('nothing_today');
    expect(result.contributing_reports).toEqual([report]);
    expect(result.regions.quad_l.contributing_reports).toEqual([report]);
  });

  it('verwirft Meldungen für unbekannte Muskelregionen', () => {
    expect(isValidMuscleReport({
      at: sessionAt,
      regionId: 'made_up_region',
      value: 5,
    })).toBe(false);
  });

  it('führt anonyme Laufabschnitte mit eigener Kennung und Startzeit', () => {
    const run = buildRunStimulusContributions({
      id: 'run-1',
      startTime: sessionAt,
      endTime: sessionAt + 120 * 1000,
      durationSeconds: 120,
      distanceMeters: 360,
      purpose: 'free',
      source: 'test',
      status: 'finished',
      segments: [
        { distanceMeters: 180, durationSeconds: 60, gradePercent: 0 },
        { distanceMeters: 180, durationSeconds: 60, gradePercent: 0 },
      ],
    });
    expect(new Set(run.map(contribution => contribution.segmentId))).toEqual(
      new Set(['split-1', 'split-2']),
    );
    expect(new Set(run.map(contribution => contribution.at))).toEqual(
      new Set([sessionAt, sessionAt + 60 * 1000]),
    );
  });
});
