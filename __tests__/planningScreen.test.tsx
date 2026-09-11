import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { Run } from '../src/native';
import {
  PlanningScreen,
  type PlanningScreenProps,
} from '../src/ui/PlanningScreen';
import type { ScheduleState, ScheduledSession } from '../src/domain/schedule';

const localAt = (date: string, hour = 9, minute = 0): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
};

const emptySchedule = (
  overrides: Partial<ScheduleState> = {},
): ScheduleState => ({
  version: 1,
  sessions: [],
  availability: {},
  routine: { days: [], minutes: 30 },
  ...overrides,
});

const plannedSession = (
  overrides: Partial<ScheduledSession> = {},
): ScheduledSession => ({
  id: 'session-1',
  date: '2025-03-10',
  title: 'Locker Lauf',
  kind: 'run',
  minutes: 30,
  purpose: 'easy',
  locked: false,
  status: 'planned',
  effort: 'easy',
  ...overrides,
});

const completedRun = (id: string, date: string): Run => {
  const startTime = localAt(date, 8);
  return {
    id,
    startTime,
    endTime: startTime + 30 * 60 * 1000,
    durationSeconds: 30 * 60,
    distanceMeters: 5000,
    purpose: 'easy',
    source: 'test',
    status: 'completed',
  };
};

type SaveHandler = jest.Mock<Promise<void>, [ScheduleState]>;

interface RenderOptions {
  now?: number;
  runs?: Run[];
  onSave?: SaveHandler;
}

const renderPlanning = (
  state: ScheduleState = emptySchedule(),
  options: RenderOptions = {},
): TestRenderer.ReactTestRenderer => {
  const onSave = options.onSave ?? jest.fn<Promise<void>, [ScheduleState]>();
  onSave.mockResolvedValue(undefined);
  const props: PlanningScreenProps = {
    state,
    onSave,
    templates: [],
    runs: options.runs ?? [],
    strengthSessions: [],
    now: options.now ?? localAt('2025-03-12', 12),
    onStartRun: jest
      .fn<Promise<void>, [ScheduledSession]>()
      .mockResolvedValue(undefined),
    onStartStrength: jest
      .fn<Promise<void>, [ScheduledSession]>()
      .mockResolvedValue(undefined),
  };
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PlanningScreen {...props} />);
  });
  return tree;
};

const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');

const screenText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root.findAllByType(Text).map(textContent).join(' ');

const unmount = (tree: TestRenderer.ReactTestRenderer): void => {
  act(() => {
    tree.unmount();
  });
};

