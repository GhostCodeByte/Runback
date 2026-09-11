import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  AppState as AndroidAppState,
  Text,
  type AppStateStatus,
} from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/native', () => ({
  nativeCall: jest.fn(async () => ({})),
  normalizeRun: (raw: unknown) => raw,
  native: {
    state: jest.fn(),
    saveSettings: jest.fn(),
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
}));

import { native, nativeCall, type AppState } from '../src/native';
import { RunbackApp } from '../src/ui/RunbackApp';
import { PlanningScreen } from '../src/ui/PlanningScreen';
import { DevelopmentScreen } from '../src/ui/DevelopmentScreen';
import {
  localDateKey,
  addCalendarDays,
  normalizeSchedule,
  type ScheduledSession,
} from '../src/domain/schedule';

let stored: AppState;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');
let tree: TestRenderer.ReactTestRenderer;
const session = (): ScheduledSession => ({
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
async function tap(label: string) {
  await act(async () => {
    tree.root
      .find(
        node =>
          node.props.accessibilityLabel === label &&
          typeof node.props.onPress === 'function',
      )
      .props.onPress();
  });
}
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(<RunbackApp />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  (AndroidAppState.addEventListener as jest.Mock).mockImplementation(() => ({
    remove: jest.fn(),
  }));
  (native.strength as jest.Mock).mockResolvedValue({
    templates: [],
    active: null,
    history: [],
  });
  stored = {
    runs: [],
    recording: null,
    capabilities: {},
    settings: {
      onboardedAt: 1,
      goal: 'Regelmäßig laufen',
      trainingDays: [1, 3],
      minutes: 30,
      schedule: { ...normalizeSchedule(), sessions: [session()] },
    },
  };
  (native.state as jest.Mock).mockImplementation(async () => clone(stored));
  (native.saveSettings as jest.Mock).mockImplementation(async settings => {
    stored.settings = clone(settings);
  });
  (nativeCall as jest.Mock).mockImplementation(async method => {
    if (method === 'requestRecordingPermissions')
      return { locationPermission: true };
    if (method === 'startRun')
      stored.recording = {
        id: 'recorded-run',
        startTime: Date.now(),
        endTime: 0,
        status: 'recording',
        purpose: 'easy',
        durationSeconds: 0,
        distanceMeters: 0,
        source: 'phone',
        sourceVersion: 'native-v1',
        samples: 0,
      };
    return {};
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

it('saves calendar changes locally and restores them after reopening the app', async () => {
  await mount();
  await tap('Planung');
  const next = {
    ...normalizeSchedule(),
    sessions: [session()],
    availability: { [localDateKey()]: 45 },
    routine: { days: [0, 4], minutes: 45 },
  };
  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onSave(next);
  });
  expect(stored.settings.goal).toBe('Regelmäßig laufen');
  expect(stored.settings.schedule).toEqual(next);
  await act(async () => tree.unmount());
  await mount();
  await tap('Planung');
  expect(tree.root.findByType(PlanningScreen).props.state).toEqual(next);
});

it('leaves saved planning intact and rejects the caller on storage failure', async () => {
  await mount();
  await tap('Planung');
  const before = clone(stored.settings.schedule);
  (native.saveSettings as jest.Mock).mockRejectedValueOnce(
    new Error('Speicher voll'),
  );
  await act(async () => {
    await expect(
      tree.root.findByType(PlanningScreen).props.onSave(normalizeSchedule()),
    ).rejects.toThrow('Speicher voll');
  });
  expect(stored.settings.schedule).toEqual(before);
  expect(tree.root.findByType(PlanningScreen).props.state).toEqual(before);
});

it('links a started planned run to its recording without claiming completion', async () => {
  await mount();
  await tap('Planung');
  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onStartRun(session());
  });
  expect(nativeCall).toHaveBeenCalledWith('startRun', 'easy');
  expect(stored.settings.schedule?.sessions[0]).toMatchObject({
    activityId: 'recorded-run',
    status: 'planned',
  });
  expect(
    tree.root
      .findAllByType(Text)
      .some(node => node.props.children === 'Lauf läuft'),
  ).toBe(true);
});

it('keeps a failed activity link retryable without starting a second run', async () => {
  await mount();
  await tap('Planung');
  (native.saveSettings as jest.Mock).mockRejectedValueOnce(
    new Error('Speicher voll'),
  );

  await act(async () => {
    await expect(
      tree.root.findByType(PlanningScreen).props.onStartRun(session()),
    ).rejects.toThrow('Planung');
  });
  expect(stored.settings.schedule?.sessions[0].activityId).toBeUndefined();
  expect(
    tree.root
      .findAllByType(Text)
      .some(node => textContent(node).includes('Öffne Planung')),
  ).toBe(true);

  await tap('Planung');
  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onStartRun(session());
  });
  expect(stored.settings.schedule?.sessions[0]).toMatchObject({
    activityId: 'recorded-run',
    status: 'planned',
  });
  expect(
    (nativeCall as jest.Mock).mock.calls.filter(
      ([method]) => method === 'startRun',
    ),
  ).toHaveLength(1);
});

