import {
  dayPartTitle,
  isMeaningfulRunName,
  purposeLabel,
  runTitle,
} from '../src/domain/runTitle';

const at = (hour: number) => new Date(2024, 4, 1, hour, 30).getTime();

describe('isMeaningfulRunName', () => {
  it('accepts names a person could have written', () => {
    expect(isMeaningfulRunName('Morning Run')).toBe(true);
    expect(isMeaningfulRunName('Feierabendrunde')).toBe(true);
    expect(isMeaningfulRunName('Intervalle Bahn')).toBe(true);
  });

  it('rejects file names, identifiers and time stamps', () => {
    expect(isMeaningfulRunName('activity_12345678')).toBe(false);
    expect(isMeaningfulRunName('2024-05-01T07-00-00')).toBe(false);
    expect(isMeaningfulRunName('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
      false,
    );
    expect(isMeaningfulRunName('9982371')).toBe(false);
    expect(isMeaningfulRunName('')).toBe(false);
    expect(isMeaningfulRunName(undefined)).toBe(false);
  });

  it('rejects the placeholder names the importers write', () => {
    expect(isMeaningfulRunName('Garmin Lauf')).toBe(false);
    expect(isMeaningfulRunName('Importierter Lauf')).toBe(false);
    expect(isMeaningfulRunName('activity')).toBe(false);
  });
});

describe('dayPartTitle', () => {
  it('names the part of the day the run started in', () => {
    expect(dayPartTitle(at(6))).toBe('Morgenlauf');
    expect(dayPartTitle(at(11))).toBe('Vormittagslauf');
    expect(dayPartTitle(at(12))).toBe('Mittagslauf');
    expect(dayPartTitle(at(15))).toBe('Nachmittagslauf');
    expect(dayPartTitle(at(19))).toBe('Abendlauf');
    expect(dayPartTitle(at(23))).toBe('Nachtlauf');
    expect(dayPartTitle(at(2))).toBe('Nachtlauf');
  });

  it('falls back without a usable start time', () => {
    expect(dayPartTitle(0)).toBe('Lauf');
  });
});

describe('runTitle', () => {
  it('prefers a meaningful name from the source', () => {
    expect(
      runTitle({ name: 'Morning Run', startTime: at(19), purpose: 'easy' }),
    ).toBe('Morning Run');
  });

  it('falls back to the purpose when the name is technical', () => {
    expect(
      runTitle({
        name: 'activity_12345678',
        startTime: at(19),
        purpose: 'intervals',
      }),
    ).toBe(purposeLabel('intervals'));
  });

  it('falls back to the part of the day without a usable purpose', () => {
    expect(
      runTitle({ name: 'Garmin Lauf', startTime: at(7), purpose: 'unknown' }),
    ).toBe('Morgenlauf');
    expect(runTitle({ startTime: at(19), purpose: 'free' })).toBe('Abendlauf');
  });
});
