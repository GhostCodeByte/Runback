import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { PlanEditor } from '../src/ui/PlanEditor';
import { PlanList } from '../src/ui/PlanList';
import { createTemplate } from '../src/domain/plans';
import { catalogExercise } from '../src/domain/catalog';
import type { Exercise, WorkoutTemplate } from '../src/domain/strength';

const NOW = 1_700_000_000_000;

const template = (): WorkoutTemplate => ({
  id: 'template-1',
  name: 'Unterkörper',
  days: [1, 4],
  createdAt: NOW,
  exercises: [
    {
      exerciseId: 'barbell_back_squat',
      name: 'Kniebeuge (Langhantel)',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 100, restSeconds: 180 },
        { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 100, restSeconds: 180 },
      ],
    },
    {
      exerciseId: 'lying_leg_curl',
      name: 'Beinbeuger liegend',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 10, weightKg: 40, restSeconds: 90 },
      ],
    },
  ],
});

/** Sammelt jeden dargestellten Textknoten, unabhängig von der Verschachtelung. */
const texts = (tree: ReactTestRenderer.ReactTestRenderer): string[] => {
  const found: string[] = [];
  const walk = (node: any) => {
    if (node === null || node === undefined || typeof node === 'boolean') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      found.push(String(node));
      return;
    }
    const children = node.children;
    if (!children) {
      return;
    }
    if (node.type === 'Text') {
      const joined = children
        .filter(
          (child: unknown) =>
            typeof child === 'string' || typeof child === 'number',
        )
        .join('');
      if (joined) {
        found.push(joined);
      }
    }
    children.forEach(walk);
  };
  walk(tree.toJSON());
  return found;
};

const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.find(
    node =>
      typeof node.type !== 'string' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

const inputByLabel = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root.find(
    node =>
      typeof node.type !== 'string' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === 'function',
  );

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  ReactTestRenderer.act(() => {
    byLabel(tree, label).props.onPress();
  });

const type = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  value: string,
) => {
  const input = inputByLabel(tree, label);
  ReactTestRenderer.act(() => {
    input.props.onChangeText(value);
  });
  if (input.props.onBlur) {
    ReactTestRenderer.act(() => {
      input.props.onBlur();
    });
  }
};

const renderEditor = (
  plan: WorkoutTemplate,
  handlers: { onSave: jest.Mock; onCancel: jest.Mock },
) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <PlanEditor
        onCancel={handlers.onCancel}
        onSave={handlers.onSave}
        template={plan}
      />,
    );
  });
  return tree;
};

const editorHandlers = () => ({ onSave: jest.fn(), onCancel: jest.fn() });

