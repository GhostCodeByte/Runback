import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState as AndroidAppState, Text } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/native', () => {
  const { normalizeRun } = jest.requireActual('../src/native');
  return {
    nativeCall: jest.fn(async () => ({})),
    normalizeRun,
    native: {
      state: jest.fn(),
      run: jest.fn(),
      saveSettings: jest.fn(),
      feedback: jest.fn(async () => undefined),
      strength: jest.fn(async () => ({
        templates: [],
        active: null,
        history: [],
      })),
      strengthSessions: jest.fn(async () => []),
      sorenessReports: jest.fn(async () => [
        { id: 'today', at: Date.now(), entries: [] },
      ]),
      saveStrengthSession: jest.fn(async () => ({})),
    },
  };
});

import { native, nativeCall, type AppState, type Run } from '../src/native';
import { RunbackApp } from '../src/ui/RunbackApp';
import {
  localDateKey,
  normalizeSchedule,
  type ScheduledSession,
} from '../src/domain/schedule';

let stored: AppState;
let tree: TestRenderer.ReactTestRenderer;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');
const screenText = () =>
  tree.root.findAllByType(Text).map(textContent).join(' ');
const pressables = () =>
  tree.root.findAll(node => typeof node.props.onPress === 'function');
const findPressable = (label: string) =>
  pressables().find(
    node =>
      node.props.accessibilityLabel === label ||
      node.props.title === label ||
      (node.props.accessibilityRole === 'tab' &&
        textContent(node).includes(label)),
  );
