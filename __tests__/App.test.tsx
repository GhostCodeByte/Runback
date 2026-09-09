/** @format */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NativeModules, Text } from 'react-native';
import App from '../App';
import { native } from '../src/native';
import { BodyMap } from '../src/ui/BodyMap';
import * as modelValidation from '../src/domain/modelValidation';
import * as calibration from '../src/domain/calibration';

const emptyStrength = () => ({ templates: [], active: null, history: [] });
const session = (id: string, name: string) => ({
  id,
  kind: 'strength' as const,
  name,
  startTime: 1,
  endTime: 2,
  status: 'finished' as const,
  exercises: [],
  currentExercise: 0,
  modelVersion: 'strength-v1',
  catalogVersion: 'catalog-v1',
});
const soreness = (value: number) => ({
  at: Date.now(),
  nothingToday: false,
  entries: [{ regionId: 'quad_l', value }],
});

let mockAppState: any;
let mockStrengthState: any;
let mockStrengthSessions: any[];
let mockSorenessReports: any[];
const mockAlertAlert = jest.fn();
const mockRestoreBackup = jest.fn();
const mockClearAllData = jest.fn();
const mockGetStrengthState = jest.fn(async () => mockStrengthState);
const mockGetStrengthSessions = jest.fn(async () => ({
  sessions: mockStrengthSessions,
}));
const mockGetSorenessReports = jest.fn(async () => ({
  reports: mockSorenessReports,
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  actual.NativeModules.Runback = {
    getState: jest.fn(async () => mockAppState),
    getStrengthState: mockGetStrengthState,
    getStrengthSessions: mockGetStrengthSessions,
    getSorenessReports: mockGetSorenessReports,
    restoreBackup: mockRestoreBackup,
    clearAllData: mockClearAllData,
  };
  Object.defineProperty(actual, 'Alert', {
    get: () => ({ alert: mockAlertAlert }),
    configurable: true,
  });
  return actual;
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeEach(() => {
  mockAppState = {
    runs: [],
    recording: null,
    settings: { onboardedAt: 1 },
    capabilities: {},
  };
  mockStrengthState = emptyStrength();
  mockStrengthSessions = [];
  mockSorenessReports = [soreness(7)];
  mockAlertAlert.mockReset();
  mockRestoreBackup.mockReset();
  mockClearAllData.mockReset();
  mockGetStrengthState.mockClear();
  mockGetStrengthSessions.mockClear();
  mockGetSorenessReports.mockClear();
  mockClearAllData.mockImplementation(async () => {
    mockAppState = {
      ...mockAppState,
      runs: [],
      settings: { onboardedAt: 1 },
      capabilities: {},
    };
    mockStrengthState = emptyStrength();
    mockStrengthSessions = [];
    mockSorenessReports = [];
  });
  mockRestoreBackup.mockImplementation(async () => ({
    cancelled: false,
    message: 'Backup geladen.',
  }));
  (native as any).strength = mockGetStrengthState;
  (native as any).strengthSessions = async () => mockStrengthSessions;
  (native as any).sorenessReports = async () => mockSorenessReports;
  Object.assign(NativeModules.Runback, {
    restoreBackup: mockRestoreBackup,
    clearAllData: mockClearAllData,
  });
});

async function renderLoaded() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  });
  return renderer;
}
function text(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  return renderer.root
    .findAllByType(Text)
    .find(node => String(node.props.children) === value);
}
function pressText(
  renderer: ReactTestRenderer.ReactTestRenderer,
  value: string,
) {
  const nodes = renderer.root
    .findAllByType(Text)
    .filter(node => String(node.props.children) === value);
  for (const node of nodes) {
    let target: any = node.parent;
    while (target && typeof target.props.onPress !== 'function')
      target = target.parent;
    if (target) return target.props.onPress;
  }
  throw new Error(`No pressable text found: ${value}`);
}
async function tap(
  renderer: ReactTestRenderer.ReactTestRenderer,
  value: string,
) {
  await ReactTestRenderer.act(async () => {
    await pressText(renderer, value)();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}
function alertButton(label: string) {
  const call = mockAlertAlert.mock.calls.at(-1);
  expect(call).toBeDefined();
  const button = call![2].find((item: any) => item.text === label);
  expect(button).toBeDefined();
  return button;
}
async function openData(renderer: ReactTestRenderer.ReactTestRenderer) {
  await tap(renderer, 'Mehr');
  await tap(renderer, 'Daten & Speicher');
}
async function openHistory(renderer: ReactTestRenderer.ReactTestRenderer) {
  await tap(renderer, 'Mehr');
  await tap(renderer, 'Kraft-Historie');
}
async function openMuscleMap(renderer: ReactTestRenderer.ReactTestRenderer) {
  await tap(renderer, 'Mehr');
  await tap(renderer, 'Muskelkarte');
}

test('renders correctly', async () => {
  const renderer = await renderLoaded();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('clearing data reloads the UI and removes old strength history and soreness', async () => {
  mockStrengthSessions = [session('old-session', 'Altes Training')];
  const renderer = await renderLoaded();
  await openHistory(renderer);
  expect(text(renderer, 'Altes Training')).toBeDefined();
  await openData(renderer);
  await tap(renderer, 'Alle lokalen Daten löschen');
  await ReactTestRenderer.act(async () => {
    alertButton('Alles löschen').onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  expect(mockClearAllData).toHaveBeenCalledTimes(1);
  expect(text(renderer, 'Lokale Daten gelöscht.')).toBeDefined();
  await openHistory(renderer);
  expect(text(renderer, 'Altes Training')).toBeUndefined();
  await openMuscleMap(renderer);
  await tap(renderer, 'Gemeldeter Muskelkater');
  expect(
    renderer.root.findAllByType(BodyMap)[0].props.values.quad_l,
  ).toBeNull();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('successful restore reloads the newly restored history and soreness', async () => {
  mockStrengthSessions = [session('old-session', 'Altes Training')];
  const renderer = await renderLoaded();
  await openData(renderer);
  await tap(renderer, 'Backup wiederherstellen');
  mockRestoreBackup.mockImplementationOnce(async () => {
    mockStrengthSessions = [session('new-session', 'Neues Training')];
    mockSorenessReports = [soreness(3)];
    return { cancelled: false, message: 'Backup geladen.' };
  });
  await ReactTestRenderer.act(async () => {
    alertButton('Backup wählen').onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  await openHistory(renderer);
  expect(text(renderer, 'Neues Training')).toBeDefined();
  expect(text(renderer, 'Altes Training')).toBeUndefined();
  await openMuscleMap(renderer);
  await tap(renderer, 'Gemeldeter Muskelkater');
  expect(renderer.root.findAllByType(BodyMap)[0].props.values.quad_l).toBe(3);
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('cancelled restore retains old state and does not reload training data', async () => {
  mockStrengthSessions = [session('old-session', 'Altes Training')];
  const renderer = await renderLoaded();
  const callsBefore = mockGetStrengthSessions.mock.calls.length;
  await openData(renderer);
  await tap(renderer, 'Backup wiederherstellen');
  mockRestoreBackup.mockResolvedValueOnce({ cancelled: true });
  await ReactTestRenderer.act(async () => {
    alertButton('Backup wählen').onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  expect(mockRestoreBackup).toHaveBeenCalledTimes(1);
  expect(mockGetStrengthSessions).toHaveBeenCalledTimes(callsBefore);
  await openHistory(renderer);
  expect(text(renderer, 'Altes Training')).toBeDefined();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('failed training reload does not preserve deleted previous history', async () => {
  mockStrengthSessions = [session('old-session', 'Altes Training')];
  const renderer = await renderLoaded();
  await openData(renderer);
  mockGetStrengthState.mockImplementationOnce(async () => {
    throw new Error('reload failed');
  });
  await tap(renderer, 'Alle lokalen Daten löschen');
  await ReactTestRenderer.act(async () => {
    alertButton('Alles löschen').onPress();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  await openHistory(renderer);
  expect(text(renderer, 'Altes Training')).toBeUndefined();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('locked muscle map does not invoke model validation and keeps all freshness values unknown', async () => {
  const unlockedSpy = jest.spyOn(modelValidation, 'modelIsUnlocked');
  const calibrateSpy = jest.spyOn(calibration, 'calibrateModel');
  const renderer = await renderLoaded();
  await openMuscleMap(renderer);
  const bodyMap = renderer.root.findAllByType(BodyMap)[0];
  expect(
    Object.values(bodyMap.props.values).every(value => value === null),
  ).toBe(true);
  expect(unlockedSpy).not.toHaveBeenCalled();
  expect(calibrateSpy).not.toHaveBeenCalled();
  await tap(renderer, 'Gemeldeter Muskelkater');
  expect(renderer.root.findAllByType(BodyMap)[0].props.values.quad_l).toBe(7);
  unlockedSpy.mockRestore();
  calibrateSpy.mockRestore();
  await ReactTestRenderer.act(async () => renderer.unmount());
});
