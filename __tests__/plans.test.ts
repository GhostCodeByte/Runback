import {
  addPlannedSet,
  addTemplateExercise,
  applyProposal,
  clearTemplateDays,
  comparePlan,
  createTemplate,
  daysLabel,
  deleteTemplate,
  duplicateTemplate,
  hasFixedDay,
  moveTemplateExercise,
  proposalFingerprint,
  proposalIsAllowed,
  recordDecision,
  removePlannedSet,
  removeTemplateExercise,
  renameTemplate,
  setTemplateDays,
  templateFromSession,
  templatesForDay,
  toggleTemplateDay,
  updatePlannedSet,
  upsertTemplate,
  validateTemplate,
  DECLINED_PROPOSAL_SILENCE_DAYS,
  PLAN_MODEL_VERSION,
  STRUCTURE_PROPOSAL_INTERVAL_DAYS,
  type PlanProposal,
  type ProposalRecord,
} from '../src/domain/plans';
import { catalogExercise } from '../src/domain/catalog';
import {
  completeSet,
  skipSet,
  startSession,
  type Exercise,
  type StrengthSession,
  type WorkoutTemplate,
} from '../src/domain/strength';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const squat = catalogExercise('barbell_back_squat') as Exercise;
const curl = catalogExercise('lying_leg_curl') as Exercise;

