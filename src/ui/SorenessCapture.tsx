import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { regionLabel, type RegionId } from '../domain/regions';
import {
  buildReport,
  fromStructured,
  parseSoreness,
  type SorenessParse,
  type SorenessQuestion,
  type SorenessReport,
  type StructuredSorenessItem,
} from '../domain/sorenessInput';
import { BodyMap, regionsInView, type BodyView } from './BodyMap';
import { Button, color, Copy } from './components';

/**
 * Kurze Abfrage nach docs/zielspezifikation-training.md T-10.
 *
 * Sprache ist der schnelle Weg, Tippen der gleichwertige — nicht der Notweg.
 * Beide färben die Figur sofort; gespeichert wird erst nach einem Tippen auf
 * „Übernehmen“. „Heute nichts“ ist eine eigenständige, wertvolle Antwort.
 * Überspringen ist jederzeit möglich und hat keine Folgen für die Auswertung.
 */

export interface TranscriptResult {
  text: string;
  /**
   * Optionale strukturierte Felder aus dem zuschaltbaren OpenRouter-Durchlauf.
   * Sie gehen durch dasselbe Lexikon wie die gesprochene Eingabe; was dort
   * nicht steht, wird verworfen (Invariante 6).
   */
  structured?: StructuredSorenessItem[];
}

export interface SorenessCaptureProps {
  now: number;
  /** Sprachweg verfügbar. Fehlt er, bleibt das Tippen vollständig nutzbar. */
  voiceAvailable: boolean;
  /** Grund, warum der Sprachweg gerade nicht geht. Wird unverändert gezeigt. */
  voiceHint?: string;
  onTranscribe?: () => Promise<TranscriptResult>;
  onSave: (report: SorenessReport) => void;
  onSkip: () => void;
}

/** Stärkeschritte des Lexikons plus die beiden Ränder. */
const STEPS: { value: number; label: string }[] = [
  { value: 0, label: 'kein Muskelkater · 0' },
  { value: 3, label: 'leicht · 3' },
  { value: 5, label: 'mittel · 5' },
  { value: 6, label: 'ordentlich · 6' },
  { value: 8, label: 'stark · 8' },
  { value: 9, label: 'extrem · 9' },
  { value: 10, label: 'mehr geht nicht · 10' },
];

type Values = Record<RegionId, number | null>;

