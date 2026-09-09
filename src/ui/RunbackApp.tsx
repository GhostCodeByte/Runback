import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState as AndroidAppState,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Onboarding } from './Onboarding';
import { Statistics } from './Statistics';
import { TrainingChat } from './TrainingChat';
import { DeviceSettings } from './DeviceSettings';
import { VendorImport } from './VendorImport';
import { WorkoutScreen } from './WorkoutScreen';
import { ExercisePicker } from './ExercisePicker';
import { PlanEditor } from './PlanEditor';
import { PlanList } from './PlanList';
import { BodyMap, type BodyMapMode } from './BodyMap';
import { SorenessCapture } from './SorenessCapture';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  upsertTemplate,
} from '../domain/plans';
import {
  addExercise,
  addSet,
  completeSet as completeStrengthSet,
  editSet as editStrengthSet,
  emptyStrengthState,
  finishSession,
  selectExercise,
  summarize,
  startSession,
  templateForDay,
  type Exercise,
  type StrengthSession,
  type StrengthState,
  type WorkoutTemplate,
} from '../domain/strength';
import { RunIntegrations } from './RunIntegrations';
import { ProseSettings, ProseExplanation } from './ProseSettings';
import {
  acceptRecommendation,
  analyzeRun,
  allRegionIds,
  evaluateExperiment,
  transitionExperiment,
} from '../domain';
import type {
  ExperimentStatus,
  Recommendation,
  RunPurpose,
} from '../domain/types';
import type { SorenessReport as CapturedSorenessReport } from '../domain/sorenessInput';
import type { RegionId } from '../domain/regions';
import {
  native,
  nativeCall,
  type AppState,
  type Preset,
  type Run,
  type Settings,
} from '../native';
import {
  Button,
  Copy,
  Icon,
  Route,
  Row,
  Section,
  Stat,
  color,
} from './components';

const purposes: { value: RunPurpose; label: string; description: string }[] = [
  { value: 'free', label: 'Freier Lauf', description: 'Ohne feste Vorgabe' },
  {
    value: 'easy',
    label: 'Locker',
    description: 'Ein ruhiger, gleichmäßiger Lauf',
  },
  { value: 'long', label: 'Lang', description: 'Zeit auf den Beinen' },
  {
    value: 'intervals',
    label: 'Intervalle',
    description: 'Belastung und Erholung im Wechsel',
  },
  { value: 'race', label: 'Wettkampf', description: 'Laufen auf Leistung' },
  {
    value: 'unknown',
    label: 'Noch offen',
    description: 'Zweck später ergänzen',
  },
];
const purposeLabel = (value: RunPurpose) =>
  purposes.find(p => p.value === value)?.label || 'Lauf';
const number = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '–';
const distance = (run: Run) => number(run.distanceMeters / 1000, 2);
const duration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(
        2,
        '0',
      )}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pace = (run: Run) =>
  run.distanceMeters >= 20
    ? duration(run.durationSeconds / (run.distanceMeters / 1000))
    : '–:––';
const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
});
const date = (timestamp: number) => dateFormatter.format(new Date(timestamp));
const initial: AppState = {
  runs: [],
  recording: null,
  settings: {},
  capabilities: {},
};
type Tab = 'Heute' | 'Läufe' | 'Fokus' | 'Mehr';
type Page =
  | 'main'
  | 'profile'
  | 'devices'
  | 'data'
  | 'vendor-import'
  | 'presets'
  | 'models'
  | 'statistics'
  | 'chat'
  | 'plans'
  | 'strength-history'
  | 'muscle-map';

