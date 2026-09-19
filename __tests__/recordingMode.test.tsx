import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, AppState as AndroidAppState, Text } from 'react-native';

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
async function tapText(label: string) {
  const node = pressables().find(item => textContent(item).includes(label));
  if (!node) throw new Error(`Kein antippbarer Text „${label}“.`);
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
  it('keeps the start card to one button and asks sport and purpose in the sheet', async () => {
    await mount();
    const home = screenText();
    // Die Startseite verlangt keine Entscheidung: kein Chip, kein Plan.
    expect(home).not.toContain('Sportart');
    expect(home).not.toContain('Zweck');
    expect(findPressable('Lauf starten')).toBeTruthy();
    expect(findPressable('Los')).toBeUndefined();

    await tap('Lauf starten');
    const sheet = screenText();
    expect(sheet).toContain('Laufen');
    expect(sheet).toContain('Radfahren');
    expect(sheet).toContain('Krafttraining');
    expect(sheet).toContain('Zweck');

    await tap('Radfahren');
    expect(stored.settings.sport).toBe('cycling');

    await tap('Intervalle');
    await tap('Los');
    expect(nativeCall).toHaveBeenCalledWith(
      'startRun',
      'intervals',
      'cycling',
      '{"kind":"none","version":1}',
    );
    const live = screenText();
    expect(live).toContain('Radfahrt läuft');
    expect(live).toContain('Fahrzeit');
    expect(live).toContain('Ø km/h');
    expect(live).not.toContain('min / km');
    expect(findPressable('Radfahrt beenden')).toBeTruthy();
  });

  it('puts the planned run first and keeps a free recording one tap away', async () => {
    stored.settings.schedule = {
      ...normalizeSchedule(),
      sessions: [plannedRun()],
    };
    await mount();
    expect(screenText()).toContain('Locker 30');
    expect(findPressable('Lauf starten')).toBeTruthy();
    expect(findPressable('Stattdessen etwas anderes starten')).toBeTruthy();
    expect(screenText()).not.toContain('Radfahren');

    await tap('Stattdessen etwas anderes starten');
    expect(screenText()).toContain('Radfahren');
    expect(findPressable('Los')).toBeTruthy();

    await tap('Los');
    expect(nativeCall).toHaveBeenCalledWith(
      'startRun',
      'free',
      'running',
      '{"kind":"none","version":1}',
    );
    // Eine freie Aufzeichnung verknüpft sich nicht mit dem Termin.
    expect(stored.settings.schedule?.sessions[0].activityId).toBeUndefined();
  });

  it('edits the pace target on its own page and returns to the sheet', async () => {
    await mount();
    expect(screenText()).not.toContain('Laufen nach');

    await tap('Lauf starten');
    expect(screenText()).toContain('Laufen nach');
    expect(screenText()).toContain('Ohne Ziel');
    expect(screenText()).not.toContain('Minuten pro Kilometer');

    await tapText('Laufen nach');
    expect(screenText()).toContain('Wie möchtest du laufen?');
    expect(findPressable('Los')).toBeUndefined();
    await tap('Tempo');
    expect(screenText()).toContain('Minuten pro Kilometer');
    await tap('Ziel übernehmen');
    expect(stored.settings.runTarget).toMatchObject({
      kind: 'pace',
      secondsPerKm: 330,
      mode: 'range',
    });

    // Zurück auf Heute steht das Sheet wieder offen, wo man es verlassen hat.
    expect(findPressable('Los')).toBeTruthy();
    await tap('Los');
    expect(nativeCall).toHaveBeenCalledWith(
      'startRun',
      'free',
      'running',
      expect.stringContaining('"secondsPerKm":330'),
    );
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
    await tap('Verlauf');
    let text = screenText();
    expect(text).toContain('Radfahrt');
    expect(text).toContain('30,0 km/h');
    expect(text).toContain('1 Lauf · 1 Radfahrt');
    // Der Wochenkopf zählt nur Laufkilometer: 10, nicht 10 + 30.
    expect(text).toContain('Diese Woche');
    expect(text).toContain('10,0 km');
    expect(text).not.toContain('40,0');

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
    await tap('Verlauf');
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
    expect(text).toContain('Fahrgefühl');
    expect(text).not.toContain('Nächster Schritt');
    expect(text).not.toContain('Tempoindex');
    // Art und Zweck ändern ist eine Ausnahme und liegt eingeklappt unten.
    expect(findPressable('Laufen')).toBeUndefined();

    await tap('Bearbeiten & verwalten');
    expect(screenText()).toContain('Art');
    await tap('Laufen');
    expect(native.feedback).toHaveBeenCalledWith('ride', { sport: 'running' });
  });
});

describe('Funktionen der Aufzeichnung', () => {
  const live = (): Run => ({
    id: 'live',
    startTime: Date.now() - 600_000,
    endTime: 0,
    status: 'recording',
    purpose: 'free',
    sport: 'running',
    durationSeconds: 600,
    distanceMeters: 2000,
    source: 'phone',
  });

  it('versteckt Radfahren, Krafttraining und „Laufen nach“, wenn sie abgewählt sind', async () => {
    stored.settings.features = {
      areas: { running: true, strength: false },
      sports: { cycling: false },
      recording: { targets: false },
    } as any;
    await mount();
    expect(screenText()).not.toContain('Krafttraining starten');
    await tap('Lauf starten');
    const sheet = screenText();
    expect(sheet).not.toContain('Radfahren');
    expect(sheet).not.toContain('Art der Einheit');
    expect(sheet).not.toContain('Laufen nach');
    expect(sheet).toContain('Zweck');
  });

  it('zeigt während der Aufzeichnung nur gewählte Kennzahlen', async () => {
    stored.settings.features = {
      recording: { metrics: ['heartRate'], primary: 'distance' },
    } as any;
    stored.recording = live();
    await mount();
    const text = screenText();
    expect(text).toContain('Kilometer');
    expect(text).toContain('Herzfrequenz');
    expect(text).not.toContain('Ø min / km');
  });

  it('kehrt nach dem Beenden direkt zu Heute zurück, wenn gewünscht', async () => {
    stored.settings.features = { recording: { afterRun: 'home' } } as any;
    stored.recording = live();
    (nativeCall as jest.Mock).mockImplementation(async (method: string) => {
      if (method === 'finishRun') {
        stored.runs = [finished({ id: 'live' })];
        stored.recording = null;
      }
      return {};
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) => {
        buttons
          ?.find(button => button.text === 'Beenden & speichern')
          ?.onPress?.();
      });
    await mount();
    await tap('Lauf beenden');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screenText()).toContain('Aufzeichnung gespeichert');
    expect(screenText()).toContain('Lauf starten');
    expect(screenText()).not.toContain('Notiz zu dieser Aufzeichnung');
    alert.mockRestore();
  });
});
