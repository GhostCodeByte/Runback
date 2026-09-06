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
import { nativeCall, type Settings } from '../native';
import { Button, Copy, Section, color } from './components';

const STEPS = ['welcome', 'goal', 'import', 'ready'] as const;
type Step = (typeof STEPS)[number];
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const PURPOSES: { value: RunPurpose; label: string }[] = [
  { value: 'easy', label: 'Locker laufen' },
  { value: 'long', label: 'Langer Lauf' },
  { value: 'intervals', label: 'Intervalle' },
  { value: 'race', label: 'Wettkampf' },
  { value: 'free', label: 'Freies Laufen' },
];

export interface OnboardingProps {
  settings: Settings;
  persist: (patch: Partial<Settings>) => Promise<void>;
  onDone: () => void;
  onImport: () => void;
  onCancelImport?: () => void;
  importStatus: any;
  busy: boolean;
}

function parseMinutes(value: string): number | undefined {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 5 && minutes <= 600
    ? minutes
    : undefined;
}

export function Onboarding({
  settings,
  persist,
  onDone,
  onImport,
  onCancelImport,
  importStatus,
  busy,
}: OnboardingProps) {
  const initial = STEPS.includes(settings.onboardingStep as Step)
    ? (settings.onboardingStep as Step)
    : 'welcome';
  const [step, setStep] = useState<Step>(initial);
  const [goal, setGoal] = useState(settings.goal || '');
  const [minutes, setMinutes] = useState(String(settings.minutes || 30));
  const [days, setDays] = useState<number[]>(settings.trainingDays || []);
  const [purpose, setPurpose] = useState<RunPurpose>(
    settings.purpose || 'free',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('');
  const patch = (): Partial<Settings> => {
    const value = parseMinutes(minutes);
    return {
      goal: goal.trim() || undefined,
      ...(value === undefined ? {} : { minutes: value }),
      trainingDays: [...days].sort(),
      purpose,
    };
  };
  const saveAnd = async (next: Step) => {
    setSaving(true);
    setError('');
    try {
      await persist({ ...patch(), onboardingStep: next });
      setStep(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.',
      );
    } finally {
      setSaving(false);
    }
  };
  const skip = async () => {
    setSaving(true);
    setError('');
    try {
      await persist({
        onboardedAt: Date.now(),
        onboardingStep: 'welcome',
        onboardingSkipped: true,
      });
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.',
      );
    } finally {
      setSaving(false);
    }
  };
  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      await persist({
        ...patch(),
        onboardingStep: 'welcome',
        onboardedAt: Date.now(),
        onboardingSkipped: false,
      });
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.',
      );
    } finally {
      setSaving(false);
    }
  };
  const index = STEPS.indexOf(step);
  const next = () => saveAnd(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  const validMinutes = parseMinutes(minutes) !== undefined;
  const status = importStatus || {};
  const importRunning = status.state === 'running';
  const canLeave = !saving && !busy && !importRunning;
  const requestPermissions = async () => {
    setPermissionBusy(true);
    setPermissionStatus('');
    setError('');
    try {
      const result = await nativeCall<any>('requestRecordingPermissions');
      setPermissionStatus(
        result?.locationPermission && result?.notificationPermission
          ? 'Standort und Mitteilungen sind freigegeben.'
          : 'Mindestens eine Berechtigung ist noch nicht freigegeben. Die Aufzeichnung fragt beim Start erneut.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Berechtigungen konnten nicht angefragt werden.',
      );
    } finally {
      setPermissionBusy(false);
    }
  };
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.progress}>
          Einrichtung · {index + 1}/{STEPS.length}
        </Text>
        <Pressable accessibilityRole="button" onPress={skip} disabled={!canLeave}>
          <Text style={styles.link}>Später</Text>
        </Pressable>
      </View>
      <View style={styles.progressLine}>
        {STEPS.map(item => (
          <View
            key={item}
            style={[
              styles.progressDot,
              item === step && styles.progressDotActive,
            ]}
          />
        ))}
      </View>
      {step === 'welcome' ? (
        <>
          <Text style={styles.title}>Willkommen bei Runback</Text>
          <Copy muted>
            Richte die wenigen Dinge ein, die deinen nächsten Lauf besser
            einordnen. Alles ist optional und bleibt grundsätzlich auf deinem
            Gerät; optionale Cloud-Dienste kannst du später aktivieren.
          </Copy>
          <Button title="Einrichten" onPress={next} disabled={saving || busy} />
        </>
      ) : null}
      {step === 'goal' ? (
        <>
          <Text style={styles.title}>Dein nächster Lauf</Text>
          <Section title="Übergeordnetes Ziel">
            <TextInput
              accessibilityLabel="Laufziel"
              value={goal}
              onChangeText={setGoal}
              placeholder="Zum Beispiel: regelmäßig laufen"
              placeholderTextColor={color.muted}
              style={styles.input}
            />
          </Section>
          <Section title="Zeitbudget in Minuten">
            <TextInput
              accessibilityLabel="Zeitbudget in Minuten"
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
              style={styles.input}
            />
            {!validMinutes ? (
              <Copy muted>Bitte zwischen 5 und 600 Minuten eingeben.</Copy>
            ) : null}
          </Section>
          <Section title="Mögliche Lauftage">
            <View style={styles.days}>
              {DAYS.map((label, day) => (
                <Pressable
                  key={label}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: days.includes(day) }}
                  onPress={() =>
                    setDays(current =>
                      current.includes(day)
                        ? current.filter(item => item !== day)
                        : [...current, day],
                    )
                  }
                  style={[styles.day, days.includes(day) && styles.dayActive]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      days.includes(day) && styles.dayTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
          <Section title="Standardzweck">
            {PURPOSES.map(option => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: purpose === option.value }}
                onPress={() => setPurpose(option.value)}
                style={styles.choice}
              >
                <Text style={styles.choiceText}>{option.label}</Text>
                <Text style={styles.check}>
                  {purpose === option.value ? '✓' : ''}
                </Text>
              </Pressable>
            ))}
          </Section>
          <Button
            title="Weiter"
            onPress={next}
            disabled={saving || busy || !validMinutes}
          />
        </>
      ) : null}
      {step === 'import' ? (
        <>
          <Text style={styles.title}>Historie mitnehmen?</Text>
          <Copy muted>
            Importiere FIT, GPX, TCX oder einen Strava Export. Doppelte
            Aktivitäten werden erkannt.
          </Copy>
          <Button
            title={importRunning ? 'Import läuft …' : 'Dateien importieren'}
            onPress={onImport}
            disabled={busy || importRunning}
          />
          {importRunning && onCancelImport ? (
            <Button secondary title="Import abbrechen" onPress={onCancelImport} />
          ) : null}
          {status.imported !== undefined ? (
            <Copy>
              Importiert: {status.imported} · Doppelt: {status.duplicates || 0}{' '}
              · Übersprungen: {status.skipped || 0}
            </Copy>
          ) : null}
          <Button
            secondary
            title="Weiter"
            onPress={next}
            disabled={saving || busy || importRunning}
          />
        </>
      ) : null}
      {step === 'ready' ? (
        <>
          <Text style={styles.title}>Bereit für den ersten Lauf</Text>
          <Copy muted>
            Du kannst jederzeit unter Mehr → Einrichtung zurückkommen.
          </Copy>
          <Button
            secondary
            title="Aufzeichnungsberechtigungen anfragen"
            onPress={requestPermissions}
            disabled={saving || busy || permissionBusy}
          />
          {permissionStatus ? <Copy muted>{permissionStatus}</Copy> : null}
          <Button
            title="Los geht’s"
            onPress={finish}
            disabled={saving || busy || permissionBusy}
          />
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {step !== 'welcome' && step !== 'ready' ? (
        <Pressable
          onPress={() => saveAnd(STEPS[Math.max(index - 1, 0)])}
          disabled={!canLeave}
        >
          <Text style={styles.back}>Zurück</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export { Onboarding as OnboardingFlow };

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progress: { color: color.muted, fontSize: 13 },
  link: { color: color.green, fontSize: 15, fontWeight: '600' },
  progressLine: { flexDirection: 'row', gap: 6 },
  progressDot: {
    flex: 1,
    height: 4,
    backgroundColor: color.line,
    borderRadius: 2,
  },
  progressDotActive: { backgroundColor: color.green },
  title: { color: color.text, fontSize: 28, fontWeight: '700' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    padding: 14,
    color: color.text,
    backgroundColor: color.surface,
    fontSize: 16,
  },
  days: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  dayActive: { backgroundColor: color.green, borderColor: color.green },
  dayText: { color: color.text },
  dayTextActive: { color: color.ink, fontWeight: '700' },
  choice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  choiceText: { color: color.text, fontSize: 16 },
  check: { color: color.green, fontSize: 20 },
  back: { color: color.muted, textAlign: 'center', paddingVertical: 8 },
  error: { color: color.text, fontSize: 14, lineHeight: 20 },
});
