import {
  VENDOR_INFOS,
  detectVendorForFile,
  isStrongCsvContent,
  mapAppleRecordType,
  mapSamsungSleepStage,
  parseStrongCsvPreview,
  strongWorkoutVolume,
  vendorById,
} from '../src/domain/vendorImports';

const STRONG_CSV = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2024-11-02 18:30:00,Friday-lower,01:00:00,Squat (Barbell),1,100,8,,,,,8',
  '2024-11-02 18:30:00,Friday-lower,01:00:00,Squat (Barbell),2,100,8,,,,,8',
  '2024-11-02 18:30:00,Friday-lower,01:00:00,Lunge (Dumbbell),1,50,8,,,,,',
].join('\n');

describe('vendor imports', () => {
  it('covers every required platform with export steps and data mapping', () => {
    for (const id of [
      'fitbit',
      'google_fit',
      'strong',
      'mi_fitness',
      'apple_health',
      'samsung',
    ] as const) {
      const info = vendorById(id);
      expect(info.exportSteps.length).toBeGreaterThan(0);
      expect(info.useful.length).toBeGreaterThan(0);
      expect(info.limitations.length).toBeGreaterThan(0);
    }
    expect(VENDOR_INFOS.length).toBeGreaterThanOrEqual(10);
  });

  it('detects vendor files by name', () => {
    expect(detectVendorForFile('export.xml')).toBe('apple_health');
    expect(detectVendorForFile('com.samsung.shealth.exercise.20240101.csv')).toBe('samsung');
    expect(detectVendorForFile('heart_rate-2024-03-15.json')).toBe('fitbit');
    expect(detectVendorForFile('strong.csv')).toBe('strong');
    expect(detectVendorForFile('SPORT_20240101.csv')).toBe('mi_fitness');
    expect(detectVendorForFile('summarizedActivities.json')).toBe('garmin');
    expect(detectVendorForFile('run.gpx')).toBe('generic');
  });

  it('parses Strong CSV into grouped workouts with volume', () => {
    expect(isStrongCsvContent(STRONG_CSV)).toBe(true);
    const parsed = parseStrongCsvPreview(STRONG_CSV);
    expect(parsed.workouts).toHaveLength(1);
    expect(parsed.workouts[0].sets).toHaveLength(3);
    expect(parsed.workouts[0].durationSeconds).toBeCloseTo(3600, 0);
    expect(strongWorkoutVolume(parsed.workouts[0])).toBeCloseTo(2000, 0);
    expect(parsed.skipped).toBe(0);
  });

  it('rejects non-Strong CSV headers with a clear error', () => {
    expect(() =>
      parseStrongCsvPreview('Activity ID,Name,Distance\n1,Run,5'),
    ).toThrow(/Strong-Kopfzeile/);
  });

  it('maps Apple record types without inventing heart-rate rows', () => {
    expect(mapAppleRecordType('HKQuantityTypeIdentifierRestingHeartRate')).toBe('resting_hr');
    expect(mapAppleRecordType('HKQuantityTypeIdentifierHeartRateVariabilitySDNN')).toBe('hrv_sdnn');
    expect(mapAppleRecordType('HKCategoryTypeIdentifierSleepAnalysis')).toBe('sleep_stage');
    expect(mapAppleRecordType('HKQuantityTypeIdentifierHeartRate')).toBeNull();
    expect(mapAppleRecordType('HKQuantityTypeIdentifierStepCount')).toBe('steps');
  });

  it('maps Samsung sleep stage codes', () => {
    expect(mapSamsungSleepStage('40001')).toBe('awake');
    expect(mapSamsungSleepStage('40002')).toBe('light');
    expect(mapSamsungSleepStage('40003')).toBe('deep');
    expect(mapSamsungSleepStage('40004')).toBe('rem');
    expect(mapSamsungSleepStage('99999')).toBe('unknown');
  });

  it('keeps vendor imports optional in wording', () => {
    const apple = vendorById('apple_health');
    expect(apple.useful.some(u => /Nur Anzeige/i.test(u.howUsed))).toBe(true);
    const strong = vendorById('strong');
    expect(strong.useful.some(u => /keine Laufwertung/i.test(u.howUsed))).toBe(true);
  });
});
