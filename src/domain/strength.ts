import type { MuscleShares } from './regions';
import { sharesAreValid } from './regions';

/**
 * Krafttraining nach docs/zielspezifikation-training.md T-1, T-3, T-4 und T-5.
 *
 * Reine Funktionen ohne Zustand. Alles, was den Verlauf einer Einheit verändert,
 * gibt eine neue Einheit zurück; die Aufrufer entscheiden über Speichern.
 *
 * Grundregel aus T-5: Vorgabe und tatsächlicher Wert liegen getrennt und
 * bleiben beide erhalten. Abweichung wird festgehalten, aber nicht bewertet.
 */
export const STRENGTH_MODEL_VERSION = 'strength-v1';
export const CATALOG_VERSION = 'catalog-v1';

export type SetKind = 'warmup' | 'normal' | 'failure' | 'dropset' | 'timed';
export type LoadKind = 'kg' | 'bodyweight' | 'assisted' | 'bodyweight_plus';
export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'band';

export interface Exercise {
  id: string;
  name: string;
  equipment: Equipment;
  /** Trainiert eine Seite zur Zeit; Belastung geht dann nur auf diese Seite. */
  unilateral: boolean;
  /** Exzentrik- und Dehnungsfaktor, docs/muskelmodell.md §3. */
  eccentric: number;
  shares: MuscleShares;
  /** `catalog` oder `user`. Eigene Übungen tragen keine Katalogherkunft. */
  origin: 'catalog' | 'user';
  catalogVersion?: string;
}

/** Zielvorgabe eines Satzes. Stammt aus Plan oder letzter Einheit. */
export interface PlannedSet {
  kind: SetKind;
  loadKind: LoadKind;
  reps?: number;
  seconds?: number;
  weightKg?: number;
  restSeconds: number;
}

/** Ein Satz während oder nach der Einheit: Vorgabe plus tatsächlicher Wert. */
export interface LoggedSet {
  id: string;
  planned: PlannedSet;
  actualReps?: number;
  actualSeconds?: number;
  actualWeightKg?: number;
  completedAt?: number;
  /** Vom Nutzer übersprungen. Kein Fehler, nur eine Angabe zur Umsetzung. */
  skipped?: boolean;
}

export interface SessionExercise {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
  /** Frei ergänzt statt aus dem Plan übernommen. */
  added?: boolean;
}

export type SessionStatus = 'active' | 'finished' | 'interrupted';

export interface StrengthSession {
  id: string;
  kind: 'strength';
  name: string;
  templateId?: string;
  startTime: number;
  endTime?: number;
  status: SessionStatus;
  exercises: SessionExercise[];
  currentExercise: number;
  /** Läuft seit diesem Zeitpunkt, für die Pause nach einem Satz. */
  restStartedAt?: number;
  restSeconds?: number;
  note?: string;
  modelVersion: string;
  catalogVersion: string;
}

export interface TemplateExercise {
  exerciseId: string;
  name: string;
  sets: PlannedSet[];
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  /** Wochentage 0 (Sonntag) bis 6, wie `Date.getDay`. Leer heißt: kein fester Tag. */
  days: number[];
  exercises: TemplateExercise[];
  createdAt: number;
}

export interface StrengthState {
  templates: WorkoutTemplate[];
  active: StrengthSession | null;
  history: SessionSummary[];
}

export interface SessionSummary {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  completedSets: number;
  volumeKg: number;
}

const identifier = (
  prefix: string,
  seed: number,
  index: number,
  scope = 0,
) => `${prefix}-${seed.toString(36)}-${scope}-${index}`;

export const emptyStrengthState = (): StrengthState => ({
  templates: [],
  active: null,
  history: [],
});

/**
 * Startet eine Einheit aus einer Vorlage. Ohne Vorlage entsteht eine leere
 * Einheit, der Übungen einzeln hinzugefügt werden.
 */
export function startSession(
  template: WorkoutTemplate | null,
  now: number,
  name = 'Freies Training',
): StrengthSession {
  const exercises = (template?.exercises || []).map((exercise, exerciseIndex) => ({
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    sets: exercise.sets.map((planned, index) => ({
      id: identifier(exercise.exerciseId, now, index, exerciseIndex),
      planned: { ...planned },
    })),
  }));
  return {
    id: `session-${now.toString(36)}`,
    kind: 'strength',
    name: template?.name || name,
    templateId: template?.id,
    startTime: now,
    status: 'active',
    exercises,
    currentExercise: 0,
    modelVersion: STRENGTH_MODEL_VERSION,
    catalogVersion: CATALOG_VERSION,
  };
}

const replaceExercise = (
  session: StrengthSession,
  index: number,
  next: SessionExercise,
): StrengthSession => ({
  ...session,
  exercises: session.exercises.map((exercise, i) =>
    i === index ? next : exercise,
  ),
});

