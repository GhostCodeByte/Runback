import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { daysLabel, WEEKDAY_LABELS } from '../domain/plans';
import type { WorkoutTemplate } from '../domain/strength';
import { Button, color, Copy } from './components';

/**
 * Übersicht der Trainingspläne.
 *
 * Ein Plan ist ein Vorschlag. Deshalb steht neben jedem Plan „Starten“, aber
 * nirgends eine Quote, ein Rückstand oder eine Mahnung. Löschen fragt einmal
 * nach, weil es sich nicht rückgängig machen lässt.
 */

const summary = (template: WorkoutTemplate) => {
  const exercises = template.exercises.length;
  const sets = template.exercises.reduce(
    (total, exercise) => total + exercise.sets.length,
    0,
  );
  if (!exercises) {
    return 'Noch keine Übung hinterlegt';
  }
  return `${exercises} ${exercises === 1 ? 'Übung' : 'Übungen'} · ${sets} ${
    sets === 1 ? 'Satz' : 'Sätze'
  }`;
};

export function PlanList({
  templates,
  today,
  busy = false,
  onCreate,
  onStart,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  templates: WorkoutTemplate[];
  /** Wochentag 0 (Sonntag) bis 6, wie `Date.getDay`. */
  today: number;
  busy?: boolean;
  onCreate: () => void;
  onStart: (template: WorkoutTemplate) => void;
  onEdit: (template: WorkoutTemplate) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <View style={styles.content}>
      <Text style={styles.title}>Trainingspläne</Text>
      <Copy muted>
        Ein Plan schlägt vor, was ansteht. Was du tatsächlich trainierst, zählt
        — auch wenn es etwas anderes ist.
      </Copy>

      {templates.length ? (
        templates.map(template => {
          const onToday = template.days.includes(today);
          const confirmingThis = confirming === template.id;
          return (
            <View key={template.id} style={styles.card}>
              <Text style={styles.name}>{template.name || 'Ohne Namen'}</Text>
              <Text style={styles.meta}>
                {daysLabel(template)} · {summary(template)}
                {onToday ? ` · heute ${WEEKDAY_LABELS[today]}` : ''}
              </Text>

              {confirmingThis ? (
                <>
                  <Copy muted>
                    {template.name || 'Diesen Plan'} endgültig löschen? Bereits
                    erfasste Einheiten bleiben erhalten.
                  </Copy>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel={`Löschen von ${template.name} bestätigen`}
                      accessibilityRole="button"
                      onPress={() => {
                        setConfirming(null);
                        onDelete(template.id);
                      }}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>Endgültig löschen</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Löschen abbrechen"
                      accessibilityRole="button"
                      onPress={() => setConfirming(null)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>Behalten</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Button
                    disabled={busy || !template.exercises.length}
                    label={`${template.name || 'Plan ohne Namen'} starten`}
                    small
                    title={`${template.name || 'Plan'} starten`}
                    onPress={() => onStart(template)}
                  />
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel={`${template.name} bearbeiten`}
                      accessibilityRole="button"
                      onPress={() => onEdit(template)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>Bearbeiten</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`${template.name} duplizieren`}
                      accessibilityRole="button"
                      onPress={() => onDuplicate(template.id)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>Duplizieren</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`${template.name} löschen`}
                      accessibilityRole="button"
                      onPress={() => setConfirming(template.id)}
                      style={({ pressed }) => [
                        styles.action,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>Löschen</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          );
        })
      ) : (
        <View style={styles.card}>
          <Text style={styles.name}>Noch kein Plan</Text>
          <Copy muted>
            Du kannst jederzeit frei trainieren. Ein Plan hilft nur dann, wenn
            du wiederkehrende Einheiten festhalten möchtest.
          </Copy>
        </View>
      )}

      <Button
        label="Neuen Trainingsplan anlegen"
        title="Neuen Plan anlegen"
        onPress={onCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 24 },
  title: { color: color.text, fontSize: 26, fontWeight: '600' },
  card: {
    borderRadius: 8,
    backgroundColor: color.raised,
    padding: 14,
    gap: 10,
  },
  name: { color: color.text, fontSize: 18, fontWeight: '600' },
  meta: { color: color.muted, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionText: { color: color.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.72 },
});
