import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatPace } from '../domain/analysis';
import {
  formatGoalTime,
  formatDistanceKm,
  type RacePrediction,
} from '../domain/raceGoal';
import {
  Button,
  Card,
  Copy,
  Disclosure,
  Ring,
  color,
  space,
  type,
} from './components';

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formatDateKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.getTime()) ? key : dateFormatter.format(date);
};

const daysLabel = (days: number) =>
  days < 0
    ? 'Zieldatum vorbei'
    : days === 0
    ? 'Heute'
    : days === 1
    ? 'Noch 1 Tag'
    : `Noch ${days} Tage`;

/**
 * Zielnähe: ein Ring, ein Satz, darunter die Fakten. Schätzung und Messung
 * bleiben getrennt beschriftet; unter „Details“ stehen Lauf, Modell und
 * Grenzen der Schätzung.
 */
export function GoalProgress({
  prediction,
  onEdit,
  compact = false,
}: {
  prediction: RacePrediction;
  onEdit?: () => void;
  /** Auf Heute: nur Ring und Satz, Details bleiben der Zielseite. */
  compact?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasGoal = prediction.status !== 'no_goal';
  const ringValue =
    prediction.status === 'estimated' && prediction.progress !== undefined
      ? prediction.progress
      : null;
  const header = (
    <View style={styles.header}>
      <Ring
        value={ringValue}
        label={`Zielnähe ${prediction.goal || 'kein Ziel'}`}
        caption="Zielnähe"
      />
      <View style={styles.headerText}>
        <Text style={styles.goal} numberOfLines={2}>
          {hasGoal ? prediction.goal : 'Noch kein Ziel festgelegt'}
        </Text>
        {prediction.targetDate ? (
          <Text style={styles.meta}>
            {formatDateKey(prediction.targetDate)}
            {prediction.daysToGo !== undefined
              ? ` · ${daysLabel(prediction.daysToGo)}`
              : ''}
          </Text>
        ) : null}
        {prediction.targetSeconds !== undefined ? (
          <Text style={styles.meta}>
            Ziel {formatGoalTime(prediction.targetSeconds)}
          </Text>
        ) : null}
      </View>
    </View>
  );
  return (
    <Card>
      {header}
      <Copy>{prediction.message}</Copy>
      {compact ? (
        onEdit ? (
          <Button secondary small title="Ziel ansehen" onPress={onEdit} />
        ) : null
      ) : (
        <>
          {prediction.status === 'estimated' ? (
            <View style={styles.facts}>
              <Fact
                label="Geschätzt"
                value={
                  prediction.predictedSeconds === undefined
                    ? '–'
                    : formatGoalTime(prediction.predictedSeconds)
                }
                note={
                  prediction.predictedPaceSecondsPerKm === undefined
                    ? undefined
                    : `${formatPace(prediction.predictedPaceSecondsPerKm)} /km`
                }
              />
              <Fact
                label="Längster Lauf"
                value={
                  prediction.longestRunKm === undefined
                    ? '–'
                    : formatDistanceKm(prediction.longestRunKm)
                }
                note={
                  prediction.peakLongRunKm === undefined
                    ? undefined
                    : `Aufbau bis ${formatDistanceKm(prediction.peakLongRunKm)}`
                }
              />
            </View>
          ) : null}
          {prediction.status === 'estimated' && prediction.reference ? (
            <Disclosure
              title="Details"
              subtitle="Lauf, Modell und Grenzen der Schätzung"
              open={detailsOpen}
              onToggle={setDetailsOpen}
            >
              <Copy muted>
                {`Grundlage: dein Lauf über ${formatDistanceKm(
                  prediction.reference.distanceKm,
                )} in ${formatGoalTime(
                  prediction.reference.durationSeconds,
                )} vom ${dateFormatter.format(
                  new Date(prediction.reference.startTime),
                )}.`}
              </Copy>
              <Copy muted>
                {`Zielnähe: ${
                  prediction.limitedBy === 'time'
                    ? 'die Zielzeit begrenzt'
                    : 'die Strecke begrenzt'
                } — ${Math.round(
                  (prediction.distanceShare ?? 0) * 100,
                )} % der Aufbaustrecke${
                  prediction.timeShare === undefined
                    ? ''
                    : `, ${Math.round(prediction.timeShare * 100)} % der Zielzeit`
                }.`}
              </Copy>
              {prediction.limits.map(limit => (
                <Copy muted key={limit}>
                  {limit}
                </Copy>
              ))}
              <Copy muted>{`Modell ${prediction.version}`}</Copy>
            </Disclosure>
          ) : null}
          {onEdit ? (
            <Button
              secondary
              small
              title={hasGoal ? 'Ziel bearbeiten' : 'Ziel festlegen'}
              onPress={onEdit}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factValue}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
      {note ? <Text style={styles.factLabel}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, gap: space.xxs },
  goal: { color: color.text, ...type.heading },
  meta: { color: color.muted, ...type.label, fontWeight: '400' },
  facts: { flexDirection: 'row', gap: space.md },
  fact: { flex: 1, gap: 2 },
  factValue: {
    color: color.text,
    ...type.value,
    fontVariant: ['tabular-nums'],
  },
  factLabel: { color: color.muted, ...type.micro, fontWeight: '400' },
});
