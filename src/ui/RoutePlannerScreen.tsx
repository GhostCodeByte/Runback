import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  formatDistanceKm,
  formatPaceSeconds,
  nearestRoutePoint,
  nextTurn,
  remainingRouteMeters,
  routePreferenceLabel,
  type RouteMode,
  type RoutePlan,
  type RoutePreference,
  type RouteRequest,
} from '../domain/routes';
import { requestRoutePlan } from '../services/routeProvider';
import {
  native,
  nativeCall,
  normalizeRun,
  type LocationSearchResult,
  type NativeLocation,
  type Run,
  type RoutePlannerState,
  type RouteVoiceSettings,
} from '../native';
import {
  Button,
  Card,
  ChipGroup,
  Copy,
  Field,
  Input,
  Notice,
  RouteMap,
  Row,
  Section,
  Stat,
  Title,
  color,
  space,
  type,
} from './components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type PlannerView =
  | 'start'
  | 'search'
  | 'distance'
  | 'mode'
  | 'preference'
  | 'result'
  | 'live';

const DEFAULT_VOICE_SETTINGS: RouteVoiceSettings = {
  enabled: true,
  pace: true,
  distance: true,
  heartRate: false,
  navigation: true,
  intervalKm: 1,
};

const distanceOptions = [
  { value: '3', label: '3 km' },
  { value: '5', label: '5 km' },
  { value: '8', label: '8 km' },
  { value: '10', label: '10 km' },
  { value: '15', label: '15 km' },
];

const modeOptions: { value: RouteMode; label: string }[] = [
  { value: 'loop', label: 'Rundweg' },
  { value: 'out_and_back', label: 'Hin und zurück' },
];

const preferenceOptions: { value: RoutePreference; label: string }[] = [
  { value: 'flat', label: 'Möglichst flach' },
  { value: 'quiet', label: 'Möglichst ruhig' },
  { value: 'green', label: 'Möglichst grün' },
  { value: 'balanced', label: 'Ausgeglichen' },
];

const voiceIntervalOptions = [
  { value: '0.5', label: '0,5 km' },
  { value: '1', label: '1 km' },
  { value: '2', label: '2 km' },
  { value: '5', label: '5 km' },
];

function number(value: number | undefined, digits = 1) {
  return Number.isFinite(value)
    ? (value || 0).toFixed(digits).replace('.', ',')
    : '–';
}

