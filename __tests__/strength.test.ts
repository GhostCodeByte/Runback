import {
  addExercise,
  addSet,
  completeSet,
  editSet,
  epley1RM,
  exerciseProgress,
  finishSession,
  referenceLabel,
  referenceSet,
  removeSet,
  restRemaining,
  selectExercise,
  sessionBest1RM,
  sessionProgress,
  skipSet,
  startSession,
  summarize,
  templateForDay,
  type StrengthSession,
  type WorkoutTemplate,
} from '../src/domain/strength';
import { CATALOG, catalogExercise, searchCatalog } from '../src/domain/catalog';
import {
  allRegionIds,
  regionId,
  regionLabel,
  sharesAreValid,
} from '../src/domain/regions';

const template: WorkoutTemplate = {
  id: 'template-1',
  name: 'Unterkörper',
  days: [1],
  createdAt: 0,
  exercises: [
    {
      exerciseId: 'barbell_back_squat',
      name: 'Kniebeuge (Langhantel)',
      sets: [
        { kind: 'warmup', loadKind: 'kg', reps: 8, weightKg: 40, restSeconds: 60 },
        { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 100, restSeconds: 180 },
        { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 100, restSeconds: 180 },
      ],
    },
    {
      exerciseId: 'romanian_deadlift',
      name: 'Rumänisches Kreuzheben',
      sets: [
        { kind: 'normal', loadKind: 'kg', reps: 8, weightKg: 80, restSeconds: 120 },
      ],
    },
  ],
};

const start = () => startSession(template, 1_000_000);

describe('Muskelregionen', () => {
  it('führt 45 konkrete Regionen', () => {
    expect(allRegionIds()).toHaveLength(45);
  });

  it('hängt eine Seite nur an seitig geführte Regionen', () => {
    expect(regionId('quad', 'l')).toBe('quad_l');
    expect(regionId('neck', 'l')).toBe('neck');
  });

  it('beschriftet konkrete Regionen mit ihrer Seite', () => {
    expect(regionLabel('quad_r')).toBe('Quadrizeps rechts');
    expect(regionLabel('neck')).toBe('Nacken');
  });

  it('gibt unbekannte Kennungen unverändert zurück, statt zu raten', () => {
    expect(regionLabel('unbekannt')).toBe('unbekannt');
  });

  it('weist Anteile zurück, die sich nicht auf 1 summieren', () => {
    expect(sharesAreValid({ quad: 0.5, glute: 0.3 })).toBe(false);
    expect(sharesAreValid({ quad: 0.5, glute: 0.5 })).toBe(true);
    expect(sharesAreValid({})).toBe(false);
  });
});

describe('Übungskatalog', () => {
  it('verteilt jede Übung vollständig auf bekannte Regionen', () => {
    const broken = CATALOG.filter(exercise => !sharesAreValid(exercise.shares));
    expect(broken.map(exercise => exercise.id)).toEqual([]);
  });

  it('hält den Exzentrikfaktor im dokumentierten Bereich', () => {
    for (const exercise of CATALOG) {
      expect(exercise.eccentric).toBeGreaterThanOrEqual(0.7);
      expect(exercise.eccentric).toBeLessThanOrEqual(1.8);
    }
  });

  it('vergibt jede Kennung nur einmal', () => {
    expect(new Set(CATALOG.map(exercise => exercise.id)).size).toBe(
      CATALOG.length,
    );
  });

  it('kennzeichnet Herkunft und Katalogversion', () => {
    for (const exercise of CATALOG) {
      expect(exercise.origin).toBe('catalog');
      expect(exercise.catalogVersion).toBe('catalog-v1');
    }
  });

  it('findet Übungen unabhängig von Groß- und Kleinschreibung', () => {
    expect(searchCatalog('kniebeuge').length).toBeGreaterThan(0);
    expect(searchCatalog('gibtesnicht')).toEqual([]);
    expect(catalogExercise('leg_press')?.name).toBe('Beinpresse');
    expect(catalogExercise('gibtesnicht')).toBeUndefined();
  });
});