const findByLabel = (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): TestRenderer.ReactTestInstance =>
  tree.root.find(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

const press = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> => {
  const node = findByLabel(tree, label);
  await act(async () => {
    node.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const changeText = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
  value: string,
): Promise<void> => {
  const input = tree.root.find(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === 'function',
  );
  await act(async () => {
    input.props.onChangeText(value);
  });
};

describe('PlanningScreen', () => {
  it('renders March 2025 as seven columns across six complete calendar rows', async () => {
    const tree = renderPlanning(emptySchedule(), {
      now: localAt('2025-03-12', 12),
    });

    await press(tree, 'Monat');

    const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const shownWeekdays = tree.root
      .findAllByType(Text)
      .map(textContent)
      .filter(value => weekdayLabels.includes(value));
    expect(shownWeekdays).toEqual(weekdayLabels);

    const cells = tree.root.findAll(
      node =>
        typeof node.type === 'function' &&
        node.type.name === 'Pressable' &&
        node.props.accessibilityRole === 'button' &&
        typeof node.props.accessibilityLabel === 'string' &&
        /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), \d+\. /.test(
          node.props.accessibilityLabel,
        ),
    );
    expect(cells).toHaveLength(42);
    expect(
      cells.slice(0, 7).map(node => node.props.accessibilityLabel),
    ).toEqual([
      'Montag, 24. Februar',
      'Dienstag, 25. Februar',
      'Mittwoch, 26. Februar',
      'Donnerstag, 27. Februar',
      'Freitag, 28. Februar',
      'Samstag, 1. März',
      'Sonntag, 2. März',
    ]);
    expect(cells[41].props.accessibilityLabel).toBe('Sonntag, 6. April');
    unmount(tree);
  });

  it('previews a proposed week and saves only after explicit application', async () => {
    const onSave = jest.fn<Promise<void>, [ScheduleState]>();
    onSave.mockResolvedValue(undefined);
    const state = emptySchedule({
      availability: { '2025-03-10': 30 },
      routine: { days: [0], minutes: 30 },
    });
    const tree = renderPlanning(state, {
      now: localAt('2025-03-10', 12),
      onSave,
    });

    await press(
      tree,
      'Trainingswoche aus Rhythmus und Kraftvorlagen vorschlagen',
    );

    expect(screenText(tree)).toContain('Wochenvorschlag');
    expect(screenText(tree)).toContain('Vorschlag übernehmen');
    expect(onSave).not.toHaveBeenCalled();

    await press(tree, 'Vorschlag übernehmen');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sessions).toEqual([
      expect.objectContaining({
        date: '2025-03-10',
        origin: 'routine',
      }),
    ]);
    unmount(tree);
  });

  it('shows and applies a move-only week proposal', async () => {
    const onSave = jest.fn<Promise<void>, [ScheduleState]>();
    onSave.mockResolvedValue(undefined);
    const state = emptySchedule({
      sessions: [plannedSession({ id: 'move-me', title: 'Flexibler Lauf' })],
      availability: {
        '2025-03-10': 0,
        '2025-03-11': 30,
      },
    });
    const tree = renderPlanning(state, {
      now: localAt('2025-03-10', 12),
      onSave,
    });

    await press(
      tree,
      'Trainingswoche aus Rhythmus und Kraftvorlagen vorschlagen',
    );

    expect(screenText(tree)).toContain('Flexibler Lauf');
    expect(screenText(tree)).toContain('Vorschlag übernehmen');
    expect(onSave).not.toHaveBeenCalled();

    await press(tree, 'Vorschlag übernehmen');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sessions).toEqual([
      expect.objectContaining({ id: 'move-me', date: '2025-03-11' }),
    ]);
    unmount(tree);
  });

  it('keeps an editor draft after a failed save and retries the same draft', async () => {
    const onSave = jest.fn<Promise<void>, [ScheduleState]>();
    onSave
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(undefined);
    const state = emptySchedule({
      availability: { '2025-03-10': 30 },
    });
    const tree = renderPlanning(state, {
      now: localAt('2025-03-10', 12),
      onSave,
    });

    await press(tree, 'Einheit am Montag hinzufügen');
    await changeText(tree, 'Name der Einheit', 'Entwurf Intervall');
    await changeText(tree, 'Dauer in Minuten', '45');
    await press(tree, 'Speichern');

    expect(screenText(tree)).toContain('Speichern erneut versuchen');
    expect(screenText(tree)).toContain('Änderung nicht gespeichert. Offline');
    expect(
      tree.root.find(
        node =>
          node.props.accessibilityLabel === 'Name der Einheit' &&
          node.props.value === 'Entwurf Intervall',
      ),
    ).toBeTruthy();

    await press(tree, 'Erneut speichern');

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toEqual(onSave.mock.calls[0][0]);
    expect(screenText(tree)).toContain('Einheit hinzugefügt.');
    expect(screenText(tree)).not.toContain('Speichern erneut versuchen');
    expect(
      tree.root.findAll(
        node => node.props.accessibilityLabel === 'Name der Einheit',
      ),
    ).toHaveLength(0);
    unmount(tree);
  });

  it('moves a session into next week from the move dialog', async () => {
    const onSave = jest.fn<Promise<void>, [ScheduleState]>();
    onSave.mockResolvedValue(undefined);
    const state = emptySchedule({
      sessions: [
        plannedSession({
          id: 'move-next-week',
          date: '2025-03-12',
          title: 'Verschiebbarer Lauf',
        }),
      ],
    });
    const tree = renderPlanning(state, {
      now: localAt('2025-03-12', 12),
      onSave,
    });

    await press(tree, 'Einheit Verschiebbarer Lauf, Mittwoch, 12. März');
    await press(tree, 'Einheit verschieben');
    expect(screenText(tree)).toContain('Einheit verschieben');
    await press(tree, 'Nächste Woche zum Verschieben');
    expect(screenText(tree)).toContain('Montag, 17. März');
    await press(tree, 'Montag, 17. März');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sessions).toEqual([
      expect.objectContaining({ id: 'move-next-week', date: '2025-03-17' }),
    ]);
    unmount(tree);
  });

  it('uses linked actual completion and does not infer completion from the planned date', () => {
    const state = emptySchedule({
      sessions: [
        plannedSession({
          id: 'linked',
          title: 'Verknüpfter Lauf',
          activityId: 'actual-run',
        }),
        plannedSession({
          id: 'date-only',
          title: 'Nur geplanter Lauf',
          date: '2025-03-11',
        }),
      ],
    });
    const tree = renderPlanning(state, {
      now: localAt('2025-03-12', 12),
      runs: [completedRun('actual-run', '2025-03-10')],
    });

    const linked = tree.root.find(
      node =>
        node.props.accessibilityLabel ===
        'Einheit Verknüpfter Lauf, Montag, 10. März',
    );
    const dateOnly = tree.root.find(
      node =>
        node.props.accessibilityLabel ===
        'Einheit Nur geplanter Lauf, Dienstag, 11. März',
    );
    expect(textContent(linked)).toContain('Lauf · 30 min · Erledigt');
    expect(textContent(dateOnly)).toContain('Lauf · 30 min · Geplant');
    unmount(tree);
  });
});
