/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import App from '../App';

const mockNativeState = {
  runs: [],
  recording: null,
  settings: { onboardedAt: 1 },
  capabilities: {},
};
const mockAlertAlert = jest.fn();
let mockStrengthState = { templates: [], active: null, history: [] };
let mockStrengthSessions: unknown[] = [];
let mockSorenessReports: unknown[] = [];

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  actual.NativeModules.Runback = {
    getState: jest.fn(async () => mockNativeState),
    getStrengthState: jest.fn(async () => mockStrengthState),
    getStrengthSessions: jest.fn(async () => ({ sessions: mockStrengthSessions })),
    getSorenessReports: jest.fn(async () => ({ reports: mockSorenessReports })),
    clearAllData: jest.fn(async () => {
      mockStrengthState = { templates: [], active: null, history: [] };
      mockStrengthSessions = [];
      mockSorenessReports = [];
    }),
  };
  Object.defineProperty(actual, 'Alert', { get: () => ({ alert: mockAlertAlert }), configurable: true });
  return actual;
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeEach(() => {
  mockAlertAlert.mockReset();
  mockStrengthState = { templates: [], active: null, history: [] };
  mockStrengthSessions = [];
  mockSorenessReports = [
    { at: Date.now(), nothingToday: false, entries: [{ regionId: 'quad_l', value: 7 }] },
  ];
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

test('keeps unvalidated freshness unknown while soreness remains available', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
  const muscleMapLink = renderer!.root
    .findAllByType(Text)
    .find(node => String(node.props.children) === 'Muskelkarte');
  expect(muscleMapLink).toBeDefined();
  await ReactTestRenderer.act(async () => {
    let target = muscleMapLink!.parent;
    while (target && typeof target.props.onPress !== 'function') {
      target = target.parent;
    }
    expect(target).toBeDefined();
    target!.props.onPress();
  });
  const lockedOutput = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .filter(value => typeof value === 'string')
    .join(' ');
  expect(lockedOutput).toContain('Noch nicht freigeschaltet');
  expect(lockedOutput).toContain('Warum noch unbekannt?');
  expect(lockedOutput).not.toContain('Frische: 100');
  const sorenessButton = renderer!.root
    .findAllByType(Text)
    .find(node => {
      if (String(node.props.children) !== 'Gemeldeter Muskelkater') return false;
      let target = node.parent;
      while (target && typeof target.props.onPress !== 'function') target = target.parent;
      return Boolean(target);
    });
  await ReactTestRenderer.act(async () => {
    let target = sorenessButton!.parent;
    while (target && typeof target.props.onPress !== 'function') target = target.parent;
    target!.props.onPress();
  });
  const output = renderer!.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .filter(value => typeof value === 'string')
    .join(' ');
  expect(output).toContain('Gemeldeter Muskelkater');
  expect(output).toContain('7');
  await ReactTestRenderer.act(async () => renderer!.unmount());
});