const replaceSet = (
  exercise: SessionExercise,
  setId: string,
  next: LoggedSet,
): SessionExercise => ({
  ...exercise,
  sets: exercise.sets.map(set => (set.id === setId ? next : set)),
});

export function selectExercise(
  session: StrengthSession,
  index: number,
): StrengthSession {
  if (!session.exercises.length) {
    return session;
  }
  const clamped = Math.min(Math.max(index, 0), session.exercises.length - 1);
  return clamped === session.currentExercise
    ? session
    : { ...session, currentExercise: clamped };
}

/** Trägt geänderte Werte ein, ohne den Satz abzuschließen. */
export function editSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
  values: Pick<LoggedSet, 'actualReps' | 'actualWeightKg' | 'actualSeconds'>,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const set = exercise?.sets.find(candidate => candidate.id === setId);
  if (!exercise || !set) {
    return session;
  }
  return replaceExercise(
    session,
    exerciseIndex,
    replaceSet(exercise, setId, { ...set, ...values }),
  );
}

/**
 * Schließt einen Satz ab. Nicht angegebene Werte übernehmen die Vorgabe, damit
 * das Bestätigen mit einer Aktion möglich bleibt (T-4).
 */
export function completeSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
  now: number,
  values: Pick<
    LoggedSet,
    'actualReps' | 'actualWeightKg' | 'actualSeconds'
  > = {},
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const set = exercise?.sets.find(candidate => candidate.id === setId);
  if (!exercise || !set) {
    return session;
  }
  if (set.completedAt !== undefined) {
    // Erneutes Tippen nimmt den Abschluss zurück; die Werte bleiben stehen.
    const reopened = replaceSet(exercise, setId, {
      ...set,
      completedAt: undefined,
    });
    return {
      ...replaceExercise(session, exerciseIndex, reopened),
      restStartedAt: undefined,
      restSeconds: undefined,
    };
  }
  const completed: LoggedSet = {
    ...set,
    ...values,
    actualReps: values.actualReps ?? set.actualReps ?? set.planned.reps,
    actualWeightKg:
      values.actualWeightKg ?? set.actualWeightKg ?? set.planned.weightKg,
    actualSeconds:
      values.actualSeconds ?? set.actualSeconds ?? set.planned.seconds,
    completedAt: now,
    skipped: false,
  };
  const rest = set.planned.restSeconds;
  return {
    ...replaceExercise(
      session,
      exerciseIndex,
      replaceSet(exercise, setId, completed),
    ),
    restStartedAt: rest > 0 ? now : undefined,
    restSeconds: rest > 0 ? rest : undefined,
  };
}

export function skipSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  const set = exercise?.sets.find(candidate => candidate.id === setId);
  if (!exercise || !set) {
    return session;
  }
  return replaceExercise(
    session,
    exerciseIndex,
    replaceSet(exercise, setId, {
      ...set,
      skipped: !set.skipped,
      completedAt: undefined,
    }),
  );
}

/** Hängt einen Satz an, vorbelegt aus dem letzten Satz derselben Übung. */
export function addSet(
  session: StrengthSession,
  exerciseIndex: number,
  now: number,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise) {
    return session;
  }
  const last = exercise.sets[exercise.sets.length - 1];
  const planned: PlannedSet = last
    ? {
        ...last.planned,
        reps: last.actualReps ?? last.planned.reps,
        weightKg: last.actualWeightKg ?? last.planned.weightKg,
        seconds: last.actualSeconds ?? last.planned.seconds,
      }
    : { kind: 'normal', loadKind: 'kg', reps: 8, restSeconds: 120 };
  return replaceExercise(session, exerciseIndex, {
    ...exercise,
    sets: [
      ...exercise.sets,
      { id: identifier(exercise.exerciseId, now, exercise.sets.length), planned },
    ],
  });
}

export function removeSet(
  session: StrengthSession,
  exerciseIndex: number,
  setId: string,
): StrengthSession {
  const exercise = session.exercises[exerciseIndex];
  if (!exercise || exercise.sets.length <= 1) {
    return session;
  }
  return replaceExercise(session, exerciseIndex, {
    ...exercise,
    sets: exercise.sets.filter(set => set.id !== setId),
  });
}

/** Ergänzt eine Übung spontan. Sie wird als frei ergänzt gekennzeichnet. */
export function addExercise(
  session: StrengthSession,
  exercise: Exercise,
  now: number,
  sets = 3,
): StrengthSession {
  const planned: PlannedSet = {
    kind: 'normal',
    loadKind: exercise.equipment === 'bodyweight' ? 'bodyweight' : 'kg',
    reps: 8,
    restSeconds: 120,
  };
  const next: SessionExercise = {
    exerciseId: exercise.id,
    name: exercise.name,
    added: true,
    sets: Array.from({ length: Math.max(1, sets) }, (_, index) => ({
      id: identifier(exercise.id, now, index, session.exercises.length),
      planned: { ...planned },
    })),
  };
  return {
    ...session,
    exercises: [...session.exercises, next],
    currentExercise: session.exercises.length,
  };
}

