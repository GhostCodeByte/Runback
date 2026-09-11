import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Run } from '../native';
import type { StrengthSession, WorkoutTemplate } from '../domain/strength';
import type { RunPurpose } from '../domain/types';
import { runTitle } from '../domain/runTitle';
import {
  addCalendarDays,
  addScheduledSession,
  applyWeekSuggestion,
  cancelSession,
  localDateKey,
  moveSession as applyDomainMove,
  proposeMove,
  setAvailability,
  setRoutine,
  startOfWeek,
  suggestWeek,
  updateSession,
  type ScheduleKind,
  type ScheduleEffort,
  type ScheduleState,
  type ScheduledSession,
  type WeekSuggestion,
} from '../domain/schedule';
import {
  Button,
  Card,
  ChipGroup,
  Copy,
  EmptyState,
  Field,
  Input,
  Notice,
  Row,
  Section,
  Stat,
  Title,
  color,
  radius,
  space,
  type as typography,
} from './components';

export type { ScheduleState, ScheduledSession } from '../domain/schedule';

export interface PlanningScreenProps {
  state: ScheduleState;
  onSave: (next: ScheduleState) => Promise<void>;
  templates: WorkoutTemplate[];
  runs: Run[];
  strengthSessions: StrengthSession[];
  now: number;
  onStartRun: (session: ScheduledSession) => Promise<void>;
  onStartStrength: (session: ScheduledSession) => Promise<void>;
  onDevelopment?: () => void;
  onManageTemplates?: () => void;
  busy?: boolean;
}

type ViewMode = 'week' | 'month';
type PlanningScope = 'week' | 'routine';
type ActivityStatus = 'planned' | 'skipped' | 'started' | 'done';

interface SessionDraft {
  id?: string;
  date: string;
  title: string;
  kind: ScheduleKind;
  minutes: string;
  purpose: RunPurpose;
  effort: ScheduleEffort;
  templateId?: string;
  locked: boolean;
}

interface PendingSave {
  next: ScheduleState;
  previous: ScheduleState;
  message: string;
  trackUndo: boolean;
}

const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAY_LONG = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
];
const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const PURPOSES: { value: RunPurpose; label: string }[] = [
  { value: 'easy', label: 'Locker' },
  { value: 'long', label: 'Lang' },
  { value: 'intervals', label: 'Intervalle' },
  { value: 'free', label: 'Frei' },
];
const KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: 'run', label: 'Lauf' },
  { value: 'strength', label: 'Kraft' },
];
const EFFORT_OPTIONS: { value: ScheduleEffort; label: string }[] = [
  { value: 'easy', label: 'Locker' },
  { value: 'hard', label: 'Anstrengend' },
];
const SCOPE_OPTIONS: { value: PlanningScope; label: string }[] = [
  { value: 'week', label: 'Diese Woche' },
  { value: 'routine', label: 'Rhythmus' },
];

let nextSessionNumber = 0;

function localDateFrom(value: number | string | Date): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  const parts = value.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function isoDate(value: Date): string {
  return localDateKey(value);
}

function addDays(value: Date, amount: number): Date {
  return localDateFrom(addCalendarDays(isoDate(value), amount));
}

function mondayOf(value: Date): Date {
  return localDateFrom(startOfWeek(value));
}

function firstOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function dateLabel(value: Date): string {
  return `${
    WEEKDAY_SHORT[(value.getDay() + 6) % 7]
  }, ${value.getDate()}. ${MONTH_NAMES[value.getMonth()].slice(0, 3)}.`;
}

function fullDateLabel(value: Date): string {
  return `${WEEKDAY_LONG[(value.getDay() + 6) % 7]}, ${value.getDate()}. ${
    MONTH_NAMES[value.getMonth()]
  }`;
}

function monthLabel(value: Date): string {
  return `${MONTH_NAMES[value.getMonth()]} ${value.getFullYear()}`;
}

function parseMinutes(value: string): number | undefined {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1440) return undefined;
  return Math.round(parsed);
}

function parseDuration(value: string): number | undefined {
  const minutes = parseMinutes(value);
  return minutes === undefined || minutes < 1 ? undefined : minutes;
}

function mondayIndex(value: Date): number {
  return (value.getDay() + 6) % 7;
}

function formatMinutes(value: number): string {
  return `${Math.max(0, Math.round(value))} min`;
}

function formatActivityDate(value: number): string {
  return dateLabel(localDateFrom(value));
}

function cloneState(state: ScheduleState): ScheduleState {
  return {
    version: state.version,
    sessions: state.sessions.map(session => ({ ...session })),
    availability: { ...state.availability },
    routine: { days: [...state.routine.days], minutes: state.routine.minutes },
    goal: state.goal ? { ...state.goal } : undefined,
  };
}

