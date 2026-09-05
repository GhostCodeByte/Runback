import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Switch, TextInput} from 'react-native';
import {nativeCall} from '../native';
import type {RunAnalysis} from '../domain/types';
import {Button, Copy, Row, Section, color} from './components';

export function ProseSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('openrouter/free');
  const [limit, setLimit] = useState('0');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {let mounted = true; nativeCall<any>('getProseSettings').then(value => {if (mounted) {setSettings(value); setModel(value.model); setLimit(String(value.dailyRequestLimit)); setEnabled(value.enabled);}}).catch(() => {}); return () => {mounted = false;};}, []);
  const act = async (fn: () => Promise<void>) => {setBusy(true); setMessage(''); try {await fn();} catch (error) {setMessage(error instanceof Error ? error.message : 'Einstellung konnte nicht gespeichert werden.');} finally {setBusy(false);}};
  return <Section title="Optionale Textdarstellung"><Copy muted>OpenRouter kann die Darstellung bestehender Engine-Aussagen auswählen. Die Entscheidung und ihre Inhalte bleiben unverändert. Keine Koordinaten, Notizen oder Rohsamples werden übermittelt.</Copy><Row title="OpenRouter verwenden" subtitle={settings?.hasKey ? 'Eigener Schlüssel ist gespeichert' : 'Eigener API-Schlüssel erforderlich'} trailing={<Switch accessibilityLabel="OpenRouter aktivieren" value={enabled} onValueChange={setEnabled} trackColor={{false: color.line, true: color.green}} thumbColor={enabled ? color.ink : color.muted} />} /><Copy>API-Schlüssel</Copy><TextInput accessibilityLabel="OpenRouter API-Schlüssel" secureTextEntry autoCapitalize="none" autoCorrect={false} value={key} onChangeText={setKey} placeholder={settings?.hasKey ? 'Gespeicherten Schlüssel ersetzen' : 'Eigenen Schlüssel eingeben'} placeholderTextColor={color.muted} style={styles.input} /><Copy>Modell</Copy><TextInput accessibilityLabel="OpenRouter Modell" autoCapitalize="none" autoCorrect={false} value={model} onChangeText={setModel} style={styles.input} /><Copy muted>Freie Modellwahl mit eigenem Key. Je nach Modell können bei OpenRouter Kosten anfallen; das Tageslimit begrenzt die Anfragen.</Copy><Copy>Maximale Anfragen pro Tag</Copy><TextInput accessibilityLabel="OpenRouter Tageslimit" keyboardType="number-pad" maxLength={3} value={limit} onChangeText={setLimit} style={styles.input} /><Copy muted>0 deaktiviert Anfragen. Heute verwendet: {settings?.requestsToday ?? 0}. Maximal 40 Ausgabetokens je Anfrage.</Copy><Button secondary title="Textdarstellung speichern" disabled={busy} onPress={() => {void act(async () => {const value = Number(limit); if (!Number.isInteger(value) || value < 0 || value > 100) {throw new Error('Das Tageslimit muss zwischen 0 und 100 liegen.');} setSettings(await nativeCall('configureProse', enabled, model.trim(), value, 40, key.trim() || null)); setKey(''); setMessage('Einstellungen gespeichert.');});}} />{settings?.hasKey ? <Button secondary title="Schlüssel entfernen" disabled={busy} onPress={() => {void act(async () => {setSettings(await nativeCall('clearProseKey')); setEnabled(false); setKey('');});}} /> : null}<Button secondary small title="Textcache leeren" disabled={busy} onPress={() => {void act(async () => {await nativeCall('clearProseCache'); setMessage('Textcache geleert.');});}} />{message ? <Copy>{message}</Copy> : null}</Section>;
}

export function ProseExplanation({analysis}: {analysis: RunAnalysis}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = JSON.stringify(analysis);
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {setText('');}, [input]);
  return <Section title="Alternative Darstellung"><Button secondary title="Aussagen kompakt darstellen" disabled={busy} onPress={() => {setBusy(true); const requested = input; nativeCall<any>('requestProse', requested).then(result => {if (latest.current !== requested) {return;} if (result.classification !== analysis.classification || result.focus !== analysis.focus || result.nextAction !== analysis.nextAction) {setText('Die ursprüngliche Einordnung bleibt gültig.'); return;} setText(result.text + (result.source === 'template' ? '\n\nLokale Textvorlage; kein externer Text verwendet.' : '\n\nDarstellung aus unveränderten Engine-Aussagen.'));}).catch(error => {if (latest.current === requested) {setText(error.message);}}).finally(() => setBusy(false));}} />{text ? <Copy>{text}</Copy> : null}</Section>;
}
const styles = StyleSheet.create({input: {borderWidth: 1, borderColor: color.line, borderRadius: 8, padding: 14, color: color.text, backgroundColor: color.surface, fontSize: 16, minHeight: 52}});
