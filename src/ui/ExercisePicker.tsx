import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { searchCatalog } from '../domain/catalog';
import type { Exercise } from '../domain/strength';
import { Button, color, Copy } from './components';

const equipmentLabel: Record<Exercise['equipment'], string> = {
  barbell: 'Langhantel',
  dumbbell: 'Kurzhantel',
  machine: 'Maschine',
  cable: 'Kabel',
  bodyweight: 'Eigengewicht',
  band: 'Band',
};

/** Übungsauswahl aus dem Katalog. */
export function ExercisePicker({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchCatalog(query, 40), [query]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Übung wählen</Text>
          <TextInput
            accessibilityLabel="Übung suchen"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Suchen"
            placeholderTextColor={color.muted}
            style={styles.search}
            value={query}
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
            {results.length ? (
              results.map(exercise => (
                <Pressable
                  accessibilityRole="button"
                  key={exercise.id}
                  onPress={() => {
                    setQuery('');
                    onSelect(exercise);
                  }}
                  style={({ pressed }) => [styles.item, pressed && styles.pressed]}
                >
                  <Text style={styles.itemName}>{exercise.name}</Text>
                  <Text style={styles.itemMeta}>
                    {equipmentLabel[exercise.equipment]}
                    {exercise.unilateral ? ' · einseitig' : ''}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Copy muted style={styles.empty}>
                Keine Übung mit diesem Namen im Katalog. Eigene Übungen lassen
                sich noch nicht anlegen.
              </Copy>
            )}
          </ScrollView>
          <Button secondary small title="Schließen" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 12,
    maxHeight: '85%',
  },
  title: { color: color.text, fontSize: 19, fontWeight: '600' },
  search: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    color: color.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  list: { flexGrow: 0 },
  item: {
    minHeight: 60,
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  itemName: { color: color.text, fontSize: 16 },
  itemMeta: { color: color.muted, fontSize: 13 },
  empty: { paddingVertical: 16 },
  pressed: { opacity: 0.72 },
});
