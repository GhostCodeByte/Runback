import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { RunInsights, deltaText, toneFor } from '../src/ui/RunInsights';
import { Stat, color } from '../src/ui/components';
import { pacingFor } from '../src/domain/analysis';
import type { RunSeries } from '../src/domain/runSeries';
import type { RunSummary } from '../src/domain/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function runWith(
  id: string,
  paces: number[],
  hrs: number[],
  extra: Partial<RunSummary> = {},
): RunSummary {
  let elapsed = 0;
  const segments = paces.map((pace, i) => {
    const start = elapsed;
    elapsed += pace;
    return {
      distanceMeters: 1000,
      durationSeconds: pace,
      movingSeconds: pace,
      avgHeartRate: hrs[i],
      startElapsedSeconds: start,
      endElapsedSeconds: elapsed,
      ascentMeters: 0,
      descentMeters: 0,
      gradePercent: 0,
    };
  });
  return {
    id,
    startTime: NOW,
    endTime: NOW + elapsed * 1000,
    durationSeconds: elapsed,
    distanceMeters: paces.length * 1000,
    purpose: 'easy',
    source: 'phone',
    status: 'completed',
    avgHeartRate: hrs.reduce((a, b) => a + b, 0) / hrs.length,
    avgHeartRateMin: 110,
    avgHeartRateMax: 175,
    avgCadence: 172,
    avgCadenceMin: 160,
    avgCadenceMax: 180,
    time: {
      model_version: 't',
      elapsedSeconds: elapsed + 90,
      pausedSeconds: 30,
      activeSeconds: elapsed + 60,
      movingSeconds: elapsed,
      runningSeconds: elapsed - 120,
      walkingSeconds: 120,
      stoppedSeconds: 60,
      unknownSeconds: 0,
    },
    phaseMetrics: {
      model_version: 'p',
      longestRunMeters: 3200,
      longestRunSeconds: 960,
      runWalkTransitions: 4,
      trailingIdleSeconds: 0,
      running: { seconds: elapsed - 120, meters: 3800, avgHeartRate: 152 },
      walking: { seconds: 120, meters: 200, avgHeartRate: 118 },
      stopped: { seconds: 60, meters: 0 },
    },
    context: { temperatureC: 21, windMps: 3 },
    segments,
    ...extra,
  };
}
const current = runWith('now', [300, 300, 300, 300], [150, 150, 152, 152]);
const history = [
  runWith('p1', [310, 310, 310, 310], [150, 150, 150, 150], {
    startTime: NOW - 2 * DAY,
  }),
  runWith('p2', [312, 312, 312, 312], [151, 151, 151, 151], {
    startTime: NOW - 6 * DAY,
  }),
  runWith('p3', [320, 320, 320, 320], [153, 153, 153, 153], {
    startTime: NOW - 12 * DAY,
  }),
];
const series: RunSeries = {
  stepSeconds: 5,
  wind: { mps: 3, fromDeg: 270 },
  rows: Array.from({ length: 240 }, (_, i) => ({
    elapsedSeconds: (i + 1) * 5,
    distanceMeters: (i + 1) * 16.7,
    moving: true,
    speedMps: 3.33,
    heartRate: 140 + (i % 40 > 20 ? 20 : 0),
    cadence: 172,
    headwindMps: i < 80 ? 2 : -1,
  })),
};

const texts = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children
            .map((child: unknown) =>
              typeof child === 'string' || typeof child === 'number'
                ? String(child)
                : '',
            )
            .join('')
        : String(node.props.children ?? ''),
    )
    .join('\n');

