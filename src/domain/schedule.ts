import type { RunPurpose } from './types';
import type { WorkoutTemplate } from './strength';

/**
 * Kalenderplanung ist absichtlich eine kleine, lokale Datenebene.
 *
 * Ein Termin beschreibt eine Absicht (geplant/übersprungen), nie das Ergebnis
 * eines Trainings. Tatsächliche Läufe und Kraft-Einheiten bleiben in ihren
 * jeweiligen Historien. `activityId` ist nur eine optionale Verbindung zu
 * einem solchen Datensatz.
 */
export const SCHEDULE_VERSION = 1 as const;
export const SCHEDULE_MODEL_VERSION = 'schedule-v1';

export type ScheduleDate = string;
export type ScheduleKind = 'run' | 'strength';
export type ScheduleEffort = 'easy' | 'hard';
export type ScheduleStatus = 'planned' | 'skipped';
export type ScheduleSessionOrigin =
  | 'routine'
  | 'manual'
  | 'fixed'
  | 'suggestion';

/** Wochentage 0 (Montag) bis 6 (Sonntag). */
export interface ScheduleRoutine {
  days: number[];
  minutes: number;
}

export interface ScheduleGoal {
  name: string;
  startDate: ScheduleDate;
  targetDate?: ScheduleDate;
  phase?: string;
}

export interface ScheduledSession {
  id: string;
  date: ScheduleDate;
  title: string;
  kind: ScheduleKind;
  minutes: number;
  purpose?: RunPurpose;
  templateId?: string;
  locked: boolean;
  status: ScheduleStatus;
  effort: ScheduleEffort;

  /** Link to an actual native run or strength session; never a completion flag. */
  activityId?: string;

  /** Optional metadata used to keep recurring routines separate from exceptions. */
  origin?: ScheduleSessionOrigin;
  routineDay?: number;
}

/**
 * The small part of a strength template needed by the calendar planner.
 * Template days follow `WorkoutTemplate`: Sunday is 0, Monday is 1.
 */
export type ScheduleStrengthTemplate = Pick<WorkoutTemplate, 'id' | 'name' | 'days'> & {
  minutes?: number;
  effort?: ScheduleEffort;
};

export interface ScheduleState {
  version: typeof SCHEDULE_VERSION;
  sessions: ScheduledSession[];
  /** Date-specific available minutes. Missing means the routine budget applies. */
  availability: Record<ScheduleDate, number>;
  routine: ScheduleRoutine;
  goal?: ScheduleGoal;
}

export type LocalDateInput = string | number | Date;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const PURPOSES: RunPurpose[] = [
  'easy',
  'long',
  'intervals',
  'race',
  'free',
  'unknown',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isDay = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

const sortDays = (days: unknown): number[] =>
  Array.from(
    new Set(
      (Array.isArray(days) ? days : []).filter(isDay),
    ),
  ).sort((a, b) => a - b);

const dateParts = (value: string): [number, number, number] | null => {
  const match = DATE_KEY.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return [year, month, day];
};

/**
 * Creates a local midnight without using Date.UTC. The latter turns a date
 * key into the previous/next local day in many time zones.
 */
const localDateFromKey = (value: string): Date | null => {
  const parts = dateParts(value);
  if (!parts) {
    return null;
  }
  const [year, month, day] = parts;
  const result = new Date(0);
  result.setHours(0, 0, 0, 0);
  result.setFullYear(year, month - 1, day);
  // setFullYear normalizes impossible dates (e.g. February 31st). Reject them.
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }
  return result;
};

