import type { Run } from '../src/native';
import {
  baseLongRunKm,
  buildUpWeek,
  longRunSequence,
} from '../src/domain/buildUp';
import { suggestWeek, type ScheduleState } from '../src/domain/schedule';

const localAt = (date: string, hour = 9): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
};

const runAt = (id: string, date: string, km: number, paceSeconds = 360): Run => {
  const startTime = localAt(date);
  const durationSeconds = Math.round(km * paceSeconds);
  return {
    id,
    startTime,
    endTime: startTime + durationSeconds * 1000,
    durationSeconds,
    distanceMeters: km * 1000,
    purpose: 'easy',
    source: 'test',
    status: 'completed',
  };
};

// Montag, 21.09.2026; Halbmarathon Sonntag, 15.11.2026 (8 Wochen).
const TODAY = '2026-09-22';
const NOW = localAt(TODAY, 18);
const goal = { name: 'Halbmarathon', distanceKm: 21.0975, targetDate: '2026-11-15' };
const routine = { days: [1, 3, 6], minutes: 40 };
const runs = [
  runAt('w1', '2026-08-30', 8),
  runAt('w2', '2026-09-06', 10),
  runAt('w3', '2026-09-13', 11),
  runAt('w4', '2026-09-20', 12),
];

describe('Aufbau', () => {
  it('nimmt den Median der längsten Wochenläufe als Basis', () => {
    expect(baseLongRunKm(runs, NOW)).toEqual({ km: 10.5, weeks: 4 });
    expect(baseLongRunKm([runs[3]], NOW).km).toBeUndefined();
  });

  it('wächst um höchstens zehn Prozent und legt jede vierte Woche Erholung ein', () => {
    const sequence = longRunSequence(10, 19, 7);
    expect(sequence.map(item => item.km)).toEqual([11, 12.1, 13.3, 10.6, 14.6, 16.1, 17.7]);
    expect(sequence[3].recovery).toBe(true);
    expect(longRunSequence(18, 19, 3).map(item => item.km)).toEqual([19, 19, 19]);
  });

  it('plant den langen Lauf auf den letzten Routinetag und sagt, wie weit der Aufbau reicht', () => {
    const week = buildUpWeek({ goal, runs, routine, weekStart: '2026-09-21', today: TODAY, now: NOW });
    expect(week.status).toBe('ready');
    expect(week.phase).toBe('build');
    expect(week.weeksToGo).toBe(7);
    expect(week.longRunKm).toBe(11.6);
    const long = week.slots.find(slot => slot.purpose === 'long');
    expect(long?.routineDay).toBe(6);
    expect(long?.minutes).toBe(70);
    expect(week.slots.filter(slot => slot.purpose === 'easy')).toHaveLength(2);
    // 7 Aufbauwochen à 10 % ab 10,5 km enden unter 19 km.
    expect(week.reachableKm).toBeLessThan(19);
    expect(week.limits[0]).toContain('statt 19 km');
  });

  it('entlastet in der Vorwoche und setzt den Wettkampf auf das Zieldatum', () => {
    const taper = buildUpWeek({ goal, runs, routine, weekStart: '2026-11-02', today: TODAY, now: NOW });
    expect(taper.phase).toBe('taper');
    expect(taper.longRunKm).toBeCloseTo((taper.reachableKm as number) * 0.6, 0);
    const race = buildUpWeek({ goal, runs, routine, weekStart: '2026-11-09', today: TODAY, now: NOW });
    expect(race.phase).toBe('race');
    const raceSlot = race.slots.find(slot => slot.purpose === 'race');
    expect(raceSlot).toMatchObject({ routineDay: 6, title: 'Halbmarathon', effort: 'hard' });
    // Routinetag Samstag (5) liegt zu nah am Wettkampf, Montag und Mittwoch bleiben kurz.
    expect(race.slots.filter(slot => slot.purpose === 'easy').map(slot => slot.routineDay)).toEqual([1, 3]);
    expect(race.slots.every(slot => slot.purpose !== 'easy' || slot.minutes <= 30)).toBe(true);
  });

  it('bleibt ohne Lauftage oder Datenbasis ehrlich', () => {
    expect(
      buildUpWeek({ goal, runs, routine: { days: [], minutes: 40 }, weekStart: '2026-09-21', today: TODAY, now: NOW }).status,
    ).toBe('no_days');
    const thin = buildUpWeek({ goal, runs: [runs[3]], routine, weekStart: '2026-09-21', today: TODAY, now: NOW });
    expect(thin.status).toBe('insufficient_data');
    expect(thin.slots).toHaveLength(0);
    expect(thin.limits[0]).toContain('zwei der letzten vier Wochen');
    expect(
      buildUpWeek({ goal, runs, routine, weekStart: '2026-11-23', today: TODAY, now: NOW }).status,
    ).toBe('past_target');
  });

  it('fließt als Lauf-Slots in den Wochenvorschlag ein', () => {
    const week = buildUpWeek({ goal, runs, routine, weekStart: '2026-09-21', today: TODAY, now: NOW });
    const state: ScheduleState = { version: 1, sessions: [], availability: {}, routine };
    const suggestion = suggestWeek(state, '2026-09-21', { today: TODAY, runSlots: week.slots });
    expect(suggestion.addedSessions.map(session => [session.date, session.purpose, session.minutes])).toEqual([
      ['2026-09-22', 'easy', 40],
      ['2026-09-24', 'easy', 40],
      ['2026-09-27', 'long', 70],
    ]);
    expect(suggestion.addedSessions[2].title).toBe('Langer Lauf · 11,6 km');
    // Eine ausdrücklich knappe Verfügbarkeit bleibt eine Grenze: der lange
    // Lauf weicht auf einen anderen Tag aus.
    const tight = suggestWeek(
      { ...state, availability: { '2026-09-27': 30 } },
      '2026-09-21',
      { today: TODAY, runSlots: week.slots },
    );
    const long = tight.addedSessions.find(session => session.purpose === 'long');
    expect(long?.date).not.toBe('2026-09-27');
    expect(tight.suggestions[0]?.message).toContain('2026-09-27 passt nicht');
  });
});
