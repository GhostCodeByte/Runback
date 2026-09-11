import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Run } from '../native';
import type { StrengthSession } from '../domain/strength';
import type { ScheduleState } from '../domain/schedule';
import {
  buildDevelopmentFacts,
  DEVELOPMENT_RUN_LOAD_LIMIT,
  DEVELOPMENT_STRENGTH_LOAD_LIMIT,
  type DevelopmentPeriod,
  type DevelopmentFacts,
  type PlanPosition,
  type StrengthHistoryItem,
} from '../domain/development';
import {
  Button,
  Card,
  Copy,
  Section,
  Stat,
  Title,
  color,
  space,
  type,
} from './components';

const numberFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const distanceFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formatDistance = (meters: number) =>
  `${distanceFormatter.format(Math.max(0, meters) / 1000)} km`;

const formatDuration = (seconds: number) => {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${numberFormatter.format(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
};

const formatDate = (dateKey: string | undefined) => {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
};

const formatDateRange = (position: PlanPosition) => {
  const start = formatDate(position.startDate);
  const end = formatDate(position.targetDate);
  if (start && end) {
    return `${start} – ${end}`;
  }
  return start || end;
};

const signedNumber = (value: number) =>
  value > 0
    ? `+${numberFormatter.format(value)}`
    : numberFormatter.format(value);

function PeriodBlock({
  period,
  title,
}: {
  period: DevelopmentPeriod;
  title: string;
}) {
  const hasRuns = period.runCount > 0;
  return (
    <View style={styles.period}>
      <Text style={styles.periodTitle}>{title}</Text>
      <View style={styles.statRow}>
        <Stat
          label="Tage trainiert"
          value={
            period.hasTraining
              ? numberFormatter.format(period.trainingDays)
              : '–'
          }
        />
        <Stat
          label="Laufstrecke"
          value={hasRuns ? formatDistance(period.distanceMeters) : '–'}
        />
        <Stat
          label="Laufzeit"
          value={hasRuns ? formatDuration(period.durationSeconds) : '–'}
        />
      </View>
      <Text style={styles.periodMeta}>
        {hasRuns
          ? `${numberFormatter.format(period.runCount)} ${
              period.runCount === 1 ? 'Lauf' : 'Läufe'
            }`
          : period.hasTraining
          ? 'Kein Lauf in diesem Zeitraum'
          : 'Keine abgeschlossene Einheit'}
      </Text>
      {period.strengthSessionCount > 0 ? (
        <Text style={styles.periodMeta}>
          {numberFormatter.format(period.strengthSessionCount)}{' '}
          {period.strengthSessionCount === 1
            ? 'Krafteinheit'
            : 'Krafteinheiten'}{' '}
          · {numberFormatter.format(period.strengthCompletedSets)} bestätigte
          Sätze
        </Text>
      ) : null}
    </View>
  );
}

function PlanPositionCard({ position }: { position: PlanPosition | null }) {
  return (
    <Card>
      {position ? (
        <>
          <Text style={styles.planLabel}>{position.label}</Text>
          <Text style={styles.planMeta}>
            {position.timing === 'upcoming'
              ? 'Planbeginn liegt noch vor dir'
              : position.timing === 'ended'
              ? 'Geplanter Zeitraum beendet'
              : `Woche ${position.week}${
                  position.totalWeeks ? ` von ${position.totalWeeks}` : ''
                }`}
          </Text>
          <Copy muted>
            Zeitlicher Planstand, keine Bewertung deiner Leistung.
          </Copy>
          {position.phase && position.phase !== position.label ? (
            <Text style={styles.planMeta}>{position.phase}</Text>
          ) : null}
          {formatDateRange(position) ? (
            <Text style={styles.planMeta}>{formatDateRange(position)}</Text>
          ) : null}
        </>
      ) : (
        <Copy muted>Kein aktueller Planabschnitt hinterlegt.</Copy>
      )}
    </Card>
  );
}

function GoalCard({
  facts,
  goal,
  onEditGoal,
}: {
  facts: DevelopmentFacts;
  goal: string;
  onEditGoal: () => void;
}) {
  const evidence = facts.goalEvidence;
  return (
    <Card>
      <Text style={styles.goal}>
        {goal.trim() || 'Noch kein Ziel festgelegt'}
      </Text>
      <Button title="Ziel bearbeiten" onPress={onEditGoal} />
      <Text style={styles.evidence}>{evidence.message}</Text>
      {evidence.targetDistanceKm !== undefined ? (
        <View style={styles.factList}>
          <FactRow
            label="Zielstrecke"
            value={formatDistance(evidence.targetDistanceKm * 1000)}
          />
          <FactRow
            label="Längster erfasster Lauf"
            value={
              evidence.longestRunDistanceKm === undefined
                ? '–'
                : formatDistance(evidence.longestRunDistanceKm * 1000)
            }
          />
        </View>
      ) : null}
    </Card>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function StrengthHistoryCard({
  history,
  loadedLimitReached,
  available,
}: {
  history: DevelopmentFacts['strengthHistory'];
  loadedLimitReached: boolean;
  available: boolean;
}) {
  if (!available) {
    return (
      <Card>
        <Copy muted>Kraft-Historie momentan nicht verfügbar.</Copy>
      </Card>
    );
  }
  if (!history.hasData) {
    return (
      <Card>
        <Copy muted>
          Keine abgeschlossenen Krafttrainings mit bestätigten Werten.
        </Copy>
        {loadedLimitReached ? (
          <Copy muted>
            Geprüft wurden die höchstens 500 zuletzt geladenen Kraft-Einheiten.
          </Copy>
        ) : null}
      </Card>
    );
  }
  return (
    <Card>
      <View style={styles.statRow}>
        <Stat
          label="Erfasste Einheiten"
          value={numberFormatter.format(history.totalSessions)}
        />
        <Stat
          label="Sätze erfasst"
          value={numberFormatter.format(history.completedSets)}
        />
        <Stat
          label="kg bewegt"
          value={numberFormatter.format(Math.round(history.volumeKg))}
        />
      </View>
      <View style={styles.historyList}>
        {history.sessions.slice(0, 4).map(item => (
          <StrengthHistoryRow item={item} key={item.id} />
        ))}
      </View>
      {loadedLimitReached ? (
        <Copy muted>
          Geladen sind höchstens{' '}
          {numberFormatter.format(DEVELOPMENT_STRENGTH_LOAD_LIMIT)}{' '}
          Kraft-Einheiten; ältere Einheiten können fehlen.
        </Copy>
      ) : null}
      {history.sessions.length > 4 ? (
        <Copy muted>
          Weitere {numberFormatter.format(history.sessions.length - 4)}{' '}
          Einheiten in der Historie.
        </Copy>
      ) : null}
      <Copy muted>Nur bestätigte Satzwerte fließen in die Zahlen ein.</Copy>
    </Card>
  );
}

function StrengthHistoryRow({ item }: { item: StrengthHistoryItem }) {
  const date = dateFormatter.format(new Date(item.startTime));
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyText}>
        <Text style={styles.historyTitle}>{item.name}</Text>
        <Text style={styles.historyMeta}>{date || 'Datum unbekannt'}</Text>
      </View>
      <Text style={styles.historyValue}>
        {numberFormatter.format(item.completedSets)}{' '}
        {item.completedSets === 1 ? 'Satz' : 'Sätze'}
      </Text>
    </View>
  );
}

export interface DevelopmentScreenProps {
  runs: Run[];
  sessions: StrengthSession[];
  goal: string;
  now: number;
  schedule?: ScheduleState | null;
  onEditGoal: () => void;
  /** False when the native history query failed, rather than returned no rows. */
  strengthHistoryAvailable?: boolean;
}

/** Entwicklung: Planposition, beobachtete Aktivität und Zielnachweis. */
export function DevelopmentScreen({
  runs,
  sessions,
  goal,
  now,
  schedule = null,
  onEditGoal,
  strengthHistoryAvailable = true,
}: DevelopmentScreenProps) {
  const facts = useMemo(
    () => buildDevelopmentFacts({ runs, sessions, goal, now, schedule }),
    [goal, now, runs, schedule, sessions],
  );
  const comparison = facts.comparison;
  return (
    <View style={styles.content}>
      <Title>Entwicklung</Title>

      <Section title="Ziel">
        <GoalCard facts={facts} goal={goal} onEditGoal={onEditGoal} />
      </Section>

      <Section title="Im Trainingsplan">
        <PlanPositionCard position={facts.planPosition} />
      </Section>

      <Section title="Tatsächliches Training">
        <Card>
          <PeriodBlock period={facts.current} title="Letzte 4 Wochen" />
          <View style={styles.divider} />
          <PeriodBlock period={facts.previous} title="Davor" />
          {facts.current.hasTraining || facts.previous.hasTraining ? (
            <Text style={styles.comparison}>
              Trainingstage im Vergleich:{' '}
              {signedNumber(comparison.trainingDays)}
            </Text>
          ) : (
            <Copy muted>
              Für den Vergleich fehlen abgeschlossene Einheiten.
            </Copy>
          )}
          {!strengthHistoryAvailable ? (
            <Copy muted>
              Krafttraining ist momentan nicht geladen; Trainingstage und
              Vergleich berücksichtigen nur Läufe.
            </Copy>
          ) : null}
          {runs.length >= DEVELOPMENT_RUN_LOAD_LIMIT ? (
            <Copy muted>
              Die Laufzahlen basieren auf bis zu{' '}
              {numberFormatter.format(DEVELOPMENT_RUN_LOAD_LIMIT)} zuletzt
              geladenen Läufen.
            </Copy>
          ) : null}
        </Card>
      </Section>

      <Section title="Kraftverlauf">
        <StrengthHistoryCard
          history={facts.strengthHistory}
          loadedLimitReached={
            sessions.length >= DEVELOPMENT_STRENGTH_LOAD_LIMIT
          }
          available={strengthHistoryAvailable}
        />
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: space.xs,
    paddingBottom: space.xxl,
    gap: space.xs,
  },
  goal: { color: color.text, ...type.heading },
  evidence: { color: color.text, ...type.body },
  statRow: { flexDirection: 'row', gap: space.md },
  period: { gap: space.sm },
  periodTitle: { color: color.text, ...type.heading },
  periodMeta: { color: color.muted, ...type.label, fontWeight: '400' },
  divider: { borderTopWidth: 1, borderTopColor: color.line },
  comparison: { color: color.text, ...type.label },
  factList: { gap: space.xs },
  factRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  factLabel: { color: color.muted, ...type.label },
  factValue: {
    color: color.text,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
  planLabel: { color: color.text, ...type.heading },
  planMeta: { color: color.muted, ...type.label, fontWeight: '400' },
  historyList: { gap: 0 },
  historyRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  historyText: { flex: 1, gap: space.xxs },
  historyTitle: { color: color.text, ...type.body, fontWeight: '500' },
  historyMeta: { color: color.muted, ...type.label, fontWeight: '400' },
  historyValue: {
    color: color.text,
    ...type.label,
    fontVariant: ['tabular-nums'],
  },
});

export default DevelopmentScreen;
