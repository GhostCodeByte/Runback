import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  Statistics,
  defaultStatisticsView,
  readStatisticsView,
  type StatisticsView,
} from '../src/ui/Statistics';
import type { Run } from '../src/native';

const NOW = Date.now();
const days = (count: number) => count * 24 * 60 * 60 * 1000;

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-1',
  startTime: NOW - days(2),
  endTime: NOW - days(2) + 3_600_000,
  durationSeconds: 3600,
  distanceMeters: 10000,
  purpose: 'easy',
  source: 'test',
  status: 'completed',
  ...overrides,
});

const pressables = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll(node => typeof node.props?.onPress === 'function');

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  pressables(tree).find(node => node.props.accessibilityLabel === label);

const labelStartingWith = (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) =>
  pressables(tree).find(node =>
    String(node.props.accessibilityLabel ?? '').startsWith(prefix),
  );

const texts = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('Text' as unknown as React.ComponentType)
    .map(node => JSON.stringify(node.props.children))
    .join(' ');

const render = (
  runs: Run[],
  view: StatisticsView = defaultStatisticsView,
  onViewChange?: (next: StatisticsView) => void,
) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <Statistics runs={runs} view={view} onViewChange={onViewChange} />,
    );
  });
  return tree;
};

describe('Statistik', () => {
  it('bietet ohne Läufe den leeren Zustand statt leerer Diagramme', () => {
    const tree = render([]);
    expect(JSON.stringify(tree.toJSON())).toContain('Noch keine Läufe');
    expect(byLabel(tree, 'Zeitraum')).toBeUndefined();
  });

  it('meldet den gewählten Zeitraum nach außen', () => {
    const onViewChange = jest.fn();
    const tree = render([run()], defaultStatisticsView, onViewChange);
    ReactTestRenderer.act(() => {
      byLabel(tree, '4 Wochen')!.props.onPress();
    });
    expect(onViewChange).toHaveBeenCalledWith({
      range: '4w',
      metric: 'distance',
    });
  });

  it('meldet die gewählte Kennzahl nach außen', () => {
    const onViewChange = jest.fn();
    const tree = render([run()], defaultStatisticsView, onViewChange);
    ReactTestRenderer.act(() => {
      byLabel(tree, 'Dauer')!.props.onPress();
    });
    expect(onViewChange).toHaveBeenCalledWith({
      range: '12w',
      metric: 'duration',
    });
  });

  it('verschweigt Kennzahlen, für die keine Daten vorliegen', () => {
    const bare = render([run({ distanceMeters: 200, durationSeconds: 90 })]);
    expect(byLabel(bare, 'Tempo')).toBeUndefined();
    expect(byLabel(bare, 'Gefühl')).toBeUndefined();

    const rated = render([run({ rpe: { legs: 5, breathing: 7, recordedAt: 1 } })]);
    expect(byLabel(rated, 'Tempo')).toBeDefined();
    expect(byLabel(rated, 'Gefühl')).toBeDefined();
  });

  it('öffnet die Werte eines Balkens an Ort und Stelle', () => {
    const tree = render([run()]);
    expect(texts(tree)).toContain('Balken antippen');

    const bar = labelStartingWith(tree, 'Woche ');
    ReactTestRenderer.act(() => {
      bar!.props.onPress();
    });
    const shown = texts(tree);
    expect(shown).not.toContain('Balken antippen');
    expect(shown).toContain('10,0 km');
  });

  it('klappt einen Abschnitt erst auf Anforderung auf', () => {
    const tree = render([run()]);
    const panel = labelStartingWith(tree, 'Bestwerte,')!;
    expect(panel.props.accessibilityState.expanded).toBe(false);
    expect(texts(tree)).not.toContain('Längster Lauf');

    ReactTestRenderer.act(() => {
      panel.props.onPress();
    });
    expect(texts(tree)).toContain('Längster Lauf');
  });
});

describe('readStatisticsView', () => {
  it('behält gespeicherte Auswahl und verwirft Unsinn', () => {
    expect(readStatisticsView({ range: '1y', metric: 'pace' })).toEqual({
      range: '1y',
      metric: 'pace',
    });
    expect(readStatisticsView({ range: 'gestern', metric: 42 })).toEqual(
      defaultStatisticsView,
    );
    expect(readStatisticsView(undefined)).toEqual(defaultStatisticsView);
  });
});
