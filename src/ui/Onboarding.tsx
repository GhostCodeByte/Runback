import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RunPurpose } from '../domain/types';
import type { Capabilities, Settings } from '../native';
import {
  Button,
  Copy,
  Row,
  Section,
  color,
  purposes,
} from './components';

export const ONBOARDING_STEP_IDS = [
  'willkommen',
  'ziel',
  'zweck',
  'daten',
  'berechtigungen',
  'fertig',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Die Ersteinrichtung ist immer optional: kein Konto, kein Pflichtablauf. */
export function shouldShowOnboarding(
  settings: Settings,
  opts: { loading: boolean; recording: boolean },
): boolean {
  return !opts.loading && !opts.recording && !settings.onboardedAt;
}

/** Gibt Minuten (5–600) zurück oder undefined bei ungültiger Eingabe. */
export function parseMinutesInput(text: string): number | undefined {
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
    return undefined;
  }
  return minutes;
}

export interface OnboardingProps {
  settings: Settings;
  capabilities: Capabilities;
  busy: boolean;
  importRunning: boolean;
  importSummary: string;
  importErrorCount: number;
  onPersist: (patch: Partial<Settings>) => Promise<void>;
  onImport: () => void;
  onRequestPermissions: () => Promise<void>;
  onClose: () => void;
}