function duration(seconds: number | undefined) {
  if (!Number.isFinite(seconds)) return '–:––';
  const rounded = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function normalizePlannerState(
  value: Partial<RoutePlannerState>,
): RoutePlannerState {
  const voice = value.voice as Partial<RouteVoiceSettings> | undefined;
  return {
    routes: Array.isArray(value.routes)
      ? value.routes
          .filter(
            route =>
              route &&
              route.source === 'brouter' &&
              Array.isArray(route.points) &&
              route.points.length >= 2,
          )
          .slice(0, 10)
      : [],
    voice: {
      ...DEFAULT_VOICE_SETTINGS,
      ...(voice || {}),
      intervalKm:
        Number(voice?.intervalKm) || DEFAULT_VOICE_SETTINGS.intervalKm,
    },
    activeRoutePlanId: value.activeRoutePlanId ?? null,
  };
}

export function RoutePlannerScreen({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<PlannerView>('start');
  const [plannerState, setPlannerState] = useState<RoutePlannerState | null>(
    null,
  );
  const [start, setStart] = useState<NativeLocation | null>(null);
  const [startQuery, setStartQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>(
    [],
  );
  const [distanceInput, setDistanceInput] = useState('5');
  const [mode, setMode] = useState<RouteMode>('loop');
  const [preference, setPreference] = useState<RoutePreference>('flat');
  const [route, setRoute] = useState<RoutePlan | null>(null);
  const [recording, setRecording] = useState<Run | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voice, setVoice] = useState<RouteVoiceSettings>(
    DEFAULT_VOICE_SETTINGS,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const plannerStateRef = useRef<RoutePlannerState | null>(null);
  const plannerWrite = useRef(Promise.resolve());
  const routeCursor = useRef(0);

  const applyState = (next: RoutePlannerState, run: Run | null) => {
    const normalized = normalizePlannerState(next);
    plannerStateRef.current = normalized;
    setPlannerState(normalized);
    setVoice(normalized.voice);
    setRecording(run);
    const activeId = normalized.activeRoutePlanId;
    const active = activeId
      ? normalized.routes.find(item => item.id === activeId)
      : undefined;
    if (run && active) {
      setRoute(active);
      setView('live');
    }
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([native.state(), native.routePlannerState()])
      .then(([next, planner]) => {
        if (mounted) applyState(planner, next.recording);
      })
      .catch(errorValue => {
        if (mounted)
          setError(
            errorValue instanceof Error
              ? errorValue.message
              : String(errorValue),
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (view !== 'live') return;
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await native.state();
        if (!mounted) return;
        setRecording(next.recording);
        if (!next.recording) {
          setView('result');
          setMessage('Lauf gespeichert.');
        }
      } catch {
        // Die Aufzeichnung bleibt nativ aktiv, auch wenn eine einzelne Abfrage scheitert.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1_500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [view]);

  const persistPlannerState = async (
    patch: Partial<RoutePlannerState>,
  ): Promise<void> => {
    const current = plannerStateRef.current;
    if (!current)
      throw new Error('Die lokalen Routendaten sind noch nicht geladen.');
    const next = normalizePlannerState({ ...current, ...patch });
    plannerStateRef.current = next;
    setPlannerState(next);
    setVoice(next.voice);
    const operation = plannerWrite.current.then(() =>
      native.saveRoutePlannerState(next),
    );
    plannerWrite.current = operation.catch(() => undefined);
    await operation;
  };

  const saved = plannerState?.routes ?? [];

  useEffect(() => {
    routeCursor.current = 0;
  }, [route?.id]);

  const currentPoint = useMemo(() => {
    const points = recording?.route;
    return points && points.length ? points[points.length - 1] : undefined;
  }, [recording?.route]);

  const progress = useMemo(() => {
    if (!route || !currentPoint) return null;
    const nearest = nearestRoutePoint(
      route.points,
      currentPoint,
      routeCursor.current,
    );
    if (nearest.index >= routeCursor.current) {
      routeCursor.current = nearest.index;
    }
    return {
      ...nearest,
      remainingMeters: remainingRouteMeters(route.points, nearest.index),
      nextTurn: nextTurn(route.points, nearest.index),
    };
  }, [currentPoint, route]);

  const loadCurrentLocation = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeCall('requestRecordingPermissions');
      const location = await native.currentLocation();
      setStart({ ...location, label: 'Aktuelle Position' });
      if (location.accuracyM && location.accuracyM > 100) {
        setMessage(
          `Die aktuelle Position ist ungefähr ${Math.round(
            location.accuracyM,
          )} m genau.`,
        );
      }
      setView('distance');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const searchStart = async () => {
    setBusy(true);
    setError('');
    try {
      const results = await native.searchLocation(startQuery);
      setSearchResults(results);
      if (!results.length) setError('Kein passender Startort gefunden.');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const selectSearchResult = (result: LocationSearchResult) => {
    setStart(result);
    setSearchResults([]);
    setView('distance');
  };

  const request = (): RouteRequest | null => {
    if (!start) {
      setError('Wähle zuerst einen Startpunkt.');
      return null;
    }
    const distanceKm = Number(distanceInput.replace(',', '.'));
    if (!Number.isFinite(distanceKm) || distanceKm < 1 || distanceKm > 50) {
      setError('Wähle eine Distanz zwischen 1 und 50 Kilometern.');
      return null;
    }
    return {
      start: {
        latitude: start.latitude,
        longitude: start.longitude,
      },
      startLabel: start.label || 'Startpunkt',
      distanceKm,
      mode,
      preference,
    };
  };

  const generate = async () => {
    const nextRequest = request();
    if (!nextRequest) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const nextRoute = await requestRoutePlan(nextRequest);
      if (!nextRoute) {
        setRoute(null);
        setError(
          'Keine begehbare Route gefunden. Prüfe die Internetverbindung und versuche es erneut.',
        );
        setView('preference');
        return;
      }
      setRoute(nextRoute);
      setView('result');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveRoute = async (plan: RoutePlan) => {
    if (plan.source !== 'brouter') {
      setError('Nur verifizierte Straßenrouten können gespeichert werden.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = [plan, ...saved.filter(item => item.id !== plan.id)].slice(
        0,
        10,
      );
      await persistPlannerState({ routes: next });
      setRoute(plan);
      setMessage('Route gespeichert.');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const startRun = async () => {
    if (!route || route.source !== 'brouter') {
      setError('Nur eine verifizierte Straßenroute kann gestartet werden.');
      return;
    }
    setBusy(true);
    setError('');
    let activated = false;
    let hadRecording = false;
    try {
      const current = await native.state();
      hadRecording = Boolean(current.recording);
      const activeRouteId = plannerStateRef.current?.activeRoutePlanId;
      if (current.recording && activeRouteId !== route.id) {
        throw new Error(
          'Ein anderer Lauf ist bereits aktiv. Beende ihn zuerst, bevor du diese Route startest.',
        );
      }
      const permissions = await nativeCall<{ locationPermission: boolean }>(
        'requestRecordingPermissions',
      );
      if (!permissions.locationPermission) {
        throw new Error(
          'Für die Aufzeichnung fehlt die genaue Standortfreigabe.',
        );
      }
      const nextRoutes = saved.some(item => item.id === route.id)
        ? saved
        : [route, ...saved].slice(0, 10);
      await persistPlannerState({
        routes: nextRoutes,
        activeRoutePlanId: route.id,
      });
      activated = true;
      let started = current.recording;
      if (!started) {
        const result = await nativeCall<{ recording?: unknown }>(
          'startRouteRun',
          route.id,
          'free',
          'running',
        );
        started = result.recording ? normalizeRun(result.recording) : null;
      }
      if (!started?.id)
        throw new Error('Der Lauf konnte nicht gestartet werden.');
      const activeRoutes = nextRoutes.map(item =>
        item.id === route.id ? { ...item, activeRunId: started.id } : item,
      );
      await persistPlannerState({ routes: activeRoutes });
      setRecording(started);
      setView('live');
    } catch (errorValue) {
      if (activated && !hadRecording) {
        await persistPlannerState({ activeRoutePlanId: null }).catch(() => {});
      }
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const finishRun = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeCall('finishRun');
      const activeRouteId = plannerStateRef.current?.activeRoutePlanId;
      const clearedRoutes = saved.map(item =>
        item.id === activeRouteId ? { ...item, activeRunId: undefined } : item,
      );
      await persistPlannerState({
        routes: clearedRoutes,
        activeRoutePlanId: null,
      });
      const next = await native.state();
      setRecording(next.recording);
      setView('result');
      setMessage('Lauf gespeichert.');
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (!recording) return;
    setBusy(true);
    try {
      await nativeCall(
        recording.status === 'recording' ? 'pauseRun' : 'resumeRun',
      );
      const next = await native.state();
      setRecording(next.recording);
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    } finally {
      setBusy(false);
    }
  };

  const updateVoice = (patch: Partial<RouteVoiceSettings>) => {
    const next = { ...voice, ...patch };
    setVoice(next);
    void persistPlannerState({ voice: next }).catch(errorValue =>
      setError(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      ),
    );
  };

  const back = () => {
    setError('');
    setMessage('');
    switch (view) {
      case 'start':
        onClose();
        break;
      case 'search':
        setView('start');
        break;
      case 'distance':
        setView('start');
        break;
      case 'mode':
        setView('distance');
        break;
      case 'preference':
        setView('mode');
        break;
      case 'result':
        setView('preference');
        break;
      case 'live':
        setView('result');
        break;
    }
  };

  const step =
    view === 'start' || view === 'search'
      ? '1 / 4'
      : view === 'distance'
      ? '2 / 4'
      : view === 'mode'
      ? '3 / 4'
      : view === 'preference'
      ? '4 / 4'
      : '';

  const shell = (children: React.ReactNode) => (
    <View
      style={[
        styles.shell,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, space.xs),
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zurück"
          onPress={back}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
          <Text style={styles.backLabel}>Zurück</Text>
        </Pressable>
        <View style={styles.headerRight}>
          {step ? <Text style={styles.step}>{step}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Routenplaner schließen"
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.closeText}>Schließen</Text>
          </Pressable>
        </View>
      </View>
      {error ? (
        <View style={styles.noticeSlot}>
          <Notice
            title="Aktion nicht abgeschlossen"
            onDismiss={() => setError('')}
          >
            {error}
          </Notice>
        </View>
      ) : null}
      {message ? (
        <View style={styles.noticeSlot}>
          <Notice onDismiss={() => setMessage('')}>{message}</Notice>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );

  const renderStart = () => (
    <>
      <Title>Wo startest du?</Title>
      <Copy muted>Wähle den Start für deine nächste Laufroute.</Copy>
      <Button
        title="Aktuelle Position verwenden"
        onPress={() => void loadCurrentLocation()}
        disabled={busy}
      />
      <Button
        secondary
        title="Startort suchen"
        onPress={() => setView('search')}
        disabled={busy}
      />
      {saved.length ? (
        <Section title="Gespeicherte Routen">
          {saved.map(item => (
            <Row
              key={item.id}
              title={`${number(item.distanceMeters / 1000, 2)} km · ${
                item.mode === 'loop' ? 'Rundweg' : 'Hin und zurück'
              }`}
              subtitle={`${item.startLabel} · ${routePreferenceLabel(
                item.preference,
              )}`}
              onPress={() => {
                setRoute(item);
                setView('result');
              }}
            />
          ))}
        </Section>
      ) : null}
    </>
  );

  const renderSearch = () => (
    <>
      <Title>Startort suchen</Title>
      <Copy muted>
        Suche nach einer Adresse, einem Ort oder einem Treffpunkt.
      </Copy>
      <Field label="Startort">
        <Input
          label="Startort"
          value={startQuery}
          onChangeText={setStartQuery}
          placeholder="Zum Beispiel: Seepark Freiburg"
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => void searchStart()}
        />
      </Field>
      <Button
        title="Startort suchen"
        onPress={() => void searchStart()}
        disabled={busy || startQuery.trim().length < 3}
      />
      {searchResults.length ? (
        <Section title="Treffer">
          {searchResults.map((result, index) => (
            <Row
              key={`${result.latitude}-${result.longitude}-${index}`}
              title={result.label}
              subtitle="Als Startpunkt verwenden"
              onPress={() => selectSearchResult(result)}
            />
          ))}
        </Section>
      ) : null}
    </>
  );

  const renderDistance = () => (
    <>
      <Title>Wie weit möchtest du laufen?</Title>
      <Copy muted>Die Distanz meint die gesamte Route, inklusive Rückweg.</Copy>
      <Field label="Schnellauswahl">
        <ChipGroup
          label="Distanz auswählen"
          options={distanceOptions}
          value={
            distanceOptions.some(option => option.value === distanceInput)
              ? distanceInput
              : ''
          }
          onChange={setDistanceInput}
        />
      </Field>
      <Field label="Eigene Distanz" hint="Zwischen 1 und 50 km">
        <Input
          label="Eigene Distanz in Kilometern"
          value={distanceInput}
          onChangeText={setDistanceInput}
          keyboardType="decimal-pad"
        />
      </Field>
      <Button title="Weiter" onPress={() => setView('mode')} disabled={busy} />
    </>
  );

  const renderMode = () => (
    <>
      <Title>Welche Strecke möchtest du?</Title>
      <Copy muted>Beide Varianten bringen dich wieder zum Start.</Copy>
      <ChipGroup
        label="Routentyp"
        options={modeOptions}
        value={mode}
        onChange={setMode}
      />
      <Card>
        <Text style={styles.cardTitle}>
          {mode === 'loop' ? 'Rundweg' : 'Hin und zurück'}
        </Text>
        <Copy muted>
          {mode === 'loop'
            ? 'Runback sucht eine Schleife mit möglichst wenig doppelter Strecke.'
            : 'Runback sucht einen Wendepunkt und führt dich auf demselben Weg zurück.'}
        </Copy>
      </Card>
      <Button title="Weiter" onPress={() => setView('preference')} />
    </>
  );

  const renderPreference = () => (
    <>
      <Title>Was ist dir wichtig?</Title>
      <Copy muted>
        Runback nutzt die Auswahl als Priorität, nicht als starres Versprechen.
      </Copy>
      <ChipGroup
        label="Routenpriorität"
        options={preferenceOptions}
        value={preference}
        onChange={setPreference}
      />
      <Card>
        <Text style={styles.cardTitle}>{routePreferenceLabel(preference)}</Text>
        <Copy muted>
          Hauptstraßen und ungeeignete Wege werden weiterhin vermieden, wenn die
          Kartendaten das erkennen lassen.
        </Copy>
      </Card>
      <Notice>
        Für eine begehbare Straßenroute werden Startpunkt und
        Routenzwischenpunkte an BRouter mit OpenStreetMap-Daten übertragen.
        Laufdaten bleiben lokal auf deinem Gerät.
      </Notice>
      <Button
        title="Route finden"
        onPress={() => void generate()}
        disabled={busy || !start}
      />
      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.green} />
          <Copy muted>Routenvorschläge werden verglichen …</Copy>
        </View>
      ) : null}
    </>
  );

  const renderResult = () => {
    if (!route) return null;
    const isSaved = saved.some(item => item.id === route.id);
    const isNavigable = route.source === 'brouter';
    return (
      <>
        <Title>Deine Route</Title>
        <Copy muted>
          {route.startLabel} · {routePreferenceLabel(route.preference)}
        </Copy>
        <RouteMap planned={route.points} />
        <View style={styles.metrics}>
          <Stat
            value={number(route.distanceMeters / 1000, 2)}
            label="Kilometer"
          />
          <Stat
            value={
              route.ascentMeters === undefined
                ? '–'
                : number(route.ascentMeters, 0)
            }
            label="Höhenmeter"
          />
          <Stat
            value={route.mode === 'loop' ? 'Rundweg' : 'Wende'}
            label="Strecke"
          />
        </View>
        <Card>
          <Text style={styles.cardTitle}>
            {route.source === 'brouter' ? 'Strecke gefunden' : 'Vorschau'}
          </Text>
          <Copy muted>
            {route.providerLabel}.{' '}
            {route.source === 'preview'
              ? 'Die Kartendaten waren nicht erreichbar. Prüfe die Strecke vor dem Lauf.'
              : 'Die Route basiert auf OpenStreetMap-Daten.'}
          </Copy>
        </Card>
        <Button
          title={
            isSaved
              ? 'Gespeichert · Lauf starten'
              : 'Route speichern & Lauf starten'
          }
          onPress={() => void startRun()}
          disabled={busy || !isNavigable}
        />
        {!isSaved ? (
          <Button
            secondary
            title="Nur Route speichern"
            onPress={() => void saveRoute(route)}
            disabled={busy || !isNavigable}
          />
        ) : null}
        {!isNavigable ? (
          <Copy muted>
            Diese Vorschau ist nicht auf Straßen geprüft und kann deshalb weder
            gespeichert noch gestartet werden.
          </Copy>
        ) : null}
        <Button
          secondary
          small
          title="Andere Route suchen"
          onPress={() => setView('preference')}
          disabled={busy}
        />
      </>
    );
  };

  const renderVoiceSettings = () => (
    <Section title="Sprachansagen">
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Sprachansagen aktiv</Text>
          <Text style={styles.rowSubtitle}>
            Pace und Route werden während des Laufs angesagt.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Sprachansagen aktiv"
          accessibilityState={{ checked: voice.enabled }}
          value={voice.enabled}
          onValueChange={enabled => updateVoice({ enabled })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.enabled ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Pace</Text>
          <Text style={styles.rowSubtitle}>
            Aktueller Durchschnitt in min/km.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Pace ansagen"
          accessibilityState={{ checked: voice.pace }}
          value={voice.pace}
          onValueChange={paceValue => updateVoice({ pace: paceValue })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.pace ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Distanz</Text>
          <Text style={styles.rowSubtitle}>
            Bereits gelaufene Kilometer und Reststrecke.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Distanz ansagen"
          accessibilityState={{ checked: voice.distance }}
          value={voice.distance}
          onValueChange={distanceValue =>
            updateVoice({ distance: distanceValue })
          }
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.distance ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Puls</Text>
          <Text style={styles.rowSubtitle}>
            Nur wenn ein gültiger Wert vorliegt.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Puls ansagen"
          accessibilityState={{ checked: voice.heartRate }}
          value={voice.heartRate}
          onValueChange={heartRate => updateVoice({ heartRate })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.heartRate ? color.green : color.muted}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Route</Text>
          <Text style={styles.rowSubtitle}>
            Reststrecke und Abstand zur geplanten Route.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Route ansagen"
          accessibilityState={{ checked: voice.navigation }}
          value={voice.navigation}
          onValueChange={navigation => updateVoice({ navigation })}
          trackColor={{ false: color.line, true: color.greenSoft }}
          thumbColor={voice.navigation ? color.green : color.muted}
        />
      </View>
      <Field label="Ansageintervall">
        <ChipGroup
          label="Ansageintervall"
          options={voiceIntervalOptions}
          value={String(voice.intervalKm)}
          onChange={value => updateVoice({ intervalKm: Number(value) })}
        />
      </Field>
    </Section>
  );

  const renderLive = () => {
    if (!route || !recording) return null;
    const paceSeconds =
      recording.distanceMeters >= 20
        ? recording.durationSeconds / (recording.distanceMeters / 1000)
        : undefined;
    const offRoute =
      progress?.distanceMeters !== undefined && progress.distanceMeters > 80;
    return (
      <>
        <Title>
          {recording.status === 'recording' ? 'Lauf läuft' : 'Lauf pausiert'}
        </Title>
        <Copy muted>
          {route.startLabel} · Ziel {formatDistanceKm(route.distanceMeters)}
        </Copy>
        <RouteMap
          planned={route.points}
          track={recording.route || []}
          current={currentPoint}
        />
        <Card>
          <Text style={styles.cardTitle}>
            {offRoute ? 'Du bist neben der Route' : 'Du bist auf der Route'}
          </Text>
          <Copy muted>
            {offRoute
              ? `Etwa ${number(
                  progress?.distanceMeters,
                  0,
                )} m von der geplanten Strecke entfernt.`
              : 'Folge der gestrichelten Linie.'}
          </Copy>
        </Card>
        <View style={styles.metrics}>
          <Stat value={duration(recording.durationSeconds)} label="Dauer" />
          <Stat
            value={formatDistanceKm(recording.distanceMeters)}
            label="Gelaufen"
          />
          <Stat value={formatPaceSeconds(paceSeconds)} label="Pace" />
        </View>
        <Section title="Während des Laufs">
          <Row
            title="Reststrecke"
            subtitle={formatDistanceKm(progress?.remainingMeters)}
          />
          <Row
            title="Nächste Richtungsänderung"
            subtitle={
              progress?.nextTurn
                ? `In ${formatDistanceKm(progress.nextTurn.distanceMeters)} ${
                    progress.nextTurn.direction === 'left' ? 'links' : 'rechts'
                  }`
                : 'Dem Weg weiter folgen'
            }
          />
          <Row
            title="Herzfrequenz"
            subtitle={
              recording.avgHeartRate
                ? `${Math.round(recording.avgHeartRate)} bpm`
                : 'Keine Daten'
            }
          />
        </Section>
        <Button
          title={
            recording.status === 'recording'
              ? 'Lauf pausieren'
              : 'Lauf fortsetzen'
          }
          onPress={() => void togglePause()}
          disabled={busy}
        />
        <Button
          secondary
          title="Lauf beenden & speichern"
          onPress={() => void finishRun()}
          disabled={busy}
        />
        <Button
          secondary
          small
          title={
            voiceOpen
              ? 'Sprachansagen schließen'
              : 'Sprachansagen konfigurieren'
          }
          onPress={() => setVoiceOpen(value => !value)}
        />
        {voiceOpen ? renderVoiceSettings() : null}
      </>
    );
  };

  if (loading) {
    return shell(
      <View style={styles.loading}>
        <ActivityIndicator color={color.green} />
        <Copy muted>Routen werden geladen …</Copy>
      </View>,
    );
  }

  return shell(
    view === 'start'
      ? renderStart()
      : view === 'search'
      ? renderSearch()
      : view === 'distance'
      ? renderDistance()
      : view === 'mode'
      ? renderMode()
      : view === 'preference'
      ? renderPreference()
      : view === 'result'
      ? renderResult()
      : renderLive(),
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.bg },
  header: {
    minHeight: 58,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  back: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  backText: { color: color.text, fontSize: 34, lineHeight: 36 },
  backLabel: { color: color.text, ...type.label },
  step: { color: color.muted, ...type.label },
  close: { minHeight: 48, justifyContent: 'center' },
  closeText: { color: color.muted, ...type.label },
  noticeSlot: { paddingHorizontal: space.md, paddingTop: space.sm },
  content: { padding: space.md, paddingBottom: space.xxl, gap: space.md },
  cardTitle: { color: color.text, ...type.heading },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  metrics: { flexDirection: 'row', gap: space.sm },
  switchRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  switchText: { flex: 1, gap: space.xxs },
  rowTitle: { color: color.text, ...type.body, fontWeight: '500' },
  rowSubtitle: { color: color.muted, ...type.label },
});
