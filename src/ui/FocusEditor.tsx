import React, { useState } from 'react';
import {
  BROAD_FOCUS,
  FOCUS_VERSION,
  focusLabel,
  focusTypesFor,
  suggestedFocus,
  type FocusKind,
  type TrainingFocus,
} from '../domain/focus';
import { AREA_LABELS } from '../domain/areas';
import type { Area } from '../domain/types';
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

/**
 * Fokus eines Bereichs. Für Krafttraining trägt die Seite zusätzlich das
 * Ziel, weil es dort keine eigene „Ziel & Alltag“-Seite gibt.
 */
export function FocusEditor({
  area = 'running',
  focus,
  goal,
  persist,
  goalEditor,
}: {
  area?: Area;
  focus?: TrainingFocus | null;
  goal: string;
  persist: (focus: TrainingFocus | null) => Promise<void>;
  goalEditor?: {
    value: string;
    targetDate: string;
    persist: (goal: string, targetDate: string) => Promise<void>;
  };
}) {
  const [kind, setKind] = useState<FocusKind | ''>(focus?.kind || '');
  const [label, setLabel] = useState(focus?.label || '');
  const [goalInput, setGoalInput] = useState(goalEditor?.value || '');
  const [targetInput, setTargetInput] = useState(goalEditor?.targetDate || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const suggestion = suggestedFocus(goal, area);
  const types = focusTypesFor(area);
  async function run(task: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      await task();
      setMessage(done);
    } catch {
      setMessage('Speichern hat nicht geklappt. Versuche es erneut.');
    } finally {
      setBusy(false);
    }
  }
  async function save(next: TrainingFocus | null) {
    await run(
      async () => {
        await persist(next);
        setKind(next?.kind || '');
        setLabel(next?.label || '');
      },
      next ? 'Fokus gespeichert.' : 'Fokus entfernt.',
    );
  }
  return (
    <>
      <Title>Wähle, woran du arbeiten möchtest.</Title>
      <Copy muted>
        {AREA_LABELS[area]} · Dein Fokus bleibt, solange er zu dir passt. Du
        kannst auch ohne Fokus trainieren.
      </Copy>
      {message ? (
        <Notice onDismiss={() => setMessage('')}>{message}</Notice>
      ) : null}
      {goalEditor ? (
        <Section title="Dein Ziel">
          <Field label="Ziel (optional)">
            <Input
              label="Ziel im Krafttraining"
              value={goalInput}
              onChangeText={setGoalInput}
              editable={!busy}
              placeholder="Zum Beispiel: 100 kg Kniebeuge"
            />
          </Field>
          <Field label="Zieldatum (optional, JJJJ-MM-TT)">
            <Input
              label="Zieldatum im Krafttraining"
              value={targetInput}
              onChangeText={setTargetInput}
              editable={!busy}
              placeholder="2027-03-01"
            />
          </Field>
          <Button
            secondary
            title="Ziel speichern"
            disabled={busy}
            onPress={() =>
              void run(
                () => goalEditor.persist(goalInput.trim(), targetInput.trim()),
                goalInput.trim() ? 'Ziel gespeichert.' : 'Ziel entfernt.',
              )
            }
          />
        </Section>
      ) : null}
      <Section title="Fokus-Art">
        <ChipGroup
          label="Fokus-Art"
          options={types.map(item => ({ ...item }))}
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
              area,
            })}`}
            onPress={() => setKind(suggestion)}
            disabled={busy}
          />
        ) : null}
        {kind && BROAD_FOCUS.includes(kind) ? (
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
          void save({ version: FOCUS_VERSION, kind, label: label.trim(), area })
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
