import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  exerciseProgress,
  formatWeight,
  referenceLabel,
  restRemaining,
  sessionProgress,
  type LoggedSet,
  type SessionExercise,
  type StrengthSession,
} from '../domain/strength';
import { color, Copy } from './components';

/**
 * Aktive Trainingsansicht nach docs/zielspezifikation-training.md T-4.
 *
 * Aufbau: erledigte Übungen als schmale Zeilen oben, die aktuelle Übung als
 * ausgeklappte Karte in der Mitte, kommende Übungen als schmale Zeilen unten.
 * Eine Zeile antippen wechselt die Übung.
 */

const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
};

const formatElapsed = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours
    ? `${hours} h ${String(minutes).padStart(2, '0')} min`
    : `${minutes} min`;
};

const plannedLabel = (set: LoggedSet) => {
  const { planned } = set;
  if (planned.kind === 'timed' && planned.seconds) {
    return `${planned.seconds} s`;
  }
  const weight =
    planned.loadKind === 'bodyweight'
      ? 'Eigengewicht'
      : planned.weightKg
      ? `${formatWeight(planned.weightKg)} kg`
      : null;
  const reps = planned.reps ? `${planned.reps} Wdh.` : null;
  return [weight, reps].filter(Boolean).join(' × ') || 'frei';
};

const kindLabel: Record<string, string> = {
  warmup: 'Aufwärmen',
  failure: 'bis Versagen',
  dropset: 'Dropsatz',
  timed: 'Zeitsatz',
};

