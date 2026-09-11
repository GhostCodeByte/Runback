import {
  SPORTS,
  isRun,
  normalizeSport,
  speedKmh,
  sportLabel,
  sportNoun,
  sportWords,
  usesPace,
} from '../src/domain/sport';
import { dayPartTitle, runTitle } from '../src/domain/runTitle';

const at = (hour: number) => new Date(2024, 4, 1, hour, 30).getTime();

describe('normalizeSport', () => {
  it('treats missing and unknown values as running', () => {
    expect(normalizeSport(undefined)).toBe('running');
    expect(normalizeSport(null)).toBe('running');
    expect(normalizeSport('swimming')).toBe('running');
    expect(normalizeSport(42)).toBe('running');
  });

  it('keeps every offered sport', () => {
    for (const option of SPORTS) {
      expect(normalizeSport(option.value)).toBe(option.value);
    }
  });
});

describe('isRun', () => {
  it('counts legacy records without a sport as runs', () => {
    expect(isRun({})).toBe(true);
    expect(isRun({ sport: 'running' })).toBe(true);
    expect(isRun({ sport: 'cycling' })).toBe(false);
  });
});

describe('sport words', () => {
  it('labels running and cycling differently', () => {
    expect(sportLabel('running')).toBe('Laufen');
    expect(sportLabel('cycling')).toBe('Radfahren');
    expect(sportNoun(undefined)).toBe('Lauf');
    expect(sportNoun('cycling')).toBe('Radfahrt');
    expect(sportWords('cycling').durationLabel).toBe('Fahrzeit');
    expect(sportWords('running').feelingLabel).toBe('Laufgefühl');
  });

  it('reads runs as pace and rides as speed', () => {
    expect(usesPace(undefined)).toBe(true);
    expect(usesPace('running')).toBe(true);
    expect(usesPace('cycling')).toBe(false);
  });
});

describe('speedKmh', () => {
  it('derives km/h from metres and seconds', () => {
    expect(speedKmh({ distanceMeters: 30000, durationSeconds: 3600 })).toBe(30);
  });

  it('refuses to invent a speed without usable distance or time', () => {
    expect(speedKmh({ distanceMeters: 5, durationSeconds: 60 })).toBeNull();
    expect(speedKmh({ distanceMeters: 1000, durationSeconds: 0 })).toBeNull();
    expect(
      speedKmh({ distanceMeters: Number.NaN, durationSeconds: 60 }),
    ).toBeNull();
  });
});

describe('titles by sport', () => {
  it('names a ride by the part of the day', () => {
    expect(dayPartTitle(at(6), 'cycling')).toBe('Morgenfahrt');
    expect(dayPartTitle(at(19), 'cycling')).toBe('Abendfahrt');
    expect(dayPartTitle(0, 'cycling')).toBe('Radfahrt');
  });

  it('leaves run titles unchanged for records without a sport', () => {
    expect(runTitle({ startTime: at(6), purpose: 'free' })).toBe('Morgenlauf');
    expect(
      runTitle({ startTime: at(6), purpose: 'free', sport: 'cycling' }),
    ).toBe('Morgenfahrt');
    // Ein benannter Zweck gilt für beide Sportarten.
    expect(
      runTitle({ startTime: at(6), purpose: 'intervals', sport: 'cycling' }),
    ).toBe('Intervalle');
  });
});