describe('Planeditor', () => {
  it('zeigt Name, Wochentage und alle Übungen des Plans', () => {
    const tree = renderEditor(template(), editorHandlers());
    const shown = texts(tree);
    expect(shown).toContain('Unterkörper');
    expect(shown).toContain('Kniebeuge (Langhantel)');
    expect(shown).toContain('Beinbeuger liegend');
    expect(shown).toContain('Mo');
    expect(inputByLabel(tree, 'Name des Plans').props.value).toBe('Unterkörper');
  });

  it('übernimmt einen neuen Namen', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    type(tree, 'Name des Plans', 'Beine schwer');
    press(tree, 'Plan speichern');
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onSave.mock.calls[0][0].name).toBe('Beine schwer');
  });

  it('schaltet einen Wochentag an und wieder aus', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Mittwoch');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].days).toEqual([1, 3, 4]);
    press(tree, 'Mittwoch, ausgewählt');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[1][0].days).toEqual([1, 4]);
  });

  it('nimmt jede Tagesbindung zurück', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Keinen festen Tag festlegen');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].days).toEqual([]);
    expect(texts(tree)).toContain('Kein fester Tag');
  });

  it('ändert Wiederholungen, Gewicht und Pause eines Satzes', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    type(tree, 'Wiederholungen für Satz 1', '3');
    type(tree, 'Gewicht für Satz 1 in Kilogramm', '107,5');
    type(tree, 'Pause nach Satz 1 in Sekunden', '240');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].exercises[0].sets[0]).toEqual({
      kind: 'normal',
      loadKind: 'kg',
      reps: 3,
      weightKg: 107.5,
      restSeconds: 240,
    });
  });

  it('nimmt eine geleerte Eingabe als nicht vorgegeben', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    type(tree, 'Gewicht für Satz 1 in Kilogramm', '');
    press(tree, 'Plan speichern');
    expect(
      handlers.onSave.mock.calls[0][0].exercises[0].sets[0].weightKg,
    ).toBeUndefined();
  });

  it('schaltet die Satzart weiter', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Satzart für Satz 1, jetzt Arbeitssatz, weiterschalten');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].exercises[0].sets[0].kind).toBe(
      'failure',
    );
  });

  it('schaltet die Lastart einer Übung weiter', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(
      tree,
      'Lastart für Beinbeuger liegend, jetzt Zusatzlast in kg, weiterschalten',
    );
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].exercises[1].sets[0].loadKind).toBe(
      'bodyweight',
    );
  });

  it('fügt einen Satz hinzu und entfernt ihn wieder', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Satz zu Beinbeuger liegend hinzufügen');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].exercises[1].sets).toHaveLength(2);
    press(tree, 'Satz 2 entfernen');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[1][0].exercises[1].sets).toHaveLength(1);
  });

  it('sortiert Übungen um', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Beinbeuger liegend nach oben schieben');
    press(tree, 'Plan speichern');
    expect(
      handlers.onSave.mock.calls[0][0].exercises.map(
        (exercise: { exerciseId: string }) => exercise.exerciseId,
      ),
    ).toEqual(['lying_leg_curl', 'barbell_back_squat']);
  });

  it('nimmt eine Übung aus dem Plan', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Kniebeuge (Langhantel) aus dem Plan nehmen');
    press(tree, 'Plan speichern');
    expect(handlers.onSave.mock.calls[0][0].exercises).toHaveLength(1);
  });

  it('fügt eine Übung über die Auswahl hinzu', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    press(tree, 'Übung zum Plan hinzufügen');
    const picker = tree.root.find(
      node =>
        typeof node.type !== 'string' && typeof node.props.onSelect === 'function',
    );
    ReactTestRenderer.act(() => {
      picker.props.onSelect(catalogExercise('pull_up') as Exercise);
    });
    press(tree, 'Plan speichern');
    const saved = handlers.onSave.mock.calls[0][0];
    expect(saved.exercises).toHaveLength(3);
    expect(saved.exercises[2].exerciseId).toBe('pull_up');
  });

  it('nennt offene Punkte als ruhigen Hinweis statt als Fehler', () => {
    const tree = renderEditor(createTemplate(NOW, ''), editorHandlers());
    const shown = texts(tree);
    expect(shown).toContain('Der Plan braucht einen Namen.');
    expect(shown).toContain('Füge mindestens eine Übung hinzu.');
    expect(shown.join(' ').toLowerCase()).not.toContain('fehler');
  });

  it('speichert erst, wenn Name und Übung vorhanden sind', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(createTemplate(NOW, ''), handlers);
    const save = byLabel(tree, 'Plan speichern');
    expect(save.props.disabled).toBe(true);
    expect(save.props.accessibilityState.disabled).toBe(true);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('bricht ab, ohne zu speichern', () => {
    const handlers = editorHandlers();
    const tree = renderEditor(template(), handlers);
    type(tree, 'Name des Plans', 'Verworfen');
    press(tree, 'Bearbeiten abbrechen');
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('gibt jedem Bedienelement eine Rolle und eine Beschriftung', () => {
    const tree = renderEditor(template(), editorHandlers());
    const pressables = tree.root.findAll(
      node =>
        typeof node.type !== 'string' &&
        typeof node.props.onPress === 'function' &&
        node.props.style !== undefined,
    );
    expect(pressables.length).toBeGreaterThan(5);
    for (const pressable of pressables) {
      expect(typeof pressable.props.accessibilityLabel).toBe('string');
      expect(pressable.props.accessibilityLabel.length).toBeGreaterThan(0);
      expect(pressable.props.accessibilityRole).toBe('button');
    }
  });
});

const listHandlers = () => ({
  onCreate: jest.fn(),
  onStart: jest.fn(),
  onEdit: jest.fn(),
  onDuplicate: jest.fn(),
  onDelete: jest.fn(),
});

const renderList = (
  templates: WorkoutTemplate[],
  handlers: ReturnType<typeof listHandlers>,
  today = 1,
) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <PlanList templates={templates} today={today} {...handlers} />,
    );
  });
  return tree;
};

describe('Planübersicht', () => {
  it('zeigt Wochentag und Umfang jedes Plans', () => {
    const tree = renderList([template()], listHandlers());
    const shown = texts(tree);
    expect(shown).toContain('Unterkörper');
    expect(
      shown.some(entry => entry.includes('Mo, Do') && entry.includes('2 Übungen')),
    ).toBe(true);
  });

  it('sagt ohne Plan, dass freies Training genügt', () => {
    const tree = renderList([], listHandlers());
    const shown = texts(tree).join(' ');
    expect(shown).toContain('Noch kein Plan');
    expect(shown).toContain('jederzeit frei trainieren');
  });

  it('startet, bearbeitet und dupliziert einen Plan', () => {
    const handlers = listHandlers();
    const tree = renderList([template()], handlers);
    press(tree, 'Unterkörper starten');
    press(tree, 'Unterkörper bearbeiten');
    press(tree, 'Unterkörper duplizieren');
    expect(handlers.onStart.mock.calls[0][0].id).toBe('template-1');
    expect(handlers.onEdit.mock.calls[0][0].id).toBe('template-1');
    expect(handlers.onDuplicate).toHaveBeenCalledWith('template-1');
  });

  it('löscht erst nach einer Rückfrage', () => {
    const handlers = listHandlers();
    const tree = renderList([template()], handlers);
    press(tree, 'Unterkörper löschen');
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(texts(tree).join(' ')).toContain('endgültig löschen?');
    press(tree, 'Löschen von Unterkörper bestätigen');
    expect(handlers.onDelete).toHaveBeenCalledWith('template-1');
  });

  it('lässt die Rückfrage folgenlos abbrechen', () => {
    const handlers = listHandlers();
    const tree = renderList([template()], handlers);
    press(tree, 'Unterkörper löschen');
    press(tree, 'Löschen abbrechen');
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(texts(tree)).toContain('Unterkörper');
  });

  it('legt einen neuen Plan an', () => {
    const handlers = listHandlers();
    const tree = renderList([], handlers);
    press(tree, 'Neuen Plan anlegen');
    expect(handlers.onCreate).toHaveBeenCalledTimes(1);
  });

  it('nennt den heutigen Tag, ohne ihn zu einer Pflicht zu machen', () => {
    const shown = texts(renderList([template()], listHandlers(), 1)).join(' ');
    expect(shown).toContain('heute Montag');
    for (const word of ['Rückstand', 'verpasst', 'Pflicht', 'Fehler']) {
      expect(shown).not.toContain(word);
    }
  });
});