export function OnboardingFlow(props: OnboardingProps) {
  const { settings } = props;
  const [step, setStep] = useState<OnboardingStepId>('willkommen');
  const [goal, setGoal] = useState(settings.goal || '');
  const [minutes, setMinutes] = useState(String(settings.minutes || 30));
  const [days, setDays] = useState<number[]>(settings.trainingDays || []);
  const [purpose, setPurpose] = useState<RunPurpose>(
    settings.purpose || 'free',
  );
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState('');

  const index = ONBOARDING_STEP_IDS.indexOf(step);
  const run = async (fn: () => Promise<void>) => {
    if (saving || props.busy) {
      return;
    }
    setSaving(true);
    setStepError('');
    try {
      await fn();
    } catch (e) {
      setStepError(
        e instanceof Error
          ? e.message
          : 'Das hat nicht geklappt. Bitte erneut versuchen.',
      );
    } finally {
      setSaving(false);
    }
  };
  const skipAll = () =>
    run(async () => {
      await props.onPersist({
        onboardedAt: Date.now(),
        onboardingSkipped: true,
      });
      props.onClose();
    });
  const collectPatch = (): Partial<Settings> => {
    const patch: Partial<Settings> = {
      purpose,
      trainingDays: [...days].sort(),
    };
    const parsed = parseMinutesInput(minutes);
    if (parsed !== undefined) {
      patch.minutes = parsed;
    }
    if (goal.trim()) {
      patch.goal = goal.trim();
    }
    return patch;
  };
  const nextFromGoal = () =>
    run(async () => {
      if (parseMinutesInput(minutes) === undefined) {
        throw new Error(
          'Bitte ein Zeitbudget zwischen 5 und 600 Minuten eingeben.',
        );
      }
      await props.onPersist(collectPatch());
      setStep('zweck');
    });
  const finish = () =>
    run(async () => {
      await props.onPersist({
        ...collectPatch(),
        onboardedAt: Date.now(),
        onboardingSkipped: false,
      });
      props.onClose();
    });
  const toggleDay = (day: number) =>
    setDays(current =>
      current.includes(day)
        ? current.filter(d => d !== day)
        : [...current, day],
    );
  const capability = (ok: unknown) =>
    ok ? 'Bereit' : 'Noch nicht verfügbar';

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topRow}>
        <Text style={styles.step}>
          Schritt {index + 1} von {ONBOARDING_STEP_IDS.length}
        </Text>
        <Pressable accessibilityRole="button" onPress={skipAll}>
          <Text style={styles.skip}>Später</Text>
        </Pressable>
      </View>
      <View style={styles.dots}>
        {ONBOARDING_STEP_IDS.map(id => (
          <View
            key={id}
            style={[styles.dot, id === step && styles.dotActive]}
          />
        ))}
      </View>

      {step === 'willkommen' ? (
        <>
          <Text style={styles.title}>Willkommen bei Runback</Text>
          <Copy muted>
            Ein Lauf rein — eine begründete, prüfbare nächste Handlung raus,
            wenn die Daten sie tragen. Sonst sagt die App ehrlich, was noch
            fehlt.
          </Copy>
          <Section title="Deine Daten bleiben bei dir">
            <Copy muted>
              Kein Konto, keine Cloud. Aufzeichnung und einfache Auswertung
              funktionieren ohne Internet. Richte jetzt in einer Minute das
              Wichtigste ein — oder überspringe alles und starte direkt.
            </Copy>
          </Section>
          <Button
            title="Einrichten (1 Minute)"
            onPress={() => setStep('ziel')}
            disabled={saving}
          />
        </>
      ) : null}

      {step === 'ziel' ? (
        <>
          <Text style={styles.title}>Was möchtest du erreichen?</Text>
          <Section title="Übergeordnetes Laufziel">
            <TextInput
              accessibilityLabel="Übergeordnetes Laufziel"
              value={goal}
              onChangeText={setGoal}
              placeholder="Zum Beispiel: regelmäßig laufen"
              placeholderTextColor={color.muted}
              style={styles.input}
              selectionColor={color.green}
            />
          </Section>
          <Section title="Zeit für den nächsten Lauf">
            <View style={styles.timeRow}>
              <TextInput
                accessibilityLabel="Zeitbudget in Minuten"
                keyboardType="number-pad"
                maxLength={3}
                value={minutes}
                onChangeText={setMinutes}
                style={[styles.input, styles.flex]}
                selectionColor={color.green}
              />
              <Copy muted>Minuten</Copy>
            </View>
          </Section>
          <Section title="Mögliche Lauftage">
            <View style={styles.dayRow}>
              {WEEKDAYS.map((day, i) => (
                <Pressable
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityLabel={day}
                  accessibilityState={{ checked: days.includes(i) }}
                  onPress={() => toggleDay(i)}
                  style={[styles.day, days.includes(i) && styles.dayActive]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      days.includes(i) && styles.dayTextActive,
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Copy muted>
              Verpasste Läufe werden nicht zu zusätzlicher Belastung
              zusammengelegt.
            </Copy>
          </Section>
        </>
      ) : null}

      {step === 'zweck' ? (
        <>
          <Text style={styles.title}>Womit läufst du meistens?</Text>
          <Copy muted>
            Der Zweck steuert die Bewertung. Du kannst ihn vor jedem Lauf
            ändern.
          </Copy>
          <Section title="Standardzweck">
            {purposes.map(option => (
              <Row
                key={option.value}
                title={`${option.label}${purpose === option.value ? ' ✓' : ''}`}
                subtitle={option.description}
                onPress={() => setPurpose(option.value)}
              />
            ))}
          </Section>
        </>
      ) : null}

      {step === 'daten' ? (
        <>
          <Text style={styles.title}>Historie mitnehmen?</Text>
          <Section title="Alte Läufe importieren">
            <Copy muted>
              FIT, GPX, TCX oder ein Strava-Export als ZIP. Bereits vorhandene
              Läufe werden erkannt und nicht doppelt gezählt.
            </Copy>
            <Button
              title={
                props.importRunning
                  ? 'Import läuft …'
                  : 'Dateien importieren'
              }
              onPress={props.onImport}
              disabled={props.busy || props.importRunning}
            />
            {props.importSummary ? <Copy>{props.importSummary}</Copy> : null}
            {props.importErrorCount > 0 ? (
              <Copy muted>
                {props.importErrorCount} Dateien wurden mit Hinweis
                übersprungen. Details stehen unter Mehr → Daten.
              </Copy>
            ) : null}
          </Section>
        </>
      ) : null}

      {step === 'berechtigungen' ? (
        <>
          <Text style={styles.title}>Was die App braucht</Text>
          <Copy muted>
            Standort nur für die Streckenaufzeichnung, Mitteilungen für die
            laufende Aufzeichnung. Alles andere ist optional und lässt sich
            später unter Mehr → Geräte ändern.
          </Copy>
          <Section title="Stand auf diesem Gerät">
            <Row
              title="Standort (GPS)"
              subtitle={capability(
                props.capabilities.gps &&
                  props.capabilities.locationPermission,
              )}
            />
            <Row
              title="Mitteilungen"
              subtitle={capability(
                props.capabilities.notificationPermission,
              )}
            />
            <Row
              title="Bluetooth (Uhr & Sensoren, optional)"
              subtitle={capability(props.capabilities.bluetoothPermission)}
            />
            <Row
              title="Barometer (optional)"
              subtitle={capability(props.capabilities.barometer)}
            />
          </Section>
          <Button
            secondary
            title="Berechtigungen anfragen"
            onPress={() => run(props.onRequestPermissions)}
            disabled={saving || props.busy}
          />
          <Copy muted>
            Ohne Freigabe geht es trotzdem weiter — die Aufzeichnung fragt beim
            Start erneut.
          </Copy>
        </>
      ) : null}

      {step === 'fertig' ? (
        <>
          <Text style={styles.title}>Bereit für den ersten Lauf</Text>
          <Section title="Deine Einrichtung">
            <Row
              title="Ziel"
              subtitle={goal.trim() || 'Noch kein Ziel gesetzt'}
            />
            <Row
              title="Zeitbudget"
              subtitle={`${parseMinutesInput(minutes) || 30} Minuten`}
            />
            <Row
              title="Lauftage"
              subtitle={
                days.length
                  ? [...days]
                      .sort()
                      .map(d => WEEKDAYS[d])
                      .join(', ')
                  : 'Flexibel'
              }
            />
            <Row
              title="Standardzweck"
              subtitle={
                purposes.find(p => p.value === purpose)?.label || 'Lauf'
              }
            />
          </Section>
          <Copy muted>
            Unter Mehr findest du Daten & Speicher, Laufvorlagen, Uhr und
            Auswertung. Die Einrichtung lässt sich dort jederzeit erneut
            öffnen.
          </Copy>
          <Button
            title="Los geht's"
            onPress={finish}
            disabled={saving || props.busy}
          />
        </>
      ) : null}

      {stepError ? (
        <Section title="Hinweis">
          <Copy>{stepError}</Copy>
        </Section>
      ) : null}

      {step !== 'willkommen' && step !== 'fertig' ? (
        <View style={styles.nav}>
          <Button
            secondary
            small
            title="Zurück"
            onPress={() =>
              setStep(ONBOARDING_STEP_IDS[Math.max(0, index - 1)])
            }
            disabled={saving}
          />
          {step === 'ziel' ? (
            <Button small title="Weiter" onPress={nextFromGoal} disabled={saving} />
          ) : (
            <Button
              small
              title="Weiter"
              onPress={() =>
                run(async () => {
                  await props.onPersist(collectPatch());
                  setStep(ONBOARDING_STEP_IDS[index + 1]);
                })
              }
              disabled={saving}
            />
          )}
        </View>
      ) : null}
      {step === 'ziel' || step === 'zweck' || step === 'daten' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            run(async () => {
              await props.onPersist(collectPatch());
              setStep(ONBOARDING_STEP_IDS[index + 1]);
            })
          }
          style={styles.textButton}
        >
          <Text style={styles.skip}>Diesen Schritt überspringen</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  step: { color: color.muted, fontSize: 13 },
  skip: { color: color.green, fontSize: 15, fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.line },
  dotActive: { backgroundColor: color.green },
  title: { color: color.text, fontSize: 26, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    padding: 14,
    color: color.text,
    backgroundColor: color.surface,
    fontSize: 16,
    minHeight: 52,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  dayRow: { flexDirection: 'row', gap: 8 },
  day: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dayActive: { backgroundColor: color.green, borderColor: color.green },
  dayText: { color: color.text, fontSize: 14 },
  dayTextActive: { color: color.ink, fontWeight: '700' },
  nav: { flexDirection: 'row', gap: 10, marginTop: 4 },
  textButton: { alignItems: 'center', paddingVertical: 10 },
});