const plan = (): WorkoutTemplate => ({
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

describe('Pläne anlegen und bearbeiten', () => {
  it('legt eine leere Vorlage mit deterministischer Kennung an', () => {
    const created = createTemplate(NOW, 'Oberkörper');
    expect(created).toEqual(createTemplate(NOW, 'Oberkörper'));
    expect(created.exercises).toEqual([]);
    expect(created.days).toEqual([]);
    expect(created.createdAt).toBe(NOW);
  });

  it('weicht einer bereits vergebenen Kennung aus', () => {
    const first = createTemplate(NOW, 'A');
    const second = createTemplate(NOW, 'B', [first]);
    expect(second.id).not.toBe(first.id);
  });

  it('benennt um, ohne andere Felder zu berühren', () => {
    const renamed = renameTemplate(plan(), 'Beine');
    expect(renamed.name).toBe('Beine');
    expect(renamed.exercises).toEqual(plan().exercises);
  });

  it('lässt die Ausgangsvorlage unverändert', () => {
    const original = plan();
    const snapshot = JSON.stringify(original);
    renameTemplate(original, 'Anders');
    addTemplateExercise(original, squat);
    removeTemplateExercise(original, 0);
    updatePlannedSet(original, 0, 0, { reps: 12 });
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('Wochentage', () => {
  it('sortiert nach Woche ab Montag und entfernt Doppelte', () => {
    const set = setTemplateDays(plan(), [0, 3, 1, 3]);
    expect(set.days).toEqual([1, 3, 0]);
  });

  it('ignoriert unmögliche Tage', () => {
    expect(setTemplateDays(plan(), [7, -1, 2.5, 2]).days).toEqual([2]);
  });

  it('schaltet einen Tag an und wieder aus', () => {
    const on = toggleTemplateDay(plan(), 6);
    expect(on.days).toContain(6);
    expect(toggleTemplateDay(on, 6).days).not.toContain(6);
  });

  it('kennt den Zustand ohne festen Tag', () => {
    const free = clearTemplateDays(plan());
    expect(free.days).toEqual([]);
    expect(hasFixedDay(free)).toBe(false);
    expect(daysLabel(free)).toBe('Kein fester Tag');
    expect(daysLabel(plan())).toBe('Mo, Do');
  });

  it('findet alle Vorlagen eines Tages, keine ist zulässig', () => {
    const templates = [plan(), clearTemplateDays(plan())];
    expect(templatesForDay(templates, 1)).toHaveLength(1);
    expect(templatesForDay(templates, 2)).toEqual([]);
  });
});

describe('Übungen und Sätze', () => {
  it('fügt eine Katalogübung mit vorbelegten Sätzen an', () => {
    const next = addTemplateExercise(plan(), curl, 4);
    expect(next.exercises).toHaveLength(3);
    expect(next.exercises[2].sets).toHaveLength(4);
    expect(next.exercises[2].name).toBe(curl.name);
  });

  it('wählt bei Eigengewichtsübungen die passende Lastart', () => {
    const pullUp = catalogExercise('pull_up') as Exercise;
    const next = addTemplateExercise(createTemplate(NOW, 'X'), pullUp);
    expect(next.exercises[0].sets[0].loadKind).toBe('bodyweight');
  });

  it('entfernt eine Übung und ignoriert unmögliche Stellen', () => {
    expect(removeTemplateExercise(plan(), 0).exercises).toHaveLength(1);
    expect(removeTemplateExercise(plan(), 9).exercises).toHaveLength(2);
  });

  it('sortiert Übungen um und schneidet Ziele auf den Bereich zu', () => {
    const moved = moveTemplateExercise(plan(), 1, 0);
    expect(moved.exercises.map(e => e.exerciseId)).toEqual([
      'lying_leg_curl',
      'barbell_back_squat',
    ]);
    expect(moveTemplateExercise(plan(), 0, 99).exercises[1].exerciseId).toBe(
      'barbell_back_squat',
    );
    expect(moveTemplateExercise(plan(), 0, 0)).toEqual(plan());
  });

  it('hängt einen Satz nach dem Vorbild des letzten an', () => {
    const next = addPlannedSet(plan(), 1);
    expect(next.exercises[1].sets).toHaveLength(2);
    expect(next.exercises[1].sets[1]).toEqual(next.exercises[1].sets[0]);
  });

  it('lässt den letzten Satz einer Übung stehen', () => {
    expect(removePlannedSet(plan(), 1, 0).exercises[1].sets).toHaveLength(1);
    expect(removePlannedSet(plan(), 0, 0).exercises[0].sets).toHaveLength(1);
  });

  it('ändert einzelne Satzwerte', () => {
    const next = updatePlannedSet(plan(), 0, 1, {
      reps: 3,
      weightKg: 110,
      restSeconds: 240,
      kind: 'failure',
    });
    expect(next.exercises[0].sets[1]).toEqual({
      kind: 'failure',
      loadKind: 'kg',
      reps: 3,
      weightKg: 110,
      restSeconds: 240,
    });
    expect(next.exercises[0].sets[0].reps).toBe(5);
  });

  it('nimmt eine geleerte Vorgabe als nicht vorgegeben', () => {
    const next = updatePlannedSet(plan(), 0, 0, { weightKg: undefined });
    expect(next.exercises[0].sets[0].weightKg).toBeUndefined();
  });

  it('lässt keine negative Pause zu', () => {
    const next = updatePlannedSet(plan(), 0, 0, { restSeconds: -30 });
    expect(next.exercises[0].sets[0].restSeconds).toBe(0);
  });
});

describe('Vervielfältigen und Löschen', () => {
  it('legt eine eigenständige Kopie ohne Tageszuordnung an', () => {
    const list = duplicateTemplate([plan()], 'template-1', NOW + 1000);
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe('Unterkörper (Kopie)');
    expect(list[1].days).toEqual([]);
    expect(list[1].id).not.toBe('template-1');
    list[1].exercises[0].sets[0].reps = 99;
    expect(list[0].exercises[0].sets[0].reps).toBe(5);
  });

  it('lässt die Liste unberührt, wenn die Kennung fehlt', () => {
    expect(duplicateTemplate([plan()], 'weg', NOW)).toHaveLength(1);
  });

  it('löscht genau eine Vorlage', () => {
    const other = { ...plan(), id: 'template-2' };
    expect(deleteTemplate([plan(), other], 'template-1')).toEqual([other]);
  });

  it('legt beim Speichern an oder ersetzt', () => {
    expect(upsertTemplate([], plan())).toHaveLength(1);
    const changed = renameTemplate(plan(), 'Neu');
    const list = upsertTemplate([plan()], changed);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Neu');
  });
});

describe('Prüfung', () => {
  it('nimmt eine vollständige Vorlage an', () => {
    expect(validateTemplate(plan())).toEqual({ ok: true, problems: [] });
  });

  it('meldet fehlenden Namen und fehlende Übung als Daten', () => {
    const result = validateTemplate(createTemplate(NOW, '   '));
    expect(result.ok).toBe(false);
    expect(result.problems.map(p => p.field)).toEqual(['name', 'exercises']);
    expect(result.problems[0].message).toContain('Namen');
  });

  it('nennt eine Übung ohne Satz mit ihrer Stelle', () => {
    const empty: WorkoutTemplate = {
      ...plan(),
      exercises: [{ exerciseId: 'x', name: 'Testübung', sets: [] }],
    };
    const result = validateTemplate(empty);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toEqual({
      field: 'sets',
      exerciseIndex: 0,
      message: 'Testübung hat noch keinen Satz.',
    });
  });

  it('wirft bei keiner Eingabe', () => {
    expect(() =>
      validateTemplate({
        id: '',
        name: '',
        days: [],
        exercises: [],
        createdAt: 0,
      }),
    ).not.toThrow();
  });
});

describe('Vorlage aus einer gelaufenen Einheit', () => {
  const finished = (): StrengthSession => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW, {
      actualReps: 5,
      actualWeightKg: 102.5,
    });
    session = completeSet(session, 0, session.exercises[0].sets[1].id, NOW, {
      actualReps: 4,
      actualWeightKg: 102.5,
    });
    return session;
  };

  it('übernimmt die tatsächlichen Werte der bestätigten Sätze', () => {
    const derived = templateFromSession(finished(), NOW + DAY, 'Wie zuletzt');
    expect(derived.name).toBe('Wie zuletzt');
    expect(derived.exercises).toHaveLength(1);
    expect(derived.exercises[0].sets).toEqual([
      { kind: 'normal', loadKind: 'kg', reps: 5, weightKg: 102.5, restSeconds: 180 },
      { kind: 'normal', loadKind: 'kg', reps: 4, weightKg: 102.5, restSeconds: 180 },
    ]);
  });

  it('lässt übersprungene und offene Sätze weg und trägt keine Tage ein', () => {
    let session = finished();
    session = skipSet(session, 0, session.exercises[0].sets[1].id);
    const derived = templateFromSession(session, NOW + DAY);
    expect(derived.exercises[0].sets).toHaveLength(1);
    expect(derived.days).toEqual([]);
  });

  it('verändert die zugrunde liegende Einheit nicht', () => {
    const session = finished();
    const snapshot = JSON.stringify(session);
    templateFromSession(session, NOW + DAY);
    expect(JSON.stringify(session)).toBe(snapshot);
  });

  it('ergibt eine Vorlage ohne Übungen, wenn nichts bestätigt wurde', () => {
    const derived = templateFromSession(startSession(plan(), NOW), NOW);
    expect(derived.exercises).toEqual([]);
    expect(validateTemplate(derived).ok).toBe(false);
  });
});

describe('Plan und Durchführung nebeneinander', () => {
  it('erkennt einen Satz genau nach Vorgabe', () => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW);
    const result = comparePlan(session, plan());
    expect(result.exercises[0].sets[0].adherence).toBe('matched');
    expect(result.matched).toBe(1);
    expect(result.modelVersion).toBe(PLAN_MODEL_VERSION);
  });

  it('hält eine Abweichung mit Vorzeichen fest, ohne sie zu bewerten', () => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW, {
      actualReps: 7,
      actualWeightKg: 95,
    });
    const result = comparePlan(session, plan());
    const set = result.exercises[0].sets[0];
    expect(set.adherence).toBe('deviated');
    expect(set.repsDelta).toBe(2);
    expect(set.weightDelta).toBe(-5);
    expect(result.deviated).toBe(1);
  });

  it('unterscheidet übersprungen, offen und ergänzt', () => {
    let session = startSession(plan(), NOW);
    session = skipSet(session, 0, session.exercises[0].sets[0].id);
    const result = comparePlan(session, plan());
    expect(result.skipped).toBe(1);
    expect(result.open).toBe(2);
    expect(result.matched).toBe(0);
  });

  it('zählt Sätze über die Vorgabe hinaus als ergänzt', () => {
    const short: WorkoutTemplate = {
      ...plan(),
      exercises: [{ ...plan().exercises[0], sets: [plan().exercises[0].sets[0]] }],
    };
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[1].id, NOW);
    const result = comparePlan(session, short);
    expect(result.exercises[0].sets[1].adherence).toBe('added');
    expect(result.added).toBe(1);
  });

  it('führt eine geplante, aber nicht trainierte Übung als solche', () => {
    const session = startSession(
      { ...plan(), exercises: [plan().exercises[0]] },
      NOW,
    );
    const result = comparePlan(session, plan());
    expect(result.untrained).toEqual([
      {
        exerciseId: 'lying_leg_curl',
        name: 'Beinbeuger liegend',
        plannedSets: 1,
      },
    ]);
  });

  it('kennzeichnet eine frei ergänzte Übung', () => {
    const session = startSession(plan(), NOW);
    const withExtra: StrengthSession = {
      ...session,
      exercises: [
        ...session.exercises,
        { exerciseId: 'plank', name: 'Unterarmstütz', sets: [], added: true },
      ],
    };
    const result = comparePlan(withExtra, plan());
    expect(result.exercises[2].planned).toBe(false);
    expect(result.exercises[0].planned).toBe(true);
  });

  it('kommt ohne Plan aus und nennt das freies Training', () => {
    let session = startSession(null, NOW, 'Freies Training');
    session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW);
    const result = comparePlan(session, null);
    expect(result.hasPlan).toBe(false);
    expect(result.untrained).toEqual([]);
    expect(result.summary).toBe('Freies Training, 1 Satz erfasst.');
  });

  it('formuliert die Zusammenfassung ohne jede Wertung', () => {
    let session = startSession(plan(), NOW);
    session = completeSet(session, 0, session.exercises[0].sets[0].id, NOW);
    session = completeSet(session, 0, session.exercises[0].sets[1].id, NOW, {
      actualReps: 3,
    });
    session = skipSet(session, 1, session.exercises[1].sets[0].id);
    const { summary } = comparePlan(session, plan());
    expect(summary).toBe(
      '1 Satz wie vorgesehen, 1 mit anderen Werten, 1 übersprungen.',
    );
    for (const word of [
      'gut',
      'schlecht',
      'Fehler',
      'verfehlt',
      'geschafft',
      'leider',
      'nicht erfüllt',
    ]) {
      expect(summary.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('ordnet dieselbe Übung zweimal im Plan der Reihe nach zu', () => {
    const twice: WorkoutTemplate = {
      ...plan(),
      exercises: [plan().exercises[0], plan().exercises[0]],
    };
    const session = startSession(twice, NOW);
    const result = comparePlan(session, twice);
    expect(result.exercises.every(exercise => exercise.planned)).toBe(true);
    expect(result.untrained).toEqual([]);
  });

  it('liefert für dieselbe Eingabe dasselbe Ergebnis', () => {
    const session = startSession(plan(), NOW);
    expect(comparePlan(session, plan())).toEqual(comparePlan(session, plan()));
  });
});

describe('Vorschläge bleiben Vorschläge', () => {
  const proposal = (
    overrides: Partial<PlanProposal> = {},
  ): PlanProposal => ({
    id: 'proposal-1',
    templateId: 'template-1',
    scope: 'structure',
    reason: 'Der Montagstermin ist dreimal in Folge ausgefallen.',
    slots: 'Kniebeuge, Satz 1 und 2',
    expectation: 'Der Umfang passt wieder zu deiner Woche.',
    check: 'In vier Wochen: findet die Einheit wieder regelmäßig statt?',
    changes: [
      {
        kind: 'setValues',
        exerciseIndex: 0,
        setIndex: 0,
        values: { reps: 3 },
      },
    ],
    createdAt: NOW,
    ...overrides,
  });

  it('ändert den Plan erst, wenn er angewendet wird', () => {
    const template = plan();
    const snapshot = JSON.stringify(template);
    const suggestion = proposal();
    expect(JSON.stringify(template)).toBe(snapshot);
    const applied = applyProposal(template, suggestion);
    expect(applied.exercises[0].sets[0].reps).toBe(3);
    expect(JSON.stringify(template)).toBe(snapshot);
  });

  it('greift nur auf den Plan, für den er gedacht ist', () => {
    const other = { ...plan(), id: 'template-9' };
    expect(applyProposal(other, proposal())).toEqual(other);
  });

  it('lässt eine nicht mehr passende Änderung wirkungslos', () => {
    const suggestion = proposal({
      changes: [
        { kind: 'setValues', exerciseIndex: 7, setIndex: 0, values: { reps: 3 } },
      ],
    });
    expect(applyProposal(plan(), suggestion)).toEqual(plan());
  });

  it('kann Sätze ergänzen, entfernen und Tage setzen', () => {
    const suggestion = proposal({
      changes: [
        {
          kind: 'addSet',
          exerciseIndex: 1,
          set: { kind: 'normal', loadKind: 'kg', reps: 12, restSeconds: 90 },
        },
        { kind: 'removeSet', exerciseIndex: 0, setIndex: 1 },
        { kind: 'days', days: [2] },
      ],
    });
    const applied = applyProposal(plan(), suggestion);
    expect(applied.exercises[1].sets).toHaveLength(2);
    expect(applied.exercises[0].sets).toHaveLength(1);
    expect(applied.days).toEqual([2]);
  });

  it('lässt einen ersten Strukturvorschlag zu', () => {
    const gate = proposalIsAllowed(proposal(), [], NOW);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBeTruthy();
  });

  it('hält Strukturvorschläge auf Abstand und begründet das', () => {
    const records: ProposalRecord[] = [
      recordDecision(proposal(), 'accepted', NOW),
    ];
    const soon = proposalIsAllowed(
      proposal({ id: 'proposal-2', changes: [{ kind: 'days', days: [3] }] }),
      records,
      NOW + 7 * DAY,
    );
    expect(soon.allowed).toBe(false);
    expect(soon.reason).toContain('7 Tagen');
    const later = proposalIsAllowed(
      proposal({ id: 'proposal-2', changes: [{ kind: 'days', days: [3] }] }),
      records,
      NOW + (STRUCTURE_PROPOSAL_INTERVAL_DAYS + 1) * DAY,
    );
    expect(later.allowed).toBe(true);
  });

  it('lässt Last- und Wiederholungsvorschläge häufiger zu', () => {
    const load = proposal({ id: 'proposal-3', scope: 'load' });
    const records = [recordDecision(proposal(), 'accepted', NOW)];
    expect(proposalIsAllowed(load, records, NOW + DAY).allowed).toBe(true);
  });

  it('bringt einen abgelehnten Vorschlag nicht unverändert zurück', () => {
    const declined = proposal();
    const records = [recordDecision(declined, 'declined', NOW)];
    const again = proposalIsAllowed(declined, records, NOW + 7 * DAY);
    expect(again.allowed).toBe(false);
    expect(again.reason).toContain('abgelehnt');
    expect(
      proposalIsAllowed(
        declined,
        records,
        NOW + (DECLINED_PROPOSAL_SILENCE_DAYS + 1) * DAY,
      ).allowed,
    ).toBe(true);
  });

  it('erkennt gleiche Änderungen an ihrem Erkennungswert', () => {
    expect(proposalFingerprint(proposal())).toBe(
      proposalFingerprint(proposal({ id: 'anders', createdAt: NOW + DAY })),
    );
    expect(proposalFingerprint(proposal())).not.toBe(
      proposalFingerprint(proposal({ changes: [{ kind: 'days', days: [5] }] })),
    );
  });

  it('hält auch die Ablehnung als gültiges Ergebnis fest', () => {
    const record = recordDecision(proposal(), 'declined', NOW);
    expect(record.decision).toBe('declined');
    expect(record.templateId).toBe('template-1');
    expect(record.decidedAt).toBe(NOW);
  });

  it('nennt in jedem Vorschlag Anlass, Stellen, Wirkung und Prüfkriterium', () => {
    const suggestion = proposal();
    expect(suggestion.reason.length).toBeGreaterThan(0);
    expect(suggestion.slots.length).toBeGreaterThan(0);
    expect(suggestion.expectation.length).toBeGreaterThan(0);
    expect(suggestion.check.length).toBeGreaterThan(0);
  });
});
