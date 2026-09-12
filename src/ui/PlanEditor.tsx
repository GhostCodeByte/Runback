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
  addPlannedSet,
  addTemplateExercise,
  clearTemplateDays,
  moveTemplateExercise,
  removePlannedSet,
  removeTemplateExercise,
  renameTemplate,
  toggleTemplateDay,
  updatePlannedSet,
  validateTemplate,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  type PlannedSetValues,
} from '../domain/plans';
import {
  formatWeight,
  type Exercise,
  type LoadKind,
  type PlannedSet,
  type SetKind,
  type WorkoutTemplate,
} from '../domain/strength';
import { color, Copy } from './components';
import { ExercisePicker } from './ExercisePicker';

/**
 * Plan anlegen und bearbeiten.
 *
 * Der Plan ist ein Nutzerartefakt: Jede Änderung hier kommt vom Nutzer, nichts
 * verstellt sich von selbst. Offene Punkte stehen als ruhiger Hinweis neben
 * dem Feld und nicht als Fehlermeldung.
 */

const SET_KINDS: SetKind[] = ['warmup', 'normal', 'failure', 'dropset', 'timed'];

const setKindLabel: Record<SetKind, string> = {
  warmup: 'Aufwärmen',
  normal: 'Arbeitssatz',
  failure: 'bis Versagen',
  dropset: 'Dropsatz',
  timed: 'Zeitsatz',
};

const setKindShort: Record<SetKind, string> = {
  warmup: 'Aufw.',
  normal: 'Arbeit',
  failure: 'Vers.',
  dropset: 'Drop',
  timed: 'Zeit',
};

const loadKindLabel: Record<LoadKind, string> = {
  kg: 'Zusatzlast in kg',
  bodyweight: 'Eigengewicht',
  assisted: 'mit Unterstützung',
  bodyweight_plus: 'Eigengewicht plus Last',
};

const LOAD_KINDS: LoadKind[] = [
  'kg',
  'bodyweight',
  'assisted',
  'bodyweight_plus',
];

const nextIn = <T,>(values: T[], current: T): T =>
  values[(Math.max(0, values.indexOf(current)) + 1) % values.length];

const numberText = (value?: number) =>
  value === undefined ? '' : formatWeight(value);

