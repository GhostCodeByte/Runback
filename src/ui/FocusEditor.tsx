import React, { useState } from 'react';
import {
  FOCUS_TYPES,
  FOCUS_VERSION,
  focusLabel,
  suggestedFocus,
  type FocusKind,
  type TrainingFocus,
} from '../domain/focus';
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

export function FocusEditor({
  focus,
  goal,
  persist,
}: {
  focus?: TrainingFocus | null;
  goal: string;
  persist: (focus: TrainingFocus | null) => Promise<void>;
}) {
  const [kind, setKind] = useState<FocusKind | ''>(focus?.kind || '');
  const [label, setLabel] = useState(focus?.label || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const suggestion = suggestedFocus(goal);
  async function save(next: TrainingFocus | null) {
    setBusy(true);
    setMessage('');
    try {
      await persist(next);
      setKind(next?.kind || '');
      setLabel(next?.label || '');
      setMessage(next ? 'Fokus gespeichert.' : 'Fokus entfernt.');
    } catch {
      setMessage('Speichern hat nicht geklappt. Versuche es erneut.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title>Wähle, woran du arbeiten möchtest.</Title>
      <Copy muted>
        Dein Fokus bleibt, solange er zu dir passt. Du kannst auch ohne Fokus
        trainieren.
      </Copy>
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
      <Section title="Fokus-Art">
        <ChipGroup
          label="Fokus-Art"
          options={FOCUS_TYPES.map(item => ({ ...item }))}
          value={kind}
          onChange={value => setKind(value as FocusKind)}
          disabled={busy}
        />
        {!focus && suggestion && !kind ? (
          <Button
            secondary
            title={`Vorschlag zum Ziel: ${focusLabel({
              version: FOCUS_VERSION,
              kind: suggestion,
              label: '',
            })}`}
            onPress={() => setKind(suggestion)}
            disabled={busy}
          />
        ) : null}
        {kind === 'fitness' ? (
          <Copy muted>
            Für diesen breiten Fokus zählen passende Daten und gut umsetzbare
            Empfehlungen.
          </Copy>
        ) : null}
      </Section>
      <Field label="Eigene Bezeichnung (optional)">
        <Input
          label="Eigene Fokusbezeichnung"
          value={label}
          onChangeText={setLabel}
          editable={!busy}
          placeholder="Zum Beispiel: gut durch den Winter"
        />
      </Field>
      <Copy muted>
        Deine Bezeichnung wird nur angezeigt. Die Fokus-Art hilft bei der
        Auswahl künftiger Empfehlungen.
      </Copy>
      <Button
        title="Fokus speichern"
        disabled={busy || !kind}
        onPress={() =>
          kind &&
          void save({ version: FOCUS_VERSION, kind, label: label.trim() })
        }
      />
      {focus ? (
        <Button
          secondary
          title="Fokus entfernen"
          disabled={busy}
          onPress={() => void save(null)}
        />
      ) : null}
      <Copy muted>
        Eine laufende Empfehlung bleibt mit ihren bisherigen Regeln bestehen.
      </Copy>
    </>
  );
}
