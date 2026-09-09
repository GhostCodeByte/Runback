import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { nativeCall } from '../native';
import {
  VENDOR_INFOS,
  detectVendorForFile,
  type VendorId,
} from '../domain/vendorImports';
import { Button, Copy, Row, Section, Title, space } from './components';

/**
 * App-Importe: erst die Quelle wählen, dann die Schritte genau dieser Quelle.
 * Vorher standen die Anleitungen aller Anbieter gleichzeitig auf der Seite.
 * Siehe docs/design-language.md § 9.
 */
export function VendorImport({
  onImport,
  onCancelImport,
  onOpenDocs,
  busy,
  importStatus,
}: {
  onImport: () => void;
  onCancelImport: () => void;
  onOpenDocs?: () => void;
  busy: boolean;
  importStatus: any;
}) {
  const [selected, setSelected] = useState<VendorId | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const status = importStatus || {};
  const vendors = status.vendors || {};
  const vendor = VENDOR_INFOS.find(item => item.id === selected) || null;

  const refreshSummary = useCallback(() => {
    nativeCall<any>('getVendorSummary')
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
  }, [
    refreshSummary,
    status.imported,
    status.duplicates,
    status.state,
    status.wellness,
    status.strength,
  ]);

  const progress =
    status.state === 'running' ? (
      <>
        <Copy>
          Import läuft: {status.processed ?? 0} Dateien verarbeitet
          {status.currentFile ? ` · ${status.currentFile}` : ''}
        </Copy>
        <Button
          secondary
          small
          title="Import abbrechen"
          onPress={onCancelImport}
        />
      </>
    ) : null;

  const result =
    status.imported !== undefined || status.wellness !== undefined ? (
      <Copy>
        Läufe: {status.imported ?? 0} importiert · {status.duplicates ?? 0}{' '}
        doppelt
        {status.wellness !== undefined
          ? ` · Kontextwerte: ${status.wellness}`
          : ''}
        {status.strength !== undefined
          ? ` · Krafteinheiten: ${status.strength}`
          : ''}
        {status.nonRunning ? ` · ${status.nonRunning} keine Läufe` : ''}
        {status.skipped !== undefined ? ` · ${status.skipped} übersprungen` : ''}
        {status.failed !== undefined ? ` · ${status.failed} fehlgeschlagen` : ''}
      </Copy>
    ) : null;

  const errors = (status.errors || [])
    .slice(0, 20)
    .map((item: any, i: number) => (
      <Copy muted key={i}>
        {item.file ? `${item.file}: ` : ''}
        {item.message || item.reason || String(item)}
      </Copy>
    ));

  if (vendor) {
    const counts = vendors[vendor.id] || vendors[vendor.id.replace('_', '')];
    return (
      <>
        <Title>{vendor.name}</Title>
        <Copy muted>{vendor.short}</Copy>
        {progress}
        {result}
        {errors}
        <Section title="So exportierst du">
          {vendor.exportSteps.map((step, i) => (
            <Copy key={i}>
              {i + 1}. {step}
            </Copy>
          ))}
        </Section>
        {vendor.notes?.length ? (
          <Section title="Beachte">
            {vendor.notes.map((note, i) => (
              <Copy key={i}>{note}</Copy>
            ))}
          </Section>
        ) : null}
        <Section title="Diese Dateien">
          {vendor.filePatterns.map((pattern, i) => (
            <Copy muted key={i}>
              • {pattern}
            </Copy>
          ))}
        </Section>
        <View style={styles.action}>
          <Button
            title="Dateien wählen & importieren"
            onPress={onImport}
            disabled={busy}
          />
        </View>
        {counts ? (
          <Copy muted>
            Bereits übernommen: {counts.imported ?? 0} Läufe ·{' '}
            {counts.wellness ?? 0} Kontext
            {counts.strength ? ` · ${counts.strength} Kraft` : ''}
          </Copy>
        ) : null}
        <Section title="Was Runback damit macht">
          {vendor.useful.map((item, i) => (
            <Row key={i} title={item.label} subtitle={item.howUsed} />
          ))}
        </Section>
        <Section title="Grenzen">
          {vendor.limitations.map((line, i) => (
            <Copy muted key={i}>
              • {line}
            </Copy>
          ))}
          <Copy muted>{vendor.privacy}</Copy>
        </Section>
        <View style={styles.action}>
          <Button
            secondary
            title="Andere Quelle wählen"
            onPress={() => setSelected(null)}
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Title>App-Importe</Title>
      <Copy muted>Wähle, woher deine Daten kommen.</Copy>
      {progress}
      {result}
      {errors}
      <Section title="Quelle">
        {VENDOR_INFOS.map(item => {
          const counts = vendors[item.id] || vendors[item.id.replace('_', '')];
          return (
            <Row
              key={item.id}
              title={item.name}
              subtitle={
                counts
                  ? `${item.short} · ${counts.imported ?? 0} übernommen`
                  : item.short
              }
              onPress={() => setSelected(item.id)}
            />
          );
        })}
      </Section>
      {summary?.wellness && Object.keys(summary.wellness).length ? (
        <Section title="Gespeicherter Kontext">
          <Copy muted>
            {Object.entries(summary.wellness)
              .map(([kind, info]: [string, any]) => `${kind} (${info.count})`)
              .join(', ')}
          </Copy>
          {summary?.strength?.workouts ? (
            <Copy muted>
              Krafteinheiten: {summary.strength.workouts} gespeichert
            </Copy>
          ) : null}
        </Section>
      ) : null}
      <Section title="Was nicht passiert">
        <Copy muted>
          Keine Cloud-Synchronisierung, keine Readiness-Scores, keine Diagnosen.
        </Copy>
        {onOpenDocs ? (
          <Button
            secondary
            small
            title="Ausführliche Anleitung"
            onPress={onOpenDocs}
          />
        ) : null}
      </Section>
    </>
  );
}

export function vendorHintForFileName(fileName: string): string {
  const vendor = detectVendorForFile(fileName);
  const info = VENDOR_INFOS.find(v => v.id === vendor);
  return info ? `${info.name}` : 'Unbekannte Quelle';
}

const styles = StyleSheet.create({
  action: { marginTop: space.ml, gap: space.sm },
});