async function tap(label: string) {
  const node = findPressable(label);
  if (!node) {
    throw new Error(`Kein antippbares Element „${label}“.`);
  }
  await act(async () => {
    node.props.onPress();
  });
}
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(<RunbackApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const HOUR = 3600 * 1000;
const finished = (overrides: Partial<Run>): Run => ({
  id: 'run',
  startTime: Date.now() - 2 * HOUR,
  endTime: Date.now() - HOUR,
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'free',
  source: 'phone',
  status: 'completed',
  ...overrides,
});
const plannedRun = (): ScheduledSession => ({
  id: 'planned-run',
  title: 'Locker 30',
  date: localDateKey(),
  kind: 'run',
  minutes: 30,
  purpose: 'easy',
  locked: false,
  status: 'planned',
  effort: 'easy',
});

beforeEach(() => {
  jest.clearAllMocks();
  (AndroidAppState.addEventListener as jest.Mock).mockImplementation(() => ({
    remove: jest.fn(),
  }));
  stored = {
    runs: [],
    recording: null,
    capabilities: {},
    settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
  };
  (native.state as jest.Mock).mockImplementation(async () => clone(stored));
  (native.run as jest.Mock).mockImplementation(async (id: string) =>
    clone(stored.runs.find(run => run.id === id)!),
  );
  (native.saveSettings as jest.Mock).mockImplementation(async settings => {
    stored.settings = clone(settings);
  });
  (nativeCall as jest.Mock).mockImplementation(
    async (method: string, ...args: unknown[]) => {
      if (method === 'requestRecordingPermissions') {
        return { locationPermission: true };
      }
      if (method === 'startRun') {
        stored.recording = {
          id: 'recorded',
          startTime: Date.now(),
          endTime: 0,
          status: 'recording',
          purpose: args[0] as Run['purpose'],
          sport: args[1] as Run['sport'],
          durationSeconds: 0,
          distanceMeters: 0,
          source: 'phone',
        };
        return { recording: clone(stored.recording) };
      }
      return {};
    },
  );
});
afterEach(async () => {
  if (tree) {
    await act(async () => tree.unmount());
  }
});

describe('Freie Aufzeichnung auf Heute', () => {
  it('offers sport and purpose without any plan and starts with both', async () => {
    await mount();
    const text = screenText();
    expect(text).toContain('Art');
    expect(text).toContain('Laufen');
    expect(text).toContain('Radfahren');
    expect(text).toContain('Zweck');
    expect(findPressable('Lauf starten')).toBeTruthy();
    // Kein Plan nötig: Die Karte verlangt weder Termin noch Vorlage.
    expect(text).not.toContain('Geplanten Lauf starten');

    await tap('Radfahren');
    expect(stored.settings.sport).toBe('cycling');
    expect(findPressable('Radfahrt starten')).toBeTruthy();

    await tap('Intervalle');
    await tap('Radfahrt starten');
    expect(nativeCall).toHaveBeenCalledWith('startRun', 'intervals', 'cycling');
    const live = screenText();
    expect(live).toContain('Radfahrt läuft');
    expect(live).toContain('Fahrzeit');
    expect(live).toContain('Ø km/h');
    expect(live).not.toContain('min / km');
    expect(findPressable('Radfahrt beenden')).toBeTruthy();
  });

  it('keeps the free recording one tap away when a run is planned today', async () => {
    stored.settings.schedule = {
      ...normalizeSchedule(),
      sessions: [plannedRun()],
    };
    await mount();
    expect(findPressable('Geplanten Lauf starten')).toBeTruthy();
    expect(findPressable('Stattdessen frei aufzeichnen')).toBeTruthy();
    expect(screenText()).not.toContain('Radfahren');

    await tap('Stattdessen frei aufzeichnen');
    const text = screenText();
    expect(text).toContain('Radfahren');
    expect(findPressable('Lauf starten')).toBeTruthy();
    // Der Plan bleibt erreichbar, aber nachrangig.
    expect(findPressable('Geplanten Lauf starten')).toBeTruthy();

    await tap('Lauf starten');
    expect(nativeCall).toHaveBeenCalledWith('startRun', 'free', 'running');
    // Eine freie Aufzeichnung verknüpft sich nicht mit dem Termin.
    expect(stored.settings.schedule?.sessions[0].activityId).toBeUndefined();
  });
});

describe('Radfahrten in Einheiten und Detail', () => {
  beforeEach(() => {
    stored.runs = [
      finished({ id: 'ride', sport: 'cycling', distanceMeters: 30000 }),
      finished({
        id: 'run',
        startTime: Date.now() - 26 * HOUR,
        endTime: Date.now() - 25 * HOUR,
      }),
    ];
  });

  it('lists rides with their own label and speed, filtered separately', async () => {
    await mount();
    // Die Startkarte zählt nur Laufkilometer: 10, nicht 10 + 30.
    expect(screenText()).toContain('10,0 km in 7 Tagen');
    expect(screenText()).not.toContain('40,0');

    await tap('Einheiten');
    let text = screenText();
    expect(text).toContain('Radfahrt');
    expect(text).toContain('30,0 km/h');
    expect(text).toContain('1 Lauf · 1 Radfahrt');

    await tap('Radfahren');
    text = screenText();
    expect(text).toContain('1 Radfahrt');
    expect(text).not.toContain('1 Lauf ');

    await tap('Laufen');
    text = screenText();
    expect(text).toContain('1 Lauf');
    expect(text).not.toContain('km/h');
  });

  it('shows a ride without the running analysis but with a correctable sport', async () => {
    await mount();
    await tap('Einheiten');
    const row = pressables().find(node =>
      (node.props.accessibilityLabel || '').startsWith('Radfahrt:'),
    );
    expect(row).toBeTruthy();
    await act(async () => {
      row!.props.onPress();
    });
    const text = screenText();
    expect(text).toContain('Fahrzeit');
    expect(text).toContain('Ø km/h');
    expect(text).toContain('Art');
    expect(text).toContain('Fahrgefühl');
    expect(text).not.toContain('Nächster Schritt');
    expect(text).not.toContain('Tempoindex');

    await tap('Laufen');
    expect(native.feedback).toHaveBeenCalledWith('ride', { sport: 'running' });
  });
});
