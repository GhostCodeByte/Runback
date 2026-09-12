import type {
  Exercise,
  LoadKind,
  LoggedSet,
  PlannedSet,
  SetKind,
  StrengthSession,
  TemplateExercise,
  WorkoutTemplate,
} from './strength';

/**
 * Trainingspläne.
 *
 * Ein Plan ist ein Nutzerartefakt. Er schlägt vor, er verpflichtet nicht.
 * Alle Funktionen hier sind rein und geben eine neue Vorlage zurück; ob und
 * wann gespeichert wird, entscheiden die Aufrufer. Die Zeit kommt immer als
 * Parameter herein, damit dieselbe Eingabe dasselbe Ergebnis liefert.
 *
 * Zwei Regeln durchziehen die Datei:
 * - Die App ändert keinen Plan von sich aus. Ein Vorschlag ist Daten; erst ein
 *   ausdrückliches `applyProposal` des Nutzers macht ihn wirksam (T-6).
 * - Eine Abweichung zwischen Plan und Durchführung wird festgehalten, aber
 *   nicht bewertet. Es gibt hier kein Gut, kein Schlecht und kein Versäumnis
 *   (T-5, Grundregel 13: Umsetzung ist nicht Ergebnis).
 */

export const PLAN_MODEL_VERSION = 'plans-v1';

/** Abstand, den ein erneuter Strukturvorschlag zum letzten einhält (T-6). */
export const STRUCTURE_PROPOSAL_INTERVAL_DAYS = 28;

/** So lange kehrt ein abgelehnter Vorschlag unverändert nicht wieder (T-6). */
export const DECLINED_PROPOSAL_SILENCE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Wochentage 0 (Sonntag) bis 6, wie `Date.getDay`. */
export const WEEKDAY_LABELS = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];

export const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Reihenfolge für die Anzeige: die Woche beginnt montags. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_SET: PlannedSet = {
  kind: 'normal',
  loadKind: 'kg',
  reps: 8,
  restSeconds: 120,
};

const isDay = (day: number) => Number.isInteger(day) && day >= 0 && day <= 6;

const sortDays = (days: number[]) =>
  [...new Set(days.filter(isDay))].sort(
    (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b),
  );

const replaceExercise = (
  template: WorkoutTemplate,
  index: number,
  next: TemplateExercise,
): WorkoutTemplate => ({
  ...template,
  exercises: template.exercises.map((exercise, i) =>
    i === index ? next : exercise,
  ),
});

const withinBounds = (index: number, length: number) =>
  Number.isInteger(index) && index >= 0 && index < length;

// ── Anlegen, Bearbeiten, Vervielfältigen ───────────────────────────────────

const uniqueId = (existing: WorkoutTemplate[], base: string): string => {
  const taken = new Set(existing.map(template => template.id));
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
};

/** Leere Vorlage. Ohne Übungen; die Prüfung nennt das als offenen Punkt. */
export function createTemplate(
  now: number,
  name = '',
  existing: WorkoutTemplate[] = [],
): WorkoutTemplate {
  return {
    id: uniqueId(existing, `template-${now.toString(36)}`),
    name,
    days: [],
    exercises: [],
    createdAt: now,
  };
}

export function renameTemplate(
  template: WorkoutTemplate,
  name: string,
): WorkoutTemplate {
  return { ...template, name };
}

/** Setzt die Wochentage. Eine leere Liste heißt ausdrücklich: kein fester Tag. */
export function setTemplateDays(
  template: WorkoutTemplate,
  days: number[],
): WorkoutTemplate {
  return { ...template, days: sortDays(days) };
}

export function toggleTemplateDay(
  template: WorkoutTemplate,
  day: number,
): WorkoutTemplate {
  if (!isDay(day)) {
    return template;
  }
  return setTemplateDays(
    template,
    template.days.includes(day)
      ? template.days.filter(entry => entry !== day)
      : [...template.days, day],
  );
}

/** Nimmt jede Tagesbindung zurück. Ohne festen Tag ist ein Plan vollwertig. */
export function clearTemplateDays(template: WorkoutTemplate): WorkoutTemplate {
  return template.days.length ? { ...template, days: [] } : template;
}

export function hasFixedDay(template: WorkoutTemplate): boolean {
  return template.days.length > 0;
}

export function daysLabel(template: WorkoutTemplate): string {
  return template.days.length
    ? template.days.map(day => WEEKDAY_SHORT[day]).join(', ')
    : 'Kein fester Tag';
}

