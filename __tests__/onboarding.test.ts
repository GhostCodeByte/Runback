import {
  ONBOARDING_STEP_IDS,
  parseMinutesInput,
  shouldShowOnboarding,
} from '../src/ui/Onboarding';

describe('onboarding', () => {
  it('covers welcome, goal, purpose, data, permissions and done', () => {
    expect(ONBOARDING_STEP_IDS).toEqual([
      'willkommen',
      'ziel',
      'zweck',
      'daten',
      'berechtigungen',
      'fertig',
    ]);
  });

  it('shows on first launch without runs or settings', () => {
    expect(
      shouldShowOnboarding({}, { loading: false, recording: false }),
    ).toBe(true);
  });

  it('stays hidden once completed or skipped', () => {
    expect(
      shouldShowOnboarding(
        { onboardedAt: 123, onboardingSkipped: false },
        { loading: false, recording: false },
      ),
    ).toBe(false);
    expect(
      shouldShowOnboarding(
        { onboardedAt: 123, onboardingSkipped: true },
        { loading: false, recording: false },
      ),
    ).toBe(false);
  });

  it('stays hidden while loading or recording', () => {
    expect(
      shouldShowOnboarding({}, { loading: true, recording: false }),
    ).toBe(false);
    expect(
      shouldShowOnboarding({}, { loading: false, recording: true }),
    ).toBe(false);
  });

  it('accepts only a usable time budget', () => {
    expect(parseMinutesInput('30')).toBe(30);
    expect(parseMinutesInput('5')).toBe(5);
    expect(parseMinutesInput('600')).toBe(600);
    expect(parseMinutesInput('4')).toBeUndefined();
    expect(parseMinutesInput('601')).toBeUndefined();
    expect(parseMinutesInput('12.5')).toBeUndefined();
    expect(parseMinutesInput('')).toBeUndefined();
    expect(parseMinutesInput('viel')).toBeUndefined();
  });
});