describe('Einblicke auf der Detailseite', () => {
  it('zeigt Bewegung, Pacing, Puls, Bedingungen und Vergleich', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <RunInsights
          run={current}
          series={series}
          history={history}
          pacing={pacingFor(current)}
          maxHeartRateSetting={190}
          onMaxHeartRate={() => {}}
        />,
      );
    });
    const all = texts(tree);
    expect(all).toContain('Bewegung');
    expect(all).toContain('gelaufen');
    expect(all).toContain('Längster Abschnitt am Stück');
    expect(all).toContain('3,20 km · 16:00 ohne Gehpause');
    expect(all).toContain('4×');
    expect(all).toContain('152 bpm · 118 bpm');
    expect(all).toContain('Pacing');
    expect(all).toContain('Beide Hälften gleich schnell.');
    expect(all).toContain('Puls & Schritt');
    expect(all).toContain('110–175 bpm');
    expect(all).toContain('160–180 spm');
    expect(all).toContain('Meter je Herzschlag');
    expect(all).toContain('Z3 moderat');
    expect(all).toContain('190 bpm · eingestellt');
    expect(all).toContain('Bedingungen');
    expect(all).toContain('21 °C · Wind 3 m/s aus W');
    expect(all).toContain('Wind am Tempo');
    expect(all).toContain('Wärme am Tempo');
    expect(all).toContain('Im Vergleich zu dir');
    expect(all).toContain(
      'Gegenüber dem Median deiner letzten 3 gleichartigen Läufe.',
    );
    expect(all).toContain('Tempo');
    expect(all).toContain('Basis 5:12 /km');
  });

  it('färbt bessere Werte grün und schreibt den Pfeil dazu', () => {
    const comparison = {
      count: 3,
      samePurpose: true,
      metrics: [
        {
          metric: 'pace' as const,
          value: 300,
          reference: 312,
          deltaPercent: -3.8,
          rating: 'better' as const,
        },
        {
          metric: 'heartRate' as const,
          value: 160,
          reference: 150,
          deltaPercent: 6.7,
          rating: 'worse' as const,
        },
      ],
    };
    expect(toneFor(comparison, 'pace')).toEqual({
      tone: 'better',
      delta: '−12 s/km',
    });
    expect(toneFor(comparison, 'heartRate')).toEqual({
      tone: 'worse',
      delta: '+10 bpm',
    });
    expect(toneFor(comparison, 'cadence')).toBeUndefined();
    expect(deltaText(comparison.metrics[0])).toBe('−12 s/km');

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <Stat value="5:00" label="/km" {...toneFor(comparison, 'pace')} />,
      );
    });
    const value = tree.root.findAllByType(Text)[0];
    const flat = Array.isArray(value.props.style)
      ? Object.assign({}, ...value.props.style.filter(Boolean))
      : value.props.style;
    expect(flat.color).toBe(color.green);
    expect(texts(tree)).toContain('▲');
    expect(texts(tree)).toContain('−12 s/km');
    expect(
      tree.root.findAll(
        n => n.props.accessibilityLabel === '5:00 /km, besser als zuletzt',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('lässt Sektionen ohne Daten weg und bietet den Maxpuls zum Eintragen an', () => {
    const bare: RunSummary = {
      id: 'bare',
      startTime: NOW,
      endTime: NOW + 600_000,
      durationSeconds: 600,
      distanceMeters: 2000,
      purpose: 'unknown',
      source: 'import',
      status: 'imported',
      avgHeartRate: 140,
    };
    const onMax = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <RunInsights
          run={bare}
          series={null}
          history={[]}
          onMaxHeartRate={onMax}
        />,
      );
    });
    const all = texts(tree);
    expect(all).not.toContain('Bewegung');
    expect(all).not.toContain('Pacing');
    expect(all).not.toContain('Bedingungen');
    expect(all).not.toContain('Im Vergleich zu dir');
    expect(all).toContain(
      'Noch nicht bekannt — eintragen oder drei Läufe mit Puls',
    );
    act(() => {
      tree.root
        .findAll(n => n.props.accessibilityLabel === 'Maxpuls')[0]
        .props.onPress();
    });
    const input = () => tree.root.findByType(TextInput);
    act(() => input().props.onChangeText('188'));
    act(() => input().props.onSubmitEditing());
    expect(onMax).toHaveBeenCalledWith(188);
    act(() => input().props.onChangeText('12'));
    act(() => input().props.onBlur());
    expect(onMax).toHaveBeenLastCalledWith(undefined);
  });
});
