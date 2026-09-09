import React from 'react';
import { TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { WorkoutScreen } from '../src/ui/WorkoutScreen';
import {
  completeSet,
  startSession,
  type StrengthSession,
  type WorkoutTemplate,
} from '../src/domain/strength';

const template: WorkoutTemplate = {
  id: 'template-1',
  name: 'Unterkörper',
  days: [],
  createdAt: 0,
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
    {
      exerciseId: 'standing_calf_raise',
      name: 'Wadenheben stehend',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 12, weightKg: 60, restSeconds: 60 },
      ],
    },
  ],
};

const handlers = () => ({
  onSelectExercise: jest.fn(),
  onCompleteSet: jest.fn(),
  onEditSet: jest.fn(),
  onAddSet: jest.fn(),
  onAddExercise: jest.fn(),
  onFinish: jest.fn(),
  onMinimize: jest.fn(),
});

function render(
  session: StrengthSession,
  props: ReturnType<typeof handlers>,
  overrides: {
    now?: number;
    history?: StrengthSession[];
    sessions?: StrengthSession[];
  } = {},
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <WorkoutScreen
        history={overrides.history || []}
        now={overrides.now ?? 1_000_000}
        session={session}
        sessions={overrides.sessions}
        {...props}
      />,
    );
  });
  return tree;
}

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

const byLabel = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root.find(
    node =>
      typeof node.type !== 'string' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  );