const dateKeyFromDate = (value: Date): string => {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('Ungültiges Datum.');
  }
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const inputToDate = (value: LocalDateInput): Date => {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (DATE_KEY.test(value)) {
    const parsed = localDateFromKey(value);
    if (!parsed) {
      throw new RangeError(`Ungültiges Kalenderdatum: ${value}`);
    }
    return parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Ungültiges Datum: ${value}`);
  }
  return parsed;
};

const tryLocalDateKey = (value: unknown): string | null => {
  if (typeof value === 'string' && DATE_KEY.test(value)) {
    return localDateFromKey(value) ? value : null;
  }
  if (value instanceof Date || typeof value === 'number') {
    try {
      return localDateKey(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    try {
      return localDateKey(value);
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Returns the local calendar date as ISO `YYYY-MM-DD`.
 *
 * A date-only string is interpreted as a local calendar date. Date-times and
 * timestamps are converted using the device's local time zone.
 */
export function localDateKey(value: LocalDateInput = new Date()): ScheduleDate {
  return dateKeyFromDate(inputToDate(value));
}

/** Adds calendar days in local time and returns another local date key. */
export function addCalendarDays(
  value: LocalDateInput,
  days: number,
): ScheduleDate {
  if (!Number.isInteger(days)) {
    throw new RangeError('Kalendertage müssen ganze Zahlen sein.');
  }
  const date = inputToDate(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

/** Returns the Monday of the local week containing the given date. */
export function startOfWeek(value: LocalDateInput): ScheduleDate {
  const date = inputToDate(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  return addCalendarDays(localDateKey(date), -mondayOffset);
}

const normalizeMinutes = (value: unknown, fallback: number): number => {
  const number = finiteNumber(value) ? Math.round(value) : fallback;
  return Math.min(1440, Math.max(0, number));
};

const normalizeDuration = (value: unknown, fallback = 30): number => {
  const number = finiteNumber(value) ? Math.round(value) : fallback;
  return Math.min(1440, Math.max(1, number));
};

const defaultTitle = (kind: ScheduleKind): string =>
  kind === 'strength' ? 'Krafttraining' : 'Lauf';

const normalizeKind = (value: unknown): ScheduleKind =>
  value === 'strength' ? 'strength' : 'run';

const normalizeEffort = (value: unknown): ScheduleEffort =>
  value === 'hard' ? 'hard' : 'easy';

const normalizeStatus = (value: unknown): ScheduleStatus =>
  value === 'skipped' ? 'skipped' : 'planned';

const normalizeOrigin = (value: unknown): ScheduleSessionOrigin | undefined =>
  value === 'routine' ||
  value === 'manual' ||
  value === 'fixed' ||
  value === 'suggestion'
    ? value
    : undefined;

const normalizeSession = (raw: unknown): ScheduledSession | null => {
  if (!isRecord(raw) || !nonEmptyString(raw.id)) {
    return null;
  }
  const date = tryLocalDateKey(raw.date);
  if (!date) {
    return null;
  }
  const kind = normalizeKind(raw.kind);
  const purpose = PURPOSES.includes(raw.purpose as RunPurpose)
    ? (raw.purpose as RunPurpose)
    : undefined;
  const session: ScheduledSession = {
    id: raw.id.trim(),
    date,
    title: nonEmptyString(raw.title) ? raw.title.trim() : defaultTitle(kind),
    kind,
    minutes: normalizeDuration(raw.minutes),
    locked: raw.locked === true,
    status: normalizeStatus(raw.status),
    effort: normalizeEffort(raw.effort),
  };
  if (purpose) {
    session.purpose = purpose;
  }
  if (nonEmptyString(raw.templateId)) {
    session.templateId = raw.templateId.trim();
  }
  if (nonEmptyString(raw.activityId)) {
    session.activityId = raw.activityId.trim();
  }
  const origin = normalizeOrigin(raw.origin);
  if (origin) {
    session.origin = origin;
  }
  if (isDay(raw.routineDay)) {
    session.routineDay = raw.routineDay;
  }
  return session;
};

export interface ScheduleDefaults {
  routine?: Partial<ScheduleRoutine>;
  goal?: ScheduleGoal;
}

/**
 * Normalizes persisted JSON. Unknown or malformed entries are ignored so an
 * old/corrupt optional calendar cannot prevent the rest of the app opening.
 */
export function normalizeSchedule(
  raw: unknown = undefined,
  defaults: ScheduleDefaults = {},
): ScheduleState {
  const value = isRecord(raw) ? raw : {};
  const defaultRoutine = defaults.routine || {};
  const routineMinutes = normalizeDuration(
    value.routine && isRecord(value.routine)
      ? value.routine.minutes
      : defaultRoutine.minutes,
    normalizeDuration(defaultRoutine.minutes, 30),
  );
  const routineRaw = value.routine && isRecord(value.routine)
    ? value.routine
    : undefined;
  const routine: ScheduleRoutine = {
    days: sortDays(routineRaw?.days ?? defaultRoutine.days),
    minutes: routineMinutes,
  };

  const availability: Record<ScheduleDate, number> = {};
  if (isRecord(value.availability)) {
    for (const [rawDate, minutes] of Object.entries(value.availability)) {
      const date = tryLocalDateKey(rawDate);
      if (!date || !finiteNumber(minutes)) {
        continue;
      }
      availability[date] = normalizeMinutes(minutes, 0);
    }
  }

  const sessions: ScheduledSession[] = [];
  const ids = new Set<string>();
  if (Array.isArray(value.sessions)) {
    for (const rawSession of value.sessions) {
      const session = normalizeSession(rawSession);
      if (!session || ids.has(session.id)) {
        continue;
      }
      ids.add(session.id);
      sessions.push(session);
    }
  }
  sessions.sort(compareSessions);

  const rawGoal = value.goal && isRecord(value.goal) ? value.goal : undefined;
  const fallbackGoal = defaults.goal;
  const goalName = rawGoal?.name ?? fallbackGoal?.name;
  const goalStart = tryLocalDateKey(rawGoal?.startDate ?? fallbackGoal?.startDate);
  let goal: ScheduleGoal | undefined;
  if (nonEmptyString(goalName) && goalStart) {
    goal = { name: goalName.trim(), startDate: goalStart };
    const targetDate = tryLocalDateKey(
      rawGoal?.targetDate ?? fallbackGoal?.targetDate,
    );
    if (targetDate) {
      goal.targetDate = targetDate;
    }
    const phase = rawGoal?.phase ?? fallbackGoal?.phase;
    if (nonEmptyString(phase)) {
      goal.phase = phase.trim();
    }
  }

  return { version: SCHEDULE_VERSION, sessions, availability, routine, goal };
}

/** A JSON-safe round trip for the offline settings store. */
export function serializeSchedule(state: ScheduleState): string {
  return JSON.stringify(normalizeSchedule(state));
}

/** Parses optional persisted JSON without allowing a parse error to escape. */
export function parseSchedule(
  serialized: string | null | undefined,
  defaults: ScheduleDefaults = {},
): ScheduleState {
  if (!serialized) {
    return normalizeSchedule(undefined, defaults);
  }
  try {
    return normalizeSchedule(JSON.parse(serialized), defaults);
  } catch {
    return normalizeSchedule(undefined, defaults);
  }
}

const compareSessions = (a: ScheduledSession, b: ScheduledSession): number =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

const cloneState = (state: ScheduleState): ScheduleState => ({
  version: SCHEDULE_VERSION,
  sessions: state.sessions.map(session => ({ ...session })),
  availability: { ...state.availability },
  routine: { days: [...state.routine.days], minutes: state.routine.minutes },
  goal: state.goal ? { ...state.goal } : undefined,
});

const isBefore = (a: ScheduleDate, b: ScheduleDate): boolean => a < b;

const todayFrom = (value: LocalDateInput | undefined): ScheduleDate =>
  localDateKey(value ?? new Date());

const plannedMinutesOn = (
  sessions: ScheduledSession[],
  date: ScheduleDate,
  exceptId?: string,
): number =>
  sessions
    .filter(
      session =>
        session.id !== exceptId &&
        session.date === date &&
        session.status === 'planned',
    )
    .reduce((total, session) => total + session.minutes, 0);

const usableAvailability = (
  state: ScheduleState,
  date: ScheduleDate,
  minutes: number,
  exceptId?: string,
): boolean => {
  if (!localDateFromKey(date) || !finiteNumber(minutes) || minutes < 0) {
    return false;
  }
  const budget = Object.prototype.hasOwnProperty.call(state.availability, date)
    ? state.availability[date]
    : state.routine.minutes;
  // A missing date-specific override means the normal daily budget applies.
  // `routine.days` controls which recurring slots are proposed; it does not
  // make an otherwise unspecified calendar day unusable when reflowing a
  // session or checking a manually chosen target. The budget is shared by
  // planned run and strength sessions on the same day.
  return budget >= plannedMinutesOn(state.sessions, date, exceptId) + minutes;
};

const activeSessionsOn = (
  state: ScheduleState,
  date: ScheduleDate,
  exceptId?: string,
): ScheduledSession[] =>
  state.sessions.filter(
    session =>
      session.id !== exceptId &&
      session.date === date &&
      session.status === 'planned',
  );

const isHardConflict = (
  session: ScheduledSession,
  other: ScheduledSession,
): boolean =>
  session.status === 'planned' &&
  other.status === 'planned' &&
  session.effort === 'hard' &&
  other.effort === 'hard';

export type ScheduleConflictCode =
  | 'not_found'
  | 'invalid_date'
  | 'past_immutable'
  | 'past_target'
  | 'locked_source'
  | 'date_taken'
  | 'locked_session'
  | 'unavailable'
  | 'adjacent_hard';

export interface ScheduleConflict {
  code: ScheduleConflictCode;
  message: string;
  date?: ScheduleDate;
  sessionIds: string[];
}

export interface MoveAlternative {
  date: ScheduleDate;
  message: string;
}

export interface MoveProposal {
  allowed: boolean;
  ok: boolean;
  sessionId: string;
  fromDate?: ScheduleDate;
  toDate: ScheduleDate;
  conflicts: ScheduleConflict[];
  suggestions: MoveAlternative[];
  /** The exact state that an explicit apply would produce. */
  preview: ScheduleState;
  /** Internal stale-preview guard; callers do not need to construct it. */
  baseSignature?: string;
}

export interface MoveOptions {
  today?: LocalDateInput;
  maxSuggestions?: number;
}

const conflict = (
  code: ScheduleConflictCode,
  message: string,
  date?: ScheduleDate,
  sessionIds: string[] = [],
): ScheduleConflict => ({ code, message, date, sessionIds });

/**
 * A proposal is valid only for the complete state from which it was made.
 * Include availability and routine settings as well as every session field;
 * otherwise applying a preview after an unrelated edit could silently restore
 * old settings from the preview's cloned state.
 */
const stateSignature = (state: ScheduleState): string =>
  JSON.stringify({
    version: state.version,
    availability: Object.keys(state.availability)
      .sort()
      .map(date => [date, state.availability[date]]),
    routine: {
      days: [...state.routine.days].sort((a, b) => a - b),
      minutes: state.routine.minutes,
    },
    goal: state.goal
      ? {
          name: state.goal.name,
          startDate: state.goal.startDate,
          targetDate: state.goal.targetDate,
          phase: state.goal.phase,
        }
      : undefined,
    sessions: [...state.sessions]
      .sort(compareSessions)
      .map(session => ({
        id: session.id,
        date: session.date,
        title: session.title,
        kind: session.kind,
        minutes: session.minutes,
        purpose: session.purpose,
        templateId: session.templateId,
        locked: session.locked,
        status: session.status,
        effort: session.effort,
        activityId: session.activityId,
        origin: session.origin,
        routineDay: session.routineDay,
      })),
  });

const hardNeighbors = (
  state: ScheduleState,
  session: ScheduledSession,
  date: ScheduleDate,
): ScheduledSession[] =>
  [addCalendarDays(date, -1), addCalendarDays(date, 1)].flatMap(neighborDate =>
    activeSessionsOn(state, neighborDate, session.id).filter(other =>
      isHardConflict(session, other),
    ),
  );

const candidateDates = (target: ScheduleDate): ScheduleDate[] => {
  const result: ScheduleDate[] = [];
  // Nearby dates are easiest to understand in a week view. Include a full
  // week on either side so a move at a Sunday/Monday boundary is actionable.
  for (let distance = 1; distance <= 7; distance += 1) {
    result.push(addCalendarDays(target, distance));
    result.push(addCalendarDays(target, -distance));
  }
  return result;
};

const alternativesFor = (
  state: ScheduleState,
  session: ScheduledSession,
  target: ScheduleDate,
  options: MoveOptions,
): MoveAlternative[] => {
  const today = todayFrom(options.today);
  const seen = new Set<string>();
  const alternatives: MoveAlternative[] = [];
  const limit = Math.max(0, Math.min(7, Math.floor(options.maxSuggestions ?? 3)));
  for (const date of candidateDates(target)) {
    if (alternatives.length >= limit || seen.has(date) || isBefore(date, today)) {
      continue;
    }
    seen.add(date);
    if (!usableAvailability(state, date, session.minutes, session.id)) {
      continue;
    }
    const sameDay = activeSessionsOn(state, date, session.id);
    if (sameDay.length) {
      continue;
    }
    const neighbors = hardNeighbors(state, session, date);
    if (neighbors.length) {
      continue;
    }
    alternatives.push({
      date,
      message: `Passt voraussichtlich am ${date}.`,
    });
  }
  return alternatives;
};

/**
 * Checks a move and describes all reasons it cannot be applied. No session is
 * changed by this function. Conflict alternatives are suggestions only.
 */
export function proposeMove(
  state: ScheduleState,
  sessionId: string,
  targetDate: LocalDateInput,
  options: MoveOptions = {},
): MoveProposal {
  let target: ScheduleDate;
  try {
    if (targetDate === undefined) {
      throw new RangeError('Kein Zieldatum.');
    }
    target = localDateKey(targetDate);
  } catch {
    target = typeof targetDate === 'string' ? targetDate : '';
  }
  const session = state.sessions.find(candidate => candidate.id === sessionId);
  const noPreview = cloneState(state);
  if (!session) {
    const invalidTarget = target || 'ungültiges Datum';
    const missing = conflict(
      'not_found',
      `Einheit ${sessionId} wurde nicht gefunden.`,
      target || undefined,
      [],
    );
    return {
      allowed: false,
      ok: false,
      sessionId,
      toDate: invalidTarget,
      conflicts: [missing],
      suggestions: [],
      preview: noPreview,
      baseSignature: stateSignature(state),
    };
  }
  if (!target || !localDateFromKey(target)) {
    const invalid = conflict(
      'invalid_date',
      'Das Zieldatum ist kein gültiges lokales Kalenderdatum.',
      target || undefined,
      [session.id],
    );
    return {
      allowed: false,
      ok: false,
      sessionId,
      fromDate: session.date,
      toDate: target || session.date,
      conflicts: [invalid],
      suggestions: [],
      preview: noPreview,
      baseSignature: stateSignature(state),
    };
  }

  const today = todayFrom(options.today);
  const conflicts: ScheduleConflict[] = [];
  if (isBefore(session.date, today)) {
    conflicts.push(
      conflict(
        'past_immutable',
        'Vergangene Einheiten bleiben unverändert.',
        session.date,
        [session.id],
      ),
    );
  }
  if (isBefore(target, today)) {
    conflicts.push(
      conflict(
        'past_target',
        'Eine Einheit kann nicht in die Vergangenheit verschoben werden.',
        target,
        [session.id],
      ),
    );
  }
  if (session.locked && target !== session.date) {
    conflicts.push(
      conflict(
        'locked_source',
        'Diese feste Einheit bleibt an ihrem Tag.',
        session.date,
        [session.id],
      ),
    );
  }
  if (target !== session.date) {
    const sameDay = activeSessionsOn(state, target, session.id);
    if (sameDay.length) {
      const locked = sameDay.filter(candidate => candidate.locked);
      conflicts.push(
        conflict(
          locked.length ? 'locked_session' : 'date_taken',
          locked.length
            ? 'Der Zieltag enthält eine feste Einheit.'
            : 'Am Zieltag ist bereits eine Einheit geplant.',
          target,
          sameDay.map(candidate => candidate.id),
        ),
      );
    }
    if (!usableAvailability(state, target, session.minutes, session.id)) {
      conflicts.push(
        conflict(
          'unavailable',
          `Für den Zieltag sind weniger als ${session.minutes} Minuten verfügbar.`,
          target,
          [session.id],
        ),
      );
    }
    const neighbors = hardNeighbors(state, session, target);
    if (neighbors.length) {
      conflicts.push(
        conflict(
          'adjacent_hard',
          'Harte Einheiten an benachbarten Tagen liegen zu dicht beieinander.',
          target,
          neighbors.map(candidate => candidate.id),
        ),
      );
    }
  }
  const allowed = conflicts.length === 0;
  let preview = noPreview;
  if (allowed && target !== session.date) {
    preview.sessions = preview.sessions
      .map(candidate =>
        candidate.id === session.id
          ? {
              ...candidate,
              date: target,
              // A manually moved recurring slot is still the same recurring
              // slot. Keeping its origin and routineDay prevents the next
              // weekly preview from cloning it back onto its base day.
              origin: (
                candidate.origin === 'routine' || candidate.routineDay !== undefined
                  ? 'routine'
                  : candidate.origin === 'suggestion'
                    ? 'suggestion'
                    : 'manual'
              ) as ScheduleSessionOrigin,
            }
          : candidate,
      )
      .sort(compareSessions);
  }
  return {
    allowed,
    ok: allowed,
    sessionId,
    fromDate: session.date,
    toDate: target,
    conflicts,
    suggestions: allowed
      ? []
      : alternativesFor(state, session, target, options),
    preview,
    baseSignature: stateSignature(state),
  };
}

/** Applies an allowed move. A rejected proposal returns the original state. */
export function moveSession(
  state: ScheduleState,
  sessionIdOrProposal: string | MoveProposal,
  targetDate?: LocalDateInput,
  options: MoveOptions = {},
): ScheduleState {
  const proposal =
    typeof sessionIdOrProposal === 'string'
      ? proposeMove(state, sessionIdOrProposal, targetDate as LocalDateInput, options)
      : sessionIdOrProposal;
  // A proposal belongs to a particular state. Re-checking by id/date avoids
  // accidentally applying a stale preview after another edit.
  if (
    !proposal.allowed ||
    !proposal.fromDate ||
    (proposal.baseSignature !== undefined &&
      proposal.baseSignature !== stateSignature(state)) ||
    state.sessions.find(session => session.id === proposal.sessionId)?.date !==
      proposal.fromDate
  ) {
    return state;
  }
  return proposal.preview;
}

export interface UpdateSessionPatch {
  date?: LocalDateInput;
  title?: string;
  kind?: ScheduleKind;
  minutes?: number;
  purpose?: RunPurpose;
  templateId?: string;
  locked?: boolean;
  effort?: ScheduleEffort;
  /** Status updates use `cancelSession` for a clearer intent. */
  status?: ScheduleStatus;
  activityId?: string;
}

/**
 * Applies a safe field update. Past sessions and fixed sessions are immutable;
 * a date update goes through the same conflict checks as a move.
 */
export function updateSession(
  state: ScheduleState,
  sessionId: string,
  patch: UpdateSessionPatch,
  options: MoveOptions = {},
): ScheduleState {
  const session = state.sessions.find(candidate => candidate.id === sessionId);
  if (!session) {
    return state;
  }
  const today = todayFrom(options.today);
  if (isBefore(session.date, today) || (session.locked && patch.date !== undefined)) {
    return state;
  }
  let nextState = state;
  if (patch.date !== undefined) {
    let nextDate: ScheduleDate;
    try {
      nextDate = localDateKey(patch.date);
    } catch {
      return state;
    }
    if (nextDate !== session.date) {
      nextState = moveSession(state, sessionId, nextDate, options);
    }
    if (nextDate !== session.date && nextState === state) {
      return state;
    }
  }
  const current = nextState.sessions.find(candidate => candidate.id === sessionId);
  if (!current) {
    return state;
  }
  if (current.locked && Object.keys(patch).some(key => key !== 'activityId')) {
    return state;
  }
  const next: ScheduledSession = { ...current };
  if (patch.title !== undefined && nonEmptyString(patch.title)) {
    next.title = patch.title.trim();
  }
  if (patch.kind === 'run' || patch.kind === 'strength') {
    next.kind = patch.kind;
  }
  if (patch.minutes !== undefined && finiteNumber(patch.minutes) && patch.minutes >= 1) {
    next.minutes = normalizeDuration(patch.minutes, current.minutes);
  }
  if (patch.purpose !== undefined && PURPOSES.includes(patch.purpose)) {
    next.purpose = patch.purpose;
  }
  if (patch.templateId !== undefined) {
    next.templateId = nonEmptyString(patch.templateId)
      ? patch.templateId.trim()
      : undefined;
  }
  if (patch.effort === 'easy' || patch.effort === 'hard') {
    next.effort = patch.effort;
  }
  if (patch.status === 'planned' || patch.status === 'skipped') {
    next.status = patch.status;
  }
  if (patch.activityId !== undefined) {
    next.activityId = nonEmptyString(patch.activityId)
      ? patch.activityId.trim()
      : undefined;
  }
  // `locked` can only be enabled by an explicit update; once a session is
  // fixed, the guard above prevents silently editing it through this helper.
  if (patch.locked === true && !current.locked) {
    next.locked = true;
    next.origin = 'fixed';
  }
  return {
    ...nextState,
    sessions: nextState.sessions
      .map(candidate => (candidate.id === sessionId ? next : candidate))
      .sort(compareSessions),
  };
}

/** Marks a future planned session skipped. It never creates a catch-up session. */
export function cancelSession(
  state: ScheduleState,
  sessionId: string,
  options: MoveOptions = {},
): ScheduleState {
  const today = todayFrom(options.today);
  const session = state.sessions.find(candidate => candidate.id === sessionId);
  if (!session || isBefore(session.date, today) || session.status === 'skipped') {
    return state;
  }
  return {
    ...state,
    sessions: state.sessions.map(candidate =>
      candidate.id === sessionId ? { ...candidate, status: 'skipped' } : candidate,
    ),
  };
}

export const skipSession = cancelSession;

/** Adds a one-off session without mutating the routine. */
export function addScheduledSession(
  state: ScheduleState,
  session: ScheduledSession,
  options: MoveOptions = {},
): ScheduleState {
  const normalized = normalizeSession(session);
  if (!normalized || state.sessions.some(existing => existing.id === normalized.id)) {
    return state;
  }
  const today = todayFrom(options.today);
  if (isBefore(normalized.date, today)) {
    return state;
  }
  return {
    ...state,
    sessions: [...state.sessions, { ...normalized, origin: normalized.origin ?? 'manual' }].sort(
      compareSessions,
    ),
  };
}

export function setAvailability(
  state: ScheduleState,
  dateInput: LocalDateInput,
  minutes: number,
): ScheduleState {
  let date: ScheduleDate;
  try {
    date = localDateKey(dateInput);
  } catch {
    return state;
  }
  if (!finiteNumber(minutes) || minutes < 0) {
    return state;
  }
  return {
    ...state,
    availability: {
      ...state.availability,
      [date]: normalizeMinutes(minutes, 0),
    },
  };
}

export function setRoutine(
  state: ScheduleState,
  routine: Partial<ScheduleRoutine>,
): ScheduleState {
  return {
    ...state,
    routine: {
      days: routine.days === undefined ? [...state.routine.days] : sortDays(routine.days),
      minutes:
        routine.minutes === undefined
          ? state.routine.minutes
          : normalizeDuration(routine.minutes, state.routine.minutes),
    },
  };
}

export interface SuggestWeekOptions {
  kind?: ScheduleKind;
  title?: string;
  purpose?: RunPurpose;
  effort?: ScheduleEffort;
  templateId?: string;
  minutes?: number;
  days?: number[];
  /**
   * Optional recurring strength templates. Their `days` use the strength
   * catalog convention (Sunday = 0); the planner converts them to its local
   * Monday = 0 convention. Supplying templates keeps strength slots separate
   * from the run routine.
   */
  strengthTemplates?: ReadonlyArray<ScheduleStrengthTemplate>;
  /** Monday-based days for a template-less strength routine. */
  strengthDays?: number[];
  strengthMinutes?: number;
  /** Set to false when the caller only wants to reflow existing sessions. */
  includeRoutine?: boolean;
  /** Existing future, flexible sessions are reflowed by default. */
  reflowExisting?: boolean;
  today?: LocalDateInput;
}

export interface WeekSessionMove {
  id: string;
  sessionId: string;
  title: string;
  from: ScheduleDate;
  to: ScheduleDate;
  fromDate: ScheduleDate;
  toDate: ScheduleDate;
  session: ScheduledSession;
  reason: 'availability' | 'adjacent_hard' | 'date_taken';
  message: string;
}

export interface WeekSuggestion {
  weekStart: ScheduleDate;
  weekEnd: ScheduleDate;
  /** Existing and newly proposed slots for rendering the week preview. */
  sessions: ScheduledSession[];
  /** Only slots that are new and may be explicitly applied. */
  addedSessions: ScheduledSession[];
  /** Existing slots that the explicit preview would move. */
  movedSessions: ScheduledSession[];
  /** Detailed move records for a review/apply UI. */
  moves: WeekSessionMove[];
  proposedSessions: ScheduledSession[];
  existingSessions: ScheduledSession[];
  conflicts: ScheduleConflict[];
  suggestions: MoveAlternative[];
  warnings: string[];
  rationale: string[];
  preview: ScheduleState;
  /** Internal stale-preview guard; callers do not need to construct it. */
  baseSignature: string;
}

interface SlotRequest {
  id: string;
  kind: ScheduleKind;
  routineDay: number;
  baseDate: ScheduleDate;
  title: string;
  minutes: number;
  purpose?: RunPurpose;
  templateId?: string;
  effort: ScheduleEffort;
}

const routineSessionId = (
  weekStart: ScheduleDate,
  routineDay: number,
  kind: ScheduleKind = 'run',
  templateId?: string,
): string =>
  kind === 'run' && !templateId
    ? `routine-${weekStart}-${routineDay}`
    : `routine-${weekStart}-${kind}-${templateId || 'default'}-${routineDay}`;

const sessionFromRoutine = (
  request: SlotRequest,
  date = request.baseDate,
): ScheduledSession => {
  return {
    id: request.id,
    date,
    title: request.title,
    kind: request.kind,
    minutes: request.minutes,
    purpose: request.purpose,
    templateId: request.templateId,
    locked: false,
    status: 'planned',
    effort: request.effort,
    origin: 'routine',
    routineDay: request.routineDay,
  };
};

const weekDates = (weekStart: ScheduleDate): ScheduleDate[] =>
  Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));

const mondayDayFromSundayDay = (day: number): number => (day + 6) % 7;

const sessionGroupKey = (session: Pick<ScheduledSession, 'kind'>): ScheduleKind =>
  session.kind;

const plannedSessionsOn = (
  sessions: ScheduledSession[],
  date: ScheduleDate,
  exceptId?: string,
): ScheduledSession[] =>
  sessions.filter(
    session =>
      session.id !== exceptId &&
      session.date === date &&
      session.status === 'planned',
  );

const hasPlannedGroupOn = (
  sessions: ScheduledSession[],
  date: ScheduleDate,
  kind: ScheduleKind,
  exceptId?: string,
): boolean =>
  plannedSessionsOn(sessions, date, exceptId).some(
    session => sessionGroupKey(session) === kind,
  );

const hasSkippedGroupOn = (
  sessions: ScheduledSession[],
  date: ScheduleDate,
  kind: ScheduleKind,
): boolean =>
  sessions.some(
    session =>
      session.date === date &&
      session.kind === kind &&
      session.status === 'skipped',
  );

const isRoutineSessionFor = (
  session: ScheduledSession,
  request: SlotRequest,
  weekStart: ScheduleDate,
): boolean => {
  if (session.kind !== request.kind) {
    return false;
  }
  if (session.id === request.id) {
    return true;
  }
  if (
    session.origin === 'routine' &&
    session.routineDay === request.routineDay &&
    (request.kind !== 'strength' || session.templateId === request.templateId)
  ) {
    return true;
  }
  // Legacy routine entries may only carry their deterministic id.
  return request.kind === 'run' && session.id === routineSessionId(weekStart, request.routineDay);
};

const findRoutineSession = (
  state: ScheduleState,
  existingSessions: ScheduledSession[],
  request: SlotRequest,
  weekStart: ScheduleDate,
): ScheduledSession | undefined => {
  // An exact routine id also identifies a slot when the user moved it outside
  // this week. Do not create a second copy in the original week.
  const anywhere = state.sessions.find(session => session.id === request.id);
  if (anywhere) {
    return anywhere;
  }
  return existingSessions.find(session => isRoutineSessionFor(session, request, weekStart));
};

const usableAvailabilityFor = (
  state: ScheduleState,
  date: ScheduleDate,
  minutes: number,
  exceptId?: string,
): boolean => {
  return usableAvailability(state, date, minutes, exceptId);
};

const requestForExistingWithState = (
  session: ScheduledSession,
  runDays: number[],
  strengthDays: number[],
): SlotRequest => ({
  id: session.id,
  kind: session.kind,
  routineDay:
    session.routineDay ??
    (session.kind === 'strength' ? strengthDays[0] : runDays[0]) ??
    0,
  baseDate: session.date,
  title: session.title,
  minutes: session.minutes,
  purpose: session.purpose,
  templateId: session.templateId,
  effort: session.effort,
});

const uniqueDays = (days: number[]): number[] => sortDays(days);

const makeRunRequests = (
  state: ScheduleState,
  weekStart: ScheduleDate,
  options: SuggestWeekOptions,
  runDays: number[],
): SlotRequest[] => {
  if (options.includeRoutine === false || options.kind === 'strength') {
    return [];
  }
  const minutes = normalizeDuration(options.minutes, state.routine.minutes);
  return runDays.map(routineDay => ({
    id: routineSessionId(weekStart, routineDay),
    kind: 'run',
    routineDay,
    baseDate: addCalendarDays(weekStart, routineDay),
    title: options.title?.trim() || defaultTitle('run'),
    minutes,
    purpose: options.purpose ?? 'easy',
    templateId: options.templateId,
    effort: options.effort ?? 'easy',
  }));
};

const templateDays = (template: ScheduleStrengthTemplate): number[] =>
  uniqueDays(
    (Array.isArray(template.days) ? template.days : [])
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
      .map(mondayDayFromSundayDay),
  );

const makeStrengthRequests = (
  state: ScheduleState,
  weekStart: ScheduleDate,
  options: SuggestWeekOptions,
  strengthDays: number[],
): SlotRequest[] => {
  if (options.includeRoutine === false) {
    return [];
  }
  const templates = (options.strengthTemplates || []).filter(
    template => isRecord(template) && nonEmptyString(template.id),
  );
  if (templates.length === 0 && options.kind !== 'strength') {
    return [];
  }
  const slotDays = strengthDays.length ? strengthDays : state.routine.days;
  const requests: SlotRequest[] = [];
  if (templates.length === 0) {
    const minutes = normalizeDuration(
      options.strengthMinutes ?? options.minutes,
      state.routine.minutes,
    );
    for (const routineDay of slotDays) {
      requests.push({
        id: routineSessionId(weekStart, routineDay, 'strength'),
        kind: 'strength',
        routineDay,
        baseDate: addCalendarDays(weekStart, routineDay),
        title: options.title?.trim() || defaultTitle('strength'),
        minutes,
        templateId: options.templateId,
        effort: options.effort ?? 'easy',
      });
    }
    return requests;
  }
  const seen = new Set<string>();
  for (const template of templates) {
    const days = templateDays(template);
    const minutes = normalizeDuration(
      options.strengthMinutes ?? options.minutes ?? template.minutes,
      state.routine.minutes,
    );
    for (const routineDay of days) {
      const key = `${template.id}:${routineDay}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push({
        id: routineSessionId(weekStart, routineDay, 'strength', template.id),
        kind: 'strength',
        routineDay,
        baseDate: addCalendarDays(weekStart, routineDay),
        title:
          options.title?.trim() ||
          (nonEmptyString(template.name) ? template.name.trim() : defaultTitle('strength')),
        minutes,
        templateId: template.id,
        effort: options.effort ?? template.effort ?? 'easy',
      });
    }
  }
  return requests;
};

