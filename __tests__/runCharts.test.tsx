import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Circle, Path } from 'react-native-svg';
import { KilometerTable, RunSeriesPanel } from '../src/ui/RunCharts';
import { Route } from '../src/ui/components';
import { kilometerSplits, type RunSeries } from '../src/domain/runSeries';
import type { RunSummary } from '../src/domain/types';

const run: RunSummary = {
  id: 'r1',
  startTime: 0,
  endTime: 600_000,
  durationSeconds: 600,
  distanceMeters: 2000,
  purpose: 'easy',
  source: 'phone',
  status: 'finished',
  avgHeartRate: 150,
  segments: [
    {
      distanceMeters: 1004,
      durationSeconds: 300,
      movingSeconds: 300,
      avgHeartRate: 148,
      ascentMeters: 12,
      startElapsedSeconds: 0,
      endElapsedSeconds: 300,
    },
    {
      distanceMeters: 996,
      durationSeconds: 300,
      avgHeartRate: 152,
      descentMeters: 12,
      startElapsedSeconds: 300,
      endElapsedSeconds: 600,
    },
  ],
};
const series: RunSeries = {
  stepSeconds: 5,
  rows: Array.from({ length: 120 }, (_, i) => ({
    elapsedSeconds: (i + 1) * 5,
    distanceMeters: (i + 1) * (2000 / 120),
    moving: i !== 60 && i !== 61,
    speedMps: i === 30 || i === 31 ? undefined : 3.3 + Math.sin(i / 9) * 0.3,
    heartRate: 140 + i / 6,
    elevationM: 100 + Math.sin(i / 20) * 12,
    latitude: 48 + i * 0.0002,
    longitude: 7.8 + Math.sin(i / 15) * 0.001,
    headwindMps: Math.cos(i / 15) * 2,
  })),
};

const texts = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children ?? ''),
    );

describe('Verlauf eines Laufs', () => {
  it('zeigt Gesamtwerte, Reiter nur für vorhandene Metriken und wählt beim Wischen einen Moment', async () => {
    const onSelect = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <RunSeriesPanel
          run={run}
          series={series}
          selected={null}
          onSelect={onSelect}
          range={null}
        />,
      );
    });
    const labels = tree.root
      .findAllByProps({ accessibilityRole: 'radio' })
      .map(node => node.props.accessibilityLabel);
    expect(labels).toEqual(
      expect.arrayContaining(['Tempo', 'Puls', 'Höhe', 'Wind', 'km', 'min']),
    );
    expect(labels).not.toContain('Kadenz');
    expect(texts(tree)).toContain('Gesamt · wischen zeigt einen Moment');
    expect(texts(tree)).toContain('5:00');

    const chart = tree.root.findByProps({ accessibilityRole: 'adjustable' });
    await act(async () => {
      chart.props.onLayout({ nativeEvent: { layout: { width: 340 } } });
    });
    await act(async () => {
      chart.props.onResponderGrant({ nativeEvent: { locationX: 340 - 40 } });
    });
    // Ganz rechts mit Relief (40 px Rand) ist das Ende der Strecke.
    expect(onSelect).toHaveBeenCalledWith(119);
  });

  it('liest am aktiven Moment ab und markiert GPS-Lücken statt zu interpolieren', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <RunSeriesPanel
          run={run}
          series={series}
          selected={30}
          onSelect={() => {}}
          range={[0, 59]}
        />,
      );
    });
    const all = texts(tree).join('|');
    expect(all).toContain('km 0,52');
    expect(all).toContain('2:35');
    // Tempo fehlt bei Zeile 30 (GPS-Lücke): Strich statt Zahl, kein Punkt auf der Linie.
    const pathData = tree.root
      .findAllByType(Path)
      .map(node => String(node.props.d));
    expect(pathData.some(d => (d.match(/M/g) || []).length >= 2)).toBe(true);
    expect(tree.root.findAllByType(Circle)).toHaveLength(0);
  });

  it('listet Kilometer als Balken und meldet Auswahl und Abwahl', async () => {
    const onSelect = jest.fn();
    const splits = kilometerSplits(run.segments);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <KilometerTable splits={splits} selected={1} onSelect={onSelect} />,
      );
    });
    // Nur die Pressables selbst, nicht die Host-Views, die ihre Props erben.
    const rows = tree.root.findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        typeof node.type !== 'string' &&
        node.props.accessibilityRole === 'button',
    );
    expect(rows.map(row => row.props.accessibilityLabel)).toEqual([
      'Kilometer 1: 4:59 pro Kilometer',
      'Kilometer 2: 5:01 pro Kilometer',
    ]);
    expect(rows[1].props.accessibilityState.selected).toBe(true);
    await act(async () => {
      rows[0].props.onPress();
    });
    expect(onSelect).toHaveBeenLastCalledWith(0);
    await act(async () => {
      rows[1].props.onPress();
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe('Karte mit aktivem Moment', () => {
  const points = series.rows.map(row => ({
    latitude: row.latitude!,
    longitude: row.longitude!,
    time: row.elapsedSeconds * 1000,
  }));

  it('zeigt Kilometer, Markierung und den aktiven Punkt und meldet Antippen', async () => {
    const onPick = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <Route
          points={points}
          overlay={{
            focus: points[10],
            highlight: points.slice(0, 20),
            markers: [{ point: points[59], label: '1' }],
            note: 'Wind SW 4 m/s',
            onPick,
          }}
        />,
      );
    });
    const map = tree.root.findByProps({ accessibilityRole: 'adjustable' });
    expect(map.props.accessibilityLabel).toContain('Antippen');
    expect(tree.root.findAllByType(Path)).toHaveLength(3);
    expect(texts(tree)).toContain('Wind SW 4 m/s');
    await act(async () => {
      map.props.onLayout({
        nativeEvent: { layout: { width: 360, height: 260 } },
      });
    });
    await act(async () => {
      map.props.onResponderGrant({
        nativeEvent: { locationX: 28, locationY: 232 },
      });
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toHaveProperty('latitude');
  });
});