describe('Einheit starten', () => {
  it('übernimmt Vorlage samt Vorgaben und Modellversionen', () => {
    const session = start();
    expect(session.name).toBe('Unterkörper');
    expect(session.templateId).toBe('template-1');
    expect(session.status).toBe('active');
    expect(session.exercises).toHaveLength(2);
    expect(session.exercises[0].sets).toHaveLength(3);
    expect(session.exercises[0].sets[1].planned.weightKg).toBe(100);
    expect(session.modelVersion).toBe('strength-v1');
    expect(session.catalogVersion).toBe('catalog-v1');
  });

  it('erlaubt eine Einheit ohne Vorlage', () => {
    const session = startSession(null, 5);
    expect(session.name).toBe('Freies Training');
    expect(session.exercises).toEqual([]);
    expect(session.templateId).toBeUndefined();
  });

  it('kopiert die Vorgaben, statt die Vorlage zu teilen', () => {
    const session = completeSet(start(), 0, start().exercises[0].sets[0].id, 1, {
      actualReps: 12,
    });
    expect(template.exercises[0].sets[0].reps).toBe(8);
    expect(session.exercises[0].sets[0].actualReps).toBe(12);
  });

  it('vergibt je Satz eine eigene Kennung', () => {
    const ids = start().exercises.flatMap(exercise =>
      exercise.sets.map(set => set.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hält auch bei derselben Übung mehrmals die Satzkennungen eindeutig', () => {
    const duplicate: WorkoutTemplate = {
      ...template,
      exercises: [template.exercises[0], template.exercises[0]],
    };
    const session = startSession(duplicate, 1_000_000);
    const ids = session.exercises.flatMap(exercise =>
      exercise.sets.map(set => set.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const changed = completeSet(session, 1, session.exercises[1].sets[0].id, 2);
    expect(changed.exercises[0].sets[0].completedAt).toBeUndefined();
    expect(changed.exercises[1].sets[0].completedAt).toBe(2);
  });
});

describe('Sätze erfassen', () => {
  it('übernimmt beim Bestätigen ohne Eingabe die Vorgabe', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const next = completeSet(session, 0, setId, 2_000);
    const set = next.exercises[0].sets[1];
    expect(set.completedAt).toBe(2_000);
    expect(set.actualWeightKg).toBe(100);
    expect(set.actualReps).toBe(5);
  });

  it('speichert abweichende Werte, ohne die Vorgabe zu verlieren', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const next = completeSet(session, 0, setId, 2_000, {
      actualWeightKg: 102.5,
      actualReps: 3,
    });
    const set = next.exercises[0].sets[1];
    expect(set.actualWeightKg).toBe(102.5);
    expect(set.actualReps).toBe(3);
    expect(set.planned.weightKg).toBe(100);
    expect(set.planned.reps).toBe(5);
  });

  it('nimmt einen bestätigten Satz beim erneuten Tippen zurück', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const done = completeSet(session, 0, setId, 2_000, { actualReps: 4 });
    const reopened = completeSet(done, 0, setId, 3_000);
    expect(reopened.exercises[0].sets[1].completedAt).toBeUndefined();
    expect(reopened.exercises[0].sets[1].actualReps).toBe(4);
    expect(reopened.restStartedAt).toBeUndefined();
  });

  it('ändert Werte ohne den Satz abzuschließen', () => {
    const session = start();
    const setId = session.exercises[0].sets[0].id;
    const next = editSet(session, 0, setId, { actualWeightKg: 45 });
    expect(next.exercises[0].sets[0].actualWeightKg).toBe(45);
    expect(next.exercises[0].sets[0].completedAt).toBeUndefined();
  });

  it('lässt unbekannte Sätze und Übungen unverändert', () => {
    const session = start();
    expect(completeSet(session, 9, 'gibtesnicht', 1)).toBe(session);
    expect(editSet(session, 0, 'gibtesnicht', { actualReps: 1 })).toBe(session);
    expect(skipSet(session, 0, 'gibtesnicht')).toBe(session);
  });

  it('behandelt Überspringen als Angabe, nicht als Fehler', () => {
    const session = start();
    const setId = session.exercises[0].sets[0].id;
    const skipped = skipSet(session, 0, setId);
    expect(skipped.exercises[0].sets[0].skipped).toBe(true);
    expect(exerciseProgress(skipped.exercises[0]).total).toBe(2);
    expect(skipSet(skipped, 0, setId).exercises[0].sets[0].skipped).toBe(false);
  });

  it('belegt einen ergänzten Satz aus dem letzten tatsächlichen Wert vor', () => {
    const session = completeSet(
      start(),
      0,
      start().exercises[0].sets[2].id,
      2_000,
      { actualWeightKg: 105, actualReps: 3 },
    );
    const next = addSet(session, 0, 9_000);
    const added = next.exercises[0].sets[3];
    expect(added.planned.weightKg).toBe(105);
    expect(added.planned.reps).toBe(3);
    expect(added.completedAt).toBeUndefined();
  });

  it('ergänzt einen Standardsatz, wenn die Übung noch leer ist', () => {
    const empty = addExercise(
      startSession(null, 1),
      { ...CATALOG[0] },
      2,
      0,
    );
    const withSet = addSet(removeAllSets(empty), 0, 3);
    expect(withSet.exercises[0].sets[0].planned.reps).toBe(8);
    expect(withSet.exercises[0].sets[0].planned.restSeconds).toBe(120);
  });

  it('entfernt einen Satz, behält aber den letzten', () => {
    const session = start();
    const removed = removeSet(session, 0, session.exercises[0].sets[0].id);
    expect(removed.exercises[0].sets).toHaveLength(2);
    const single = removeSet(session, 1, session.exercises[1].sets[0].id);
    expect(single.exercises[1].sets).toHaveLength(1);
  });
});

const removeAllSets = (session: StrengthSession): StrengthSession => ({
  ...session,
  exercises: session.exercises.map(exercise => ({ ...exercise, sets: [] })),
});

describe('Übungen wechseln und ergänzen', () => {
  it('begrenzt die Auswahl auf vorhandene Übungen', () => {
    const session = start();
    expect(selectExercise(session, 5).currentExercise).toBe(1);
    expect(selectExercise(session, -3).currentExercise).toBe(0);
    expect(selectExercise(session, 0)).toBe(session);
    expect(selectExercise(startSession(null, 1), 2).currentExercise).toBe(0);
  });

  it('kennzeichnet frei ergänzte Übungen und springt zu ihnen', () => {
    const session = addExercise(start(), CATALOG[0], 7_000);
    expect(session.exercises).toHaveLength(3);
    expect(session.exercises[2].added).toBe(true);
    expect(session.exercises[2].sets).toHaveLength(3);
    expect(session.currentExercise).toBe(2);
  });

  it('setzt bei Eigengewichtsübungen die passende Lastart', () => {
    const pushUp = CATALOG.find(exercise => exercise.id === 'push_up')!;
    const session = addExercise(startSession(null, 1), pushUp, 2);
    expect(session.exercises[0].sets[0].planned.loadKind).toBe('bodyweight');
  });
});

describe('Pause', () => {
  it('startet nach einem bestätigten Satz und läuft ab', () => {
    const session = start();
    const setId = session.exercises[0].sets[1].id;
    const next = completeSet(session, 0, setId, 10_000);
    expect(next.restSeconds).toBe(180);
    expect(restRemaining(next, 10_000)).toBe(180);
    expect(restRemaining(next, 70_000)).toBe(120);
    expect(restRemaining(next, 190_001)).toBeNull();
  });

  it('startet keine Pause, wenn die Vorgabe keine vorsieht', () => {
    const noRest = startSession(
      {
        ...template,
        exercises: [
          {
            exerciseId: 'plank',
            name: 'Unterarmstütz',
            sets: [
              { kind: 'timed', loadKind: 'bodyweight', seconds: 45, restSeconds: 0 },
            ],
          },
        ],
      },
      1,
    );
    const next = completeSet(noRest, 0, noRest.exercises[0].sets[0].id, 5);
    expect(next.restStartedAt).toBeUndefined();
    expect(restRemaining(next, 6)).toBeNull();
  });
});

describe('Fortschritt und Auswertung', () => {
  it('zählt Sätze und Volumen nur aus tatsächlichen Werten', () => {
    let session = start();
    session = completeSet(session, 0, session.exercises[0].sets[1].id, 1, {
      actualWeightKg: 100,
      actualReps: 5,
    });
    session = completeSet(session, 0, session.exercises[0].sets[2].id, 2, {
      actualWeightKg: 100,
      actualReps: 4,
    });
    const progress = sessionProgress(session);
    expect(progress.completedSets).toBe(2);
    expect(progress.totalSets).toBe(4);
    expect(progress.volumeKg).toBe(900);
  });

  it('meldet eine Übung erst als fertig, wenn kein Satz mehr offen ist', () => {
    let session = start();
    expect(exerciseProgress(session.exercises[1]).done).toBe(false);
    session = completeSet(session, 1, session.exercises[1].sets[0].id, 1);
    expect(exerciseProgress(session.exercises[1]).done).toBe(true);
    expect(exerciseProgress(session.exercises[1]).activeSetId).toBeUndefined();
  });

  it('nennt den nächsten offenen Satz', () => {
    const session = start();
    expect(exerciseProgress(session.exercises[0]).activeSetId).toBe(
      session.exercises[0].sets[0].id,
    );
  });

  it('schätzt das Einwiederholungsmaximum nur bei brauchbaren Werten', () => {
    expect(epley1RM(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley1RM(100, 0)).toBeNull();
    expect(epley1RM(0, 5)).toBeNull();
    expect(epley1RM(100, 40)).toBeNull();
  });

  it('lässt Aufwärmsätze aus der Bestleistung heraus', () => {
    let session = start();
    session = completeSet(session, 0, session.exercises[0].sets[0].id, 1, {
      actualWeightKg: 400,
      actualReps: 8,
    });
    session = completeSet(session, 0, session.exercises[0].sets[1].id, 2, {
      actualWeightKg: 100,
      actualReps: 5,
    });
    expect(sessionBest1RM(session, 'barbell_back_squat')).toBeCloseTo(116.667, 3);
    expect(sessionBest1RM(session, 'gibtesnicht')).toBeNull();
  });

  it('schließt eine Einheit ab und fasst sie zusammen', () => {
    let session = start();
    session = completeSet(session, 0, session.exercises[0].sets[1].id, 1, {
      actualWeightKg: 100,
      actualReps: 5,
    });
    const finished = finishSession(session, 50_000);
    expect(finished.status).toBe('finished');
    expect(finished.endTime).toBe(50_000);
    expect(finished.restStartedAt).toBeUndefined();
    expect(summarize(finished)).toMatchObject({
      completedSets: 1,
      volumeKg: 500,
      endTime: 50_000,
    });
  });
});

describe('Bezug zur letzten Leistung', () => {
  const historyFrom = (values: {
    weight?: number;
    reps?: number;
    seconds?: number;
  }): StrengthSession[] => {
    const session = start();
    return [
      completeSet(session, 0, session.exercises[0].sets[0].id, 1, {
        actualWeightKg: values.weight,
        actualReps: values.reps,
        actualSeconds: values.seconds,
      }),
    ];
  };

  it('nennt Gewicht und Wiederholungen der letzten Einheit', () => {
    expect(referenceLabel(historyFrom({ weight: 82.5, reps: 6 }), 'barbell_back_squat', 0)).toBe(
      '82,5 kg × 6',
    );
  });

  it('kommt ohne Gewicht aus', () => {
    const history = historyFrom({ reps: 12 }).map(session => ({
      ...session,
      exercises: session.exercises.map((exercise, index) =>
        index === 0
          ? {
              ...exercise,
              sets: exercise.sets.map((set, position) =>
                position === 0
                  ? { ...set, actualWeightKg: undefined, planned: { ...set.planned, weightKg: undefined } }
                  : set,
              ),
            }
          : exercise,
      ),
    }));
    expect(referenceLabel(history, 'barbell_back_squat', 0)).toBe('12 Wdh.');
  });

  it('liefert den letzten vergleichbaren Satz mit Zahlenwerten', () => {
    const set = referenceSet(
      historyFrom({ weight: 82.5, reps: 6 }),
      'barbell_back_squat',
      0,
    );
    expect(set?.actualWeightKg).toBe(82.5);
    expect(set?.actualReps).toBe(6);
  });

  it('überspringt Einheiten ohne erfasste Werte', () => {
    const empty = start();
    const withValues = historyFrom({ weight: 90, reps: 5 });
    expect(
      referenceSet([empty, ...withValues], 'barbell_back_squat', 0)
        ?.actualWeightKg,
    ).toBe(90);
  });

  it('gibt null zurück, wenn nichts Vergleichbares vorliegt', () => {
    expect(referenceSet([], 'barbell_back_squat', 0)).toBeNull();
    expect(referenceLabel([], 'barbell_back_squat', 0)).toBeNull();
    expect(referenceLabel(historyFrom({ weight: 80, reps: 5 }), 'leg_press', 0)).toBeNull();
    expect(
      referenceLabel(historyFrom({ weight: 80, reps: 5 }), 'barbell_back_squat', 4),
    ).toBeNull();
  });
});

describe('Vorlage für einen Wochentag', () => {
  it('findet die Vorlage des Tages und meldet sonst nichts', () => {
    expect(templateForDay([template], 1)?.id).toBe('template-1');
    expect(templateForDay([template], 3)).toBeNull();
    expect(templateForDay([], 1)).toBeNull();
  });
});