const candidateDatesForWeek = (
  dates: ScheduleDate[],
  currentDate: ScheduleDate,
  preferredDate?: ScheduleDate,
): ScheduleDate[] => {
  const rest = dates
    .filter(date => date !== currentDate && date !== preferredDate)
    .sort(
      (a, b) =>
        Math.abs(dates.indexOf(a) - dates.indexOf(currentDate)) -
          Math.abs(dates.indexOf(b) - dates.indexOf(currentDate)) ||
        a.localeCompare(b),
    );
  return [
    ...(preferredDate && preferredDate !== currentDate ? [preferredDate] : []),
    ...rest,
  ];
};

const canPlaceInWeek = (
  state: ScheduleState,
  session: ScheduledSession,
  date: ScheduleDate,
  today: ScheduleDate,
): ScheduleConflictCode | null => {
  if (isBefore(date, today)) {
    return 'past_target';
  }
  if (!usableAvailabilityFor(state, date, session.minutes, session.id)) {
    return 'unavailable';
  }
  if (hasPlannedGroupOn(state.sessions, date, session.kind, session.id)) {
    return state.sessions.some(
      candidate =>
        candidate.date === date &&
        candidate.id !== session.id &&
        candidate.status === 'planned' &&
        candidate.locked &&
        candidate.kind === session.kind,
    )
      ? 'locked_session'
      : 'date_taken';
  }
  if (hardNeighbors(state, session, date).length) {
    return 'adjacent_hard';
  }
  return null;
};

