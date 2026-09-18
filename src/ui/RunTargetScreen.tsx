import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  NO_RUN_TARGET,
  RUN_TARGET_VERSION,
  formatTargetPace,
  normalizeRunTarget,
  parsePaceInput,
  type RunTarget,
  type RunTargetOutput,
} from '../domain/runTarget';
import type { RunPurpose } from '../domain/types';
import { nativeCall } from '../native';
import {
  Button,
  ChipGroup,
  Copy,
  Field,
  Input,
  Notice,
  Section,
  Title,
} from './components';

type TargetKind = RunTarget['kind'];

function hasConnectedHeartRateSensor(status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  const devices = (status as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return false;
  return devices.some(device => {
    if (!device || typeof device !== 'object') return false;
    const value = device as { connected?: unknown; services?: unknown };
    return (
      value.connected === true &&
      Array.isArray(value.services) &&
      value.services.some(service =>
        String(service).toLowerCase().includes('0000180d'),
      )
    );
  });
}

export function RunTargetScreen({
  value,
  purpose,
  onSave,
}: {
  value: RunTarget;
  purpose: RunPurpose;
  onSave: (target: RunTarget) => Promise<void>;
}) {
  const normalized = normalizeRunTarget(value);
  const [kind, setKind] = useState<TargetKind>(normalized.kind);
  const [paceInput, setPaceInput] = useState(
    normalized.kind === 'pace'
      ? formatTargetPace(normalized.secondsPerKm).replace(' /km', '')
      : '5:30',
  );
  const [minInput, setMinInput] = useState(
    normalized.kind === 'heart_rate' ? String(normalized.minBpm) : '130',
  );
  const [maxInput, setMaxInput] = useState(
    normalized.kind === 'heart_rate' ? String(normalized.maxBpm) : '150',
  );
  const [output, setOutput] = useState<RunTargetOutput>(
    normalized.kind === 'none' ? 'both' : normalized.output,
  );
  const [heartRateAvailable, setHeartRateAvailable] = useState(false);
  const [checkingSensor, setCheckingSensor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    nativeCall('bleStatus')
      .then(status => {
        if (mounted) setHeartRateAvailable(hasConnectedHeartRateSensor(status));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setCheckingSensor(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    setError('');
    let next: RunTarget = NO_RUN_TARGET;
    if (kind === 'pace') {
      const secondsPerKm = parsePaceInput(paceInput);
      if (secondsPerKm === null) {
        setError(
          'Gib das Tempo als Minuten und Sekunden ein, zum Beispiel 5:30.',
        );
        return;
      }
      next = {
        kind: 'pace',
        version: RUN_TARGET_VERSION,
        secondsPerKm,
        mode: purpose === 'easy' || purpose === 'long' ? 'ceiling' : 'range',
        output,
      };
    }
    if (kind === 'heart_rate') {
      const minBpm = Number(minInput);
      const maxBpm = Number(maxInput);
      if (
        !Number.isInteger(minBpm) ||
        !Number.isInteger(maxBpm) ||
        minBpm < 40 ||
        maxBpm > 240 ||
        maxBpm - minBpm < 5
      ) {
        setError('Gib einen Pulsbereich zwischen 40 und 240 bpm ein.');
        return;
      }
      if (!heartRateAvailable) {
        setError('Verbinde zuerst einen Bluetooth-Pulssensor.');
        return;
      }
      next = {
        kind: 'heart_rate',
        version: RUN_TARGET_VERSION,
        minBpm,
        maxBpm,
        output,
      };
    }
    setBusy(true);
    try {
      await onSave(next);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Das Laufziel konnte nicht gespeichert werden.',
      );
    } finally {
      setBusy(false);
    }
  };

  const kindOptions = [
    { value: 'none' as const, label: 'Ohne Ziel' },
    { value: 'pace' as const, label: 'Tempo' },
    {
      value: 'heart_rate' as const,
      label: 'Puls',
      disabled: !heartRateAvailable,
    },
  ];

  return (
    <>
      <Title>Wie möchtest du laufen?</Title>
      <Field label="Laufen nach">
        <ChipGroup
          label="Laufziel"
          options={kindOptions}
          value={kind}
          onChange={setKind}
          disabled={busy}
        />
      </Field>
      {!checkingSensor && !heartRateAvailable ? (
        <Copy muted>
          Puls wird nach dem Verbinden eines Bluetooth-Sensors wählbar.
        </Copy>
      ) : null}
      {kind === 'pace' ? (
        <Section title="Tempo">
          <Field
            label="Minuten pro Kilometer"
            hint={
              purpose === 'easy' || purpose === 'long'
                ? 'Runback bremst nur, wenn du schneller wirst.'
                : 'Runback meldet, wenn du deutlich schneller oder langsamer wirst.'
            }
          >
            <Input
              label="Zieltempo in Minuten pro Kilometer"
              value={paceInput}
              onChangeText={setPaceInput}
              placeholder="5:30"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
            />
          </Field>
        </Section>
      ) : null}
      {kind === 'heart_rate' ? (
        <Section title="Pulsbereich">
          <View>
            <Field label="Untergrenze">
              <Input
                label="Untere Pulsgrenze"
                value={minInput}
                onChangeText={setMinInput}
                keyboardType="number-pad"
                editable={!busy}
              />
            </Field>
          </View>
          <Field label="Obergrenze">
            <Input
              label="Obere Pulsgrenze"
              value={maxInput}
              onChangeText={setMaxInput}
              keyboardType="number-pad"
              editable={!busy}
            />
          </Field>
          <Copy muted>Runback schätzt keine persönlichen Pulszonen.</Copy>
        </Section>
      ) : null}
      {kind !== 'none' ? (
        <Section title="Hinweise">
          <ChipGroup
            label="Ausgabe der Hinweise"
            options={[
              { value: 'both', label: 'Vibration & Stimme' },
              { value: 'vibration', label: 'Vibration' },
              { value: 'voice', label: 'Stimme' },
            ]}
            value={output}
            onChange={setOutput}
            disabled={busy}
          />
          <Copy muted>Die Vibration kommt von dem Gerät, das aufzeichnet.</Copy>
        </Section>
      ) : null}
      {error ? <Notice title="Prüfe deine Angabe">{error}</Notice> : null}
      <Button
        title={kind === 'none' ? 'Ohne Ziel übernehmen' : 'Ziel übernehmen'}
        onPress={save}
        disabled={busy || checkingSensor}
      />
    </>
  );
}