/**
 * Fügt eine Katalogübung an. Die Vorbelegung ist eine Ausgangsannahme und
 * kein Zielwert; der Nutzer setzt die Sätze anschließend selbst.
 */
export function addTemplateExercise(
  template: WorkoutTemplate,
  exercise: Exercise,
  sets = 3,
): WorkoutTemplate {
  const planned: PlannedSet = {
    ...DEFAULT_SET,
    loadKind: exercise.equipment === 'bodyweight' ? 'bodyweight' : 'kg',
  };
  return {
    ...template,
    exercises: [
      ...template.exercises,
      {
        exerciseId: exercise.id,
        name: exercise.name,
        sets: Array.from({ length: Math.max(1, sets) }, () => ({ ...planned })),
      },
    ],
  };
}

export function removeTemplateExercise(
  template: WorkoutTemplate,
  index: number,
): WorkoutTemplate {
  if (!withinBounds(index, template.exercises.length)) {
    return template;
  }
  return {
    ...template,
    exercises: template.exercises.filter((_, i) => i !== index),
  };
}

/** Verschiebt eine Übung an eine andere Stelle. Außerhalb wird abgeschnitten. */
export function moveTemplateExercise(
  template: WorkoutTemplate,
  from: number,
  to: number,
): WorkoutTemplate {
  const length = template.exercises.length;
  if (!withinBounds(from, length)) {
    return template;
  }
  const target = Math.min(Math.max(to, 0), length - 1);
  if (target === from) {
    return template;
  }
  const exercises = [...template.exercises];
  const [moved] = exercises.splice(from, 1);
  exercises.splice(target, 0, moved);
  return { ...template, exercises };
}

/** Hängt einen Satz an, vorbelegt aus dem letzten Satz derselben Übung. */
export function addPlannedSet(
  template: WorkoutTemplate,
  exerciseIndex: number,
): WorkoutTemplate {
  const exercise = template.exercises[exerciseIndex];
  if (!exercise) {
    return template;
  }
  const last = exercise.sets[exercise.sets.length - 1];
  return replaceExercise(template, exerciseIndex, {
    ...exercise,
    sets: [...exercise.sets, { ...(last || DEFAULT_SET) }],
  });
}

/** Entfernt einen Satz. Der letzte verbleibende Satz bleibt stehen. */
export function removePlannedSet(
  template: WorkoutTemplate,
  exerciseIndex: number,
  setIndex: number,
): WorkoutTemplate {
  const exercise = template.exercises[exerciseIndex];
  if (!exercise || exercise.sets.length <= 1) {
    return template;
  }
  if (!withinBounds(setIndex, exercise.sets.length)) {
    return template;
  }
  return replaceExercise(template, exerciseIndex, {
    ...exercise,
    sets: exercise.sets.filter((_, i) => i !== setIndex),
  });
}

export interface PlannedSetValues {
  kind?: SetKind;
  loadKind?: LoadKind;
  reps?: number;
  seconds?: number;
  weightKg?: number;
  restSeconds?: number;
}

/**
 * Ändert einen geplanten Satz. `undefined` in `values` löscht den Wert, damit
 * eine geleerte Eingabe auch wirklich „nicht vorgegeben“ bedeutet.
 */
export function updatePlannedSet(
  template: WorkoutTemplate,
  exerciseIndex: number,
  setIndex: number,
  values: PlannedSetValues,
): WorkoutTemplate {
  const exercise = template.exercises[exerciseIndex];
  if (!exercise || !withinBounds(setIndex, exercise.sets.length)) {
    return template;
  }
  const current = exercise.sets[setIndex];
  const next: PlannedSet = { ...current };
  for (const key of Object.keys(values) as (keyof PlannedSetValues)[]) {
    const value = values[key];
    if (key === 'kind' && value !== undefined) {
      next.kind = value as SetKind;
    } else if (key === 'loadKind' && value !== undefined) {
      next.loadKind = value as LoadKind;
    } else if (key === 'restSeconds') {
      next.restSeconds = Math.max(0, Number(value) || 0);
    } else if (key === 'reps' || key === 'seconds' || key === 'weightKg') {
      const parsed = typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
      next[key] = parsed !== undefined && parsed >= 0 ? parsed : undefined;
    }
  }
  return replaceExercise(template, exerciseIndex, {
    ...exercise,
    sets: exercise.sets.map((set, i) => (i === setIndex ? next : set)),
  });
}