it('keeps the plan unlinked if recording permission is denied', async () => {
  (nativeCall as jest.Mock).mockResolvedValue({ locationPermission: false });
  await mount();
  await tap('Planung');
  await act(async () => {
    await expect(
      tree.root.findByType(PlanningScreen).props.onStartRun(session()),
    ).rejects.toThrow('Standortfreigabe');
  });
  expect(stored.settings.schedule?.sessions[0].activityId).toBeUndefined();
  expect(nativeCall).not.toHaveBeenCalledWith('startRun', 'easy');
});

it('opens development from planning using actual activity data', async () => {
  await mount();
  await tap('Planung');
  await act(async () =>
    tree.root.findByType(PlanningScreen).props.onDevelopment(),
  );
  expect(tree.root.findByType(DevelopmentScreen).props.goal).toBe(
    'Regelmäßig laufen',
  );
  expect(tree.root.findByType(DevelopmentScreen).props.runs).toEqual([]);
  await act(async () =>
    tree.root.findByType(DevelopmentScreen).props.onEditGoal(),
  );
  expect(
    tree.root.find(node => node.props.accessibilityLabel === 'Planbeginn'),
  ).toBeTruthy();
});

it('does not let a slow refresh overwrite a newly saved calendar', async () => {
  let activate: (value: AppStateStatus) => void = () => {};
  const listener = jest
    .spyOn(AndroidAppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      activate = callback;
      return { remove: jest.fn() };
    });
  await mount();
  await tap('Planung');
  const stale = clone(stored);
  let resolveRead!: (value: AppState) => void;
  (native.state as jest.Mock).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveRead = resolve;
      }),
  );
  await act(async () => activate('active'));
  const changed = {
    ...normalizeSchedule(),
    sessions: [{ ...session(), minutes: 50 }],
  };
  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onSave(changed);
  });
  await act(async () => resolveRead(stale));
  expect(
    tree.root.findByType(PlanningScreen).props.state.sessions[0].minutes,
  ).toBe(50);
  listener.mockRestore();
});

it('does not let a slow refresh erase a newly started recording', async () => {
  let activate: (value: AppStateStatus) => void = () => {};
  const listener = jest
    .spyOn(AndroidAppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      activate = callback;
      return { remove: jest.fn() };
    });
  await mount();
  await tap('Planung');
  const stale = clone(stored);
  let resolveRead!: (value: AppState) => void;
  (native.state as jest.Mock).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveRead = resolve;
      }),
  );
  await act(async () => activate('active'));

  await act(async () => {
    await tree.root.findByType(PlanningScreen).props.onStartRun(session());
  });
  await act(async () => resolveRead(stale));

  expect(
    tree.root
      .findAllByType(Text)
      .some(node => textContent(node).includes('Lauf läuft')),
  ).toBe(true);
  listener.mockRestore();
});

it('uses the schedule goal as canonical and preserves its routine in profile saves', async () => {
  const scheduleGoal = {
    name: '10 km im Herbst',
    startDate: localDateKey(),
  };
  const currentSchedule = stored.settings.schedule!;
  stored.settings = {
    ...stored.settings,
    goal: 'Altes Ziel',
    trainingDays: undefined,
    schedule: {
      ...currentSchedule,
      routine: { days: [2, 5], minutes: 30 },
      goal: scheduleGoal,
    },
  };

  await mount();
  await tap('Planung');
  await act(async () => tree.root.findByType(PlanningScreen).props.onDevelopment());
  expect(tree.root.findByType(DevelopmentScreen).props.goal).toBe(
    scheduleGoal.name,
  );

  await act(async () => tree.root.findByType(DevelopmentScreen).props.onEditGoal());
  expect(
    tree.root.find(node => node.props.accessibilityLabel === 'Übergeordnetes Laufziel')
      .props.value,
  ).toBe(scheduleGoal.name);

  const saveButton = tree.root.find(
    node =>
      node.props.title === 'Einstellungen speichern' &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => saveButton.props.onPress());

  expect(stored.settings.schedule?.routine.days).toEqual([2, 5]);
  expect(stored.settings.schedule?.goal?.name).toBe(scheduleGoal.name);
  expect(stored.settings.goal).toBe(scheduleGoal.name);
});

it('does not resurrect a recurring strength workout after moving it into next week', async () => {
  (native.strength as jest.Mock).mockResolvedValue({
    templates: [
      {
        id: 'gym',
        name: 'Beintraining',
        days: [new Date().getDay()],
        exercises: [],
        createdAt: 1,
      },
    ],
    active: null,
    history: [],
  });
  stored.settings.schedule!.sessions.push({
    ...session(),
    id: 'planned-gym',
    kind: 'strength',
    templateId: 'gym',
    title: 'Beintraining',
    date: addCalendarDays(localDateKey(), 7),
  });
  await mount();
  const text = tree.root.findAllByType(Text).map(textContent).join(' ');
  expect(text).not.toContain('Beintraining starten');
  expect(text).toContain('Freies Training starten');
});