const updateWorkingDate = (
  state: ScheduleState,
  sessionId: string,
  date: ScheduleDate,
): ScheduleState => ({
  ...state,
  sessions: state.sessions.map(session =>
    session.id === sessionId ? { ...session, date } : session,
  ),
});

/**
 * Creates a deterministic, explicit preview for one local week. Existing
 * future flexible sessions may move to a free available day, while past,
 * locked, linked and skipped sessions stay exactly where they are. Missing
 * routine slots are proposed independently and never become catch-up sessions
 * after a skipped or already moved slot.
 */
export function suggestWeek(
  state: ScheduleState,
  value: LocalDateInput,
  options: SuggestWeekOptions = {},
): WeekSuggestion {
  const weekStart = startOfWeek(value);
  const dates = weekDates(weekStart);
  const weekEnd = dates[6];
  const today = todayFrom(options.today);
  const existingSessions = state.sessions
    .filter(session => session.date >= weekStart && session.date <= weekEnd)
    .map(session => ({ ...session }))
    .sort(compareSessions);
  const addedSessions: ScheduledSession[] = [];
  const movedSessions: ScheduledSession[] = [];
  const moves: WeekSessionMove[] = [];
  const conflicts: ScheduleConflict[] = [];
  const suggestions: MoveAlternative[] = [];
  const warnings: string[] = [];
  const rationale: string[] = [];
  const runDays = uniqueDays(options.days ?? state.routine.days);
  const templateDaysAll = (options.strengthTemplates || []).flatMap(templateDays);
  const strengthDays = uniqueDays(
    options.strengthDays ??
      (options.kind === 'strength' ? options.days : undefined) ??
      templateDaysAll,
  );
  const requests = [
    ...makeRunRequests(state, weekStart, options, runDays),
    ...makeStrengthRequests(state, weekStart, options, strengthDays),
  ];
  const originalPlanned = existingSessions.filter(session => session.status === 'planned');
  let workingState = cloneState(state);
  const reflowExisting = options.reflowExisting !== false;

  if (reflowExisting) {
    const movable = originalPlanned
      .filter(
        session =>
          !isBefore(session.date, today) &&
          !session.locked &&
          !session.activityId &&
          session.origin !== 'fixed',
      )
      .filter(session => !usableAvailabilityFor(
        state,
        session.date,
        session.minutes,
        session.id,
      ))
      .sort(compareSessions);

    for (const current of movable) {
      const request = requestForExistingWithState(
        current,
        runDays,
        strengthDays,
      );
      const preferredDate = current.routineDay !== undefined
        ? addCalendarDays(weekStart, current.routineDay)
        : undefined;
      const candidates = candidateDatesForWeek(dates, current.date, preferredDate);
      let selectedDate: ScheduleDate | undefined;
      let selectedCode: ScheduleConflictCode | null = null;
      for (const candidateDate of candidates) {
        if (hasSkippedGroupOn(workingState.sessions, candidateDate, current.kind)) {
          continue;
        }
        const candidateSession = { ...current, date: candidateDate };
        const candidateState = updateWorkingDate(workingState, current.id, candidateDate);
        const code = canPlaceInWeek(
          candidateState,
          candidateSession,
          candidateDate,
          today,
        );
        if (!code) {
          selectedDate = candidateDate;
          break;
        }
        selectedCode = code;
      }
      if (!selectedDate) {
        const code = selectedCode === 'adjacent_hard' ? selectedCode : 'unavailable';
        conflicts.push(
          conflict(
            code,
            `${current.date}: Keine passende freie Zeit für „${current.title}“ gefunden.`,
            current.date,
            [current.id],
          ),
        );
        warnings.push(`${current.date}: „${current.title}“ bleibt trotz der Verfügbarkeit unverändert.`);
        rationale.push(`${current.date}: Geschützte oder unpassende Einheit bleibt bestehen.`);
        continue;
      }
      const nextSession = { ...current, date: selectedDate };
      workingState = updateWorkingDate(workingState, current.id, selectedDate);
      movedSessions.push(nextSession);
      const move: WeekSessionMove = {
        id: current.id,
        sessionId: current.id,
        title: current.title,
        from: current.date,
        to: selectedDate,
        fromDate: current.date,
        toDate: selectedDate,
        session: nextSession,
        reason: 'availability',
        message: `${current.date} passt nicht; Vorschlag auf ${selectedDate} verschieben.`,
      };
      moves.push(move);
      suggestions.push({ date: selectedDate, message: move.message });
      rationale.push(`${current.date}: Auf ${selectedDate} verschoben, damit die Woche passt.`);
    }
  }

  for (const request of requests) {
    const routineSession = findRoutineSession(state, existingSessions, request, weekStart);
    if (routineSession) {
      if (routineSession.status === 'skipped') {
        rationale.push(`${routineSession.date}: Übersprungene Einheit bleibt übersprungen.`);
      } else {
        rationale.push(`${routineSession.date}: Vorhandene Einheit bleibt bestehen.`);
      }
      continue;
    }
    if (isBefore(request.baseDate, today)) {
      rationale.push(`${request.baseDate}: Vergangene Routineeinheit wird nicht nachträglich angelegt.`);
      continue;
    }
    // A skipped exception suppresses only its own group; an existing run does
    // not suppress a strength template on the same day and vice versa.
    if (hasSkippedGroupOn(existingSessions, request.baseDate, request.kind)) {
      rationale.push(`${request.baseDate}: Übersprungene Ausnahme bleibt übersprungen.`);
      continue;
    }
    if (hasPlannedGroupOn(workingState.sessions, request.baseDate, request.kind)) {
      rationale.push(`${request.baseDate}: Vorhandene Einheit bleibt bestehen.`);
      continue;
    }
    const proposed = sessionFromRoutine(request);
    const baseState = workingState;
    const baseCode = canPlaceInWeek(
      baseState,
      proposed,
      request.baseDate,
      today,
    );
    if (!baseCode) {
      addedSessions.push(proposed);
      workingState = {
        ...workingState,
        sessions: [...workingState.sessions, proposed],
      };
      continue;
    }

    const candidateDatesInWeek = candidateDatesForWeek(dates, request.baseDate);
    let selectedDate: ScheduleDate | undefined;
    for (const candidateDate of candidateDatesInWeek) {
      if (hasSkippedGroupOn(workingState.sessions, candidateDate, request.kind)) {
        continue;
      }
      const candidate = sessionFromRoutine(request, candidateDate);
      const candidateState: ScheduleState = {
        ...workingState,
        sessions: [...workingState.sessions, candidate],
      };
      if (
        !canPlaceInWeek(
          candidateState,
          candidate,
          candidateDate,
          today,
        )
      ) {
        selectedDate = candidateDate;
        break;
      }
    }
    if (selectedDate) {
      const moved = sessionFromRoutine(request, selectedDate);
      addedSessions.push(moved);
      workingState = {
        ...workingState,
        sessions: [...workingState.sessions, moved],
      };
      const message = `${request.baseDate} passt nicht; Vorschlag auf ${selectedDate} verschieben.`;
      suggestions.push({ date: selectedDate, message });
      rationale.push(`${request.baseDate}: Auf ${selectedDate} verschoben, damit die Woche passt.`);
    } else {
      const sessionIds = existingSessions
        .filter(session => session.date === request.baseDate)
        .map(session => session.id);
      conflicts.push(
        conflict(
          baseCode === 'locked_session' ? 'locked_session' : baseCode,
          baseCode === 'unavailable'
            ? `Für ${request.baseDate} sind weniger als ${request.minutes} Minuten verfügbar.`
            : baseCode === 'adjacent_hard'
              ? 'Die Einheit läge direkt neben einer harten Einheit.'
              : 'Am vorgeschlagenen Tag ist bereits eine Einheit geplant.',
          request.baseDate,
          sessionIds,
        ),
      );
      warnings.push(`${request.baseDate}: Keine passende freie Zeit für diese Einheit gefunden.`);
      rationale.push(`${request.baseDate}: Keine automatische Nachhol-Einheit angelegt.`);
    }
  }

  const sessions = workingState.sessions
    .filter(session => session.date >= weekStart && session.date <= weekEnd)
    .sort(compareSessions);
  const previewState = {
    ...workingState,
    sessions: workingState.sessions.sort(compareSessions),
  };
  const proposedSessions = [...movedSessions, ...addedSessions].sort(compareSessions);
  return {
    weekStart,
    weekEnd,
    sessions,
    addedSessions: addedSessions.map(session => ({ ...session })),
    movedSessions: movedSessions.map(session => ({ ...session })),
    moves: moves.map(move => ({ ...move, session: { ...move.session } })),
    proposedSessions: proposedSessions.map(session => ({ ...session })),
    existingSessions,
    conflicts,
    suggestions,
    warnings,
    rationale,
    preview: previewState,
    baseSignature: stateSignature(state),
  };
}