/** Legt eine Kopie an. Sie ist eigenständig und teilt keine Tage zu. */
export function duplicateTemplate(
  templates: WorkoutTemplate[],
  id: string,
  now: number,
): WorkoutTemplate[] {
  const source = templates.find(template => template.id === id);
  if (!source) {
    return templates;
  }
  const copy: WorkoutTemplate = {
    ...source,
    id: uniqueId(templates, `template-${now.toString(36)}`),
    name: `${source.name} (Kopie)`,
    days: [],
    createdAt: now,
    exercises: source.exercises.map(exercise => ({
      ...exercise,
      sets: exercise.sets.map(set => ({ ...set })),
    })),
  };
  const index = templates.findIndex(template => template.id === id);
  return [
    ...templates.slice(0, index + 1),
    copy,
    ...templates.slice(index + 1),
  ];
}

export function deleteTemplate(
  templates: WorkoutTemplate[],
  id: string,
): WorkoutTemplate[] {
  return templates.filter(template => template.id !== id);
}

/** Legt an oder ersetzt, je nachdem ob die Kennung schon vorkommt. */
export function upsertTemplate(
  templates: WorkoutTemplate[],
  template: WorkoutTemplate,
): WorkoutTemplate[] {
  return templates.some(entry => entry.id === template.id)
    ? templates.map(entry => (entry.id === template.id ? template : entry))
    : [...templates, template];
}

/** Alle Vorlagen eines Wochentags. Keine ist auch ein zulässiges Ergebnis. */
export function templatesForDay(
  templates: WorkoutTemplate[],
  day: number,
): WorkoutTemplate[] {
  return templates.filter(template => template.days.includes(day));
}

// ── Vorlage aus einer gelaufenen Einheit ───────────────────────────────────

/**
 * Macht aus einer erfassten Einheit eine Vorlage: „so wie eben“ als Plan.
 *
 * Übernommen wird, was tatsächlich stattgefunden hat — bestätigte Sätze mit
 * ihren tatsächlichen Werten. Übersprungene und offene Sätze wandern nicht in
 * den Plan; sie sind Teil der Einheit, nicht der Absicht. Die Einheit selbst
 * bleibt unverändert (Grundregel 1).
 */
export function templateFromSession(
  session: StrengthSession,
  now: number,
  name = session.name,
  existing: WorkoutTemplate[] = [],
): WorkoutTemplate {
  const exercises: TemplateExercise[] = [];
  for (const exercise of session.exercises) {
    const sets = exercise.sets
      .filter(set => set.completedAt !== undefined && !set.skipped)
      .map(set => plannedFromLogged(set));
    if (sets.length) {
      exercises.push({
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        sets,
      });
    }
  }
  return {
    ...createTemplate(now, name, existing),
    exercises,
  };
}

const plannedFromLogged = (set: LoggedSet): PlannedSet => {
  const next: PlannedSet = {
    kind: set.planned.kind,
    loadKind: set.planned.loadKind,
    restSeconds: set.planned.restSeconds,
  };
  const reps = set.actualReps ?? set.planned.reps;
  const seconds = set.actualSeconds ?? set.planned.seconds;
  const weightKg = set.actualWeightKg ?? set.planned.weightKg;
  if (reps !== undefined) {
    next.reps = reps;
  }
  if (seconds !== undefined) {
    next.seconds = seconds;
  }
  if (weightKg !== undefined) {
    next.weightKg = weightKg;
  }
  return next;
};

// ── Prüfung ────────────────────────────────────────────────────────────────

export type TemplateProblemField = 'name' | 'exercises' | 'sets';

/** Ein offener Punkt an der Vorlage. Daten, keine Ausnahme, kein Vorwurf. */
export interface TemplateProblem {
  field: TemplateProblemField;
  message: string;
  exerciseIndex?: number;
}

export interface TemplateValidation {
  ok: boolean;
  problems: TemplateProblem[];
}

/**
 * Prüft eine Vorlage. Nutzereingaben werfen nie; ein offener Punkt ist ein
 * Eintrag in `problems`, den die Oberfläche neben dem Feld anzeigen kann.
 */