describe('Trainingsansicht', () => {
  const base = () => startSession(template, 1_000_000);

  it('zeigt die aktuelle Übung ausgeklappt und die übrigen als Zeilen', () => {
    const session = { ...base(), currentExercise: 1 };
    const tree = render(session, handlers());
    const shown = texts(tree);
    expect(shown).toContain('Beinbeuger liegend');
    expect(shown).toContain('Kniebeuge (Langhantel)');
    expect(shown).toContain('Wadenheben stehend');
    // Nur die aktuelle Übung zeigt Eingabefelder.
    expect(tree.root.findAllByType(TextInput)).toHaveLength(2);
  });

  it('kennzeichnet die Richtung der Nachbarübungen', () => {
    const tree = render({ ...base(), currentExercise: 1 }, handlers());
    const shown = texts(tree);
    expect(shown).toContain('↑');
    expect(shown).toContain('↓');
  });

  it('wechselt beim Antippen einer Zeile die Übung', () => {
    const props = handlers();
    const tree = render({ ...base(), currentExercise: 1 }, props);
    byLabel(tree, 'Wadenheben stehend, 0 von 1 Sätzen erledigt').props.onPress();
    expect(props.onSelectExercise).toHaveBeenCalledWith(2);
  });

  it('belegt die Eingaben aus der Vorgabe vor', () => {
    const tree = render(base(), handlers());
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.value).toBe('100');
    expect(inputs[1].props.value).toBe('5');
  });

  it('bestätigt einen Satz mit den sichtbaren Werten', () => {
    const props = handlers();
    const tree = render(base(), props);
    ReactTestRenderer.act(() => {
      tree.root.findAllByType(TextInput)[1].props.onChangeText('4');
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      base().exercises[0].sets[0].id,
      { actualWeightKg: 100, actualReps: 4 },
    );
  });

  it('speichert bei einem Zeitsatz Sekunden statt Wiederholungen', () => {
    const timed = startSession(
      {
        ...template,
        exercises: [
          {
            exerciseId: 'plank',
            name: 'Unterarmstütz',
            sets: [
              {
                kind: 'timed',
                loadKind: 'bodyweight',
                seconds: 30,
                restSeconds: 30,
              },
            ],
          },
        ],
      },
      1_000_000,
    );
    const props = handlers();
    const tree = render(timed, props);
    ReactTestRenderer.act(() => {
      tree.root.findAllByType(TextInput)[1].props.onChangeText('42');
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      timed.exercises[0].sets[0].id,
      { actualWeightKg: undefined, actualSeconds: 42 },
    );
  });

  it('bietet bei einem erledigten Satz das Zurücknehmen an', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 1);
    const tree = render(done, handlers(), { now: 1 });
    expect(() => byLabel(tree, 'Satz 1 zurücknehmen')).not.toThrow();
  });

  it('zeigt die laufende Pause mit verbleibender Zeit', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 0);
    const tree = render(done, handlers(), { now: 60_000 });
    expect(texts(tree)).toContain('Pause 2:00');
  });

  it('zeigt keine Pause, wenn sie abgelaufen ist', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 0);
    const tree = render(done, handlers(), { now: 200_000 });
    expect(texts(tree).some(value => value.startsWith('Pause'))).toBe(false);
  });

  it('nennt die letzte vergleichbare Leistung statt der Vorgabe', () => {
    const previous = completeSet(
      base(),
      0,
      base().exercises[0].sets[0].id,
      1,
      { actualWeightKg: 97.5, actualReps: 6 },
    );
    const tree = render(base(), handlers(), { history: [previous] });
    expect(texts(tree)).toContain('97,5 kg × 6');
  });

  it('meldet Fortschritt und verstrichene Zeit im Kopf', () => {
    const session = base();
    const done = completeSet(session, 0, session.exercises[0].sets[0].id, 1);
    const tree = render(done, handlers(), { now: 1_000_000 + 15 * 60_000 });
    expect(texts(tree)).toContain('15 min · 1 von 4 Sätzen');
  });

  it('reicht Beenden, Minimieren und Ergänzen weiter', () => {
    const props = handlers();
    const tree = render(base(), props);
    byLabel(tree, 'Training beenden').props.onPress();
    byLabel(tree, 'Training in den Hintergrund legen').props.onPress();
    byLabel(tree, 'Satz hinzufügen').props.onPress();
    byLabel(tree, 'Übung hinzufügen').props.onPress();
    expect(props.onFinish).toHaveBeenCalled();
    expect(props.onMinimize).toHaveBeenCalled();
    expect(props.onAddSet).toHaveBeenCalledWith(0);
    expect(props.onAddExercise).toHaveBeenCalled();
  });

  it('kommt mit einer Einheit ohne Übungen zurecht', () => {
    const tree = render(startSession(null, 1), handlers());
    expect(texts(tree)).toContain('Noch keine Übung');
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('sperrt das Gewichtsfeld bei Eigengewichtsübungen', () => {
    const bodyweight = startSession(
      {
        ...template,
        exercises: [
          {
            exerciseId: 'push_up',
            name: 'Liegestütz',
            sets: [
              { kind: 'normal', loadKind: 'bodyweight', reps: 15, restSeconds: 60 },
            ],
          },
        ],
      },
      1,
    );
    const tree = render(bodyweight, handlers());
    expect(tree.root.findAllByType(TextInput)[0].props.editable).toBe(false);
  });

  /** Einheit ohne Planwerte, damit nur der Vorschlag greifen kann. */
  const freeTemplate: WorkoutTemplate = {
    id: 'template-free',
    name: 'Frei',
    days: [],
    createdAt: 0,
    exercises: [
      {
        exerciseId: 'barbell_back_squat',
        name: 'Kniebeuge (Langhantel)',
        sets: [
          { kind: 'normal', loadKind: 'kg', restSeconds: 180 },
          { kind: 'normal', loadKind: 'kg', restSeconds: 180 },
        ],
      },
    ],
  };

  /** Abgeschlossene Einheit mit tatsächlichen Werten als Historie. */
  const finishedSession = (
    id: string,
    at: number,
    weights: number[],
  ): StrengthSession => ({
    id,
    kind: 'strength',
    name: 'Frei',
    startTime: at,
    endTime: at + 3_600_000,
    status: 'finished',
    currentExercise: 0,
    modelVersion: 'strength-v1',
    catalogVersion: 'catalog-v1',
    exercises: [
      {
        exerciseId: 'barbell_back_squat',
        name: 'Kniebeuge (Langhantel)',
        sets: weights.map((weightKg, position) => ({
          id: `${id}-set-${position}`,
          planned: { kind: 'normal', loadKind: 'kg', restSeconds: 180 },
          actualWeightKg: weightKg,
          actualReps: 5,
          completedAt: at + position,
        })),
      },
    ],
  });

  it('füllt leere Felder mit den Werten der letzten Einheit vor', () => {
    const tree = render(startSession(freeTemplate, 2_000_000), handlers(), {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs[0].props.value).toBe('95');
    expect(inputs[1].props.value).toBe('5');
  });

  it('übernimmt den Vorschlag beim Bestätigen ohne weitere Eingabe', () => {
    const props = handlers();
    const session = startSession(freeTemplate, 2_000_000);
    const tree = render(session, props, {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    byLabel(tree, 'Satz 1 bestätigen').props.onPress();
    expect(props.onCompleteSet).toHaveBeenCalledWith(
      0,
      session.exercises[0].sets[0].id,
      { actualWeightKg: 95, actualReps: 5 },
    );
  });

  it('lässt den Planwert vor dem Vorschlag stehen', () => {
    const tree = render(base(), handlers(), {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    expect(tree.root.findAllByType(TextInput)[0].props.value).toBe('100');
  });

  it('markiert den Vorschlag als Vorschlag und die Eingabe als Eingabe', () => {
    const tree = render(startSession(freeTemplate, 2_000_000), handlers(), {
      history: [finishedSession('older', 1_000_000, [95, 95])],
    });
    const suggested = tree.root.findAllByType(TextInput)[0];
    expect(suggested.props.accessibilityLabel).toContain('Vorschlag');
    ReactTestRenderer.act(() => {
      suggested.props.onChangeText('97,5');
    });
    expect(
      tree.root.findAllByType(TextInput)[0].props.accessibilityLabel,
    ).not.toContain('Vorschlag');
  });

  it('zeigt den Verlauf erst, wenn alle Sätze der Übung erledigt sind', () => {
    const sessions = [
      finishedSession('s1', 1_000_000, [90, 90]),
      finishedSession('s2', 1_000_000 + 7 * 86_400_000, [95, 95]),
      finishedSession('s3', 1_000_000 + 14 * 86_400_000, [100, 100]),
    ];
    let session = startSession(freeTemplate, 1_000_000 + 21 * 86_400_000);
    const open = render(session, handlers(), { sessions });
    expect(
      texts(open).some(text => text.includes('Bestes geschätztes Maximum')),
    ).toBe(false);

    for (const set of session.exercises[0].sets) {
      session = completeSet(session, 0, set.id, session.startTime, {
        actualWeightKg: 105,
        actualReps: 5,
      });
    }
    const done = render(session, handlers(), { sessions });
    expect(
      texts(done).some(text => text.includes('Bestes geschätztes Maximum')),
    ).toBe(true);
  });

  it('bleibt ohne übergebene Historie ohne Verlaufsnotiz', () => {
    let session = startSession(freeTemplate, 2_000_000);
    for (const set of session.exercises[0].sets) {
      session = completeSet(session, 0, set.id, session.startTime, {
        actualWeightKg: 105,
        actualReps: 5,
      });
    }
    const tree = render(session, handlers());
    expect(
      texts(tree).some(text => text.includes('Bestes geschätztes Maximum')),
    ).toBe(false);
  });
});