/** Explicitly applies a week preview, including approved moves and additions. */
export function applyWeekSuggestion(
  state: ScheduleState,
  suggestion: WeekSuggestion,
  options: MoveOptions = {},
): ScheduleState {
  // A preview must never restore an older cloned state after another edit.
  if (
    suggestion.baseSignature !== undefined &&
    suggestion.baseSignature !== stateSignature(state)
  ) {
    return state;
  }
  if (suggestion.baseSignature !== undefined) {
    return cloneState(suggestion.preview);
  }

  // Backward-compatible handling for callers that construct an old-style
  // suggestion themselves. Each addition still goes through the normal date,
  // id and normalization checks, and no routine is silently changed.
  let next = state;
  for (const session of suggestion.addedSessions || []) {
    next = addScheduledSession(next, session, options);
  }
  return next;
}

/** Return the planned slots for one local week, useful to month/week screens. */
export function sessionsForWeek(
  state: ScheduleState,
  value: LocalDateInput,
): ScheduledSession[] {
  const weekStart = startOfWeek(value);
  const weekEnd = addCalendarDays(weekStart, 6);
  return state.sessions
    .filter(session => session.date >= weekStart && session.date <= weekEnd)
    .map(session => ({ ...session }))
    .sort(compareSessions);
}

export function sessionsForMonth(
  state: ScheduleState,
  value: LocalDateInput,
): ScheduledSession[] {
  const date = inputToDate(value);
  const year = date.getFullYear();
  const month = date.getMonth();
  return state.sessions
    .filter(session => {
      const parts = dateParts(session.date);
      return parts !== null && parts[0] === year && parts[1] === month + 1;
    })
    .map(session => ({ ...session }))
    .sort(compareSessions);
}