export function validateTemplate(
  template: WorkoutTemplate,
): TemplateValidation {
  const problems: TemplateProblem[] = [];
  if (!template.name.trim()) {
    problems.push({ field: 'name', message: 'Der Plan braucht einen Namen.' });
  }
  if (!template.exercises.length) {
    problems.push({
      field: 'exercises',
      message: 'Füge mindestens eine Übung hinzu.',
    });
  }
  template.exercises.forEach((exercise, exerciseIndex) => {
    if (!exercise.sets.length) {
      problems.push({
        field: 'sets',
        exerciseIndex,
        message: `${exercise.name} hat noch keinen Satz.`,
      });
    }
  });
  return { ok: problems.length === 0, problems };
}

// ── Plan und Durchführung nebeneinander ────────────────────────────────────

/**
 * Wie ein Satz zur Vorgabe steht. Ausdrücklich kein Urteil:
 * `deviated` heißt „anders als vorgesehen“, nicht „falsch“.
 */
export type SetAdherence =
  | 'matched'
  | 'deviated'
  | 'added'
  | 'skipped'
  | 'open';

export interface SetComparison {
  setId: string;
  position: number;
  adherence: SetAdherence;
  planned?: PlannedSet;
  actualReps?: number;
  actualSeconds?: number;
  actualWeightKg?: number;
  /** Tatsächlich minus vorgesehen. Vorzeichen, keine Wertung. */
  repsDelta?: number;
  secondsDelta?: number;
  weightDelta?: number;
}

export interface ExerciseComparison {
  exerciseId: string;
  name: string;
  /** Stand so im Plan. Sonst frei ergänzt. */
  planned: boolean;
  sets: SetComparison[];
}

/** Im Plan vorgesehen, in der Einheit nicht aufgetaucht. Kein Fehlzustand. */
export interface UntrainedExercise {
  exerciseId: string;
  name: string;
  plannedSets: number;
}

export interface PlanComparison {
  templateId?: string;
  templateName?: string;
  /** Ohne Vorlage gibt es nichts zu vergleichen; das ist zulässig (T-5). */
  hasPlan: boolean;
  exercises: ExerciseComparison[];
  untrained: UntrainedExercise[];
  matched: number;
  deviated: number;
  added: number;
  skipped: number;
  open: number;
  /** Neutrale Zusammenfassung in einem Satz. */
  summary: string;
  modelVersion: string;
}

const sameNumber = (a?: number, b?: number) =>
  (a ?? undefined) === (b ?? undefined);

const delta = (actual?: number, planned?: number) =>
  actual !== undefined && planned !== undefined && actual !== planned
    ? Math.round((actual - planned) * 100) / 100
    : undefined;

const compareSet = (
  set: LoggedSet,
  planned: PlannedSet | undefined,
  position: number,
): SetComparison => {
  const base: SetComparison = {
    setId: set.id,
    position,
    adherence: 'open',
    planned,
    actualReps: set.actualReps,
    actualSeconds: set.actualSeconds,
    actualWeightKg: set.actualWeightKg,
  };
  if (set.skipped) {
    return { ...base, adherence: 'skipped' };
  }
  if (set.completedAt === undefined) {
    return base;
  }
  if (!planned) {
    return { ...base, adherence: 'added' };
  }
  const repsDelta = delta(set.actualReps, planned.reps);
  const secondsDelta = delta(set.actualSeconds, planned.seconds);
  const weightDelta = delta(set.actualWeightKg, planned.weightKg);
  const identical =
    sameNumber(set.actualReps, planned.reps) &&
    sameNumber(set.actualSeconds, planned.seconds) &&
    sameNumber(set.actualWeightKg, planned.weightKg);
  return {
    ...base,
    adherence: identical ? 'matched' : 'deviated',
    repsDelta,
    secondsDelta,
    weightDelta,
  };
};

/**
 * Stellt eine erfasste Einheit neben ihre Vorlage.
 *
 * Das Ergebnis ist eine Angabe zur Umsetzung nach T-5 und Grundregel 13. Es
 * enthält bewusst keine Bewertung, keine Quote und keinen Zielwert. Fehlt die
 * Vorlage, ist `hasPlan` falsch und alles Erfasste zählt als frei trainiert.
 */