export function SorenessCapture({
  now,
  voiceAvailable,
  voiceHint,
  onTranscribe,
  onSave,
  onSkip,
}: SorenessCaptureProps) {
  const [values, setValues] = useState<Values>({});
  const [view, setView] = useState<BodyView>('front');
  const [questions, setQuestions] = useState<SorenessQuestion[]>([]);
  const [pending, setPending] = useState<RegionId[]>([]);
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const [usedVoice, setUsedVoice] = useState(false);
  const [usedTap, setUsedTap] = useState(false);

  const answered = useMemo(
    () => Object.keys(values).filter(id => typeof values[id] === 'number'),
    [values],
  );

  const apply = useCallback((ids: RegionId[], value: number | null) => {
    setValues(previous => {
      const next = { ...previous };
      ids.forEach(id => {
        if (value === null) {
          delete next[id];
        } else {
          next[id] = value;
        }
      });
      return next;
    });
  }, []);

  const absorb = useCallback((parse: SorenessParse) => {
    setValues(previous => {
      const next = { ...previous };
      parse.proposals.forEach(entry => {
        next[entry.regionId] = entry.value;
      });
      return next;
    });
    setQuestions(parse.questions);
  }, []);

  const listen = useCallback(async () => {
    if (!onTranscribe) {
      return;
    }
    setListening(true);
    setNotice('');
    try {
      const result = await onTranscribe();
      setTranscript(result.text || '');
      setUsedVoice(true);
      // Der regelbasierte Weg ist immer maßgeblich. Strukturierte Felder aus
      // OpenRouter ergänzen nur, was er offen gelassen hat.
      const rules = parseSoreness(result.text || '');
      if (result.structured && result.structured.length) {
        const checked = fromStructured(result.structured, result.text || '');
        absorb({
          ...rules,
          proposals: [...rules.proposals, ...checked.proposals],
          questions: rules.proposals.length
            ? rules.questions
            : [...rules.questions, ...checked.questions],
        });
      } else {
        absorb(rules);
      }
      if (rules.nothingToday) {
        setNotice('Verstanden: heute nichts. Bitte noch bestätigen.');
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Die Spracherkennung hat nicht geantwortet. Tippen geht weiter.',
      );
    } finally {
      setListening(false);
    }
  }, [absorb, onTranscribe]);

  const answerQuestion = useCallback(
    (question: SorenessQuestion, ids: RegionId[]) => {
      setQuestions(previous => previous.filter(item => item !== question));
      if (typeof question.value === 'number') {
        apply(ids, question.value);
      } else {
        setPending(ids);
      }
    },
    [apply],
  );

  const nothingToday = useCallback(() => {
    onSave(buildReport({}, now, usedVoice ? 'voice' : 'tap', transcript));
  }, [now, onSave, transcript, usedVoice]);

  const confirm = useCallback(() => {
    const source =
      usedVoice && usedTap ? 'mixed' : usedVoice ? 'voice' : 'tap';
    onSave(buildReport(values, now, source, transcript));
  }, [now, onSave, transcript, usedTap, usedVoice, values]);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Wo hast du Muskelkater?</Text>
      <Copy muted>
        Sprich es oder tippe es auf der Figur an. Beides ist gleichwertig.
        Überspringen ist folgenlos.
      </Copy>

      <View style={styles.actions}>
        <Button onPress={nothingToday} title="Heute nichts" />
        <Button
          disabled={!voiceAvailable || listening || !onTranscribe}
          onPress={() => {
            void listen();
          }}
          secondary
          title={listening ? 'Hört zu …' : 'Sprechen'}
        />
        <Button onPress={onSkip} secondary small title="Überspringen" />
      </View>

      {!voiceAvailable ? (
        <Copy muted>
          {voiceHint ||
            'Die Spracheingabe steht auf diesem Gerät nicht bereit. Tippen funktioniert unverändert.'}
        </Copy>
      ) : null}

      {notice ? <Copy>{notice}</Copy> : null}

      {transcript ? (
        <View style={styles.transcript}>
          <Copy muted>Gehört: „{transcript}“</Copy>
        </View>
      ) : null}

      {questions.map((question, index) => (
        <View key={`q-${index}-${question.fragment}`} style={styles.question}>
          <Copy>{question.question}</Copy>
          <View style={styles.chips}>
            {question.kind === 'side' ? (
              <>
                {question.candidates.map(id => (
                  <Chip
                    key={id}
                    label={regionLabel(id)}
                    onPress={() => answerQuestion(question, [id])}
                  />
                ))}
                <Chip
                  label="beide"
                  onPress={() => answerQuestion(question, question.candidates)}
                />
              </>
            ) : question.kind === 'region' ? (
              question.candidates.map(id => (
                <Chip
                  key={id}
                  label={regionLabel(id)}
                  onPress={() => answerQuestion(question, [id])}
                />
              ))
            ) : question.kind === 'intensity' ? (
              STEPS.map(step => (
                <Chip
                  key={step.value}
                  label={step.label}
                  onPress={() => {
                    setQuestions(previous =>
                      previous.filter(item => item !== question),
                    );
                    apply(question.candidates, step.value);
                  }}
                />
              ))
            ) : null}
          </View>
        </View>
      ))}

      {pending.length ? (
        <View style={styles.question}>
          <Copy>
            Wie stark ist es an {pending.map(regionLabel).join(' und ')}?
          </Copy>
          <View style={styles.chips}>
            {STEPS.map(step => (
              <Chip
                key={step.value}
                label={step.label}
                onPress={() => {
                  apply(pending, step.value);
                  setUsedTap(true);
                  setPending([]);
                }}
              />
            ))}
            <Chip
              label="Angabe entfernen"
              onPress={() => {
                apply(pending, null);
                setPending([]);
              }}
            />
          </View>
        </View>
      ) : null}

      <BodyMap
        mode="soreness"
        onChangeView={setView}
        onSelectRegion={id => {
          setUsedTap(true);
          setPending([id]);
        }}
        selected={pending[0] ?? null}
        values={values}
        view={view}
      />

      <Copy muted>
        {answered.length
          ? `${answered.length} von ${
              regionsInView(view).length
            } Regionen dieser Ansicht angegeben. Ohne Angabe bleibt eine Region unbekannt.`
          : 'Noch nichts angegeben. Ohne Angabe bleibt eine Region unbekannt.'}
      </Copy>

      <Button
        disabled={!answered.length}
        onPress={confirm}
        title="Übernehmen und speichern"
      />
    </ScrollView>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View style={styles.chip}>
      <Button onPress={onPress} secondary small title={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: 18, gap: 12, paddingBottom: 48 },
  title: { color: color.text, fontSize: 26, fontWeight: '600' },
  actions: { gap: 10, marginTop: 4 },
  transcript: {
    backgroundColor: color.surface,
    borderRadius: 8,
    padding: 12,
  },
  question: {
    backgroundColor: color.raised,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44 },
});
