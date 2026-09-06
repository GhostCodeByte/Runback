import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { nativeCall } from '../native';
import { VENDOR_INFOS, detectVendorForFile, type VendorId } from '../domain/vendorImports';
import { Button, Copy, Section, color } from './components';

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
  const [open, setOpen] = useState<VendorId | null>('fitbit');
  const [summary, setSummary] = useState<any>(null);
  const status = importStatus || {};
  const vendors = status.vendors || {};

  const refreshSummary = useCallback(() => {
    nativeCall<any>('getVendorSummary')
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary, status.imported, status.duplicates, status.state, status.wellness, status.strength]);

  const toggle = (id: VendorId) => setOpen(current => (current === id ? null : id));

  return (
    <>
      <Text style={styles.title}>App-Importe</Text>
      <Copy muted>
        Hole deine Historie aus anderen Apps nach Runback. Du exportierst dort
        eine Datei und importierst sie hier. Alles ist optional: Ohne Import
        funktionieren Aufzeichnung und Auswertung genauso.
      </Copy>
      <Section title="Import starten">
        <Copy muted>
          FIT, GPX, TCX, CSV, JSON und XML werden erkannt — auch als ZIP. GPS-Spuren
          werden zuerst eingelesen, damit Zusammenfassungen sie nicht verdrängen.
          Doppelte Läufe werden erkannt, Fehler einzelner Dateien stoppen den Rest nicht.
        </Copy>
        <Button title="Dateien wählen & importieren" onPress={onImport} disabled={busy} />
        {status.state === 'running' ? (
          <>
            <Copy>
              Import läuft: {status.processed ?? 0} Dateien verarbeitet
              {status.currentFile ? ` · ${status.currentFile}` : ''}
            </Copy>
            <Button secondary small title="Import abbrechen" onPress={onCancelImport} />
          </>
        ) : null}
        {status.imported !== undefined || status.wellness !== undefined ? (
          <Copy>
            Läufe: {status.imported ?? 0} importiert · {status.duplicates ?? 0} doppelt
            {status.wellness !== undefined ? ` · Kontextwerte: ${status.wellness}` : ''}
            {status.strength !== undefined ? ` · Krafteinheiten: ${status.strength}` : ''}
            {status.skipped !== undefined ? ` · ${status.skipped} übersprungen` : ''}
            {status.failed !== undefined ? ` · ${status.failed} fehlgeschlagen` : ''}
          </Copy>
        ) : null}
        {(status.errors || []).slice(0, 20).map((item: any, i: number) => (
          <Copy muted key={i}>
            {item.file ? `${item.file}: ` : ''}{item.message || item.reason || String(item)}
          </Copy>
        ))}
        {summary?.wellness && Object.keys(summary.wellness).length ? (
          <Copy muted>
            Kontext vorhanden: {Object.entries(summary.wellness).map(([kind, info]: [string, any]) => `${kind} (${info.count})`).join(', ')}
          </Copy>
        ) : null}
        {summary?.strength?.workouts ? (
          <Copy muted>
            Krafteinheiten: {summary.strength.workouts} gespeichert (Strong & Co., nur Kontext, keine Laufwertung).
          </Copy>
        ) : null}
        <Copy muted>
          Tipp: Dateiname verrät meist die Quelle — z. B. export.xml (Apple), com.samsung.*.csv
          (Samsung), heart_rate-*.json (Fitbit), SPORT*.csv (Mi Fitness), strong.csv (Strong).
        </Copy>
      </Section>
      {VENDOR_INFOS.map(vendor => {
        const expanded = open === vendor.id;
        const counts = vendors[vendor.id] || vendors[vendor.id.replace('_', '')];
        return (
          <View key={vendor.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => toggle(vendor.id)}
              style={styles.cardHeader}
            >
              <View style={styles.cardTitleWrap}>
                <Text style={styles.cardTitle}>{vendor.name}</Text>
                <Text style={styles.cardSubtitle}>{vendor.short}</Text>
                {counts ? (
                  <Text style={styles.cardCounts}>
                    {counts.imported ?? 0} Läufe · {counts.wellness ?? 0} Kontext
                    {counts.strength ? ` · ${counts.strength} Kraft` : ''}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.chevron}>{expanded ? '⌄' : '›'}</Text>
            </Pressable>
            {expanded ? (
              <View style={styles.cardBody}>
                <Text style={styles.bodyTitle}>So exportierst du</Text>
                {vendor.exportSteps.map((step, i) => (
                  <Copy key={i}>
                    {i + 1}. {step}
                  </Copy>
                ))}
                <Text style={styles.bodyTitle}>Dateien</Text>
                {vendor.filePatterns.map((pattern, i) => (
                  <Copy muted key={i}>• {pattern}</Copy>
                ))}
                <Text style={styles.bodyTitle}>Was Runback damit macht</Text>
                {vendor.useful.map((item, i) => (
                  <View key={i} style={styles.useful}>
                    <Text style={styles.usefulLabel}>{item.label}</Text>
                    <Copy muted>{item.why} {item.howUsed}</Copy>
                  </View>
                ))}
                <Text style={styles.bodyTitle}>Grenzen</Text>
                {vendor.limitations.map((line, i) => (
                  <Copy muted key={i}>• {line}</Copy>
                ))}
                <Copy muted>{vendor.privacy}</Copy>
                <Button secondary small title="Diese Dateien importieren" onPress={onImport} disabled={busy} />
              </View>
            ) : null}
          </View>
        );
      })}
      <Section title="Datei prüfen">
        <Copy muted>
          Unsicher, wohin eine Datei gehört? Beispiele: export.xml → Apple Health,
          com.samsung.shealth.exercise.*.csv → Samsung, heart_rate-2024-03-15.json → Fitbit,
          SPORT*.csv → Mi Fitness, strong.csv → Strong, summarizedActivities.json → Garmin.
        </Copy>
        <Copy muted>
          Erkannt wird automatisch beim Import — auch ohne diese Seite. Du musst nichts
          vorsortieren.
        </Copy>
        {onOpenDocs ? (
          <Button secondary small title="Ausführliche Anleitung lesen" onPress={onOpenDocs} />
        ) : null}
      </Section>
      <Section title="Was nicht passiert">
        <Copy muted>
          Keine automatische Cloud-Synchronisierung, keine Readiness-Scores, keine Diagnosen.
          Schlaf, Puls, HRV und Kraftwerte sind reiner Anzeige-Kontext. Empfehlungen entstehen
          weiter nur aus Laufdaten mit prüfbaren Regeln.
        </Copy>
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
  title: { color: color.text, fontSize: 30, fontWeight: '600' },
  card: {
    marginTop: 16,
    backgroundColor: color.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  cardTitleWrap: { flex: 1, gap: 4 },
  cardTitle: { color: color.text, fontSize: 17, fontWeight: '600' },
  cardSubtitle: { color: color.muted, fontSize: 14 },
  cardCounts: { color: color.green, fontSize: 13 },
  chevron: { color: color.muted, fontSize: 24 },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  bodyTitle: { color: color.text, fontSize: 15, fontWeight: '600', marginTop: 8 },
  useful: { gap: 2 },
  usefulLabel: { color: color.text, fontSize: 15, fontWeight: '500' },
});
