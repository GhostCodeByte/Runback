import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { Run } from '../src/native';
import { predictRace } from '../src/domain/raceGoal';
import { GoalProgress } from '../src/ui/GoalProgress';

const localAt = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
};

const run = (id: string, date: string, km: number, seconds: number): Run => ({
  id,
  startTime: localAt(date),
  endTime: localAt(date) + seconds * 1000,
  durationSeconds: seconds,
  distanceMeters: km * 1000,
  purpose: 'easy',
  source: 'test',
  status: 'completed',
});

const NOW = localAt('2026-09-22');

const textContent = (node: TestRenderer.ReactTestInstance): string =>
  node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child),
    )
    .join('');

const render = (element: React.ReactElement) => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

const screenText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(textContent).join(' ');

describe('GoalProgress', () => {
  it('zeigt Ring, Schätzung und Ziel getrennt beschriftet', () => {
    const prediction = predictRace({
      goal: 'Halbmarathon',
      targetDate: '2026-11-15',
      targetSeconds: 2 * 3600,
      runs: [run('a', '2026-09-14', 12, 72 * 60)],
      now: NOW,
    });
    const tree = render(<GoalProgress prediction={prediction} onEdit={() => {}} />);
    const ring = tree.root.find(
      node => node.props.accessibilityRole === 'progressbar',
    );
    expect(ring.props.accessibilityValue.now).toBe(
      Math.round((prediction.progress as number) * 100),
    );
    const text = screenText(tree);
    expect(text).toContain('Halbmarathon');
    expect(text).toContain('Ziel 2:00:00 h');
    expect(text).toContain('Noch 54 Tage');
    expect(text).toContain('Geschätzt');
    expect(text).toContain('Ziel bearbeiten');
    act(() => {
      tree.unmount();
    });
  });

  it('bleibt ohne passenden Lauf leer statt zu raten', () => {
    const prediction = predictRace({
      goal: 'Halbmarathon',
      runs: [],
      now: NOW,
    });
    const tree = render(<GoalProgress prediction={prediction} compact />);
    const ring = tree.root.find(
      node => node.props.accessibilityRole === 'progressbar',
    );
    expect(ring.props.accessibilityValue).toBeUndefined();
    expect(screenText(tree)).toContain('fehlt ein Lauf über mindestens');
    expect(screenText(tree)).not.toContain('Geschätzt');
    act(() => {
      tree.unmount();
    });
  });
});