export interface ExerciseProgress {
  completed: number;
  total: number;
  done: boolean;
  /** Erster Satz, der noch offen ist. Für die Vorbelegung der Eingabe. */
  activeSetId?: string;
}

export function exerciseProgress(exercise: SessionExercise): ExerciseProgress {
  const relevant = exercise.sets.filter(set => !set.skipped);
  const completed = relevant.filter(set => set.completedAt !== undefined).length;
  return {
    completed,
    total: relevant.length,
    done: relevant.length > 0 && completed === relevant.length,
    activeSetId: exercise.sets.find(
      set => set.completedAt === undefined && !set.skipped,
    )?.id,
  };
}

export function sessionProgress(session: StrengthSession): {
  completedSets: number;
  totalSets: number;
  volumeKg: number;
} {
  let completedSets = 0;
  let totalSets = 0;
  let volumeKg = 0;
  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      if (set.skipped) {
        continue;
      }
      totalSets += 1;
      if (set.completedAt === undefined) {
        continue;
      }
      completedSets += 1;
      if (set.actualWeightKg && set.actualReps) {
        volumeKg += set.actualWeightKg * set.actualReps;
      }
    }
  }
  return { completedSets, totalSets, volumeKg };
}

/** Verbleibende Pausensekunden, oder null, wenn keine Pause läuft. */
export function restRemaining(
  session: StrengthSession,
  now: number,
): number | null {
  if (session.restStartedAt === undefined || !session.restSeconds) {
    return null;
  }
  const elapsed = Math.floor((now - session.restStartedAt) / 1000);
  const remaining = session.restSeconds - elapsed;
  return remaining > 0 ? remaining : null;
}

export function clearRest(session: StrengthSession): StrengthSession {
  return session.restStartedAt === undefined
    ? session
    : { ...session, restStartedAt: undefined, restSeconds: undefined };
}

/**
 * Kurzform der letzten vergleichbaren Leistung, etwa `80 kg × 8`.
 * Aus der Historie, damit im Training sichtbar ist, woran angeknüpft wird.
 */
export function referenceLabel(
  history: StrengthSession[],
  exerciseId: string,
  setIndex: number,
): string | null {
  for (const session of history) {
    const exercise = session.exercises.find(
      candidate => candidate.exerciseId === exerciseId,
    );
    const set = exercise?.sets.filter(
      candidate => candidate.completedAt !== undefined,
    )[
      setIndex
    ];
    if (!set) {
      continue;
    }
    if (set.actualWeightKg && set.actualReps) {
      return `${formatWeight(set.actualWeightKg)} kg × ${set.actualReps}`;
    }
    if (set.actualReps) {
      return `${set.actualReps} Wdh.`;
    }
    if (set.actualSeconds) {
      return `${set.actualSeconds} s`;
    }
  }
  return null;
}

export function formatWeight(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace('.', ',');
}

/**
 * Geschätztes Einwiederholungsmaximum nach Epley, docs/muskelmodell.md §3.
 * Schätzung, keine Messung. Nur für Arbeitssätze mit Last und Wiederholungen.
 */
export function epley1RM(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !(reps > 0) || reps > 30) {
    return null;
  }
  return weightKg * (1 + reps / 30);
}

/** Bester geschätzter Wert einer Einheit für eine Übung. */
export function sessionBest1RM(
  session: StrengthSession,
  exerciseId: string,
): number | null {
  const exercise = session.exercises.find(
    candidate => candidate.exerciseId === exerciseId,
  );
  if (!exercise) {
    return null;
  }
  let best: number | null = null;
  for (const set of exercise.sets) {
    if (set.completedAt === undefined || set.planned.kind === 'warmup') {
      continue;
    }
    const estimate = epley1RM(set.actualWeightKg || 0, set.actualReps || 0);
    if (estimate !== null && (best === null || estimate > best)) {
      best = estimate;
    }
  }
  return best;
}

export function finishSession(
  session: StrengthSession,
  now: number,
): StrengthSession {
  return {
    ...clearRest(session),
    status: 'finished',
    endTime: now,
  };
}

export function summarize(session: StrengthSession): SessionSummary {
  const { completedSets, volumeKg } = sessionProgress(session);
  return {
    id: session.id,
    name: session.name,
    startTime: session.startTime,
    endTime: session.endTime || session.startTime,
    completedSets,
    volumeKg,
  };
}

/** Vorlage, die heute ansteht. Ohne Treffer null; das ist kein Fehler. */
export function templateForDay(
  templates: WorkoutTemplate[],
  day: number,
): WorkoutTemplate | null {
  return templates.find(template => template.days.includes(day)) || null;
}

export function exerciseIsUsable(exercise: Exercise): boolean {
  return sharesAreValid(exercise.shares) && exercise.eccentric > 0;
}
