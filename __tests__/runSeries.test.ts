import {
  availableMetrics,
  averagePace,
  compassLabel,
  formatHeadwind,
  formatPace,
  kilometerSplits,
  metricValue,
  nearestByPosition,
  nearestIndex,
  seriesTotals,
  splitRange,
  type RunSeries,
  type SeriesRow,
} from '../src/domain/runSeries';
import type { RunSummary, SegmentAggregate } from '../src/domain/types';

const row = (i: number, extra: Partial<SeriesRow> = {}): SeriesRow => ({
  elapsedSeconds: (i + 1) * 5,
  distanceMeters: i * 15,
  moving: true,
  speedMps: 3,
  latitude: 52 + i * 0.0001,
  longitude: 13,
  ...extra,
});
const series = (rows: SeriesRow[]): RunSeries => ({
  stepSeconds: 5,
  rows,
});
const run: RunSummary = {
  id: 'r1',
  startTime: 0,
  endTime: 3000_000,
  durationSeconds: 3000,
  distanceMeters: 10_000,
  purpose: 'easy',
  source: 'phone',
  status: 'finished',
  avgHeartRate: 147.4,
  time: {
    model_version: 't',
    elapsedSeconds: 3000,
    pausedSeconds: 0,
    activeSeconds: 3000,
    movingSeconds: 2900,
    runningSeconds: 2900,
    walkingSeconds: 0,
    stoppedSeconds: 100,
    unknownSeconds: 0,
  },
};

describe('Darstellungsreihe', () => {
  it('formatiert Tempo, Gegenwind und Himmelsrichtung deutsch', () => {
    expect(formatPace(299.6)).toBe('5:00');
    expect(formatPace(undefined)).toBe('–:––');
    expect(formatHeadwind(2.14)).toBe('+2,1');
    expect(formatHeadwind(-1.4)).toBe('−1,4');
    expect(formatHeadwind(0.01)).toBe('±0,0');
    expect(compassLabel(230)).toBe('SW');
    expect(compassLabel(359)).toBe('N');
  });

  it('kennt Tempo nur in Bewegung und bietet nur Metriken mit Werten an', () => {
    expect(metricValue(row(0), 'pace')).toBeCloseTo(333.3, 0);
    expect(
      metricValue(row(0, { speedMps: undefined }), 'pace'),
    ).toBeUndefined();
    expect(
      availableMetrics(series([row(0), row(1), row(2, { heartRate: 140 })])),
    ).toEqual(['pace']);
    expect(
      availableMetrics(
        series([
          row(0, { heartRate: 140, headwindMps: 1 }),
          row(1, { heartRate: 141, headwindMps: -1 }),
        ]),
      ),
    ).toEqual(['pace', 'heartRate', 'wind']);
    expect(availableMetrics(null)).toEqual([]);
  });

  it('findet die nächste Zeile nach Distanz, Zeit und Position', () => {
    const rows = [row(0), row(1), row(2), row(3)];
    expect(nearestIndex(rows, 'distance', 0)).toBe(0);
    expect(nearestIndex(rows, 'distance', 22)).toBe(1);
    expect(nearestIndex(rows, 'distance', 23)).toBe(2);
    expect(nearestIndex(rows, 'time', 100)).toBe(3);
    expect(nearestIndex([], 'time', 1)).toBe(-1);
    expect(nearestByPosition(rows, 52.00021, 13)).toBe(2);
    expect(nearestByPosition([row(0, { latitude: undefined })], 52, 13)).toBe(
      -1,
    );
  });

  it('macht aus nativen Abschnitten Kilometer mit Restlabel und Unsicherheit', () => {
    const segments: SegmentAggregate[] = [
      {
        distanceMeters: 1000,
        durationSeconds: 320,
        movingSeconds: 300,
        avgHeartRate: 140,
        ascentMeters: 6,
        descentMeters: 16,
        startElapsedSeconds: 0,
        endElapsedSeconds: 320,
      },
      {
        distanceMeters: 1000,
        durationSeconds: 310,
        gapSeconds: 14,
        startElapsedSeconds: 320,
        endElapsedSeconds: 630,
      },
      { distanceMeters: 420, durationSeconds: 140 },
    ];
    const splits = kilometerSplits(segments);
    expect(splits.map(s => s.label)).toEqual(['1', '2', '2,0–2,4']);
    expect(splits[0].secondsPerKm).toBe(300);
    expect(splits[0].uncertain).toBe(false);
    expect(splits[1].secondsPerKm).toBe(310);
    expect(splits[1].uncertain).toBe(true);
    expect(splits[2].secondsPerKm).toBeCloseTo(333.3, 0);
    expect(kilometerSplits(undefined)).toEqual([]);

    const rows = Array.from({ length: 130 }, (_, i) => row(i));
    expect(splitRange(rows, splits[0])).toEqual([0, 63]);
    expect(splitRange(rows, splits[2])).toBeNull();
  });

  it('rechnet Gesamtwerte aus Bewegungszeit, Puls, Höhe und Wind', () => {
    expect(averagePace(run)).toBe(290);
    expect(averagePace({ ...run, distanceMeters: 10 })).toBeUndefined();
    const totals = seriesTotals(
      {
        ...run,
        avgCadence: 176.6,
        elevation: {
          model_version: 'e',
          available: true,
          source: 'barometer',
          reference: 'absolute',
          ascentMeters: 95.6,
          descentMeters: 90,
          rejectedSamples: 0,
          hysteresisMeters: 3,
        },
      },
      series([row(0, { headwindMps: 2 }), row(1, { headwindMps: -1 })]),
    );
    expect(totals).toEqual({
      pace: '4:50',
      heartRate: '147',
      cadence: '177',
      elevation: '↗ 96 m',
      wind: '+0,5',
    });
    expect(seriesTotals({ ...run, avgHeartRate: undefined }, null)).toEqual({
      pace: '4:50',
    });
  });
});