const parseNumber = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const SetRow = memo(function SetRow({
  set,
  exerciseName,
  position,
  onChange,
  onCycleKind,
  onRemove,
  removable,
}: {
  set: PlannedSet;
  exerciseName: string;
  position: number;
  onChange: (values: PlannedSetValues) => void;
  onCycleKind: () => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const timed = set.kind === 'timed';
  const bodyweight = set.loadKind === 'bodyweight';
  const [weight, setWeight] = useState(numberText(set.weightKg));
  const [reps, setReps] = useState(
    numberText(timed ? set.seconds : set.reps),
  );
  const [rest, setRest] = useState(numberText(set.restSeconds));

  return (
    <View style={styles.setRow}>
      <Pressable
        accessibilityLabel={`Satzart für Satz ${position} von ${exerciseName}, jetzt ${setKindLabel[set.kind]}, weiterschalten`}
        accessibilityRole="button"
        onPress={onCycleKind}
        style={({ pressed }) => [styles.kind, pressed && styles.pressed]}
      >
        <Text style={styles.kindNumber}>{position}</Text>
        <Text numberOfLines={1} style={styles.kindLabel}>
          {setKindShort[set.kind]}
        </Text>
      </Pressable>
      <TextInput
        accessibilityLabel={`Gewicht für Satz ${position} von ${exerciseName} in Kilogramm`}
        editable={!bodyweight}
        keyboardType="decimal-pad"
        onBlur={() => onChange({ weightKg: parseNumber(weight) })}
        onChangeText={setWeight}
        placeholder={bodyweight ? '–' : 'kg'}
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={[styles.input, bodyweight && styles.inputDisabled]}
        value={bodyweight ? '' : weight}
      />
      <TextInput
        accessibilityLabel={`${
          timed ? 'Sekunden' : 'Wiederholungen'
        } für Satz ${position} von ${exerciseName}`}
        keyboardType="number-pad"
        onBlur={() =>
          onChange(
            timed
              ? { seconds: parseNumber(reps), reps: undefined }
              : { reps: parseNumber(reps), seconds: undefined },
          )
        }
        onChangeText={setReps}
        placeholder={timed ? 's' : 'Wdh.'}
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={styles.input}
        value={reps}
      />
      <TextInput
        accessibilityLabel={`Pause nach Satz ${position} von ${exerciseName} in Sekunden`}
        keyboardType="number-pad"
        onBlur={() => onChange({ restSeconds: parseNumber(rest) ?? 0 })}
        onChangeText={setRest}
        placeholder="s"
        placeholderTextColor={color.muted}
        selectTextOnFocus
        style={styles.input}
        value={rest}
      />
      <Pressable
        accessibilityLabel={`Satz ${position} von ${exerciseName} entfernen`}
        accessibilityRole="button"
        accessibilityState={{ disabled: !removable }}
        disabled={!removable}
        onPress={onRemove}
        style={({ pressed }) => [
          styles.iconButton,
          !removable && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.iconText}>−</Text>
      </Pressable>
    </View>
  );
});

export function PlanEditor({
  template,
  busy = false,
  onSave,
  onCancel,
}: {
  template: WorkoutTemplate;
  busy?: boolean;
  onSave: (template: WorkoutTemplate) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<WorkoutTemplate>(template);
  const [pickerOpen, setPickerOpen] = useState(false);
  const validation = useMemo(() => validateTemplate(draft), [draft]);

  const change = useCallback(
    (next: (current: WorkoutTemplate) => WorkoutTemplate) =>
      setDraft(current => next(current)),
    [],
  );

  const setValues = useCallback(
    (exerciseIndex: number, setIndex: number, values: PlannedSetValues) =>
      change(current =>
        updatePlannedSet(current, exerciseIndex, setIndex, values),
      ),
    [change],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Bearbeiten abbrechen"
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {draft.name.trim() || 'Neuer Plan'}
        </Text>
        <Pressable
          accessibilityLabel="Plan speichern"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !validation.ok }}
          disabled={busy || !validation.ok}
          onPress={() => onSave(draft)}
          style={({ pressed }) => [
            styles.save,
            (busy || !validation.ok) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.saveText}>Speichern</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            accessibilityLabel="Name des Plans"
            onChangeText={value => change(current => renameTemplate(current, value))}
            placeholder="Zum Beispiel Oberkörper A"
            placeholderTextColor={color.muted}
            style={styles.nameInput}
            value={draft.name}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Wochentage</Text>
          <Copy muted style={styles.hint}>
            Ohne festen Tag ist der Plan jederzeit startbar. Ein Tag ist ein
            Vorschlag, keine Verpflichtung.
          </Copy>
          <View style={styles.days}>
            {WEEKDAY_ORDER.map(day => {
              const active = draft.days.includes(day);
              return (
                <Pressable
                  accessibilityLabel={`${WEEKDAY_LABELS[day]}${
                    active ? ', ausgewählt' : ''
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={day}
                  onPress={() => change(current => toggleTemplateDay(current, day))}
                  style={({ pressed }) => [
                    styles.day,
                    active && styles.dayActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.dayText, active && styles.dayTextActive]}>
                    {WEEKDAY_SHORT[day]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityLabel="Keinen festen Tag festlegen"
            accessibilityRole="button"
            onPress={() => change(clearTemplateDays)}
            style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
          >
            <Text style={styles.ghostText}>Kein fester Tag</Text>
          </Pressable>
        </View>

        {draft.exercises.map((exercise, exerciseIndex) => (
          <View key={`${exercise.exerciseId}-${exerciseIndex}`} style={styles.card}>
            <View style={styles.exerciseHead}>
              <Text numberOfLines={2} style={styles.exerciseName}>
                {exercise.name}
              </Text>
              <Pressable
                accessibilityLabel={`${exercise.name} nach oben schieben`}
                accessibilityRole="button"
                accessibilityState={{ disabled: exerciseIndex === 0 }}
                disabled={exerciseIndex === 0}
                onPress={() =>
                  change(current =>
                    moveTemplateExercise(current, exerciseIndex, exerciseIndex - 1),
                  )
                }
                style={({ pressed }) => [
                  styles.iconButton,
                  exerciseIndex === 0 && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.iconText}>↑</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`${exercise.name} nach unten schieben`}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: exerciseIndex === draft.exercises.length - 1,
                }}
                disabled={exerciseIndex === draft.exercises.length - 1}
                onPress={() =>
                  change(current =>
                    moveTemplateExercise(current, exerciseIndex, exerciseIndex + 1),
                  )
                }
                style={({ pressed }) => [
                  styles.iconButton,
                  exerciseIndex === draft.exercises.length - 1 && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.iconText}>↓</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`${exercise.name} aus dem Plan nehmen`}
                accessibilityRole="button"
                onPress={() =>
                  change(current => removeTemplateExercise(current, exerciseIndex))
                }
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Text style={styles.iconText}>×</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityLabel={`Lastart für ${exercise.name}, jetzt ${
                loadKindLabel[exercise.sets[0]?.loadKind || 'kg']
              }, weiterschalten`}
              accessibilityRole="button"
              onPress={() =>
                change(current => {
                  const sets = current.exercises[exerciseIndex]?.sets || [];
                  const loadKind = nextIn(
                    LOAD_KINDS,
                    sets[0]?.loadKind || 'kg',
                  );
                  return sets.reduce(
                    (next, _set, setIndex) =>
                      updatePlannedSet(next, exerciseIndex, setIndex, { loadKind }),
                    current,
                  );
                })
              }
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>
                {loadKindLabel[exercise.sets[0]?.loadKind || 'kg']}
              </Text>
            </Pressable>

            <View style={styles.columns}>
              <Text style={[styles.columnLabel, styles.columnKind]}>Satz</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>kg</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>Wdh.</Text>
              <Text style={[styles.columnLabel, styles.columnInput]}>Pause</Text>
              <View style={styles.columnIcon} />
            </View>

            {exercise.sets.map((set, setIndex) => (
              <SetRow
                exerciseName={exercise.name}
                key={`${exercise.exerciseId}-${exerciseIndex}-${setIndex}-${set.kind}-${set.loadKind}`}
                onChange={values => setValues(exerciseIndex, setIndex, values)}
                onCycleKind={() =>
                  setValues(exerciseIndex, setIndex, {
                    kind: nextIn(SET_KINDS, set.kind),
                  })
                }
                onRemove={() =>
                  change(current =>
                    removePlannedSet(current, exerciseIndex, setIndex),
                  )
                }
                position={setIndex + 1}
                removable={exercise.sets.length > 1}
                set={set}
              />
            ))}

            <Pressable
              accessibilityLabel={`Satz zu ${exercise.name} hinzufügen`}
              accessibilityRole="button"
              onPress={() => change(current => addPlannedSet(current, exerciseIndex))}
              style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>+ Satz</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          accessibilityLabel="Übung zum Plan hinzufügen"
          accessibilityRole="button"
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
        >
          <Text style={styles.ghostText}>+ Übung</Text>
        </Pressable>

        {validation.problems.length ? (
          <View style={styles.notes}>
            {validation.problems.map(problem => (
              <Copy key={`${problem.field}-${problem.message}`} muted>
                {problem.message}
              </Copy>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ExercisePicker
        onClose={() => setPickerOpen(false)}
        onSelect={(exercise: Exercise) => {
          setPickerOpen(false);
          change(current => addTemplateExercise(current, exercise));
        }}
        visible={pickerOpen}
      />
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
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  headerButtonText: { color: color.text, fontSize: 24, lineHeight: 26 },
  headerTitle: { flex: 1, color: color.text, fontSize: 17, fontWeight: '600' },
  save: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.green,
  },
  saveText: { color: color.ink, fontSize: 15, fontWeight: '700' },

  content: { padding: 12, paddingBottom: 48, gap: 10 },
  card: {
    borderRadius: 8,
    backgroundColor: color.raised,
    padding: 14,
    gap: 10,
  },
  label: { color: color.muted, fontSize: 13 },
  hint: { fontSize: 14, lineHeight: 21 },
  nameInput: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 17,
    paddingHorizontal: 12,
  },

  days: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: { backgroundColor: color.green, borderColor: color.green },
  dayText: { color: color.text, fontSize: 14, fontWeight: '600' },
  dayTextActive: { color: color.ink },

  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exerciseName: { flex: 1, color: color.text, fontSize: 17, fontWeight: '600' },

  chip: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipText: { color: color.text, fontSize: 14 },

  columns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  columnLabel: { color: color.muted, fontSize: 12 },
  columnKind: { width: 52 },
  columnInput: { width: 60, textAlign: 'center' },
  columnIcon: { width: 44 },

  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kind: {
    width: 52,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  kindNumber: {
    color: color.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  kindLabel: { color: color.muted, fontSize: 10 },
  input: {
    width: 60,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 6,
    fontVariant: ['tabular-nums'],
  },
  inputDisabled: { opacity: 0.4 },

  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  iconText: { color: color.text, fontSize: 18, lineHeight: 20 },

  ghost: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: color.text, fontSize: 15, fontWeight: '600' },

  notes: { gap: 6, paddingHorizontal: 2 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});