function scheduleSignature(state: ScheduleState): string {
  return JSON.stringify({
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
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
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
}

function actualSessionStatus(
  session: ScheduledSession,
  runs: Run[],
  strengthSessions: StrengthSession[],
): ActivityStatus {
  if (session.status === 'skipped') return 'skipped';
  if (!session.activityId) return 'planned';

  if (session.kind === 'run') {
    const run = runs.find(
      candidate =>
        candidate.id === session.activityId ||
        candidate.canonicalId === session.activityId,
    );
    if (!run) return 'planned';
    const runStatus = String(run.status || '').toLowerCase();
    const finished =
      run.endTime > run.startTime &&
      ['completed', 'finished', 'complete', 'done', 'imported'].includes(
        runStatus,
      );
    return finished ? 'done' : 'started';
  }

  const strength = strengthSessions.find(
    candidate => candidate.id === session.activityId,
  );
  if (!strength) return 'planned';
  return strength.status === 'finished' ? 'done' : 'started';
}

function statusLabel(status: ActivityStatus): string {
  switch (status) {
    case 'done':
      return 'Erledigt';
    case 'started':
      return 'Gestartet';
    case 'skipped':
      return 'Ausgelassen';
    default:
      return 'Geplant';
  }
}

function sessionKindLabel(session: ScheduledSession): string {
  return session.kind === 'run' ? 'Lauf' : 'Kraft';
}

function createSessionDraft(
  date: string,
  session?: ScheduledSession,
): SessionDraft {
  return {
    id: session?.id,
    date,
    title: session?.title ?? '',
    kind: session?.kind ?? 'run',
    minutes: session ? String(session.minutes) : '30',
    purpose: session?.purpose ?? 'easy',
    effort:
      session?.effort ??
      (session?.purpose === 'intervals' || session?.purpose === 'race'
        ? 'hard'
        : 'easy'),
    templateId: session?.templateId,
    locked: Boolean(session?.locked),
  };
}

function monthCells(month: Date): Date[] {
  const start = mondayOf(firstOfMonth(month));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const leadingDays = mondayIndex(firstOfMonth(month));
  const days = Math.ceil((leadingDays + last.getDate()) / 7) * 7;
  return Array.from({ length: Math.max(35, days) }, (_, index) =>
    addDays(start, index),
  );
}

function inMonth(value: Date, month: Date): boolean {
  return (
    value.getFullYear() === month.getFullYear() &&
    value.getMonth() === month.getMonth()
  );
}

function actualIdMatches(
  activityId: string | undefined,
  id: string,
  canonicalId?: string,
) {
  return Boolean(
    activityId && (activityId === id || activityId === canonicalId),
  );
}

function actualIsFinishedRun(run: Run): boolean {
  const status = String(run.status || '').toLowerCase();
  return (
    run.endTime > run.startTime &&
    ['completed', 'finished', 'complete', 'done', 'imported'].includes(status)
  );
}

function suggestTrainingWeek(
  state: ScheduleState,
  weekStart: Date,
  templates: WorkoutTemplate[],
  today: string,
): WeekSuggestion {
  return suggestWeek(state, weekStart, {
    today,
    strengthTemplates: templates,
  });
}

export function PlanningScreen({
  state,
  onSave,
  templates,
  runs,
  strengthSessions,
  now,
  onStartRun,
  onStartStrength,
  onDevelopment,
  onManageTemplates,
  busy = false,
}: PlanningScreenProps) {
  const [displayState, setDisplayState] = useState<ScheduleState>(() =>
    cloneState(state),
  );
  const [view, setView] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() =>
    mondayOf(localDateFrom(now)),
  );
  const [monthDate, setMonthDate] = useState(() =>
    firstOfMonth(localDateFrom(now)),
  );
  const [adjusting, setAdjusting] = useState(false);
  const [scope, setScope] = useState<PlanningScope>('week');
  const [availabilityDraft, setAvailabilityDraft] = useState<
    Record<string, string>
  >({});
  const [routineDaysDraft, setRoutineDaysDraft] = useState<number[]>([]);
  const [routineMinutesDraft, setRoutineMinutesDraft] = useState('30');
  const [proposal, setProposal] = useState<WeekSuggestion | null>(null);
  const [editor, setEditor] = useState<SessionDraft | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveWeekStart, setMoveWeekStart] = useState(() =>
    mondayOf(localDateFrom(now)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [validation, setValidation] = useState('');
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [undoState, setUndoState] = useState<ScheduleState | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const saveExpectation = useRef<ScheduleState | null>(null);

  const today = isoDate(localDateFrom(now));
  const working = saving || Boolean(busy);

  useEffect(() => {
    if (saving || pending) return;
    const expected = saveExpectation.current;
    if (expected) {
      if (scheduleSignature(state) !== scheduleSignature(expected)) return;
      saveExpectation.current = null;
    }
    setDisplayState(cloneState(state));
  }, [pending, saving, state]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const moveWeekDates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => addDays(moveWeekStart, index)),
    [moveWeekStart],
  );
  const weekDateKeys = useMemo(() => weekDates.map(isoDate), [weekDates]);
  const monthDays = useMemo(() => monthCells(monthDate), [monthDate]);
  const monthRows = useMemo(
    () =>
      Array.from({ length: Math.ceil(monthDays.length / 7) }, (_, index) =>
        monthDays.slice(index * 7, index * 7 + 7),
      ),
    [monthDays],
  );
  const sessionsByDate = useMemo(() => {
    const grouped: Record<string, ScheduledSession[]> = {};
    displayState.sessions.forEach(session => {
      grouped[session.date] = grouped[session.date] ?? [];
      grouped[session.date].push(session);
    });
    return grouped;
  }, [displayState.sessions]);
  const detailsSession = detailsId
    ? displayState.sessions.find(session => session.id === detailsId) ?? null
    : null;
  const moveSessionDraft = moveId
    ? displayState.sessions.find(session => session.id === moveId) ?? null
    : null;

  const availableMinutes = useCallback(
    (date: string, _day?: number) => {
      if (
        Object.prototype.hasOwnProperty.call(displayState.availability, date)
      ) {
        return Math.max(0, displayState.availability[date] ?? 0);
      }
      return displayState.routine.minutes;
    },
    [displayState.availability, displayState.routine],
  );

  const visibleRange = useMemo(() => {
    if (view === 'week') return weekDateKeys;
    return monthDays.filter(day => inMonth(day, monthDate)).map(isoDate);
  }, [monthDate, monthDays, view, weekDateKeys]);

  const freeRuns = useMemo(() => {
    const linked = displayState.sessions
      .map(session => session.activityId)
      .filter((id): id is string => Boolean(id));
    return runs
      .filter(
        run => !linked.some(id => actualIdMatches(id, run.id, run.canonicalId)),
      )
      .filter(run =>
        visibleRange.includes(isoDate(localDateFrom(run.startTime))),
      )
      .sort((a, b) => b.startTime - a.startTime);
  }, [displayState.sessions, runs, visibleRange]);

  const freeStrength = useMemo(() => {
    const linked = displayState.sessions
      .map(session => session.activityId)
      .filter((id): id is string => Boolean(id));
    return strengthSessions
      .filter(session => !linked.includes(session.id))
      .filter(session =>
        visibleRange.includes(isoDate(localDateFrom(session.startTime))),
      )
      .sort((a, b) => b.startTime - a.startTime);
  }, [displayState.sessions, strengthSessions, visibleRange]);

  const persist = useCallback(
    async (
      next: ScheduleState,
      saveMessage: string,
      trackUndo = true,
      previous = displayState,
    ): Promise<boolean> => {
      setError('');
      setMessage('');
      setValidation('');
      setPending(null);
      saveExpectation.current = cloneState(next);
      setDisplayState(cloneState(next));
      setSaving(true);
      try {
        await onSave(next);
        setUndoState(trackUndo ? cloneState(previous) : null);
        setMessage(saveMessage);
        return true;
      } catch (caught) {
        const reason =
          caught instanceof Error
            ? caught.message
            : 'Bitte versuche es erneut.';
        setDisplayState(cloneState(previous));
        saveExpectation.current = null;
        setPending({
          next: cloneState(next),
          previous: cloneState(previous),
          message: saveMessage,
          trackUndo,
        });
        setError(`Änderung nicht gespeichert. ${reason}`);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [displayState, onSave],
  );

  const retrySave = useCallback(() => {
    if (!pending || working) return;
    void persist(
      pending.next,
      pending.message,
      pending.trackUndo,
      pending.previous,
    ).then(ok => {
      if (ok) {
        setEditor(null);
        setAdjusting(false);
        setMoveId(null);
        setDetailsId(null);
        setProposal(null);
      }
    });
  }, [pending, persist, working]);

  const undo = useCallback(() => {
    if (!undoState || working) return;
    void persist(
      undoState,
      'Letzte Änderung zurückgenommen.',
      false,
      displayState,
    ).then(ok => {
      if (ok) setUndoState(null);
    });
  }, [displayState, persist, undoState, working]);

  const openAdjustment = useCallback(() => {
    const values: Record<string, string> = {};
    weekDates.forEach((date, index) => {
      const key = isoDate(date);
      values[key] = String(availableMinutes(key, index));
    });
    setAvailabilityDraft(values);
    setRoutineDaysDraft([...displayState.routine.days]);
    setRoutineMinutesDraft(String(displayState.routine.minutes));
    setScope('week');
    setValidation('');
    setAdjusting(true);
  }, [
    availableMinutes,
    displayState.routine.days,
    displayState.routine.minutes,
    weekDates,
  ]);

  const saveAdjustment = useCallback(async () => {
    if (scope === 'routine') {
      const minutes = parseDuration(routineMinutesDraft);
      if (minutes === undefined) {
        setValidation('Der Rhythmus braucht 1 bis 1.440 Minuten.');
        return;
      }
      const next = setRoutine(displayState, {
        days: routineDaysDraft,
        minutes,
      });
      const ok = await persist(next, 'Rhythmus gespeichert.');
      if (ok) setAdjusting(false);
      return;
    }

    let next = cloneState(displayState);
    for (const date of weekDateKeys) {
      const minutes = parseMinutes(availabilityDraft[date] ?? '');
      if (minutes === undefined) {
        setValidation(
          `Bitte trage für ${fullDateLabel(
            localDateFrom(date),
          )} eine Zahl zwischen 0 und 1.440 ein.`,
        );
        return;
      }
      next = setAvailability(next, date, minutes);
    }
    const ok = await persist(next, 'Verfügbarkeit gespeichert.');
    if (ok) setAdjusting(false);
  }, [
    availabilityDraft,
    displayState,
    persist,
    routineDaysDraft,
    routineMinutesDraft,
    scope,
    weekDateKeys,
  ]);

  const createProposal = useCallback(() => {
    setError('');
    setMessage('');
    setValidation('');
    setProposal(suggestTrainingWeek(displayState, weekStart, templates, today));
  }, [displayState, templates, today, weekStart]);

  const applyProposal = useCallback(async () => {
    if (
      !proposal ||
      (!proposal.addedSessions.length && !proposal.movedSessions.length) ||
      working
    ) {
      return;
    }
    const next = applyWeekSuggestion(displayState, proposal, { today });
    if (next === displayState) {
      setError(
        'Der Plan hat sich geändert. Erstelle den Vorschlag bitte erneut.',
      );
      setProposal(null);
      return;
    }
    const ok = await persist(next, 'Vorschlag übernommen.');
    if (ok) setProposal(null);
  }, [displayState, persist, proposal, today, working]);

  const openEditor = useCallback(
    (session?: ScheduledSession, date = weekDateKeys[0]) => {
      setValidation('');
      setProposal(null);
      setDetailsId(null);
      setEditor(createSessionDraft(date, session));
    },
    [weekDateKeys],
  );

  const saveEditor = useCallback(async () => {
    if (!editor) return;
    const title = editor.title.trim();
    const minutes = parseDuration(editor.minutes);
    if (!title) {
      setValidation('Bitte gib der Einheit einen Namen.');
      return;
    }
    if (minutes === undefined) {
      setValidation('Die Dauer muss zwischen 1 und 1.440 Minuten liegen.');
      return;
    }
    const current = editor.id
      ? displayState.sessions.find(session => session.id === editor.id)
      : undefined;
    if (current?.locked) {
      setValidation('Eine gesperrte Einheit kann nicht geändert werden.');
      return;
    }
    if (current?.activityId && editor.kind !== current.kind) {
      setValidation(
        'Eine gestartete Einheit kann nicht in eine andere Art geaendert werden.',
      );
      return;
    }
    const session: ScheduledSession = {
      id: editor.id ?? `session-${Date.now()}-${nextSessionNumber++}`,
      date: editor.date,
      title,
      kind: editor.kind,
      minutes,
      purpose: editor.kind === 'run' ? editor.purpose : undefined,
      templateId: editor.kind === 'strength' ? editor.templateId : undefined,
      locked: current?.locked ?? false,
      status: current?.status ?? 'planned',
      effort: current?.effort ?? 'easy',
      activityId: current?.activityId,
      origin: current?.origin ?? 'manual',
      routineDay: current?.routineDay,
    };
    const next = current
      ? updateSession(
          displayState,
          current.id,
          {
            title: session.title,
            kind: session.kind,
            minutes: session.minutes,
            purpose: session.purpose,
            templateId: session.templateId,
            effort: session.effort,
          },
          { today },
        )
      : addScheduledSession(displayState, session, { today });
    if (next === displayState) {
      setValidation(
        'Die Einheit konnte nicht geändert werden. Prüfe Datum und Sperre.',
      );
      return;
    }
    const ok = await persist(
      next,
      current ? 'Einheit geändert.' : 'Einheit hinzugefügt.',
    );
    if (ok) setEditor(null);
  }, [displayState, editor, persist, today]);

  const handleMoveChoice = useCallback(
    async (session: ScheduledSession, date: string) => {
      if (working || session.locked || session.date === date) return;
      const proposalForMove = proposeMove(displayState, session.id, date, {
        today,
        maxSuggestions: 2,
      });
      if (!proposalForMove.allowed) {
        const explanation = proposalForMove.conflicts
          .map(conflict => conflict.message)
          .join(' ');
        setValidation(explanation || 'Dieser Tag passt nicht für die Einheit.');
        return;
      }
      const next = applyDomainMove(displayState, proposalForMove);
      if (next === displayState) {
        setValidation('Die Einheit konnte nicht verschoben werden.');
        return;
      }
      const ok = await persist(next, 'Einheit verschoben.');
      if (ok) {
        setMoveId(null);
        setDetailsId(null);
      }
    },
    [displayState, persist, today, working],
  );

  const skip = useCallback(
    async (session: ScheduledSession) => {
      if (working || session.activityId || session.date < today) return;
      const next =
        session.status === 'skipped'
          ? updateSession(
              displayState,
              session.id,
              { status: 'planned' },
              { today },
            )
          : cancelSession(displayState, session.id, { today });
      if (next === displayState) {
        setValidation('Diese Einheit kann nicht mehr geändert werden.');
        return;
      }
      const ok = await persist(
        next,
        session.status === 'skipped'
          ? 'Einheit wieder eingeplant.'
          : 'Einheit ausgelassen.',
      );
      if (ok) setDetailsId(null);
    },
    [displayState, persist, today, working],
  );

  const toggleLock = useCallback(
    async (session: ScheduledSession) => {
      if (working || session.date < today) return;
      let next: ScheduleState;
      if (session.locked) {
        next = {
          ...cloneState(displayState),
          sessions: displayState.sessions.map(candidate =>
            candidate.id === session.id
              ? {
                  ...candidate,
                  locked: false,
                  origin:
                    candidate.origin === 'fixed' ? 'manual' : candidate.origin,
                }
              : { ...candidate },
          ),
        };
      } else {
        next = updateSession(
          displayState,
          session.id,
          { locked: true },
          { today },
        );
      }
      if (next === displayState) {
        setValidation('Die Sperre konnte nicht geändert werden.');
        return;
      }
      const ok = await persist(
        next,
        session.locked ? 'Einheit wieder flexibel.' : 'Einheit gesperrt.',
      );
      if (ok) setDetailsId(null);
    },
    [displayState, persist, today, working],
  );

  const startSession = useCallback(
    async (session: ScheduledSession) => {
      if (working || startingId) return;
      const handler = session.kind === 'run' ? onStartRun : onStartStrength;
      if (session.date !== today) {
        setValidation('Verschiebe die Einheit zuerst auf heute.');
        return;
      }
      setError('');
      setStartingId(session.id);
      try {
        await handler(session);
        setMessage(`${session.title} kann jetzt gestartet werden.`);
        setDetailsId(null);
      } catch (caught) {
        const reason =
          caught instanceof Error
            ? caught.message
            : 'Bitte versuche es erneut.';
        setError(`Einheit konnte nicht gestartet werden. ${reason}`);
      } finally {
        setStartingId(null);
      }
    },
    [onStartRun, onStartStrength, startingId, today, working],
  );

  const jumpToToday = useCallback(() => {
    const current = localDateFrom(now);
    setWeekStart(mondayOf(current));
    setMonthDate(firstOfMonth(current));
  }, [now]);

  const navigateWeek = useCallback((amount: number) => {
    setWeekStart(current => addDays(current, amount * 7));
  }, []);

  const navigateMonth = useCallback((amount: number) => {
    setMonthDate(
      current =>
        new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  }, []);

  const openMove = useCallback((session: ScheduledSession) => {
    setValidation('');
    setDetailsId(null);
    setMoveId(session.id);
    setMoveWeekStart(mondayOf(localDateFrom(session.date)));
  }, []);

  const summaryMinutes = weekDateKeys.reduce(
    (total, date) =>
      total +
      (sessionsByDate[date] ?? []).reduce(
        (sum, session) => sum + session.minutes,
        0,
      ),
    0,
  );
  const weekSessionCount = weekDateKeys.reduce(
    (total, date) => total + (sessionsByDate[date] ?? []).length,
    0,
  );

  const renderSession = (session: ScheduledSession) => {
    const status = actualSessionStatus(session, runs, strengthSessions);
    return (
      <Pressable
        key={session.id}
        accessibilityRole="button"
        accessibilityLabel={`Einheit ${session.title}, ${fullDateLabel(
          localDateFrom(session.date),
        )}`}
        accessibilityState={{ disabled: working }}
        disabled={working}
        onPress={() => setDetailsId(session.id)}
        style={({ pressed }) => [styles.session, pressed && styles.pressed]}
      >
        <View style={styles.sessionMain}>
          <Text
            style={[
              styles.sessionTitle,
              session.status === 'skipped' && styles.struck,
            ]}
          >
            {session.title}
          </Text>
          <Text style={styles.sessionMeta}>
            {sessionKindLabel(session)} · {formatMinutes(session.minutes)} ·{' '}
            {statusLabel(status)}
          </Text>
        </View>
        <Text
          style={session.locked ? styles.sessionLocked : styles.sessionMark}
        >
          {session.locked ? 'Gesperrt' : '›'}
        </Text>
      </Pressable>
    );
  };

  const renderDayRow = (date: Date, index: number) => {
    const key = isoDate(date);
    const sessions = sessionsByDate[key] ?? [];
    const available = availableMinutes(key, index);
    if (!sessions.length) {
      return (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={`Einheit am ${WEEKDAY_LONG[index]} hinzufügen`}
          accessibilityState={{ disabled: working || key < today }}
          disabled={working || key < today}
          onPress={() => openEditor(undefined, key)}
          style={({ pressed }) => [
            styles.emptyDayRow,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.dayHeadingText}>
            <Text style={styles.dayTitle}>{fullDateLabel(date)}</Text>
            <Text style={styles.dayMeta}>
              {formatMinutes(available)} verfügbar
            </Text>
          </View>
          <Text style={styles.addText}>Einheit hinzufügen</Text>
        </Pressable>
      );
    }
    return (
      <View key={key} style={styles.dayCard}>
        <View style={styles.dayHeading}>
          <View style={styles.dayHeadingText}>
            <Text style={styles.dayTitle}>{fullDateLabel(date)}</Text>
            <Text style={styles.dayMeta}>
              {formatMinutes(available)} verfügbar
            </Text>
          </View>
        </View>
        {sessions.map(renderSession)}
        <Button
          title="Einheit hinzufügen"
          secondary
          small
          disabled={working || key < today}
          onPress={() => openEditor(undefined, key)}
          label={`Einheit am ${WEEKDAY_LONG[index]} hinzufügen`}
        />
      </View>
    );
  };

  const renderCalendarCell = (date: Date) => {
    const key = isoDate(date);
    const sessions = sessionsByDate[key] ?? [];
    const selected = key === today;
    const outside = !inMonth(date, monthDate);
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${fullDateLabel(date)}${
          sessions.length ? `, ${sessions.length} Einheiten` : ''
        }`}
        accessibilityState={{ selected }}
        onPress={() => {
          setWeekStart(mondayOf(date));
          setView('week');
        }}
        style={({ pressed }) => [
          styles.calendarCell,
          outside && styles.calendarOutside,
          selected && styles.calendarToday,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.calendarNumber, outside && styles.mutedText]}>
          {date.getDate()}
        </Text>
        {sessions.slice(0, 3).map(session => (
          <View
            key={session.id}
            style={[
              styles.calendarDot,
              session.status === 'skipped' && styles.calendarDotSkipped,
            ]}
          />
        ))}
      </Pressable>
    );
  };

  const renderActuals = () => {
    if (!freeRuns.length && !freeStrength.length) return null;
    return (
      <Section title="Freie Einheiten">
        <Card>
          {freeRuns.map(run => (
            <Row
              key={`run-${run.id}`}
              title={runTitle(run)}
              subtitle={`${formatActivityDate(run.startTime)} · ${
                actualIsFinishedRun(run) ? 'Erledigt' : 'Gestartet'
              }`}
              trailing={<Text style={styles.activityType}>Lauf</Text>}
            />
          ))}
          {freeStrength.map(session => (
            <Row
              key={`strength-${session.id}`}
              title={session.name}
              subtitle={`${formatActivityDate(session.startTime)} · ${
                session.status === 'finished' ? 'Erledigt' : 'Gestartet'
              }`}
              trailing={<Text style={styles.activityType}>Kraft</Text>}
            />
          ))}
        </Card>
      </Section>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Title>Planung</Title>
        {working ? (
          <ActivityIndicator
            color={color.green}
            accessibilityLabel="Speichern läuft"
          />
        ) : null}
      </View>

      {error ? (
        <Notice
          title="Aktion nicht abgeschlossen"
          onDismiss={() => setError('')}
        >
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
      {pending ? (
        <Notice title="Speichern erneut versuchen">
          <Text>Deine Eingaben sind noch offen.</Text>
          <View style={styles.noticeAction}>
            <Button
              title="Erneut speichern"
              secondary
              small
              disabled={working}
              onPress={retrySave}
            />
          </View>
        </Notice>
      ) : null}
      {validation ? (
        <Notice title="Bitte prüfen" onDismiss={() => setValidation('')}>
          {validation}
        </Notice>
      ) : null}

      <View style={styles.topActions}>
        <View style={styles.topActionPrimary}>
          <Button
            title="Woche vorschlagen"
            disabled={working}
            onPress={createProposal}
            label="Trainingswoche aus Rhythmus und Kraftvorlagen vorschlagen"
          />
        </View>
        <View style={styles.topActionSecondary}>
          <Button
            title="Woche anpassen"
            secondary
            small
            disabled={working}
            onPress={openAdjustment}
            label="Verfügbarkeit und Rhythmus für die Woche anpassen"
          />
        </View>
      </View>

      <ChipGroup
        label="Planungsansicht"
        options={[
          { value: 'week' as ViewMode, label: 'Woche' },
          { value: 'month' as ViewMode, label: 'Monat' },
        ]}
        value={view}
        onChange={setView}
        disabled={working}
      />

      {view === 'week' ? (
        <Section title="Diese Woche">
          <View style={styles.periodNavigation}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Vorherige Woche"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateWeek(-1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aktuelle Woche"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={jumpToToday}
              style={styles.periodLabel}
            >
              <Text style={styles.periodTitle}>
                {dateLabel(weekDates[0])} – {dateLabel(weekDates[6])}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nächste Woche"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateWeek(1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.stats}>
            <Stat value={String(weekSessionCount)} label="Einheiten" />
            <Stat value={String(summaryMinutes)} label="Minuten" />
            <Stat
              value={String(
                weekDateKeys.filter(
                  (date, index) => availableMinutes(date, index) > 0,
                ).length,
              )}
              label="Tage"
            />
          </View>
          <Card style={styles.weekCard}>{weekDates.map(renderDayRow)}</Card>
        </Section>
      ) : (
        <Section title="Monat">
          <View style={styles.periodNavigation}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Vorheriger Monat"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateMonth(-1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aktuellen Monat"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={jumpToToday}
              style={styles.periodLabel}
            >
              <Text style={styles.periodTitle}>{monthLabel(monthDate)}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nächster Monat"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => navigateMonth(1)}
              style={styles.navButton}
            >
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.calendarWeekdays}>
            {WEEKDAY_SHORT.map(day => (
              <Text key={day} style={styles.calendarWeekday}>
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {monthRows.map((row, index) => (
              <View key={`month-week-${index}`} style={styles.calendarRow}>
                {row.map(renderCalendarCell)}
              </View>
            ))}
          </View>
          <Copy muted>Tippe auf einen Tag, um seine Woche zu öffnen.</Copy>
        </Section>
      )}

      <Section title="Zeit und Rhythmus">
        <Card>
          <Row
            title="Verfügbarkeit anpassen"
            subtitle="Zeitbudget für die angezeigte Woche"
            onPress={openAdjustment}
          />
          {onManageTemplates ? (
            <Row
              title="Kraftvorlagen verwalten"
              subtitle={`${templates.length} Vorlagen gespeichert`}
              onPress={onManageTemplates}
            />
          ) : null}
          {onDevelopment ? (
            <Row
              title="Entwicklung ansehen"
              subtitle="Plan und tatsächliche Einheiten"
              onPress={onDevelopment}
            />
          ) : null}
        </Card>
      </Section>

      {undoState ? (
        <View style={styles.undoRow}>
          <Copy muted>Änderung gespeichert.</Copy>
          <Button
            title="Rückgängig"
            secondary
            small
            disabled={working}
            onPress={undo}
          />
        </View>
      ) : null}

      {renderActuals()}

      <Modal
        visible={Boolean(proposal)}
        transparent
        animationType="slide"
        onRequestClose={() => setProposal(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Wochenvorschlag
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Vorschlag schließen"
                onPress={() => setProposal(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {proposal ? (
              proposal.addedSessions.length || proposal.movedSessions.length ? (
                <>
                  <Copy>
                    {proposal.addedSessions.length +
                      proposal.movedSessions.length}{' '}
                    Änderungen für diese Woche.
                  </Copy>
                  {proposal.addedSessions.map(session => (
                    <Row
                      key={session.id}
                      title={session.title}
                      subtitle={`${fullDateLabel(
                        localDateFrom(session.date),
                      )} · ${formatMinutes(session.minutes)}`}
                    />
                  ))}
                  {proposal.moves.map(move => (
                    <Row
                      key={move.id}
                      title={move.title}
                      subtitle={`${dateLabel(
                        localDateFrom(move.from),
                      )} → ${dateLabel(
                        localDateFrom(move.to),
                      )} · ${formatMinutes(move.session.minutes)}`}
                    />
                  ))}
                  {proposal.warnings.map(warning => (
                    <Notice key={warning}>{warning}</Notice>
                  ))}
                  {proposal.rationale.length ? (
                    <Copy muted>{proposal.rationale[0]}</Copy>
                  ) : null}
                  <Button
                    title="Vorschlag übernehmen"
                    secondary
                    disabled={working}
                    onPress={() => void applyProposal()}
                  />
                </>
              ) : (
                <EmptyState
                  title="Keine neue Einheit"
                  copy={
                    proposal.warnings[0] ??
                    (displayState.routine.days.length ||
                    templates.some(template => template.days.length)
                      ? 'Der vorhandene Plan passt bereits.'
                      : 'Lege unter Woche anpassen deinen üblichen Rhythmus fest oder füge eine Einheit direkt hinzu.')
                  }
                  action={{
                    title: 'Schließen',
                    onPress: () => setProposal(null),
                  }}
                />
              )
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={Boolean(detailsSession)}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailsId(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Einheit
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Details schließen"
                onPress={() => setDetailsId(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {detailsSession ? (
              <>
                <Text style={styles.detailTitle}>{detailsSession.title}</Text>
                <Text style={styles.detailMeta}>
                  {fullDateLabel(localDateFrom(detailsSession.date))} ·{' '}
                  {sessionKindLabel(detailsSession)} ·{' '}
                  {formatMinutes(detailsSession.minutes)}
                </Text>
                <Text style={styles.detailStatus}>
                  {statusLabel(
                    actualSessionStatus(detailsSession, runs, strengthSessions),
                  )}
                  {detailsSession.locked ? ' · Gesperrt' : ''}
                </Text>
                <View style={styles.modalActions}>
                  <Button
                    title={
                      detailsSession.date === today
                        ? 'Einheit starten'
                        : 'Heute einplanen'
                    }
                    secondary
                    disabled={
                      working ||
                      detailsSession.status === 'skipped' ||
                      Boolean(detailsSession.activityId)
                    }
                    onPress={() => void startSession(detailsSession)}
                  />
                  <Button
                    title="Einheit bearbeiten"
                    secondary
                    disabled={
                      working ||
                      detailsSession.locked ||
                      detailsSession.date < today
                    }
                    onPress={() =>
                      openEditor(detailsSession, detailsSession.date)
                    }
                  />
                  <Button
                    title="Einheit verschieben"
                    secondary
                    disabled={
                      working ||
                      detailsSession.locked ||
                      detailsSession.date < today
                    }
                    onPress={() => openMove(detailsSession)}
                  />
                  <Button
                    title={
                      detailsSession.status === 'skipped'
                        ? 'Einheit wieder einplanen'
                        : 'Einheit auslassen'
                    }
                    secondary
                    disabled={
                      working ||
                      Boolean(detailsSession.activityId) ||
                      detailsSession.locked ||
                      detailsSession.date < today
                    }
                    onPress={() => void skip(detailsSession)}
                  />
                  <Button
                    title={
                      detailsSession.locked
                        ? 'Einheit entsperren'
                        : 'Einheit sperren'
                    }
                    secondary
                    disabled={working || detailsSession.date < today}
                    onPress={() => void toggleLock(detailsSession)}
                  />
                </View>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={Boolean(moveSessionDraft)}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveId(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Einheit verschieben
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Verschieben schließen"
                onPress={() => setMoveId(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {moveSessionDraft ? (
              <>
                <Copy>{moveSessionDraft.title}</Copy>
                <View style={styles.periodNavigation}>
                  <Button
                    title="‹"
                    secondary
                    label="Vorherige Woche zum Verschieben"
                    onPress={() =>
                      setMoveWeekStart(current => addDays(current, -7))
                    }
                  />
                  <Text style={styles.periodTitle}>
                    {dateLabel(moveWeekStart)} –{' '}
                    {dateLabel(addDays(moveWeekStart, 6))}
                  </Text>
                  <Button
                    title="›"
                    secondary
                    label="Nächste Woche zum Verschieben"
                    onPress={() =>
                      setMoveWeekStart(current => addDays(current, 7))
                    }
                  />
                </View>
                {moveWeekDates.map(date => {
                  const key = isoDate(date);
                  const candidate = proposeMove(
                    displayState,
                    moveSessionDraft.id,
                    key,
                    { today, maxSuggestions: 0 },
                  );
                  const selected = key === moveSessionDraft.date;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={`${fullDateLabel(date)}${
                        selected ? ', aktueller Tag' : ''
                      }`}
                      accessibilityState={{
                        disabled: working || selected || !candidate.allowed,
                        selected,
                      }}
                      disabled={working || selected || !candidate.allowed}
                      onPress={() =>
                        void handleMoveChoice(moveSessionDraft, key)
                      }
                      style={({ pressed }) => [
                        styles.moveChoice,
                        selected && styles.moveChoiceSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.moveChoiceText}>
                        {fullDateLabel(date)}
                      </Text>
                      <Text style={styles.moveChoiceMeta}>
                        {selected
                          ? 'Aktuell'
                          : candidate.allowed
                          ? 'Passt'
                          : 'Nicht möglich'}
                      </Text>
                    </Pressable>
                  );
                })}
                {error ? <Notice>{error}</Notice> : null}
                {validation ? <Notice>{validation}</Notice> : null}
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={Boolean(editor)}
        transparent
        animationType="slide"
        onRequestClose={() => setEditor(null)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {editor?.id ? 'Einheit bearbeiten' : 'Einheit hinzufügen'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Bearbeiten schließen"
                onPress={() => setEditor(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {editor ? (
              <>
                <Field label="Name">
                  <Input
                    label="Name der Einheit"
                    value={editor.title}
                    onChangeText={title =>
                      setEditor(current =>
                        current ? { ...current, title } : current,
                      )
                    }
                    placeholder="Zum Beispiel Lockerer Lauf"
                  />
                </Field>
                <Field label="Dauer in Minuten">
                  <Input
                    label="Dauer in Minuten"
                    keyboardType="numeric"
                    value={editor.minutes}
                    onChangeText={minutes =>
                      setEditor(current =>
                        current ? { ...current, minutes } : current,
                      )
                    }
                  />
                </Field>
                <Field label="Art">
                  <ChipGroup
                    options={KIND_OPTIONS}
                    value={editor.kind}
                    onChange={kind =>
                      setEditor(current =>
                        current ? { ...current, kind } : current,
                      )
                    }
                    label="Art der Einheit"
                  />
                </Field>
                {editor.kind === 'run' ? (
                  <Field label="Zweck">
                    <ChipGroup
                      options={PURPOSES}
                      value={editor.purpose}
                      onChange={purpose =>
                        setEditor(current =>
                          current
                            ? {
                                ...current,
                                purpose,
                                effort:
                                  purpose === 'intervals' || purpose === 'race'
                                    ? 'hard'
                                    : current.effort,
                              }
                            : current,
                        )
                      }
                      label="Zweck des Laufs"
                    />
                  </Field>
                ) : (
                  <Field label="Kraftvorlage">
                    {templates.length ? (
                      <ChipGroup
                        options={templates.map(template => ({
                          value: template.id,
                          label: template.name,
                        }))}
                        value={editor.templateId ?? templates[0].id}
                        onChange={templateId =>
                          setEditor(current =>
                            current ? { ...current, templateId } : current,
                          )
                        }
                        label="Kraftvorlage"
                      />
                    ) : (
                      <Copy muted>Lege zuerst eine Kraftvorlage an.</Copy>
                    )}
                  </Field>
                )}
                <Field label="Belastung">
                  <ChipGroup
                    options={EFFORT_OPTIONS}
                    value={editor.effort}
                    onChange={effort =>
                      setEditor(current =>
                        current ? { ...current, effort } : current,
                      )
                    }
                    label="Belastung der Einheit"
                  />
                </Field>
                {error ? <Notice>{error}</Notice> : null}
                {validation ? <Notice>{validation}</Notice> : null}
                <View style={styles.modalActions}>
                  <Button
                    title="Speichern"
                    secondary
                    disabled={working}
                    onPress={() => void saveEditor()}
                  />
                  <Button
                    title="Abbrechen"
                    secondary
                    disabled={working}
                    onPress={() => setEditor(null)}
                  />
                </View>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={adjusting}
        transparent
        animationType="slide"
        onRequestClose={() => setAdjusting(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.modalBackdrop}>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalCard}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Zeitbudget
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Zeitbudget schließen"
                onPress={() => setAdjusting(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <ChipGroup
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
              label="Zeitbudget ändern für"
              disabled={working}
            />
            {scope === 'week' ? (
              <>
                <Copy muted>Jeder Tag bleibt eine eigene Ausnahme.</Copy>
                {weekDateKeys.map((date, index) => (
                  <Field key={date} label={WEEKDAY_LONG[index]}>
                    <Input
                      label={`${WEEKDAY_LONG[index]} verfügbare Minuten`}
                      keyboardType="numeric"
                      value={availabilityDraft[date] ?? ''}
                      onChangeText={value =>
                        setAvailabilityDraft(current => ({
                          ...current,
                          [date]: value,
                        }))
                      }
                    />
                  </Field>
                ))}
              </>
            ) : (
              <>
                <Field label="Wöchentliche Tage">
                  <ChipGroup
                    options={WEEKDAY_SHORT.map((label, value) => ({
                      value: String(value),
                      label,
                    }))}
                    value=""
                    onChange={value => {
                      const day = Number(value);
                      setRoutineDaysDraft(current =>
                        current.includes(day)
                          ? current.filter(item => item !== day)
                          : [...current, day].sort((a, b) => a - b),
                      );
                    }}
                    label="Wochentage im Rhythmus"
                  />
                </Field>
                <View style={styles.selectedDays}>
                  {routineDaysDraft.map(day => (
                    <Text key={day} style={styles.selectedDay}>
                      ✓ {WEEKDAY_SHORT[day]}
                    </Text>
                  ))}
                </View>
                <Field label="Übliches Zeitbudget in Minuten">
                  <Input
                    label="Übliche Minuten"
                    keyboardType="numeric"
                    value={routineMinutesDraft}
                    onChangeText={setRoutineMinutesDraft}
                  />
                </Field>
              </>
            )}
            {error ? <Notice>{error}</Notice> : null}
            {validation ? <Notice>{validation}</Notice> : null}
            <View style={styles.modalActions}>
              <Button
                title={
                  scope === 'week'
                    ? 'Verfügbarkeit speichern'
                    : 'Rhythmus speichern'
                }
                secondary
                disabled={working}
                onPress={() => void saveAdjustment()}
              />
              <Button
                title="Abbrechen"
                secondary
                disabled={working}
                onPress={() => setAdjusting(false)}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: space.md },
  topActions: { flexDirection: 'row', gap: space.xs },
  topActionPrimary: { flex: 1 },
  topActionSecondary: { flex: 1 },
  weekCard: { padding: space.md, gap: space.xs },
  emptyDayRow: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addText: { color: color.green, ...typography.label },
  sessionLocked: { color: color.muted, ...typography.label },
  calendarRow: { flexDirection: 'row', gap: space.xxs },
  modalScroll: { maxHeight: '90%', flexGrow: 0 },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionBlock: { marginTop: space.xs },
  periodNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  navButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  navText: {
    color: color.text,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '400',
  },
  periodLabel: {
    minHeight: 48,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  periodTitle: {
    flexShrink: 1,
    textAlign: 'center',
    color: color.text,
    ...typography.body,
    fontWeight: '600',
  },
  stats: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  dayCard: {
    gap: space.xxs,
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  dayHeading: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayHeadingText: { flex: 1, gap: space.xxs },
  dayTitle: { color: color.text, ...typography.body, fontWeight: '600' },
  dayMeta: { color: color.muted, ...typography.label },
  dayCount: {
    color: color.muted,
    ...typography.value,
    fontVariant: ['tabular-nums'],
  },
  session: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  sessionMain: { flex: 1, gap: space.xxs },
  sessionTitle: { color: color.text, ...typography.body, fontWeight: '600' },
  sessionMeta: { color: color.muted, ...typography.label },
  sessionMark: {
    color: color.green,
    fontSize: 24,
    minWidth: 24,
    textAlign: 'center',
  },
  struck: { textDecorationLine: 'line-through', color: color.muted },
  pressed: { opacity: 0.72 },
  calendarWeekdays: { flexDirection: 'row', gap: space.xxs },
  calendarWeekday: {
    flex: 1,
    textAlign: 'center',
    color: color.muted,
    ...typography.micro,
  },
  calendarGrid: { gap: space.xxs },
  calendarCell: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.sm,
    backgroundColor: color.surface,
    padding: space.xxs,
    alignItems: 'center',
    gap: space.xxs,
  },
  calendarOutside: { opacity: 0.45 },
  calendarToday: {
    borderWidth: 1,
    borderColor: color.green,
    backgroundColor: color.greenSoft,
  },
  calendarNumber: {
    color: color.text,
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  calendarDot: {
    width: space.xs,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.green,
  },
  calendarDotSkipped: { backgroundColor: color.muted },
  mutedText: { color: color.muted },
  activityType: { color: color.muted, ...typography.label },
  undoRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  noticeAction: { marginTop: space.xs },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16,18,16,0.72)',
  },
  modalCard: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  modalHeader: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: color.text, ...typography.heading },
  closeButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: color.text, fontSize: 30, lineHeight: 32 },
  detailTitle: { color: color.text, ...typography.title },
  detailMeta: { color: color.muted, ...typography.body },
  detailStatus: { color: color.green, ...typography.label },
  modalActions: { gap: space.sm },
  moveChoice: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingHorizontal: space.sm,
  },
  moveChoiceSelected: {
    backgroundColor: color.greenSoft,
    borderColor: color.green,
  },
  moveChoiceText: { color: color.text, ...typography.body },
  moveChoiceMeta: { color: color.muted, ...typography.label },
  selectedDays: {
    minHeight: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    alignItems: 'center',
  },
  selectedDay: { color: color.green, ...typography.label },
});