const RunRow = memo(function RunRow({
  run,
  open,
}: {
  run: Run;
  open: (id: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${purposeLabel(run.purpose)}, ${date(
        run.startTime,
      )}, ${distance(run)} Kilometer`}
      onPress={() => open(run.id)}
      style={({ pressed }) => [styles.runRow, pressed && styles.pressed]}
    >
      <View style={styles.runTop}>
        <Text style={styles.runTitle}>{purposeLabel(run.purpose)}</Text>
        <Text style={styles.muted}>{date(run.startTime)}</Text>
      </View>
      <View style={styles.runBottom}>
        <Text style={styles.runDistance}>
          {distance(run)} <Text style={styles.runUnit}>km</Text>
        </Text>
        <Text style={styles.muted}>
          {duration(run.durationSeconds)} · {pace(run)} /km
        </Text>
        <Text style={styles.arrow}>›</Text>
      </View>
    </Pressable>
  );
});

export function RunbackApp() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<AppState>(initial);
  const stateRef = useRef(state);
  const [tab, setTab] = useState<Tab>('Heute');
  const [page, setPage] = useState<Page>('main');
  const [selected, setSelected] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [purposePicker, setPurposePicker] = useState(false);
  const [note, setNote] = useState('');
  const [importStatus, setImportStatus] = useState<any>(null);
  const [moreDetails, setMoreDetails] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [minuteInput, setMinuteInput] = useState('30');
  const [presetName, setPresetName] = useState('');
  const [strength, setStrength] = useState<StrengthState>(emptyStrengthState());
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<WorkoutTemplate | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [recentSessions, setRecentSessions] = useState<StrengthSession[]>([]);
  const [strengthSessions, setStrengthSessions] = useState<StrengthSession[]>(
    [],
  );
  const [sorenessReports, setSorenessReports] = useState<
    CapturedSorenessReport[]
  >([]);
  const [sorenessStorageAvailable, setSorenessStorageAvailable] =
    useState(false);
  const [sorenessOpen, setSorenessOpen] = useState(false);
  const [muscleMapMode, setMuscleMapMode] = useState<BodyMapMode>('freshness');
  const sorenessPromptShown = useRef(false);
  const strengthRef = useRef(strength);
  strengthRef.current = strength;
  const settings = state.settings;
  const runs = state.runs;
  const recording = state.recording;
  const isRecording = Boolean(recording);
  const showOnboarding =
    loaded && !isRecording && (setupOpen || !settings.onboardedAt);
  const experiment = settings.experiments?.find(
    e => e.status === 'active' || e.status === 'paused',
  );
  const analyses = useMemo(
    () => runs.map(run => ({ run, analysis: analyzeRun(run, experiment) })),
    [runs, experiment],
  );
  const candidate = analyses.find(
    a =>
      a.analysis.recommendation &&
      !settings.dismissedRecommendations?.includes(
        a.analysis.recommendation.id,
      ),
  )?.analysis.recommendation;
  const latest = analyses[0];
  const purpose = settings.purpose || 'free';

  const refresh = useCallback(async () => {
    const next = await native.state();
    next.runs.sort((a, b) => b.startTime - a.startTime);
    stateRef.current = next;
    setState(next);
    setLoaded(true);
    return next;
  }, []);
  const action = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  const persist = useCallback(async (patch: Partial<Settings>) => {
    const updated = { ...stateRef.current.settings, ...patch };
    await native.saveSettings(updated);
    stateRef.current = { ...stateRef.current, settings: updated };
    setState(stateRef.current);
  }, []);
  const save = (patch: Partial<Settings>) => {
    void action(() => persist(patch));
  };

  useEffect(() => {
    void refresh()
      .catch(e => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, [refresh]);
  // Krafttraining wird getrennt geladen. Fehlt die native Unterstützung, bleibt
  // der Zustand leer und der Rest der App unberührt (Invariante 7).
  useEffect(() => {
    void native
      .strength()
      .then(next => {
        setStrength(next);
        if (next.active) {
          setSorenessOpen(false);
          setWorkoutOpen(true);
        }
      })
      .catch(() => {});
    void native
      .strengthSessions()
      .then(setStrengthSessions)
      .catch(() => {});
    void native
      .sorenessReports()
      .then(next => {
        setSorenessReports(next);
        setSorenessStorageAvailable(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (
      !loaded ||
      !sorenessStorageAvailable ||
      sorenessPromptShown.current ||
      showOnboarding ||
      isRecording ||
      workoutOpen
    ) {
      return;
    }
    sorenessPromptShown.current = true;
    const today = new Date();
    const hasReportToday = sorenessReports.some(report => {
      const at = new Date(report.at);
      return (
        at.getFullYear() === today.getFullYear() &&
        at.getMonth() === today.getMonth() &&
        at.getDate() === today.getDate()
      );
    });
    if (!hasReportToday) {
      setSorenessOpen(true);
    }
  }, [
    isRecording,
    loaded,
    sorenessReports,
    sorenessStorageAvailable,
    showOnboarding,
    workoutOpen,
  ]);
  // Sekundentakt nur, solange eine Pause läuft.
  useEffect(() => {
    if (strength.active?.restStartedAt === undefined) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [strength.active?.restStartedAt]);
  useEffect(() => {
    const subscription = AndroidAppState.addEventListener('change', value => {
      if (value === 'active' && !busyRef.current) {
        void refresh().catch(() => {});
      }
    });
    const timer = setInterval(
      () => {
        if (!busyRef.current && AndroidAppState.currentState === 'active') {
          void refresh().catch(() => {});
        }
      },
      isRecording ? 1200 : 8000,
    );
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [refresh, isRecording]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (showOnboarding) return false;
        if (sorenessOpen) {
          setSorenessOpen(false);
          return true;
        }
        if (workoutOpen) {
          if (pickerOpen) {
            setPickerOpen(false);
          } else {
            setWorkoutOpen(false);
          }
          return true;
        }
        if (purposePicker) {
          setPurposePicker(false);
          return true;
        }
        if (selected) {
          setSelected(null);
          setMoreDetails(false);
          return true;
        }
        if (page !== 'main') {
          setPage('main');
          return true;
        }
        if (tab !== 'Heute') {
          setTab('Heute');
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [
    selected,
    page,
    tab,
    purposePicker,
    showOnboarding,
    workoutOpen,
    pickerOpen,
    sorenessOpen,
  ]);
  useEffect(() => {
    setNote(selected?.note || '');
  }, [selected?.id, selected?.note]);
  useEffect(() => {
    if (importStatus?.state !== 'running') {
      return;
    }
    const timer = setInterval(() => {
      void nativeCall<any>('getImportStatus')
        .then(result => {
          setImportStatus(result);
          if (result.state !== 'running') {
            void refresh();
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [importStatus?.state, refresh]);

  const openRun = useCallback(
    (id: string) => {
      void action(async () => {
        setSelected(await native.run(id));
        setMoreDetails(false);
      });
    },
    [action],
  );
  const openPage = (next: Page) => {
    setPage(next);
    if (next === 'muscle-map') {
      setNow(Date.now());
    }
    if (next === 'profile') {
      setGoalInput(settings.goal || '');
      setMinuteInput(String(settings.minutes || 30));
    }
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    setPage('main');
    setSelected(null);
    setError('');
    setMessage('');
  };

  // ── Krafttraining ────────────────────────────────────────────────────────
  // Jede Änderung schreibt die laufende Einheit sofort weg, damit ein Absturz
  // oder ein leerer Akku keine bestätigten Sätze verliert (T-4).
  const persistSession = useCallback((next: StrengthSession) => {
    setStrength(current => ({ ...current, active: next }));
    void native.saveStrengthSession(next).catch(e => setError(e.message));
  }, []);
  const changeSession = useCallback(
    (change: (session: StrengthSession) => StrengthSession) => {
      const active = strengthRef.current.active;
      if (active) {
        persistSession(change(active));
      }
    },
    [persistSession],
  );
  const loadRecentSessions = useCallback(async (state: StrengthState) => {
    const recent = [...state.history]
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 5);
    const loaded = await Promise.all(
      recent.map(entry => native.strengthSession(entry.id).catch(() => null)),
    );
    setRecentSessions(loaded.filter(Boolean) as StrengthSession[]);
  }, []);
  const startStrength = (template: WorkoutTemplate | null) => {
    if (strengthRef.current.active) {
      setWorkoutOpen(true);
      return;
    }
    void action(async () => {
      const session = startSession(template, Date.now());
      setStrength(current => ({ ...current, active: session }));
      setWorkoutOpen(true);
      setNow(Date.now());
      await loadRecentSessions(strengthRef.current);
      await native.saveStrengthSession(session);
    });
  };
  const finishStrength = () => {
    const active = strengthRef.current.active;
    if (!active) {
      return;
    }
    const finished = finishSession(active, Date.now());
    void action(async () => {
      const next = await native.finishStrengthSession(finished);
      setStrength(next);
      setStrengthSessions(await native.strengthSessions().catch(() => []));
      setWorkoutOpen(false);
      setMessage('Training gespeichert.');
    });
  };
  // Pläne bleiben Nutzerartefakte: geschrieben wird nur, was der Nutzer hier
  // ausdrücklich bestätigt hat (T-6).
  const persistTemplates = (next: WorkoutTemplate[]) => {
    setStrength(current => ({ ...current, templates: next }));
    void native.saveStrengthTemplates(next).catch(e => setError(e.message));
  };
  const todaysTemplate = templateForDay(
    strength.templates,
    new Date().getDay(),
  );
  const start = () => {
    void action(async () => {
      const permissions = await nativeCall<{ locationPermission: boolean }>(
        'requestRecordingPermissions',
      );
      if (!permissions.locationPermission) {
        throw new Error(
          'Für die Streckenaufzeichnung fehlt die genaue Standortfreigabe. Du kannst sie in den Android-App-Einstellungen ändern.',
        );
      }
      await nativeCall('startRun', purpose);
      await refresh();
      setTab('Heute');
      setSelected(null);
    });
  };
  const stop = () =>
    Alert.alert(
      'Lauf beenden?',
      'Deine bisherige Aufzeichnung wird gespeichert. Du kannst danach noch dein Laufgefühl ergänzen.',
      [
        { text: 'Weiterlaufen', style: 'cancel' },
        {
          text: 'Beenden & speichern',
          onPress: () => {
            void action(async () => {
              const id = recording?.id;
              await nativeCall('finishRun');
              const next = await refresh();
              if (id) {
                setSelected(await native.run(id));
              } else if (next.runs[0]) {
                setSelected(await native.run(next.runs[0].id));
              }
            });
          },
        },
      ],
    );
  const updateFeedback = (patch: any) => {
    if (!selected) {
      return;
    }
    const id = selected.id;
    void action(async () => {
      await native.feedback(id, patch);
      setSelected(await native.run(id));
      await refresh();
    });
  };
  const accept = (recommendation: Recommendation) => {
    void action(async () => {
      const next = acceptRecommendation(recommendation, Date.now(), experiment);
      await persist({ experiments: [...(settings.experiments || []), next] });
      setTab('Fokus');
      setSelected(null);
    });
  };
  const changeExperiment = (status: ExperimentStatus) => {
    if (!experiment) {
      return;
    }
    void action(async () => {
      const updated = transitionExperiment(
        experiment,
        status,
        Date.now(),
        'Vom Nutzer geändert',
      );
      await persist({
        experiments: settings.experiments?.map(e =>
          e.id === updated.id ? updated : e,
        ),
      });
    });
  };
  const beginImport = (stayOnPage: boolean) => {
    void action(async () => {
      if (!stayOnPage) {
        setPage('data');
        setTab('Mehr');
      }
      const timer = setInterval(() => {
        nativeCall<any>('getImportStatus')
          .then(setImportStatus)
          .catch(() => {});
      }, 700);
      try {
        const result = await nativeCall<any>('importFiles');
        setImportStatus(result.cancelled ? null : result);
        await refresh();
      } finally {
        clearInterval(timer);
      }
    });
  };
  const runImport = () => beginImport(false);
  const runVendorImport = () => beginImport(true);
  const cancelImport = () => {
    void nativeCall<any>('cancelImport')
      .then(setImportStatus)
      .catch(e => setError(e.message));
  };
  const importSummary = importStatus
    ? `Importiert: ${importStatus.imported ?? 0} · Doppelt: ${
        importStatus.duplicates ?? 0
      } · Übersprungen: ${importStatus.skipped ?? 0} · Fehlgeschlagen: ${
        importStatus.failed ?? 0
      } · Kontextwerte: ${importStatus.wellness ?? 0} · Krafteinheiten: ${
        importStatus.strength ?? 0
      }`
    : '';
  const snapshot = selected ? analyzeRun(selected, experiment) : null;
  // Full hold-out/stability validation currently takes seconds to minutes.
  // Keep predictions locked until a validated result can be produced off the
  // UI thread and bound to the exact data/model version (model spec §11).
  const freshnessValues = useMemo(
    () => Object.fromEntries(allRegionIds().map(id => [id, null])) as Record<RegionId, null>,
    [],
  );
  const sorenessValues = useMemo(() => {
    const latest = [...sorenessReports].sort((a, b) => b.at - a.at)[0];
    const byId = new Map(
      latest?.entries.map(entry => [entry.regionId, entry.value]) ?? [],
    );
    return allRegionIds().reduce((values, id) => {
      values[id] = byId.get(id) ?? null;
      return values;
    }, {} as Record<RegionId, number | null>);
  }, [sorenessReports]);
  const openSorenessCapture = () => {
    setNow(Date.now());
    setSorenessOpen(true);
  };
  const transcribeSoreness = async () => {
    const capabilities = await native.requestSorenessVoicePermissions();
    setState(current => ({ ...current, capabilities }));
    if (!capabilities.microphonePermission) {
      throw new Error(
        'Für die Spracheingabe fehlt die Mikrofonfreigabe. Tippen funktioniert unverändert.',
      );
    }
    if (!capabilities.speechRecognition) {
      throw new Error('Auf diesem Gerät ist keine Spracherkennung verfügbar.');
    }
    return native.transcribeSoreness();
  };
  const saveSoreness = (report: CapturedSorenessReport) => {
    void action(async () => {
      const next = await native.saveSorenessReport(report);
      setSorenessReports(next);
      setSorenessOpen(false);
      setMessage('Muskelkatermeldung gespeichert.');
    });
  };

  const renderHome = () => (
    <>
      <Text style={styles.title}>Dein nächster Lauf</Text>
      <Copy muted>{date(Date.now())}</Copy>
      <View style={styles.plan}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Trainingszweck ändern"
          onPress={() => setPurposePicker(true)}
          style={styles.planPurpose}
        >
          <Text style={styles.planTitle}>{purposeLabel(purpose)}</Text>
          <Text style={styles.arrow}>⌄</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => openPage('profile')}
        >
          <Text style={styles.planTime}>
            {settings.minutes || 30}{' '}
            <Text style={styles.planTimeUnit}>Minuten eingeplant</Text>
          </Text>
        </Pressable>
        {experiment?.status === 'active' ? (
          <Copy>{experiment.recommendation.action}</Copy>
        ) : (
          <Copy muted>
            {purpose === 'free'
              ? 'Starte einfach. Deinen Trainingszweck kannst du später ergänzen.'
              : purposes.find(p => p.value === purpose)?.description}
          </Copy>
        )}
        {settings.postponedUntil && settings.postponedUntil > Date.now() ? (
          <Copy muted>
            Auf morgen verschoben. Du kannst trotzdem jederzeit starten.
          </Copy>
        ) : null}
        <Button title="Lauf starten" onPress={start} disabled={busy} />
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            save({ postponedUntil: Date.now() + 24 * 3600 * 1000 })
          }
          style={styles.textButton}
        >
          <Text style={styles.muted}>Passt heute nicht</Text>
        </Pressable>
      </View>
      <Section title="Krafttraining">
        {strength.active ? (
          <>
            <Copy muted>
              {strength.active.name} läuft seit{' '}
              {Math.max(
                1,
                Math.round((Date.now() - strength.active.startTime) / 60000),
              )}{' '}
              Minuten.
            </Copy>
            <Button
              title="Training fortsetzen"
              onPress={() => {
                setNow(Date.now());
                setWorkoutOpen(true);
              }}
            />
          </>
        ) : (
          <>
            <Copy muted>
              {todaysTemplate
                ? `Für heute ist ${todaysTemplate.name} vorgesehen. Du kannst auch etwas anderes machen.`
                : 'Kein Plan für heute hinterlegt. Du kannst frei trainieren und Übungen unterwegs hinzufügen.'}
            </Copy>
            <Button
              disabled={busy}
              title={
                todaysTemplate
                  ? `${todaysTemplate.name} starten`
                  : 'Freies Training starten'
              }
              onPress={() => startStrength(todaysTemplate)}
            />
            {todaysTemplate ? (
              <Button
                secondary
                small
                title="Stattdessen frei trainieren"
                onPress={() => startStrength(null)}
              />
            ) : null}
            <Row
              title="Trainingspläne"
              subtitle="Vorlagen anlegen, ändern und starten"
              onPress={() => openPage('plans')}
            />
            <Row
              title="Kraft-Historie"
              subtitle="Erfasste Einheiten, Sätze und Volumen"
              onPress={() => openPage('strength-history')}
            />
            <Row
              title="Muskelkarte"
              subtitle="Gemeldeten Muskelkater und gerechnete Frische ansehen"
              onPress={() => openPage('muscle-map')}
            />
          </>
        )}
      </Section>
      {experiment ? (
        <Section title="Dein Arbeitsthema">
          <Row
            title={experiment.recommendation.title}
            subtitle={
              experiment.status === 'paused'
                ? 'Pausiert'
                : experiment.recommendation.action
            }
            onPress={() => switchTab('Fokus')}
          />
        </Section>
      ) : null}
      {latest ? (
        <Section title="Nach deinem letzten Lauf">
          <Copy>{latest.analysis.classification}</Copy>
          <Row
            title={purposeLabel(latest.run.purpose)}
            subtitle={`${distance(latest.run)} km · ${date(
              latest.run.startTime,
            )}`}
            onPress={() => openRun(latest.run.id)}
          />
        </Section>
      ) : (
        <Section title="Deine Läufe, auf deinem Gerät">
          <Copy muted>
            Zeichne deinen ersten Lauf auf oder nimm deine bisherige Historie
            mit. Eine Uhr und ein Konto brauchst du dafür nicht.
          </Copy>
          <Button
            secondary
            title="Läufe importieren"
            onPress={runImport}
            disabled={busy}
          />
        </Section>
      )}
      {settings.presets?.length ? (
        <Section title="Gespeicherte Läufe">
          {settings.presets.map(p => (
            <Row
              key={p.id}
              title={p.name}
              subtitle={`${purposeLabel(p.purpose)} · ${p.minutes} Minuten`}
              onPress={() =>
                save({ purpose: p.purpose, minutes: p.minutes, cues: p.cues })
              }
            />
          ))}
        </Section>
      ) : null}
    </>
  );

  const renderRecording = () =>
    recording ? (
      <>
        <View style={styles.recordingHeader}>
          <Text style={styles.title}>
            {recording.status === 'recording'
              ? 'Lauf läuft'
              : recording.status === 'paused'
              ? 'Lauf pausiert'
              : 'Lauf unterbrochen'}
          </Text>
          <Copy muted>{purposeLabel(recording.purpose)}</Copy>
        </View>
        <View style={styles.bigMetric}>
          <Stat
            large
            value={duration(recording.durationSeconds)}
            label="Laufzeit"
          />
        </View>
        <View style={styles.metrics}>
          <Stat value={distance(recording)} label="Kilometer" />
          <Stat value={pace(recording)} label="Ø min / km" />
        </View>
        {settings.showHeartRate ? (
          <Row
            title="Herzfrequenz"
            trailing={
              <Copy>
                {recording.avgHeartRate
                  ? `${Math.round(recording.avgHeartRate)} bpm`
                  : 'Keine Daten'}
              </Copy>
            }
          />
        ) : null}
        <Copy muted>
          {recording.distanceMeters > 0
            ? 'GPS-Strecke wird lokal gespeichert.'
            : 'Noch keine Strecke gemessen. Für ein GPS-Signal nach draußen gehen.'}
        </Copy>
        {recording.status === 'interrupted' ? (
          <Copy>
            Die Aufzeichnung wurde unterbrochen. Die Lücke bleibt in deinen
            Daten erkennbar.
          </Copy>
        ) : null}
        {experiment?.status === 'active' ? (
          <Section title="Für diesen Lauf">
            <Copy>{experiment.recommendation.action}</Copy>
          </Section>
        ) : null}
        <View style={styles.recordingActions}>
          <Button
            title={recording.status === 'recording' ? 'Pause' : 'Fortsetzen'}
            disabled={busy}
            onPress={() => {
              void action(async () => {
                await nativeCall(
                  recording.status === 'recording' ? 'pauseRun' : 'resumeRun',
                );
                await refresh();
              });
            }}
          />
          <Button
            secondary
            title="Lauf beenden"
            onPress={stop}
            disabled={busy}
          />
        </View>
        <Copy muted>
          Du kannst das Display sperren. Runback zeichnet im Hintergrund weiter
          auf.
        </Copy>
      </>
    ) : null;

  const renderRecommendation = (recommendation: Recommendation) => (
    <>
      <Text style={styles.subTitle}>{recommendation.title}</Text>
      <Copy>{recommendation.action}</Copy>
      <Copy muted>{recommendation.reason}</Copy>
      <Section title="Vorher festgelegte Prüfung">
        <Copy>{recommendation.goal}</Copy>
        <Copy muted>
          Vergleich mit {recommendation.criteria.baselineRunIds.length}{' '}
          Ausgangslauf. Mindestens {recommendation.criteria.minimumObservations}{' '}
          geeignete Läufe über {recommendation.criteria.minimumDays} Tage.
          Relevante Änderung:{' '}
          {recommendation.criteria.minimumRelevantChangePercentPoints}{' '}
          Prozentpunkte weniger Tempoabfall.
        </Copy>
        <Copy muted>
          Umfang und Trainingszweck bleiben erhalten. Ein besseres Ergebnis
          allein belegt noch keine Ursache.
        </Copy>
      </Section>
      <Button
        title="Arbeitsthema annehmen"
        onPress={() => accept(recommendation)}
        disabled={busy}
      />
      <Button
        secondary
        title="Später entscheiden"
        onPress={() => {
          setMessage('Der Vorschlag bleibt im Fokus verfügbar.');
          setTab('Heute');
        }}
      />
      <Button
        secondary
        title="Vorschlag ablehnen"
        onPress={() =>
          save({
            dismissedRecommendations: [
              ...(settings.dismissedRecommendations || []),
              recommendation.id,
            ],
          })
        }
      />
    </>
  );

  const renderFocus = () => {
    const evaluation = experiment
      ? evaluateExperiment(experiment, runs, settings.adherence)
      : null;
    return (
      <>
        <Text style={styles.title}>Dein Fokus</Text>
        <Copy muted>Eine Änderung. Eine nachvollziehbare Prüfung.</Copy>
        {experiment ? (
          <Section title={experiment.recommendation.title}>
            <Copy>{experiment.recommendation.action}</Copy>
            <Copy muted>
              {experiment.status === 'paused'
                ? 'Dieser Versuch ist pausiert.'
                : `Aktiv seit ${date(experiment.acceptedAt)}`}
            </Copy>
            <Section title="Bisheriges Ergebnis">
              <Copy>{evaluation?.summary}</Copy>
              <Copy muted>
                {evaluation?.eligibleRunIds.length || 0} geeignete Folgeläufe ·
                Umsetzung wird separat geprüft
              </Copy>
            </Section>
            <Section title="So wird geprüft">
              <Copy>{experiment.recommendation.goal}</Copy>
              <Copy muted>
                {experiment.recommendation.criteria.minimumObservations}{' '}
                geeignete Läufe, mindestens{' '}
                {experiment.recommendation.criteria.minimumDays} Tage.
                Mindeständerung:{' '}
                {
                  experiment.recommendation.criteria
                    .minimumRelevantChangePercentPoints
                }{' '}
                Prozentpunkte.
              </Copy>
              {experiment.recommendation.criteria.exclusions.map((text, i) => (
                <Copy muted key={i}>
                  {text}
                </Copy>
              ))}
            </Section>
            <Button
              secondary
              title={
                experiment.status === 'paused'
                  ? 'Versuch fortsetzen'
                  : 'Versuch pausieren'
              }
              onPress={() =>
                changeExperiment(
                  experiment.status === 'paused' ? 'active' : 'paused',
                )
              }
            />
            <Button
              secondary
              title="Versuch abschließen"
              onPress={() => changeExperiment('completed')}
            />
            <Button
              secondary
              title="Versuch abbrechen"
              onPress={() =>
                Alert.alert(
                  'Versuch abbrechen?',
                  'Die bisherige Prüfung bleibt gespeichert.',
                  [
                    { text: 'Zurück', style: 'cancel' },
                    {
                      text: 'Abbrechen',
                      onPress: () => changeExperiment('aborted'),
                    },
                  ],
                )
              }
            />
          </Section>
        ) : candidate ? (
          <Section title="Ein möglicher nächster Schritt">
            {renderRecommendation(candidate)}
          </Section>
        ) : (
          <Section title="Noch kein Arbeitsthema">
            <Copy>
              {latest?.analysis.nextAction ||
                'Nach deinem ersten Lauf ordnet Runback die vorhandenen Daten ein. Eine Änderung wird nur vorgeschlagen, wenn sie begründbar und prüfbar ist.'}
            </Copy>
            <Button
              secondary
              title="Zum nächsten Lauf"
              onPress={() => switchTab('Heute')}
            />
          </Section>
        )}
        {settings.experiments?.filter(
          e => e.status === 'completed' || e.status === 'aborted',
        ).length ? (
          <Section title="Frühere Versuche">
            {settings.experiments
              .filter(e => e.status === 'completed' || e.status === 'aborted')
              .map(e => (
                <Row
                  key={e.id}
                  title={e.recommendation.title}
                  subtitle={`${
                    e.status === 'completed' ? 'Abgeschlossen' : 'Abgebrochen'
                  } · ${
                    evaluateExperiment(e, runs, settings.adherence).summary
                  }`}
                />
              ))}
          </Section>
        ) : null}
      </>
    );
  };

  const renderRpe = (field: 'legs' | 'breathing', label: string) => (
    <View style={styles.rpeGroup}>
      <Text style={styles.fieldLabel}>
        {label}
        {selected?.rpe?.[field]
          ? ` · ${selected.rpe[field]} / 10`
          : ' · Nicht angegeben'}
      </Text>
      <View style={styles.rpeGrid}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(value => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${value} von 10`}
            accessibilityState={{
              selected: selected?.rpe?.[field] === value,
              disabled: busy,
            }}
            disabled={busy}
            onPress={() =>
              updateFeedback({
                rpe: {
                  ...selected?.rpe,
                  [field]: value,
                  recordedAt: Date.now(),
                },
              })
            }
            style={[
              styles.rpe,
              selected?.rpe?.[field] === value && styles.rpeSelected,
            ]}
          >
            <Text
              style={[
                styles.rpeText,
                selected?.rpe?.[field] === value && styles.rpeTextSelected,
              ]}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.runTop}>
        <Text style={styles.smallMuted}>1 · sehr leicht</Text>
        <Text style={styles.smallMuted}>10 · maximal</Text>
      </View>
    </View>
  );

  const renderDetail = () =>
    selected && snapshot ? (
      <>
        <Text style={styles.title}>{purposeLabel(selected.purpose)}</Text>
        <Copy muted>{date(selected.startTime)}</Copy>
        <View style={styles.metrics}>
          <Stat value={distance(selected)} label="Kilometer" />
          <Stat value={duration(selected.durationSeconds)} label="Laufzeit" />
          <Stat value={pace(selected)} label="Ø min / km" />
        </View>
        <View style={styles.feedbackSlot}>
          <Text style={styles.slotTitle}>Einordnung</Text>
          <Copy>{snapshot.classification}</Copy>
        </View>
        <View style={styles.feedbackSlot}>
          <Text style={styles.slotTitle}>Wichtig für dich</Text>
          <Copy>{snapshot.focus}</Copy>
        </View>
        <View style={styles.feedbackSlot}>
          <Text style={styles.slotTitle}>Nächster Schritt</Text>
          <Copy>{snapshot.nextAction}</Copy>
          {snapshot.recommendation && !experiment ? (
            <Button
              secondary
              title="Vorschlag ansehen"
              onPress={() => {
                setSelected(null);
                setTab('Fokus');
              }}
            />
          ) : null}
        </View>
        <Section title="Wie hat es sich angefühlt?">
          <Copy muted>Freiwillig. Jede Bewertung wird direkt gespeichert.</Copy>
          {renderRpe('legs', 'Beine')}
          {renderRpe('breathing', 'Atmung')}
          <Text style={styles.fieldLabel}>Notiz</Text>
          <TextInput
            accessibilityLabel="Notiz zum Lauf"
            multiline
            value={note}
            onChangeText={setNote}
            placeholder="Was möchtest du festhalten?"
            placeholderTextColor={color.muted}
            style={[styles.input, styles.note]}
            selectionColor={color.green}
          />
          <Button
            secondary
            small
            title="Notiz speichern"
            onPress={() => updateFeedback({ note })}
            disabled={busy}
          />
        </Section>
        {experiment && selected.startTime > experiment.acceptedAt ? (
          <Section title="Hast du die Änderung umgesetzt?">
            <View style={styles.choiceRow}>
              {(
                [
                  { value: 'yes', label: 'Ja' },
                  { value: 'no', label: 'Nein' },
                  { value: 'unknown', label: 'Unklar' },
                ] as const
              ).map(option => (
                <View key={option.value} style={styles.flex}>
                  <Button
                    small
                    secondary={
                      settings.adherence?.[selected.id] !== option.value
                    }
                    title={option.label}
                    onPress={() =>
                      save({
                        adherence: {
                          ...settings.adherence,
                          [selected.id]: option.value,
                        },
                      })
                    }
                  />
                </View>
              ))}
            </View>
          </Section>
        ) : null}
        {snapshot.question ? (
          <Section title={snapshot.question.text}>
            <Copy muted>{snapshot.question.reason}</Copy>
            <Button
              secondary
              title="Ja, es waren Intervalle"
              onPress={() => updateFeedback({ purpose: 'intervals' })}
            />
            <Button
              secondary
              title="Trainingszweck wählen"
              onPress={() => setPurposePicker(true)}
            />
          </Section>
        ) : null}
        <Section title="Strecke">
          <Route points={selected.route || []} />
          <Copy muted>Vereinfachte GPS-Geometrie. Keine Hintergrundkarte.</Copy>
        </Section>
        <Button
          secondary
          title={
            moreDetails ? 'Details schließen' : 'Daten & Auswertung ansehen'
          }
          onPress={() => setMoreDetails(v => !v)}
        />
        {moreDetails ? (
          <>
            <Section title="Datenqualität">
              {snapshot.quality.issues.length ? (
                snapshot.quality.issues.map((issue, i) => (
                  <Copy muted key={i}>
                    {issue.suspected ? 'Hinweis: ' : ''}
                    {issue.message}
                  </Copy>
                ))
              ) : (
                <Copy muted>
                  Keine Auffälligkeit in den verfügbaren Prüfungen erkannt.
                </Copy>
              )}
              <Row title="Quelle" subtitle={selected.source} />
              <Row
                title="Originalsamples"
                subtitle={`${
                  selected.samples || 0
                } gespeichert; verbleiben im nativen Speicher`}
              />
              <Button
                secondary
                title="Trainingszweck korrigieren"
                onPress={() => setPurposePicker(true)}
              />
            </Section>
            <Section title="Modellierte Anforderung">
              <Copy>
                {snapshot.effort.speedIndex === undefined
                  ? 'Nicht bestimmbar'
                  : `${number(snapshot.effort.speedIndex, 0)} · Tempoindex`}
              </Copy>
              <Copy muted>Schätzung · {snapshot.effort.unit}</Copy>
              <Copy muted>{snapshot.effort.uncertainty}</Copy>
              {Object.entries(snapshot.effort.factors).map(([key, value]) => (
                <Row
                  key={key}
                  title={
                    (
                      {
                        tempo: 'Tempo',
                        slope: 'Steigung',
                        wind: 'Wind',
                        heat: 'Wärme',
                      } as Record<string, string>
                    )[key] || key
                  }
                  subtitle={value}
                />
              ))}
              <Copy muted>Modell: {snapshot.model_version}</Copy>
              <Copy muted>
                Grundlage:{' '}
                {snapshot.inputSources
                  .map(input => `${input.source} · ${input.version}`)
                  .join(', ')}
              </Copy>
            </Section>
            {selected.segments?.length ? (
              <Section title="Abschnitte">
                {selected.segments.map((segment, i) => (
                  <Row
                    key={segment.id || i}
                    title={`Abschnitt ${i + 1}`}
                    subtitle={`${number(
                      segment.distanceMeters / 1000,
                      2,
                    )} km · ${duration(segment.durationSeconds)}${
                      segment.avgHeartRate
                        ? ` · ${Math.round(segment.avgHeartRate)} bpm`
                        : ''
                    }`}
                  />
                ))}
              </Section>
            ) : null}
            <ProseExplanation analysis={snapshot} />
            <RunIntegrations
              id={selected.id}
              weatherEnabled={Boolean(settings.weatherEnabled)}
            />
            <Section title="Diesen Lauf verwalten">
              <Button
                secondary
                title="Als GPX exportieren"
                onPress={() => {
                  void action(async () => {
                    await nativeCall('exportRun', selected.id, 'gpx');
                  });
                }}
              />
              <Button
                secondary
                title="Lauf löschen"
                onPress={() =>
                  Alert.alert(
                    'Diesen Lauf löschen?',
                    'Originaldaten und Feedback dieses Laufs werden dauerhaft entfernt. Bereits gespeicherte Prüfbedingungen bleiben erhalten.',
                    [
                      { text: 'Behalten', style: 'cancel' },
                      {
                        text: 'Löschen',
                        style: 'destructive',
                        onPress: () => {
                          void action(async () => {
                            await nativeCall('deleteRun', selected.id);
                            setSelected(null);
                            await refresh();
                          });
                        },
                      },
                    ],
                  )
                }
              />
            </Section>
          </>
        ) : null}
      </>
    ) : null;

  const toggle = (value: boolean, onValueChange: (value: boolean) => void) => (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: color.line, true: color.green }}
      thumbColor={value ? color.ink : color.muted}
    />
  );
  const renderMore = () => (
    <>
      <Text style={styles.title}>Mehr</Text>
      <Copy muted>Runback passt sich deinem Lauf an.</Copy>
      <Section title="Dein Training">
        <Row
          title="Statistik"
          subtitle="Wochenumfang, Tempo und Laufgefühl"
          onPress={() => openPage('statistics')}
        />
        <Row
          title="Trainingspläne"
          subtitle="Vorlagen für dein Krafttraining"
          onPress={() => openPage('plans')}
        />
        <Row
          title="Kraft-Historie"
          subtitle="Erfasste Einheiten, Sätze und Volumen"
          onPress={() => openPage('strength-history')}
        />
        <Row
          title="Muskelkarte"
          subtitle="Gemeldeten Muskelkater und gerechnete Frische ansehen"
          onPress={() => openPage('muscle-map')}
        />
        <Row
          title="Trainingschat"
          subtitle="Fragen stellen und deine Läufe verstehen"
          onPress={() => openPage('chat')}
        />
      </Section>
      <Section title="Deine Einstellungen">
        <Row
          title="Einrichtung"
          subtitle="Ziel festlegen und Historie importieren"
          onPress={() => setSetupOpen(true)}
        />
        <Row
          title="Ziel & Alltag"
          subtitle="Trainingszweck, Zeit und Lauftage"
          onPress={() => openPage('profile')}
        />
        <Row
          title="Geräte & Verbindungen"
          subtitle="Telefon, Uhr und optionale Datenquellen"
          onPress={() => openPage('devices')}
        />
        <Row
          title="Laufvorlagen"
          subtitle="Wiederkehrende Einstellungen speichern"
          onPress={() => openPage('presets')}
        />
        <Row
          title="Daten & Speicher"
          subtitle="Import, Backup, Export und Löschen"
          onPress={() => openPage('data')}
        />
        <Row
          title="Auswertung & Modelle"
          subtitle="Grundlagen und verfügbare Aussagen"
          onPress={() => openPage('models')}
        />
      </Section>
      <Section title="Während des Laufs">
        <Row
          title="Herzfrequenz anzeigen"
          subtitle="Nur mit vorhandenen Messdaten"
          trailing={toggle(Boolean(settings.showHeartRate), value =>
            save({ showHeartRate: value }),
          )}
        />
      </Section>
      <Section title="Lokal. Ohne Konto.">
        <Copy muted>
          Deine Läufe werden auf diesem Gerät gespeichert. Ein vollständiges
          Backup kannst du selbst exportieren.
        </Copy>
      </Section>
    </>
  );

  const renderProfile = () => (
    <>
      <Text style={styles.title}>Ziel & Alltag</Text>
      <Section title="Was möchtest du erreichen?">
        <TextInput
          accessibilityLabel="Übergeordnetes Laufziel"
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder="Zum Beispiel: regelmäßig laufen"
          placeholderTextColor={color.muted}
          style={styles.input}
          selectionColor={color.green}
        />
      </Section>
      <Section title="Zeit für den nächsten Lauf">
        <View style={styles.timeInput}>
          <TextInput
            accessibilityLabel="Zeitbudget in Minuten"
            keyboardType="number-pad"
            maxLength={3}
            value={minuteInput}
            onChangeText={setMinuteInput}
            style={[styles.input, styles.flex]}
            selectionColor={color.green}
          />
          <Copy muted>Minuten</Copy>
        </View>
      </Section>
      <Section title="Mögliche Lauftage">
        <View style={styles.choiceRow}>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day, i) => (
            <Pressable
              key={day}
              accessibilityRole="checkbox"
              accessibilityLabel={day}
              accessibilityState={{
                checked: settings.trainingDays?.includes(i) || false,
              }}
              onPress={() =>
                save({
                  trainingDays: settings.trainingDays?.includes(i)
                    ? settings.trainingDays.filter(d => d !== i)
                    : [...(settings.trainingDays || []), i],
                })
              }
              style={[
                styles.day,
                settings.trainingDays?.includes(i) && styles.rpeSelected,
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  settings.trainingDays?.includes(i) && styles.rpeTextSelected,
                ]}
              >
                {day}
              </Text>
            </Pressable>
          ))}
        </View>
        <Copy muted>
          Verpasste Läufe werden nicht zu zusätzlicher Belastung zusammengelegt.
        </Copy>
      </Section>
      <Section title="Trainingszweck">
        <Button
          secondary
          title={purposeLabel(purpose)}
          onPress={() => setPurposePicker(true)}
        />
      </Section>
      <View style={styles.sectionGap}>
        <Button
          title="Einstellungen speichern"
          onPress={() => {
            const minutes = Number(minuteInput);
            if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) {
              setError(
                'Bitte ein Zeitbudget zwischen 5 und 600 Minuten eingeben.',
              );
              return;
            }
            void action(async () => {
              await persist({ goal: goalInput.trim(), minutes });
              setPage('main');
              setMessage('Ziel und Zeitbudget gespeichert.');
            });
          }}
        />
      </View>
    </>
  );

  const renderDevices = () => (
    <DeviceSettings
      capabilities={state.capabilities}
      settings={settings}
      save={save}
      refresh={refresh}
    />
  );
  const renderData = () => (
    <>
      <Text style={styles.title}>Daten & Speicher</Text>
      <Section title="App-Importe">
        <Copy muted>
          Fitbit, Google Fit, Strong, Mi Fitness, Apple Health, Samsung, Garmin
          und mehr: Export dort sichern, hier importieren. Alles optional.
        </Copy>
        <Button
          title="App-Importe öffnen"
          onPress={() => openPage('vendor-import')}
        />
      </Section>
      <Section title="Historie mitnehmen">
        <Copy muted>
          FIT, GPX, TCX oder ein Strava-Export als ZIP. Bereits vorhandene Läufe
          werden erkannt.
        </Copy>
        <Button
          title="Dateien importieren"
          onPress={runImport}
          disabled={busy}
        />
        {importStatus ? (
          <>
            <Copy>{importSummary}</Copy>
            {importStatus.state === 'running' ? (
              <Button
                secondary
                title="Import abbrechen"
                onPress={() => {
                  nativeCall<any>('cancelImport')
                    .then(setImportStatus)
                    .catch(e => setError(e.message));
                }}
              />
            ) : null}
            {(importStatus.errors || [])
              .slice(0, 20)
              .map((item: any, i: number) => (
                <Copy muted key={i}>
                  {typeof item === 'string'
                    ? item
                    : item.reason || item.message || JSON.stringify(item)}
                </Copy>
              ))}
          </>
        ) : null}
      </Section>
      <Section title="Vollständiges Backup">
        <Copy muted>
          Sichere alle erhaltenen Originaldaten und Einstellungen. Schlüssel
          gehören nicht ins Backup.
        </Copy>
        <Button
          secondary
          title="Backup exportieren"
          disabled={busy}
          onPress={() => {
            void action(async () => {
              const result = await nativeCall<any>('exportBackup');
              if (!result.cancelled) {
                setMessage('Backup exportiert.');
              }
            });
          }}
        />
        <Button
          secondary
          title="Backup wiederherstellen"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              'Backup wiederherstellen?',
              'Wähle ein Runback-Backup. Bereits vorhandene Läufe bleiben erhalten und werden nicht doppelt angelegt.',
              [
                { text: 'Zurück', style: 'cancel' },
                {
                  text: 'Backup wählen',
                  onPress: () => {
                    void action(async () => {
                      const result = await nativeCall<any>('restoreBackup');
                      await refresh();
                      if (!result.cancelled) {
                        setMessage(
                          result.message || 'Backup wiederhergestellt.',
                        );
                      }
                    });
                  },
                },
              ],
            )
          }
        />
      </Section>
      <Section title="Aufbewahrung">
        <Copy muted>
          Originaldaten bleiben bis zu deinem ausdrücklichen Löschen erhalten.
          Der verfügbare Gerätespeicher begrenzt die Aufzeichnung. Sichere deine
          Daten regelmäßig.
        </Copy>
        <Row title="Gespeicherte Läufe" subtitle={`${runs.length}`} />
      </Section>
      <Section title="Daten löschen">
        <Button
          secondary
          title="Alle lokalen Daten löschen"
          onPress={() =>
            Alert.alert(
              'Alle lokalen Daten löschen?',
              'Alle Läufe, Originaldaten, Notizen und Einstellungen auf diesem Telefon werden dauerhaft gelöscht. Exportiere vorher ein Backup, wenn du sie behalten möchtest.',
              [
                { text: 'Behalten', style: 'cancel' },
                {
                  text: 'Alles löschen',
                  style: 'destructive',
                  onPress: () => {
                    void action(async () => {
                      await nativeCall('clearAllData');
                      await refresh();
                      setPage('main');
                      setMessage('Lokale Daten gelöscht.');
                    });
                  },
                },
              ],
            )
          }
        />
      </Section>
    </>
  );

  const renderVendorImport = () => (
    <VendorImport
      busy={busy}
      importStatus={importStatus}
      onImport={runVendorImport}
      onCancelImport={cancelImport}
    />
  );

  const renderPresets = () => (
    <>
      <Text style={styles.title}>Laufvorlagen</Text>
      <Copy muted>
        Speichere Trainingszweck und Zeitbudget für den nächsten Start.
      </Copy>
      <Section title="Aktuelle Einstellung speichern">
        <Copy>
          {purposeLabel(purpose)} · {settings.minutes || 30} Minuten
        </Copy>
        <TextInput
          accessibilityLabel="Name der Laufvorlage"
          value={presetName}
          onChangeText={setPresetName}
          placeholder="Zum Beispiel: Feierabendrunde"
          placeholderTextColor={color.muted}
          style={styles.input}
        />
        <Button
          title="Vorlage speichern"
          disabled={!presetName.trim() || busy}
          onPress={() => {
            const preset: Preset = {
              id: `preset-${Date.now()}`,
              name: presetName.trim(),
              purpose,
              minutes: settings.minutes || 30,
              cues: Boolean(settings.cues),
            };
            void action(async () => {
              await persist({ presets: [...(settings.presets || []), preset] });
              setPresetName('');
            });
          }}
        />
      </Section>
      <Section title="Deine Vorlagen">
        {settings.presets?.length ? (
          settings.presets.map(p => (
            <View key={p.id}>
              <Row
                title={p.name}
                subtitle={`${purposeLabel(p.purpose)} · ${p.minutes} Minuten`}
                onPress={() => {
                  void action(async () => {
                    await persist({
                      purpose: p.purpose,
                      minutes: p.minutes,
                      cues: p.cues,
                    });
                    setPage('main');
                    setTab('Heute');
                  });
                }}
              />
              <Pressable
                accessibilityRole="button"
                style={styles.textButton}
                onPress={() =>
                  save({
                    presets: settings.presets?.filter(item => item.id !== p.id),
                  })
                }
              >
                <Text style={styles.muted}>Vorlage entfernen</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Copy muted>Noch keine Vorlage gespeichert.</Copy>
        )}
      </Section>
    </>
  );

  const renderStrengthHistory = () => {
    const sessions = [...strengthSessions]
      .filter(session => session.status === 'finished')
      .sort(
        (a, b) =>
          (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime) ||
          b.id.localeCompare(a.id),
      );
    return (
      <>
        <Text style={styles.title}>Kraft-Historie</Text>
        <Copy muted>
          Hier bleibt sichtbar, was du tatsächlich erfasst hast. Planwerte und
          tatsächliche Sätze werden getrennt gehalten.
        </Copy>
        {sessions.length ? (
          sessions.map(session => {
            const summary = summarize(session);
            return (
              <View key={session.id} style={styles.historyCard}>
                <Text style={styles.subTitle}>{session.name}</Text>
                <Text style={styles.muted}>{date(session.startTime)}</Text>
                <View style={styles.metrics}>
                  <Stat label="Sätze" value={String(summary.completedSets)} />
                  <Stat
                    label="Volumen"
                    value={`${number(summary.volumeKg, 1)} kg`}
                  />
                </View>
                <Copy muted>
                  {session.exercises
                    .map(
                      exercise => `${exercise.name} (${exercise.sets.length})`,
                    )
                    .join(' · ')}
                </Copy>
              </View>
            );
          })
        ) : (
          <View style={styles.empty}>
            <Text style={styles.subTitle}>Noch keine Kraft-Einheit.</Text>
            <Copy muted>
              Starte ein freies Training oder einen Plan. Jede bestätigte
              Einheit erscheint danach hier.
            </Copy>
            <Button
              title="Zum Krafttraining"
              onPress={() => switchTab('Heute')}
            />
          </View>
        )}
      </>
    );
  };

  const renderMuscleMap = () => {
    const latestReport = [...sorenessReports].sort((a, b) => b.at - a.at)[0];
    return (
      <>
        <Text style={styles.title}>Muskelkarte</Text>
        <Copy muted>
          {muscleMapMode === 'freshness'
            ? 'Frische ist eine gerechnete Größe je Region. 100 bedeutet: keine nachwirkende Belastung im Sinne des Modells — nicht gesund, stark oder bereit.'
            : 'Muskelkater ist deine eigene Angabe je Region auf einer Skala von 0 bis 10. Er ist keine Messung und keine Diagnose.'}
        </Copy>
        <Section
          title={
            muscleMapMode === 'freshness'
              ? 'Gerechnete Frische'
              : 'Gemeldeter Muskelkater'
          }
        >
          <View style={styles.choiceRow}>
            <View style={styles.flex}>
              <Button
                secondary={muscleMapMode !== 'freshness'}
                small
                title="Frische"
                onPress={() => setMuscleMapMode('freshness')}
              />
            </View>
            <View style={styles.flex}>
              <Button
                secondary={muscleMapMode !== 'soreness'}
                small
                title="Gemeldeter Muskelkater"
                onPress={() => setMuscleMapMode('soreness')}
              />
            </View>
          </View>
          <BodyMap
            mode={muscleMapMode}
            values={
              muscleMapMode === 'freshness' ? freshnessValues : sorenessValues
            }
          />
          <Copy muted>
            {muscleMapMode === 'freshness'
              ? 'Noch nicht freigeschaltet. Für persönliche Frischewerte fehlt eine abgeschlossene Modellprüfung; die Regionen bleiben unbekannt.'
              : 'Letzte bestätigte Meldung · Skala 0 bis 10 · keine Messung.'}
          </Copy>
          {muscleMapMode === 'freshness' ? (
            <View style={styles.validationNotice}>
              <Text style={styles.fieldLabel}>Warum noch unbekannt?</Text>
              <Copy muted>
                Die automatische Modellprüfung ist noch nicht verfügbar.
                Deine Muskelkatermeldungen kannst du unabhängig davon erfassen
                und ansehen.
              </Copy>
            </View>
          ) : null}
        </Section>
        <Section title="Deine Meldung">
          <Copy muted>
            {latestReport
              ? `Letzte Meldung: ${date(latestReport.at)} · ${
                  latestReport.nothingToday
                    ? 'heute nichts'
                    : `${latestReport.entries.length} Regionen angegeben`
                }.`
              : 'Noch keine Meldung gespeichert.'}
          </Copy>
          <Button title="Muskelkater melden" onPress={openSorenessCapture} />
        </Section>
        <Copy muted>
          Fehlende oder unsichere Grundlage bleibt auf der Karte unbekannt. Die
          Ansicht ersetzt keine medizinische Einschätzung.
        </Copy>
      </>
    );
  };

  const renderModels = () => (
    <>
      <Text style={styles.title}>Auswertung & Modelle</Text>
      <Section title="Was bereits möglich ist">
        <Copy>
          Basiswerte, Datenqualität und Einordnung des Laufzwecks werden lokal
          aus deinen gespeicherten Daten berechnet.
        </Copy>
        <Copy muted>
          Gemessene Werte, dein Laufgefühl und Modellschätzungen bleiben
          getrennt. Fehlende Sensoren begrenzen nur die betroffenen Aussagen.
        </Copy>
      </Section>
      <Section title="Tempo & Effort">
        <Copy muted>
          Der Tempoindex beschreibt die äußere Anforderung unter den
          dokumentierten Modellannahmen. Er ist keine direkte Messung von
          Fitness, Ermüdung oder Gesundheit.
        </Copy>
      </Section>
      <Section title="Weitergehende Modelle">
        {[
          'Critical Speed & Fitness',
          'Race Simulator & Pacemaker',
          'Persönliche Umweltparameter',
          'Fuel-Plan & Szenarien',
        ].map(title => (
          <Row
            key={title}
            title={title}
            subtitle="Noch nicht für persönliche Empfehlungen freigegeben. Geeignete Daten und eine unabhängige Modellprüfung fehlen."
          />
        ))}
      </Section>
      <Section title="Erklärungen ohne Cloud">
        <Copy muted>
          Die lokalen Regeln entscheiden. Optionale Sprachmodelle sind für
          Aufzeichnung und Auswertung nicht erforderlich.
        </Copy>
      </Section>
      <ProseSettings />
      <Button title="Trainingschat öffnen" onPress={() => openPage('chat')} />
    </>
  );

  const content = selected ? (
    renderDetail()
  ) : page === 'statistics' ? (
    <Statistics runs={runs} />
  ) : page === 'plans' ? (
    <PlanList
      busy={busy}
      onCreate={() =>
        setPlanDraft(createTemplate(Date.now(), '', strength.templates))
      }
      onDelete={id => persistTemplates(deleteTemplate(strength.templates, id))}
      onDuplicate={id =>
        persistTemplates(duplicateTemplate(strength.templates, id, Date.now()))
      }
      onEdit={template => setPlanDraft(template)}
      onStart={template => startStrength(template)}
      templates={strength.templates}
      today={new Date().getDay()}
    />
  ) : page === 'strength-history' ? (
    renderStrengthHistory()
  ) : page === 'chat' ? (
    <TrainingChat onSettings={() => openPage('models')} />
  ) : page === 'profile' ? (
    renderProfile()
  ) : page === 'devices' ? (
    renderDevices()
  ) : page === 'data' ? (
    renderData()
  ) : page === 'vendor-import' ? (
    renderVendorImport()
  ) : page === 'presets' ? (
    renderPresets()
  ) : page === 'muscle-map' ? (
    renderMuscleMap()
  ) : page === 'models' ? (
    renderModels()
  ) : tab === 'Heute' ? (
    recording ? (
      renderRecording()
    ) : (
      renderHome()
    )
  ) : tab === 'Fokus' ? (
    renderFocus()
  ) : (
    renderMore()
  );
  if (sorenessOpen && !workoutOpen && !showOnboarding && !recording) {
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Muskelkatermeldung schließen"
            onPress={() => setSorenessOpen(false)}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>Zurück</Text>
          </Pressable>
          {busy ? <ActivityIndicator color={color.green} /> : null}
        </View>
        {error ? (
          <View style={styles.notice}>
            <Copy>{error}</Copy>
          </View>
        ) : null}
        <SorenessCapture
          busy={busy}
          now={now}
          onSave={saveSoreness}
          onSkip={() => setSorenessOpen(false)}
          onTranscribe={transcribeSoreness}
          voiceAvailable={Boolean(state.capabilities.speechRecognition)}
          voiceHint={
            state.capabilities.speechRecognition === false
              ? 'Auf diesem Gerät ist keine Spracherkennung verfügbar. Tippen funktioniert unverändert.'
              : undefined
          }
        />
      </View>
    );
  }
  if (planDraft) {
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {error ? (
          <View style={styles.notice}>
            <Copy>{error}</Copy>
          </View>
        ) : null}
        <PlanEditor
          busy={busy}
          onCancel={() => setPlanDraft(null)}
          onSave={template => {
            persistTemplates(upsertTemplate(strength.templates, template));
            setPlanDraft(null);
            setMessage('Plan gespeichert.');
          }}
          template={planDraft}
        />
      </View>
    );
  }
  if (strength.active && workoutOpen) {
    const session = strength.active;
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {error ? (
          <View style={styles.notice}>
            <Copy>{error}</Copy>
          </View>
        ) : null}
        <WorkoutScreen
          busy={busy}
          history={recentSessions}
          now={now}
          onAddExercise={() => setPickerOpen(true)}
          onAddSet={index => changeSession(s => addSet(s, index, Date.now()))}
          onCompleteSet={(index, setId, values) =>
            changeSession(s =>
              completeStrengthSet(s, index, setId, Date.now(), values),
            )
          }
          onEditSet={(index, setId, values) =>
            changeSession(s => editStrengthSet(s, index, setId, values))
          }
          onFinish={finishStrength}
          onMinimize={() => setWorkoutOpen(false)}
          onSelectExercise={index =>
            changeSession(s => selectExercise(s, index))
          }
          session={session}
        />
        <ExercisePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(exercise: Exercise) => {
            setPickerOpen(false);
            changeSession(s => addExercise(s, exercise, Date.now()));
          }}
          visible={pickerOpen}
        />
      </View>
    );
  }
  if (showOnboarding) {
    return (
      <View
        style={[
          styles.app,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {error ? (
          <View style={styles.notice}>
            <Copy>{error}</Copy>
          </View>
        ) : null}
        <Onboarding
          settings={settings}
          persist={persist}
          busy={busy}
          importStatus={importStatus}
          onImport={() => beginImport(true)}
          onCancelImport={() => {
            void nativeCall('cancelImport').catch(e => setError(e.message));
          }}
          onDone={() => {
            setSetupOpen(false);
            setTab('Heute');
            setPage('main');
          }}
        />
      </View>
    );
  }
  const isHistory = !selected && page === 'main' && tab === 'Läufe';
  return (
    <View style={[styles.app, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {selected || page !== 'main' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zurück"
            onPress={() => {
              if (selected) {
                setSelected(null);
                setMoreDetails(false);
              } else {
                setPage('main');
              }
            }}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
            <Text style={styles.backLabel}>Zurück</Text>
          </Pressable>
        ) : (
          <Text style={styles.brand}>
            runback<Text style={styles.brandMark}> /</Text>
          </Text>
        )}
        {busy ? (
          <ActivityIndicator color={color.green} />
        ) : (
          <Text style={styles.headerInfo}>
            {recording ? 'Aufzeichnung aktiv' : 'Auf deinem Gerät'}
          </Text>
        )}
      </View>
      {error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fehlermeldung schließen"
          onPress={() => setError('')}
          style={styles.notice}
        >
          <Text style={styles.noticeTitle}>Aktion nicht abgeschlossen</Text>
          <Copy>{error}</Copy>
          <Text style={styles.smallMuted}>Tippen zum Schließen</Text>
        </Pressable>
      ) : null}
      {message ? (
        <Pressable onPress={() => setMessage('')} style={styles.notice}>
          <Copy>{message}</Copy>
        </Pressable>
      ) : null}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.green} />
          <Copy muted>Läufe werden geladen …</Copy>
        </View>
      ) : isHistory ? (
        <FlatList
          data={runs}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <RunRow run={item} open={openRun} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <>
              <Text style={styles.title}>Deine Läufe</Text>
              <View style={styles.historyHeader}>
                <Copy muted>
                  {runs.length} {runs.length === 1 ? 'Lauf' : 'Läufe'}{' '}
                  gespeichert
                </Copy>
                <Pressable
                  accessibilityRole="button"
                  onPress={runImport}
                  style={styles.importLink}
                >
                  <Text style={styles.greenText}>Importieren</Text>
                </Pressable>
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.subTitle}>Hier beginnt deine Historie.</Text>
              <Copy muted>
                Nach deinem ersten Lauf findest du hier Strecke, Laufgefühl und
                die nächste sinnvolle Handlung.
              </Copy>
              <Button
                title="Ersten Lauf starten"
                onPress={() => switchTab('Heute')}
              />
              <Button
                secondary
                title="Vorhandene Läufe importieren"
                onPress={runImport}
              />
            </View>
          }
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          refreshing={busy}
          onRefresh={() => {
            void action(async () => {
              await refresh();
            });
          }}
        />
      ) : (
        <ScrollView
          key={`${tab}-${page}-${selected?.id || ''}-${Boolean(recording)}`}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      )}
      <View
        style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}
      >
        {(['Heute', 'Läufe', 'Fokus', 'Mehr'] as Tab[]).map(name => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
            accessibilityLabel={name}
            onPress={() => switchTab(name)}
            style={[styles.tab, tab === name && styles.tabActive]}
          >
            <Icon name={name} selected={tab === name} />
            <Text
              style={[styles.tabText, tab === name && styles.tabTextActive]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={purposePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setPurposePicker(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.subTitle}>Was ist dein Laufzweck?</Text>
            {purposes.map(p => (
              <Row
                key={p.value}
                title={p.label}
                subtitle={p.description}
                trailing={
                  <Text style={styles.greenText}>
                    {(selected?.purpose || purpose) === p.value ? '✓' : ''}
                  </Text>
                }
                onPress={() => {
                  setPurposePicker(false);
                  if (selected) {
                    updateFeedback({ purpose: p.value });
                  } else {
                    save({ purpose: p.value });
                  }
                }}
              />
            ))}
            <Button
              secondary
              small
              title="Schließen"
              onPress={() => setPurposePicker(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: color.bg },
  header: {
    height: 66,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: color.text,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -1,
  },
  brandMark: { color: color.green },
  headerInfo: { color: color.muted, fontSize: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  backText: { color: color.green, fontSize: 34 },
  backLabel: { color: color.text, fontSize: 16 },
  title: {
    color: color.text,
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '600',
    letterSpacing: -0.7,
    marginBottom: 5,
  },
  subTitle: {
    color: color.text,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
  },
  muted: { color: color.muted, fontSize: 14 },
  smallMuted: { color: color.muted, fontSize: 12, lineHeight: 18 },
  greenText: { color: color.green, fontSize: 15, fontWeight: '600' },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 36,
    gap: 8,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 32,
    flexGrow: 1,
  },
  plan: {
    marginTop: 24,
    backgroundColor: color.surface,
    borderRadius: 10,
    padding: 20,
    gap: 18,
  },
  planPurpose: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planTitle: { color: color.text, fontSize: 23, fontWeight: '600' },
  planTime: { color: color.text, fontSize: 30, fontWeight: '500' },
  planTimeUnit: { color: color.muted, fontSize: 15, fontWeight: '400' },
  textButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingHorizontal: 8,
    backgroundColor: color.bg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 5,
    gap: 6,
    borderTopWidth: 2,
    borderTopColor: 'transparent',
    minHeight: 65,
  },
  tabActive: { borderTopColor: color.green },
  tabText: { color: color.muted, fontSize: 12, fontWeight: '500' },
  tabTextActive: { color: color.green },
  runRow: {
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    gap: 14,
  },
  runTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  runTitle: { fontSize: 16, color: color.text, fontWeight: '600' },
  runBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  runDistance: {
    color: color.text,
    fontSize: 26,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  runUnit: { fontSize: 14, color: color.muted, fontWeight: '400' },
  arrow: { color: color.muted, fontSize: 25 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  importLink: { minHeight: 48, justifyContent: 'center' },
  empty: { paddingVertical: 40, gap: 18 },
  historyCard: {
    backgroundColor: color.raised,
    borderRadius: 10,
    padding: 16,
    gap: 6,
  },
  pressed: { opacity: 0.7 },
  metrics: { flexDirection: 'row', gap: 16, paddingVertical: 24 },
  bigMetric: { paddingTop: 38, paddingBottom: 8 },
  recordingHeader: { marginTop: 10 },
  recordingActions: { gap: 12, marginTop: 28, marginBottom: 12 },
  feedbackSlot: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: color.line,
    gap: 10,
  },
  slotTitle: { color: color.green, fontSize: 15, fontWeight: '600' },
  fieldLabel: { color: color.text, fontSize: 15, fontWeight: '500' },
  validationNotice: {
    marginTop: 12,
    padding: 12,
    backgroundColor: color.surface,
    borderRadius: 8,
    gap: 6,
  },
  rpeGroup: { gap: 10, marginTop: 10 },
  rpeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rpe: {
    width: '18%',
    flexGrow: 1,
    height: 48,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rpeSelected: { backgroundColor: color.green, borderColor: color.green },
  rpeText: { color: color.text, fontSize: 17 },
  rpeTextSelected: { color: color.ink, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: color.text,
    backgroundColor: color.surface,
    fontSize: 16,
    minHeight: 52,
  },
  note: { minHeight: 96, textAlignVertical: 'top' },
  choiceRow: { flexDirection: 'row', gap: 6 },
  flex: { flex: 1 },
  day: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { color: color.text, fontSize: 14 },
  timeInput: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  sectionGap: { marginTop: 24 },
  notice: {
    backgroundColor: color.raised,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    gap: 6,
    borderLeftWidth: 3,
    borderLeftColor: color.green,
  },
  noticeTitle: { color: color.text, fontWeight: '700', fontSize: 15 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: color.surface,
    borderRadius: 10,
    padding: 20,
    gap: 10,
  },
});