export function comparePlan(
  session: StrengthSession,
  template: WorkoutTemplate | null,
): PlanComparison {
  const exercises: ExerciseComparison[] = [];
  const used = new Set<number>();
  let matched = 0;
  let deviated = 0;
  let added = 0;
  let skipped = 0;
  let open = 0;

  for (const exercise of session.exercises) {
    const planIndex = template
      ? template.exercises.findIndex(
          (candidate, index) =>
            candidate.exerciseId === exercise.exerciseId && !used.has(index),
        )
      : -1;
    if (planIndex >= 0) {
      used.add(planIndex);
    }
    const plannedSets =
      planIndex >= 0 && template ? template.exercises[planIndex].sets : [];
    const sets = exercise.sets.map((set, position) =>
      compareSet(set, plannedSets[position], position + 1),
    );
    for (const set of sets) {
      if (set.adherence === 'matched') {
        matched += 1;
      } else if (set.adherence === 'deviated') {
        deviated += 1;
      } else if (set.adherence === 'added') {
        added += 1;
      } else if (set.adherence === 'skipped') {
        skipped += 1;
      } else {
        open += 1;
      }
    }
    exercises.push({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      planned: planIndex >= 0,
      sets,
    });
  }

  const untrained: UntrainedExercise[] = [];
  if (template) {
    template.exercises.forEach((exercise, index) => {
      if (!used.has(index)) {
        untrained.push({
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          plannedSets: exercise.sets.length,
        });
      }
    });
  }

  return {
    templateId: template?.id,
    templateName: template?.name,
    hasPlan: Boolean(template),
    exercises,
    untrained,
    matched,
    deviated,
    added,
    skipped,
    open,
    summary: comparisonSummary({
      hasPlan: Boolean(template),
      matched,
      deviated,
      added,
      skipped,
      open,
      untrained: untrained.length,
    }),
    modelVersion: PLAN_MODEL_VERSION,
  };
}

const setWord = (count: number) => (count === 1 ? 'Satz' : 'Sätze');

/**
 * Ein Satz in neutraler Sprache. Zählt auf, was war, und lässt es dabei.
 * Wörter wie „gut“, „schlecht“, „verfehlt“ oder „geschafft“ kommen hier
 * bewusst nicht vor.
 */
function comparisonSummary(counts: {
  hasPlan: boolean;
  matched: number;
  deviated: number;
  added: number;
  skipped: number;
  open: number;
  untrained: number;
}): string {
  if (!counts.hasPlan) {
    const total = counts.matched + counts.deviated + counts.added;
    return total
      ? `Freies Training, ${total} ${setWord(total)} erfasst.`
      : 'Freies Training ohne erfasste Sätze.';
  }
  const parts: string[] = [];
  if (counts.matched) {
    parts.push(`${counts.matched} ${setWord(counts.matched)} wie vorgesehen`);
  }
  if (counts.deviated) {
    parts.push(
      `${counts.deviated} mit anderen Werten`,
    );
  }
  if (counts.added) {
    parts.push(`${counts.added} zusätzlich`);
  }
  if (counts.skipped) {
    parts.push(`${counts.skipped} übersprungen`);
  }
  if (counts.open) {
    parts.push(`${counts.open} offen`);
  }
  if (counts.untrained) {
    parts.push(
      `${counts.untrained} ${
        counts.untrained === 1 ? 'Übung' : 'Übungen'
      } nicht trainiert`,
    );
  }
  return parts.length
    ? `${parts.join(', ')}.`
    : 'Zu dieser Einheit wurde nichts erfasst.';
}

// ── Vorschläge: vorschlagen, nie umschreiben ───────────────────────────────

export type PlanChange =
  | {
      kind: 'setValues';
      exerciseIndex: number;
      setIndex: number;
      values: PlannedSetValues;
    }
  | { kind: 'addSet'; exerciseIndex: number; set: PlannedSet }
  | { kind: 'removeSet'; exerciseIndex: number; setIndex: number }
  | { kind: 'days'; days: number[] };

/**
 * `structure` betrifft Tage, Übungen und Umfang und bleibt selten.
 * `load` betrifft Last, Sätze und Wiederholungen und darf häufiger kommen,
 * weil diese Werte ohnehin je Einheit neu gesetzt werden (T-6).
 */
export type ProposalScope = 'structure' | 'load';

export interface PlanProposal {
  id: string;
  templateId: string;
  scope: ProposalScope;
  /** Anlass: woraus der Vorschlag entstanden ist. */
  reason: string;
  /** Betroffene Stellen im Plan, in Worten. */
  slots: string;
  /** Erwartete Wirkung. */
  expectation: string;
  /** Vorab festgelegtes Prüfkriterium, Grundregel 3. */
  check: string;
  changes: PlanChange[];
  createdAt: number;
}

export type ProposalDecision = 'accepted' | 'declined';

export interface ProposalRecord {
  proposalId: string;
  templateId: string;
  scope: ProposalScope;
  decision: ProposalDecision;
  /** Erkennungswert der Änderungen, um Wiederholungen zu bemerken. */
  fingerprint: string;
  decidedAt: number;
}