function CompactRow({
  exercise,
  index,
  direction,
  onPress,
}: {
  exercise: SessionExercise;
  index: number;
  direction: 'up' | 'down';
  onPress: (index: number) => void;
}) {
  const progress = exerciseProgress(exercise);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${exercise.name}, ${progress.completed} von ${progress.total} Sätzen erledigt`}
      onPress={() => onPress(index)}
      style={({ pressed }) => [styles.compact, pressed && styles.pressed]}
    >
      <Text style={styles.compactArrow}>
        {direction === 'up' ? '↑' : '↓'}
      </Text>
      <Text numberOfLines={1} style={styles.compactName}>
        {exercise.name}
      </Text>
      <Text style={styles.compactCount}>
        {progress.completed}/{progress.total}
      </Text>
      <View style={[styles.check, progress.done && styles.checkDone]}>
        {progress.done ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

const SetRow = memo(function SetRow({
  set,
  position,
  reference,
  active,
  onComplete,
  onEdit,
}: {
  set: LoggedSet;
  position: number;
  reference: string | null;
  active: boolean;
  onComplete: (setId: string, weight: string, reps: string) => void;
  onEdit: (setId: string, weight: string, reps: string) => void;
}) {
  const initialWeight =
    set.actualWeightKg ?? set.planned.weightKg ?? undefined;
  const initialReps = set.actualReps ?? set.planned.reps ?? undefined;
  const [weight, setWeight] = useState(
    initialWeight === undefined ? '' : formatWeight(initialWeight),
  );
  const [reps, setReps] = useState(
    initialReps === undefined ? '' : String(initialReps),
  );
  const done = set.completedAt !== undefined;
  const timed = set.planned.kind === 'timed';
  const bodyweight = set.planned.loadKind === 'bodyweight';
  const note = kindLabel[set.planned.kind];

  return (
    <View
      style={[
        styles.setRow,
        done && styles.setRowDone,
        set.skipped && styles.setRowSkipped,
        active && !done && styles.setRowActive,
      ]}
    >
      <View style={styles.setNumber}>
        <Text style={styles.setNumberText}>{position}</Text>
        {note ? <Text style={styles.setKind}>{note}</Text> : null}
      </View>
      <View style={styles.setReference}>
        <Text numberOfLines={1} style={styles.referenceText}>
          {reference || plannedLabel(set)}
        </Text>
        <Text style={styles.referenceHint}>
          {reference ? 'zuletzt' : 'Vorgabe'}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={`Gewicht für Satz ${position}`}
        editable={!bodyweight}
        keyboardType="decimal-pad"
        onBlur={() => onEdit(set.id, weight, reps)}
        onChangeText={setWeight}
        placeholder={bodyweight ? 'KG' : '–'}
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={[styles.input, bodyweight && styles.inputDisabled]}
        value={bodyweight ? '' : weight}
      />
      <TextInput
        accessibilityLabel={`${timed ? 'Sekunden' : 'Wiederholungen'} für Satz ${position}`}
        keyboardType="number-pad"
        onBlur={() => onEdit(set.id, weight, reps)}
        onChangeText={setReps}
        placeholder="–"
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={styles.input}
        value={reps}
      />
      <Pressable
        accessibilityLabel={
          done ? `Satz ${position} zurücknehmen` : `Satz ${position} bestätigen`
        }
        accessibilityRole="button"
        accessibilityState={{ checked: done }}
        onPress={() => onComplete(set.id, weight, reps)}
        style={({ pressed }) => [
          styles.check,
          styles.checkLarge,
          done && styles.checkDone,
          pressed && styles.pressed,
        ]}
      >
        {done ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
    </View>
  );
});

export function WorkoutScreen({
  session,
  history,
  now,
  busy = false,
  onSelectExercise,
  onCompleteSet,
  onEditSet,
  onAddSet,
  onAddExercise,
  onFinish,
  onMinimize,
}: {
  session: StrengthSession;
  history: StrengthSession[];
  now: number;
  busy?: boolean;
  onSelectExercise: (index: number) => void;
  onCompleteSet: (
    exerciseIndex: number,
    setId: string,
    values: { actualWeightKg?: number; actualReps?: number },
  ) => void;
  onEditSet: (
    exerciseIndex: number,
    setId: string,
    values: { actualWeightKg?: number; actualReps?: number },
  ) => void;
  onAddSet: (exerciseIndex: number) => void;
  onAddExercise: () => void;
  onFinish: () => void;
  onMinimize: () => void;
}) {
  const index = session.currentExercise;
  const current = session.exercises[index];
  const progress = sessionProgress(session);
  const rest = restRemaining(session, now);
  const elapsed = Math.max(0, (now - session.startTime) / 1000);

  const parse = useCallback((weight: string, reps: string) => {
    const parsedWeight = Number(weight.replace(',', '.'));
    const parsedReps = Number(reps);
    return {
      actualWeightKg: Number.isFinite(parsedWeight) && weight.trim()
        ? parsedWeight
        : undefined,
      actualReps:
        Number.isFinite(parsedReps) && reps.trim()
          ? Math.round(parsedReps)
          : undefined,
    };
  }, []);

  const complete = useCallback(
    (setId: string, weight: string, reps: string) =>
      onCompleteSet(index, setId, parse(weight, reps)),
    [index, onCompleteSet, parse],
  );
  const edit = useCallback(
    (setId: string, weight: string, reps: string) =>
      onEditSet(index, setId, parse(weight, reps)),
    [index, onEditSet, parse],
  );

  const references = useMemo(
    () =>
      current
        ? current.sets.map((_, position) =>
            referenceLabel(history, current.exerciseId, position),
          )
        : [],
    [current, history],
  );

  const currentProgress = current
    ? exerciseProgress(current)
    : { completed: 0, total: 0, done: false, activeSetId: undefined };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Training in den Hintergrund legen"
          accessibilityRole="button"
          onPress={onMinimize}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {session.name}
          </Text>
          <Text style={styles.headerMeta}>
            {formatElapsed(elapsed)} · {progress.completedSets} von{' '}
            {progress.totalSets} Sätzen
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Training beenden"
          accessibilityRole="button"
          disabled={busy}
          onPress={onFinish}
          style={({ pressed }) => [
            styles.finish,
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.finishText}>Beenden</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {session.exercises.map((exercise, position) =>
          position < index ? (
            <CompactRow
              direction="up"
              exercise={exercise}
              index={position}
              key={`${exercise.exerciseId}-${position}`}
              onPress={onSelectExercise}
            />
          ) : null,
        )}

        {current ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{current.name}</Text>
            <Text style={styles.cardMeta}>
              {currentProgress.done
                ? 'Alle Sätze erledigt'
                : `Satz ${Math.min(
                    currentProgress.completed + 1,
                    currentProgress.total,
                  )} von ${currentProgress.total}`}
              {current.added ? ' · frei ergänzt' : ''}
            </Text>

            <View style={styles.columns}>
              <Text style={[styles.columnLabel, styles.columnNumber]}>#</Text>
              <Text style={[styles.columnLabel, styles.columnReference]}>
                Zuletzt
              </Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>kg</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>Wdh.</Text>
              <View style={styles.columnCheck} />
            </View>

            {current.sets.map((set, position) => (
              <View key={set.id}>
                <SetRow
                  active={currentProgress.activeSetId === set.id}
                  onComplete={complete}
                  onEdit={edit}
                  position={position + 1}
                  reference={references[position]}
                  set={set}
                />
                {rest !== null &&
                session.restStartedAt !== undefined &&
                set.completedAt === session.restStartedAt ? (
                  <View
                    accessibilityLabel={`Pause, noch ${formatClock(rest)}`}
                    style={styles.rest}
                  >
                    <View
                      style={[
                        styles.restFill,
                        {
                          width: `${Math.round(
                            (1 - rest / (session.restSeconds || 1)) * 100,
                          )}%`,
                        },
                      ]}
                    />
                    <Text style={styles.restText}>Pause {formatClock(rest)}</Text>
                  </View>
                ) : null}
              </View>
            ))}

            <Pressable
              accessibilityLabel="Satz hinzufügen"
              accessibilityRole="button"
              onPress={() => onAddSet(index)}
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>+ Satz</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Noch keine Übung</Text>
            <Copy muted>
              Füge eine Übung hinzu, um mit dem Aufzeichnen zu beginnen.
            </Copy>
          </View>
        )}

        {session.exercises.map((exercise, position) =>
          position > index ? (
            <CompactRow
              direction="down"
              exercise={exercise}
              index={position}
              key={`${exercise.exerciseId}-${position}`}
              onPress={onSelectExercise}
            />
          ) : null,
        )}

        <Pressable
          accessibilityLabel="Übung hinzufügen"
          accessibilityRole="button"
          onPress={onAddExercise}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
        >
          <Text style={styles.ghostText}>+ Übung</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  headerButtonText: { color: color.text, fontSize: 24, lineHeight: 26 },
  headerCenter: { flex: 1, gap: 2 },
  headerTitle: { color: color.text, fontSize: 17, fontWeight: '600' },
  headerMeta: { color: color.muted, fontSize: 13 },
  finish: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  finishText: { color: color.text, fontSize: 15, fontWeight: '600' },
  content: { padding: 12, paddingBottom: 40, gap: 8 },

  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: color.surface,
    opacity: 0.72,
  },
  compactArrow: { color: color.muted, fontSize: 14, width: 14 },
  compactName: { flex: 1, color: color.text, fontSize: 15 },
  compactCount: {
    color: color.muted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },

  card: {
    borderRadius: 12,
    backgroundColor: color.raised,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: color.text, fontSize: 22, fontWeight: '600' },
  cardMeta: { color: color.muted, fontSize: 14 },

  columns: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  columnLabel: { color: color.muted, fontSize: 12 },
  columnNumber: { width: 36 },
  columnReference: { flex: 1 },
  columnInput: { width: 64, textAlign: 'center' },
  columnCheck: { width: 44 },

  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 60,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  setRowActive: { backgroundColor: color.surface },
  setRowDone: { opacity: 0.6 },
  setRowSkipped: { opacity: 0.35 },
  setNumber: { width: 36, gap: 2 },
  setNumberText: {
    color: color.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  setKind: { color: color.muted, fontSize: 10 },
  setReference: { flex: 1, gap: 2 },
  referenceText: { color: color.text, fontSize: 14 },
  referenceHint: { color: color.muted, fontSize: 11 },
  input: {
    width: 64,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 6,
    fontVariant: ['tabular-nums'],
  },
  inputDisabled: { opacity: 0.4 },

  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLarge: { width: 44, height: 44 },
  checkDone: { backgroundColor: color.green, borderColor: color.green },
  checkMark: { color: color.ink, fontSize: 18, fontWeight: '700' },

  rest: {
    height: 34,
    borderRadius: 8,
    backgroundColor: color.surface,
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 4,
  },
  restFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: color.line,
  },
  restText: {
    color: color.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  ghost: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: color.text, fontSize: 15, fontWeight: '600' },

  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});
