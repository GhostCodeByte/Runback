import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { nativeCall } from '../native';
import { Button, Copy, Section, color } from './components';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatResult = {
  messages: ChatMessage[];
  model?: string;
  includeTraining?: boolean;
};

type ProseSettings = {
  enabled?: boolean;
  hasKey?: boolean;
  model?: string;
};

export function TrainingChat({ onSettings }: { onSettings: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [includeTraining, setIncludeTraining] = useState(true);
  const [settings, setSettings] = useState<ProseSettings | null>(null);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const sendingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      nativeCall<ChatResult>('getChatHistory'),
      nativeCall<ProseSettings>('getProseSettings'),
    ])
      .then(([history, prose]) => {
        if (!mounted) return;
        setMessages(history.messages || []);
        setIncludeTraining(history.includeTraining ?? true);
        setModel(history.model || prose.model || '');
        setSettings(prose);
        setLoadingFailed(false);
        setError('');
      })
      .catch(value => {
        if (mounted) {
          setLoadingFailed(true);
          setError(
            value instanceof Error
              ? value.message
              : 'Der Chat konnte nicht geladen werden.',
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadToken]);

  const refreshHistory = async () => {
    const result = await nativeCall<ChatResult>('getChatHistory');
    setMessages(result.messages || []);
    if (typeof result.includeTraining === 'boolean') {
      setIncludeTraining(result.includeTraining);
    }
    if (result.model) setModel(result.model);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || sendingRef.current) return;
    if (!settings?.enabled || !settings.hasKey) {
      setError(
        'Bitte richte zuerst den OpenRouter-Zugang in den Einstellungen ein.',
      );
      return;
    }

    sendingRef.current = true;
    setBusy(true);
    setError('');
    const optimistic = [...messages, { role: 'user' as const, content: text }];
    setMessages(optimistic.slice(-40));
    try {
      const result = await nativeCall<ChatResult>(
        'sendChat',
        text,
        includeTraining,
      );
      setMessages((result.messages || []).slice(-40));
      if (typeof result.includeTraining === 'boolean') {
        setIncludeTraining(result.includeTraining);
      }
      if (result.model) setModel(result.model);
      setDraft('');
    } catch (value) {
      try {
        await refreshHistory();
      } catch {
        // Keep the original send error visible when a recovery refresh also fails.
      }
      setError(
        value instanceof Error
          ? value.message
          : 'Die Nachricht konnte nicht gesendet werden.',
      );
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  const clearConversation = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await nativeCall<ChatResult>('clearChatHistory');
      setMessages(result.messages || []);
      if (typeof result.includeTraining === 'boolean') {
        setIncludeTraining(result.includeTraining);
      }
      if (result.model) setModel(result.model);
      setDraft('');
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : 'Die Unterhaltung konnte nicht gelöscht werden.',
      );
    } finally {
      setBusy(false);
    }
  };

  const changeTrainingAccess = async (value: boolean) => {
    if (busy || value === includeTraining) return;
    const previous = includeTraining;
    setIncludeTraining(value);
    setBusy(true);
    setError('');
    try {
      const result = await nativeCall<ChatResult>('clearChatHistory');
      setMessages(result.messages || []);
      if (typeof result.includeTraining === 'boolean') {
        setIncludeTraining(result.includeTraining);
      }
      if (result.model) setModel(result.model);
    } catch (valueError) {
      setIncludeTraining(previous);
      setError(
        valueError instanceof Error
          ? valueError.message
          : 'Die neue Chat-Einstellung konnte nicht übernommen werden.',
      );
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(settings?.enabled && settings?.hasKey);
  const displayedMessages = messages.slice(-40);

  return (
    <Section title="Trainingschat">
      <View accessibilityRole="text" style={styles.intro}>
        <Copy muted>
          Deine Nachrichten und freigegebene Trainingsdaten werden an OpenRouter
          und den gewählten Modellanbieter übertragen.
        </Copy>
      </View>

      <View style={styles.accessRow}>
        <View style={styles.accessText}>
          <Text style={styles.label}>Trainingsdaten einbeziehen</Text>
          <Text style={styles.hint}>
            {includeTraining
              ? 'Profil, Läufe, Laufgefühl und Notizen. Nur lesend.'
              : 'Nur ein allgemeiner Chat ohne Zugriff auf Trainingsdaten.'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Trainingsdaten einbeziehen"
          accessibilityState={{
            checked: includeTraining,
            disabled: busy || loading,
          }}
          disabled={busy || loading}
          value={includeTraining}
          onValueChange={value => void changeTrainingAccess(value)}
          trackColor={{ false: color.line, true: color.green }}
          thumbColor={includeTraining ? color.ink : color.muted}
        />
      </View>

      {loading ? <Copy muted>Unterhaltung wird geladen …</Copy> : null}
      {!loading && !ready ? (
        <Button secondary title="OpenRouter einrichten" onPress={onSettings} />
      ) : null}
      {displayedMessages.map((message, index) => (
        <View
          key={`${index}-${message.role}-${message.content.slice(0, 16)}`}
          accessibilityRole="text"
          accessibilityLabel={`${message.role === 'user' ? 'Du' : 'Runback'}: ${
            message.content
          }`}
          style={[
            styles.message,
            message.role === 'user' && styles.userMessage,
          ]}
        >
          <Text style={styles.messageRole}>
            {message.role === 'user' ? 'Du' : 'Runback'}
          </Text>
          <Text style={styles.messageText}>{message.content}</Text>
        </View>
      ))}

      {displayedMessages.length === 0 && !loading ? (
        <Copy muted>Stelle eine Frage zu deinem Training.</Copy>
      ) : null}

      <View style={styles.chips}>
        {[
          'Was steht diese Woche an?',
          'Wie war mein letzter Lauf?',
          'Erkläre mein Experiment',
        ].map(prompt => (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            accessibilityLabel={`Frage verwenden: ${prompt}`}
            disabled={busy}
            onPress={() => setDraft(prompt)}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          >
            <Text style={styles.chipText}>{prompt}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        accessibilityLabel="Nachricht an den Trainingschat"
        accessibilityHint="Frage eingeben und anschließend Senden drücken"
        multiline
        editable={!busy}
        maxLength={6000}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => void send()}
        placeholder="Zum Beispiel: Wie sollte ich diese Woche trainieren?"
        placeholderTextColor={color.muted}
        style={styles.input}
      />
      <Button
        title={busy ? 'Wird gesendet …' : 'Senden'}
        disabled={busy || !draft.trim() || !ready}
        onPress={() => void send()}
      />
      {loadingFailed ? (
        <Button
          secondary
          small
          title="Erneut laden"
          disabled={busy}
          onPress={() => {
            setLoadingFailed(false);
            setLoading(true);
            setError('');
            setReloadToken(value => value + 1);
          }}
        />
      ) : null}
      <Button
        secondary
        small
        title="OpenRouter-Einstellungen"
        disabled={busy}
        onPress={onSettings}
      />
      <Button
        secondary
        small
        title="Unterhaltung löschen"
        disabled={busy || messages.length === 0}
        onPress={() => void clearConversation()}
      />
      {model ? <Copy muted>Modell: {model}</Copy> : null}
      <Copy muted>
        KI-Antworten sind Einschätzungen und ändern keine Auswertung oder
        Experimente. Der automatische Datenzugriff enthält keine GPS-Koordinaten
        oder Rohsamples. Die letzten 40 Nachrichten bleiben lokal gespeichert;
        davon werden bis zu 18 als Gesprächskontext gesendet.
      </Copy>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  title: { color: color.text, fontSize: 17, fontWeight: '600' },
  accessRow: {
    alignItems: 'center',
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
  },
  accessText: { flex: 1, gap: 4 },
  label: { color: color.text, fontSize: 16, fontWeight: '500' },
  hint: { color: color.muted, fontSize: 14, lineHeight: 20 },
  message: {
    alignSelf: 'flex-start',
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 10,
    borderWidth: 1,
    gap: 5,
    maxWidth: '92%',
    padding: 13,
  },
  userMessage: { alignSelf: 'flex-end', backgroundColor: color.raised },
  messageRole: { color: color.green, fontSize: 12, fontWeight: '700' },
  messageText: { color: color.text, fontSize: 16, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipText: { color: color.text, fontSize: 14 },
  pressed: { opacity: 0.72 },
  input: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 8,
    borderWidth: 1,
    color: color.text,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 88,
    padding: 14,
    textAlignVertical: 'top',
  },
  settingsPrompt: { gap: 10 },
  error: { color: color.text, fontSize: 15, lineHeight: 22 },
});
