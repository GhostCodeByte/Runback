import {
  addCalendarDays,
  applyWeekSuggestion,
  cancelSession,
  localDateKey,
  moveSession,
  normalizeSchedule,
  proposeMove,
  serializeSchedule,
  startOfWeek,
  suggestWeek,
  updateSession,
  type ScheduleState,
  type ScheduledSession,
} from '../src/domain/schedule';

const TODAY = '2025-03-10';

const session = (
  id: string,
  date: string,
  extra: Partial<ScheduledSession> = {},
): ScheduledSession => ({
  id,
  date,
  title: 'Lauf',
  kind: 'run',
  minutes: 30,
  locked: false,
  status: 'planned',
  effort: 'easy',
  ...extra,
});

const state = (overrides: Partial<ScheduleState> = {}): ScheduleState => ({
  version: 1,
  sessions: [],
  availability: {},
  routine: { days: [0, 2, 5], minutes: 30 },
  ...overrides,
});

describe('Lokale Kalenderdaten', () => {
  it('arbeitet mit Kalender- statt Millisekunden-Tagen', () => {
    expect(addCalendarDays('2024-03-30', 1)).toBe('2024-03-31');
    expect(addCalendarDays('2024-03-30', 2)).toBe('2024-04-01');
    expect(addCalendarDays('2024-10-26', 2)).toBe('2024-10-28');
    expect(startOfWeek('2025-03-16')).toBe('2025-03-10');
  });

  it('formatiert einen lokalen Date-Wert ohne UTC-Verschiebung', () => {
    const local = new Date(2025, 2, 10, 23, 59, 59);
    expect(localDateKey(local)).toBe('2025-03-10');
  });
});

describe('Schedule-Normalisierung und Offline-Roundtrip', () => {
  it('entfernt ungültige Einträge, dedupliziert IDs und behält Links', () => {
    const raw = {
      version: 99,
      routine: { days: [6, 0, 0, 8, -1], minutes: 45 },
      availability: { '2025-03-11': 20, 'kein-datum': 10 },
      sessions: [
        session('run-1', '2025-03-11', { activityId: 'native-run-1' }),
        session('run-1', '2025-03-12'),
        session('bad', '2025-02-30'),
      ],
    };
    const normalized = normalizeSchedule(raw);
    expect(normalized.version).toBe(1);
    expect(normalized.routine).toEqual({ days: [0, 6], minutes: 45 });
    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0].activityId).toBe('native-run-1');
    expect(normalized.availability).toEqual({ '2025-03-11': 20 });
  });

  it('serialisiert deterministisch als lokale, rein optionale Kalenderdaten', () => {
    const original = state({ sessions: [session('r', '2025-03-11')] });
    const restored = normalizeSchedule(JSON.parse(serializeSchedule(original)));
    expect(restored).toEqual(original);
  });
});

describe('Wochenvorschlag', () => {
  it('liefert eine Vorschau und verändert den gespeicherten Zustand nicht', () => {
    const original = state();
    const suggestion = suggestWeek(original, TODAY, { today: TODAY });
    expect(suggestion.weekStart).toBe(TODAY);
    expect(suggestion.addedSessions).toHaveLength(3);
    expect(suggestion.sessions.map(item => item.id)).toEqual([
      'routine-2025-03-10-0',
      'routine-2025-03-10-2',
      'routine-2025-03-10-5',
    ]);
    expect(original.sessions).toEqual([]);
  });

  it('verschiebt bei einem un verfügbaren Tag innerhalb der Woche und erzeugt keine Dublette', () => {
    const original = state({ availability: { '2025-03-12': 0 } });
    const first = suggestWeek(original, TODAY, { today: TODAY });
    const second = suggestWeek(original, TODAY, { today: TODAY });
    expect(first.addedSessions.map(item => item.date)).toEqual([
      '2025-03-10',
      '2025-03-11',
      '2025-03-15',
    ]);
    expect(first.addedSessions.map(item => item.id)).toEqual(
      second.addedSessions.map(item => item.id),
    );
    expect(first.suggestions[0].date).toBe('2025-03-11');
  });

  it('respektiert eine übersprungene Ausnahme und holt sie nicht automatisch nach', () => {
    const original = state({
      sessions: [session('skip-wed', '2025-03-12', { status: 'skipped' })],
    });
    const suggestion = suggestWeek(original, TODAY, { today: TODAY });
    expect(suggestion.addedSessions.some(item => item.date === '2025-03-12')).toBe(
      false,
    );
    expect(suggestion.addedSessions).toHaveLength(2);
  });

  it('wird erst durch eine explizite Anwendung persistierbar und bleibt idempotent', () => {
    const preview = suggestWeek(state(), TODAY, { today: TODAY });
    const applied = applyWeekSuggestion(state(), preview, { today: TODAY });
    const twice = applyWeekSuggestion(applied, preview, { today: TODAY });
    expect(applied.sessions).toHaveLength(3);
    expect(twice.sessions).toEqual(applied.sessions);
  });
});

describe('Verschieben und Konflikte', () => {
  it('meldet einen festen Zieltermin und schlägt keinen stillen Umzug vor', () => {
    const current = state({
      sessions: [
        session('move', '2025-03-11'),
        session('fixed', '2025-03-13', { locked: true, origin: 'fixed' }),
      ],
    });
    const proposal = proposeMove(current, 'move', '2025-03-13', { today: TODAY });
    expect(proposal.allowed).toBe(false);
    expect(proposal.conflicts.map(item => item.code)).toContain('locked_session');
    expect(moveSession(current, 'move', '2025-03-13', { today: TODAY })).toEqual(
      current,
    );
  });

  it('erkennt harte Einheiten über die Wochen-Grenze hinweg', () => {
    const current = state({
      sessions: [
        session('sunday-hard', '2025-03-16', { effort: 'hard' }),
        session('move', '2025-03-14', { effort: 'hard' }),
      ],
    });
    const proposal = proposeMove(current, 'move', '2025-03-17', { today: TODAY });
    expect(proposal.conflicts.map(item => item.code)).toContain('adjacent_hard');
    expect(proposal.suggestions.some(item => item.date === '2025-03-18')).toBe(true);
  });

  it('verschiebt einen erlaubten Termin nur nach ausdrücklicher Anwendung', () => {
    const current = state({ sessions: [session('move', '2025-03-11')] });
    const proposal = proposeMove(current, 'move', '2025-03-13', { today: TODAY });
    const moved = moveSession(current, proposal);
    expect(moved.sessions.find(item => item.id === 'move')?.date).toBe('2025-03-13');
    expect(current.sessions[0].date).toBe('2025-03-11');
  });
});

describe('Sichere Änderungen', () => {
  it('hält vergangene Einheiten unveränderlich', () => {
    const current = state({ sessions: [session('past', '2025-03-09')] });
    expect(updateSession(current, 'past', { title: 'Geändert' }, { today: TODAY })).toBe(
      current,
    );
    expect(cancelSession(current, 'past', { today: TODAY })).toBe(current);
  });

  it('markiert eine zukünftige Absage, ohne eine Nachhol-Einheit anzulegen', () => {
    const current = state({ sessions: [session('future', '2025-03-12')] });
    const cancelled = cancelSession(current, 'future', { today: TODAY });
    expect(cancelled.sessions).toEqual([
      expect.objectContaining({ id: 'future', status: 'skipped' }),
    ]);
    expect(cancelled.sessions).toHaveLength(1);
  });
});