/** Stabiler Erkennungswert eines Änderungssatzes, unabhängig von Zeit und Id. */
export function proposalFingerprint(proposal: PlanProposal): string {
  return `${proposal.templateId}|${proposal.scope}|${proposal.changes
    .map(change => JSON.stringify(change))
    .join(';')}`;
}

export interface ProposalGate {
  allowed: boolean;
  /** Immer gefüllt, damit die Unterdrückung nachvollziehbar bleibt. */
  reason: string;
}

/**
 * Darf dieser Vorschlag jetzt erscheinen?
 *
 * Strukturvorschläge halten Abstand, damit ein Plan nicht unter ständiger
 * Bearbeitung steht. Ein abgelehnter Vorschlag kehrt unverändert eine Weile
 * nicht wieder. Beides sind Anzeigeregeln — der Plan bleibt in jedem Fall
 * unverändert, solange der Nutzer nicht zustimmt.
 */
export function proposalIsAllowed(
  proposal: PlanProposal,
  records: ProposalRecord[],
  now: number,
): ProposalGate {
  const fingerprint = proposalFingerprint(proposal);
  const declined = records.find(
    record =>
      record.decision === 'declined' &&
      record.fingerprint === fingerprint &&
      now - record.decidedAt < DECLINED_PROPOSAL_SILENCE_DAYS * DAY_MS,
  );
  if (declined) {
    return {
      allowed: false,
      reason: 'Diesen Vorschlag hast du bereits abgelehnt.',
    };
  }
  if (proposal.scope === 'load') {
    return { allowed: true, reason: 'Vorschlag zu Last und Wiederholungen.' };
  }
  const lastStructure = records
    .filter(
      record =>
        record.scope === 'structure' && record.templateId === proposal.templateId,
    )
    .reduce(
      (latest, record) => Math.max(latest, record.decidedAt),
      Number.NEGATIVE_INFINITY,
    );
  if (lastStructure === Number.NEGATIVE_INFINITY) {
    return { allowed: true, reason: 'Erster Strukturvorschlag für diesen Plan.' };
  }
  const days = Math.floor((now - lastStructure) / DAY_MS);
  return days >= STRUCTURE_PROPOSAL_INTERVAL_DAYS
    ? {
        allowed: true,
        reason: `Letzte Strukturfrage vor ${days} Tagen.`,
      }
    : {
        allowed: false,
        reason: `Struktur wurde vor ${days} Tagen zuletzt besprochen; frühestens nach ${STRUCTURE_PROPOSAL_INTERVAL_DAYS} Tagen wieder.`,
      };
}

/**
 * Wendet einen bestätigten Vorschlag an.
 *
 * Diese Funktion ist der einzige Weg, auf dem ein Vorschlag den Plan erreicht,
 * und sie wird ausschließlich nach ausdrücklicher Bestätigung aufgerufen
 * (T-6). Passt eine Änderung nicht mehr auf den Plan, bleibt sie wirkungslos,
 * statt etwas anderes zu treffen.
 */
export function applyProposal(
  template: WorkoutTemplate,
  proposal: PlanProposal,
): WorkoutTemplate {
  if (proposal.templateId !== template.id) {
    return template;
  }
  return proposal.changes.reduce((current, change) => {
    if (change.kind === 'days') {
      return setTemplateDays(current, change.days);
    }
    if (change.kind === 'setValues') {
      return updatePlannedSet(
        current,
        change.exerciseIndex,
        change.setIndex,
        change.values,
      );
    }
    if (change.kind === 'removeSet') {
      return removePlannedSet(current, change.exerciseIndex, change.setIndex);
    }
    const exercise = current.exercises[change.exerciseIndex];
    if (!exercise) {
      return current;
    }
    return replaceExercise(current, change.exerciseIndex, {
      ...exercise,
      sets: [...exercise.sets, { ...change.set }],
    });
  }, template);
}

/** Hält eine Entscheidung fest. „Unverändert lassen“ ist ein gültiges Ergebnis. */
export function recordDecision(
  proposal: PlanProposal,
  decision: ProposalDecision,
  now: number,
): ProposalRecord {
  return {
    proposalId: proposal.id,
    templateId: proposal.templateId,
    scope: proposal.scope,
    decision,
    fingerprint: proposalFingerprint(proposal),
    decidedAt: now,
  };
}
