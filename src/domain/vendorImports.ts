/**
 * Vendor import catalogue: which app exports Runback can read, what each file
 * contributes, and how it is used. Everything here is optional context —
 * recording and run analysis work without any import.
 *
 * Data usefulness per vendor (why Runback keeps it):
 * - Runs (GPS track or summary): same pacing/effort rules as native runs.
 *   Summaries without samples stay summary-only and never invent samples.
 * - Resting HR / HRV / sleep / weight / steps: Alltag context for the next run
 *   (e.g. explaining training days), displayed only. They never create a
 *   readiness score, diagnosis or automatic plan change.
 * - Strength sessions (Strong/Hevy/FitNotes CSV): cross-training load context
 *   (sessions, sets, volume). They never count as running evidence.
 */

export type VendorId =
  | 'fitbit'
  | 'google_fit'
  | 'strong'
  | 'mi_fitness'
  | 'apple_health'
  | 'samsung'
  | 'garmin'
  | 'polar'
  | 'strava'
  | 'huawei'
  | 'generic';

export interface VendorUsefulData {
  label: string;
  why: string;
  howUsed: string;
}

export interface VendorInfo {
  id: VendorId;
  name: string;
  short: string;
  exportSteps: string[];
  /**
   * Besonderheiten genau dieser Quelle (etwa das ZIP-Passwort, das nur Mi
   * Fitness verschickt). Sie werden erst nach der Auswahl gezeigt, damit die
   * Übersicht nicht die Hinweise aller Anbieter gleichzeitig trägt.
   */
  notes?: string[];
  filePatterns: string[];
  useful: VendorUsefulData[];
  limitations: string[];
  privacy: string;
}

export const VENDOR_INFOS: VendorInfo[] = [
  {
    id: 'fitbit',
    name: 'Fitbit / Google Health',
    short: 'Läufe, Puls, Schlaf, Schritte, Gewicht',
    exportSteps: [
      'Gesamtarchiv: takeout.google.com öffnen, nur „Fitbit“ wählen, Export als ZIP anfordern und herunterladen.',
      'Aktueller Zeitraum: Google-Health-App → Profil → Einstellungen → Daten exportieren, Zeitraum und CSV oder JSON wählen.',
      'Einzelne GPS-Läufe: Training in der App öffnen → Menü → Als TCX exportieren (pro Lauf, enthält die Route).',
      'Alle Dateien zusammen in Runback importieren: das Takeout-ZIP plus einzelne TCX-Dateien.',
    ],
    filePatterns: [
      'Takeout-ZIP mit Ordnern Physical Activity, Heart Rate, Sleep, Weight, HRV, SpO2',
      'heart_rate-YYYY-MM-DD.json (Puls im Tagesverlauf)',
      'sleep-YYYY-MM-DD.json (Schlafphasen je Nacht)',
      'Einzel-TCX je GPS-Training',
    ],
    useful: [
      {
        label: 'Läufe (TCX + Trainingsprotokoll)',
        why: 'Distanz, Dauer und Route für Tempo- und Pacing-Auswertung.',
        howUsed: 'Wie eigene Läufe, soweit Zeit und Distanz geeignet sind.',
      },
      {
        label: 'Ruhepuls & HRV (nächtlich)',
        why: 'Erholungskontext ohne Tagesform-Behauptung.',
        howUsed: 'Nur Anzeige im Import-Überblick, keine Bewertung.',
      },
      {
        label: 'Schlaf (Dauer, Phasen)',
        why: 'Alltagskontext für geplante Lauftage.',
        howUsed: 'Nur Anzeige, kein Readiness-Score.',
      },
      {
        label: 'Schritte, Distanz, Kalorien (Tageswerte)',
        why: 'Aktivitätskontext außerhalb des Laufens.',
        howUsed: 'Nur Anzeige im Überblick.',
      },
      {
        label: 'Gewicht & BMI',
        why: 'Körpertrend als Kontext.',
        howUsed: 'Nur Anzeige, keine Modellkorrektur.',
      },
    ],
    limitations: [
      'Kein gesammelter TCX-Bulkexport: GPS-Routen nur einzeln je Training.',
      'Sehr große Takeout-Archive brauchen Zeit; intraday-Reihen werden begrenzt übernommen.',
      'Schlafphasen über Health Connect sind grober als im Takeout-Archiv.',
    ],
    privacy:
      'Das Archiv enthält sensible Gesundheitsdaten. Es bleibt auf dem Gerät; Runback lädt nichts hoch.',
  },
  {
    id: 'google_fit',
    name: 'Google Fit (Takeout)',
    short: 'Sessions, Tageswerte, Schritte',
    exportSteps: [
      'takeout.google.com öffnen, nur „Google Fit“ bzw. „Fit“ wählen und Export anfordern.',
      'Heruntergeladenes ZIP in Runback importieren.',
      'GPS-Trainings zusätzlich einzeln als TCX/GPX sichern, falls die Fit-App das anbietet.',
    ],
    filePatterns: [
      'Takeout/Fit mit Sessions und Tageswerten (JSON)',
      'Optionale TCX/GPX je Training',
    ],
    useful: [
      {
        label: 'Lauf-Sessions (Start, Ende, Distanz)',
        why: 'Historie für Tempoauswertung, auch ohne GPS-Spur.',
        howUsed: 'Zusammenfassungs-Läufe ohne erfundene Samples.',
      },
      {
        label: 'Tageswerte (Schritte, Distanz, Kalorien)',
        why: 'Aktivitätskontext.',
        howUsed: 'Nur Anzeige.',
      },
      {
        label: 'Gewicht & Puls (falls protokolliert)',
        why: 'Körper- und Erholungskontext.',
        howUsed: 'Nur Anzeige.',
      },
    ],
    limitations: [
      'Je nach Konto sind Sessions nur Zusammenfassungen ohne GPS-Spur.',
      'Feldnamen variieren; unbekannte Felder werden übersprungen statt geraten.',
    ],
    privacy:
      'Takeout enthält das gesamte Fit-Konto. Nur importieren, was als Kontext dienen soll.',
  },
  {
    id: 'strong',
    name: 'Strong (Krafttraining)',
    short: 'Sätze, Volumen, RPE als Kontext',
    exportSteps: [
      'Strong öffnen → Profil → Einstellungen → Strong-Daten exportieren (iOS) bzw. Daten exportieren (Android).',
      'Die CSV-Datei (eine Zeile je Satz) per Datei, Mail oder Drive ans Telefon geben.',
      'CSV in Runback importieren. Auch Hevy- und FitNotes-CSVs mit ähnlichem Aufbau werden erkannt.',
    ],
    filePatterns: ['strong.csv bzw. Export-CSV mit Spalten Date, Exercise Name, Set Order, Weight, Reps'],
    useful: [
      {
        label: 'Krafteinheiten (Datum, Name, Dauer)',
        why: 'Training außerhalb des Laufens bleibt sichtbar.',
        howUsed: 'Anzahl und Termine im Überblick, keine Laufwertung.',
      },
      {
        label: 'Sätze (Übung, Gewicht, Wiederholungen)',
        why: 'Umfang pro Übung als Kontext.',
        howUsed: 'Volumen-Anzeige je Einheit, keine Empfehlungslogik.',
      },
      {
        label: 'RPE & Notizen (falls protokolliert)',
        why: 'Subjektive Belastung ergänzt das Lauf-RPE.',
        howUsed: 'Nur Anzeige in der Einheit.',
      },
      {
        label: 'Cardio-Zeilen (Distanz, Sekunden)',
        why: 'Laufband- oder Intervall-Hinweise.',
        howUsed: 'Bleiben Kraftkontext; ohne GPS-Spur kein Pacing-Lauf.',
      },
    ],
    limitations: [
      'Strong exportiert keine Gewichtseinheit: Runback nimmt kg an und zeigt die Annahme.',
      'Keine Superset- oder Aufwärm-Kennzeichnung im Export.',
      'Strong-Läufe ohne GPS-Spur werden keine Tempo-Läufe.',
    ],
    privacy: 'Die CSV enthält Trainingsnotizen im Klartext und bleibt lokal.',
  },
  {
    id: 'mi_fitness',
    name: 'Mi Fitness / Zepp Life (Xiaomi)',
    short: 'Läufe, Minutenpuls, Schritte',
    exportSteps: [
      'Einzelne Outdoor-Läufe: Training in Mi Fitness bzw. Zepp öffnen → Route exportieren → GPX/TCX/FIT sichern.',
      'Gesamtarchiv (DSGVO): Mi-Fitness-Einstellungen bzw. user.huami.com/privacy → Daten exportieren.',
      'Beides in Runback importieren: Einzeldateien für GPS, Archiv-CSVs für Puls- und Schritt-Kontext.',
    ],
    notes: [
      'Das Gesamtarchiv kommt als passwortgeschütztes ZIP; das Passwort steht in der E-Mail von Xiaomi.',
      'Runback kann verschlüsselte ZIPs nicht öffnen: erst mit dem Passwort entpacken, dann die entpackten Dateien wählen.',
    ],
    filePatterns: [
      'Einzel-GPX/TCX/FIT je Outdoor-Training (mit Route)',
      'SPORT*.csv (Trainingszusammenfassungen)',
      'HEARTRATE_AUTO*.csv (Minutenpuls)',
      'ACTIVITY_MINUTE*.csv (Minutenschritte)',
    ],
    useful: [
      {
        label: 'Outdoor-Läufe (GPX/TCX/FIT)',
        why: 'Volle Route, Puls und Kadenz für die Tempoauswertung.',
        howUsed: 'Wie eigene Läufe.',
      },
      {
        label: 'SPORT-Zusammenfassungen',
        why: 'Auch Läufe ohne Einzeldatei bleiben als Historie erhalten.',
        howUsed: 'Zusammenfassungs-Läufe ohne erfundene Spur.',
      },
      {
        label: 'Minutenpuls & -schritte',
        why: 'Belastungs- und Aktivitätskontext.',
        howUsed: 'Begrenzte Übernahme, nur Anzeige.',
      },
    ],
    limitations: [
      'Das Bulk-Archiv enthält keine GPS-Spuren, nur Zusammenfassungen.',
      'Minutendaten sind grob; Lücken bleiben Lücken.',
      'Inoffizielle Cloud-Skripte werden nicht benötigt und nicht unterstützt.',
    ],
    privacy: 'Das Archiv enthält Standort- und Gesundheitsverläufe. Lokal lassen, nicht teilen.',
  },
  {
    id: 'apple_health',
    name: 'Apple Health (iPhone-Export)',
    short: 'Workouts, Ruhepuls, HRV, Schlaf, Gewicht',
    exportSteps: [
      'iPhone: Health-App → Profilbild → Alle Gesundheitsdaten exportieren.',
      'Die export.zip ans Android-Telefon geben (Datei, Drive, USB).',
      'ZIP in Runback importieren. Routen liegen als workout-routes/*.gpx bei und werden mit eingelesen.',
    ],
    notes: [
      'export.xml kann bei langer Historie mehrere hundert MB groß sein; der Import läuft dann einige Minuten.',
    ],
    filePatterns: [
      'export.zip mit export.xml',
      'workout-routes/*.gpx (Routen zu den Workouts)',
    ],
    useful: [
      {
        label: 'Running-Workouts (Dauer, Distanz, Energie)',
        why: 'Laufhistorie für Tempoauswertung.',
        howUsed: 'Zusammenfassungs-Läufe; mit GPX-Route volle Auswertung.',
      },
      {
        label: 'Ruhepuls & HRV (SDNN)',
        why: 'Erholungskontext.',
        howUsed: 'Nur Anzeige. SDNN wird nicht mit RMSSD anderer Apps vermischt.',
      },
      {
        label: 'Schlafanalyse (Phasen je Intervall)',
        why: 'Alltagskontext.',
        howUsed: 'Nur Anzeige, kein Score.',
      },
      {
        label: 'Gewicht, Größe, VO2max, Schritte',
        why: 'Körper- und Aktivitätskontext.',
        howUsed: 'Nur Anzeige; VO2max steuert keine Modelle.',
      },
    ],
    limitations: [
      'export.xml kann sehr groß sein; Runback liest strombasiert mit festen Grenzen.',
      'Intraday-Puls wird nicht zeilenweise übernommen (Größe); workout-naher Puls kommt über GPX/TCX.',
      'Apple-HRV ist SDNN und bleibt getrennt von Fitbit-/Garmin-RMSSD.',
    ],
    privacy:
      'Der Export enthält die gesamte Health-Historie. Nur importieren, wenn der Kontext gewünscht ist.',
  },
  {
    id: 'samsung',
    name: 'Samsung Health',
    short: 'Trainings, Puls, Schlaf, Schritte',
    exportSteps: [
      'Samsung Health → Menü → Einstellungen → Persönliche Daten herunterladen, mit Samsung-Konto bestätigen.',
      'Das ZIP (viele com.samsung.*.csv plus jsons-Ordner) ans Telefon geben.',
      'ZIP in Runback importieren. Einzelne GPS-Läufe zusätzlich als GPX sichern (Training öffnen → als GPX exportieren), da der GPX-Export keinen Puls enthält.',
    ],
    filePatterns: [
      'com.samsung.shealth.exercise.*.csv (Trainings)',
      'com.samsung.shealth.tracker.heart_rate.*.csv (Puls)',
      'com.samsung.shealth.sleep.*.csv + com.samsung.health.sleep_stage.*.csv',
      'com.samsung.shealth.tracker.pedometer_* (Schritte)',
    ],
    useful: [
      {
        label: 'Lauftrainings (Start, Ende, Distanz, Kalorien)',
        why: 'Historie für Tempoauswertung.',
        howUsed: 'Zusammenfassungs-Läufe; mit Einzel-GPX volle Route.',
      },
      {
        label: 'Puls, HRV (Schlaf), SpO2, Stress',
        why: 'Erholungs- und Belastungskontext.',
        howUsed: 'Nur Anzeige, keine Scores als Empfehlungsgrundlage.',
      },
      {
        label: 'Schlaf (Score, Effizienz, Phasen 40001–40004)',
        why: 'Alltagskontext.',
        howUsed: 'Nur Anzeige.',
      },
      {
        label: 'Schritte, Gewicht, Körperzusammensetzung (BIA)',
        why: 'Aktivitäts- und Körperkontext.',
        howUsed: 'Nur Anzeige.',
      },
    ],
    limitations: [
      'Einzel-GPX enthält keinen Puls (Samsung-Entscheidung); Puls kommt aus den CSVs.',
      'Minuten-Binning-JSONs werden zusammengefasst, nicht vollständig übernommen.',
      'Spaltennamen teils lokalisiert; unbekannte Spalten werden übersprungen.',
    ],
    privacy: 'Das Paket enthält Jahre an Gesundheitsdaten. Lokal verarbeiten, Backups bewusst ablegen.',
  },
  {
    id: 'garmin',
    name: 'Garmin Connect',
    short: 'FIT-Trainings, Tageszusammenfassungen',
    exportSteps: [
      'Einzeln: connect.garmin.com → Aktivität → Zahnrad → Original (FIT) bzw. TCX/GPX exportieren.',
      'Gesamt: Konto → Einstellungen → Daten exportieren (ZIP mit FITs in DI_CONNECT plus Wellness-JSON).',
      'Aktivitätenliste zusätzlich als CSV sichern (eine Zeile je Training). Alles zusammen importieren.',
    ],
    filePatterns: [
      'Einzel-FIT/TCX/GPX je Training (vollständig)',
      'Bulk-ZIP mit DI_CONNECT/* (FITs in UploadedFiles_*.zip)',
      'summarizedActivities.json + Wellness-JSON (sleepData u. a.)',
      'activities.csv (eine Zeile je Training)',
    ],
    useful: [
      {
        label: 'Trainings (FIT/TCX/GPX)',
        why: 'Vollständigste Quelle: GPS, Puls, Kadenz, Höhe.',
        howUsed: 'Volle Lauf-Auswertung wie eigene Aufzeichnung.',
      },
      {
        label: 'Zusammenfassungen (CSV/JSON)',
        why: 'Füllt Lücken, wenn Einzeldaten fehlen.',
        howUsed: 'Zusammenfassungs-Läufe ohne erfundene Samples.',
      },
      {
        label: 'Wellness (Schlaf, HRV, Stress, Body Battery)',
        why: 'Erholungskontext.',
        howUsed: 'Nur Anzeige; Trainingsstatus-Labels werden nicht übernommen.',
      },
    ],
    limitations: [
      'Bulk-Export braucht Zeit und kommt per Mail.',
      'Trainingsstatus und VO2max-Verläufe sind nicht historisch exportierbar.',
      'FIT-Dateinamen sind Zeitstempel; Namen kommen aus summarizedActivities.json.',
    ],
    privacy: 'FITs enthalten GPS-Spuren in Sekundenauflösung. Nur lokal verarbeiten.',
  },
  {
    id: 'polar',
    name: 'Polar Flow',
    short: 'TCX/GPX-Trainings, Zusammenfassungen',
    exportSteps: [
      'flow.polar.com → Training → Export als TCX oder GPX sichern.',
      'Trainingsliste bzw. Tagebuch als CSV sichern, falls angeboten.',
      'Beides in Runback importieren.',
    ],
    filePatterns: ['Einzel-TCX/GPX je Training', 'Trainings-CSV (falls vorhanden)'],
    useful: [
      {
        label: 'Lauftrainings (TCX/GPX)',
        why: 'Route, Puls und Runden für Tempoauswertung.',
        howUsed: 'Volle Lauf-Auswertung.',
      },
      {
        label: 'Zusammenfassungen',
        why: 'Historie ohne Einzeldatei.',
        howUsed: 'Zusammenfassungs-Läufe.',
      },
    ],
    limitations: ['Kein dokumentierter Bulk-Wellness-Export; Schlaf/Erholung nur soweit in CSV enthalten.'],
    privacy: 'Trainings enthalten GPS-Spuren; lokal verarbeiten.',
  },
  {
    id: 'strava',
    name: 'Strava (Bulk)',
    short: 'GPX/FIT-Tracks plus activities.csv',
    exportSteps: [
      'strava.com → Einstellungen → Meine Daten herunterladen → Export anfordern.',
      'Das ZIP (activities.csv plus Track-Dateien) in Runback importieren.',
      'Bereits vorhandene FIT/GPX/TCX-Einzeldaten werden als Duplikate erkannt.',
    ],
    filePatterns: ['activities.csv (eine Zeile je Aktivität)', 'Track-Dateien (GPX/FIT/TCX) im selben ZIP'],
    useful: [
      {
        label: 'Läufe mit Track',
        why: 'Volle Tempo- und Pacing-Auswertung.',
        howUsed: 'Wie eigene Läufe.',
      },
      {
        label: 'Zusammenfassungen (Distanz, Zeit, Ø-Puls)',
        why: 'Historie ohne Track.',
        howUsed: 'Zusammenfassungs-Läufe.',
      },
    ],
    limitations: [
      'Nur eigene, sichtbare Aktivitäten sind enthalten.',
      'Fehler einzelner Dateien stoppen den Import nicht; sie werden gezählt.',
    ],
    privacy: 'Das Archiv enthält alle eigenen Tracks mit Zeitstempeln.',
  },
  {
    id: 'huawei',
    name: 'Huawei Health',
    short: 'Trainings, Puls, Schlaf (je nach Export)',
    exportSteps: [
      'Huawei Health → Ich → Einstellungen → Daten exportieren bzw. Datenschutzanfrage stellen.',
      'Einzelne Outdoor-Läufe zusätzlich als TCX/GPX sichern, falls angeboten.',
      'Alle Dateien zusammen in Runback importieren.',
    ],
    notes: [
      'Kommt der Export passwortgeschützt, zuerst mit dem zugesandten Passwort entpacken.',
    ],
    filePatterns: ['Huawei-Export (CSV/JSON, je nach Version)', 'Einzel-TCX/GPX je Lauf (falls angeboten)'],
    useful: [
      {
        label: 'Lauftrainings',
        why: 'Historie für Tempoauswertung.',
        howUsed: 'Mit Track voll, sonst als Zusammenfassung.',
      },
      {
        label: 'Puls, Schlaf, Schritte',
        why: 'Erholungs- und Aktivitätskontext.',
        howUsed: 'Nur Anzeige.',
      },
    ],
    limitations: [
      'Formate variieren je App-Version; Unbekanntes wird übersprungen und gezählt.',
      'Kein automatischer Cloud-Abgleich: manueller Export pro Zeitraum.',
    ],
    privacy: 'Enthält Gesundheitsverläufe; lokal verarbeiten.',
  },
  {
    id: 'generic',
    name: 'Weitere Apps (generisch)',
    short: 'Coros, Suunto, Adidas, Withings u. a.',
    exportSteps: [
      'In der jeweiligen App nach „Export“, „Daten herunterladen“ oder „DSGVO-Export“ suchen.',
      'Läufe als FIT, TCX oder GPX sichern (bevorzugt), Zusammenfassungen als CSV.',
      'Wellness (Gewicht, Schlaf) als CSV/JSON sichern und alles zusammen importieren.',
    ],
    filePatterns: [
      'FIT/TCX/GPX je Lauf (bevorzugt)',
      'activities.csv-ähnliche Zusammenfassungen',
      'Flache {time, value}-JSON-Reihen',
    ],
    useful: [
      {
        label: 'Läufe mit Track',
        why: 'Volle Auswertung.',
        howUsed: 'Wie eigene Läufe.',
      },
      {
        label: 'Zusammenfassungen & einfache Reihen',
        why: 'Historie und Kontext ohne Track.',
        howUsed: 'Zusammenfassungs-Läufe bzw. begrenzte Wellness-Übernahme.',
      },
    ],
    limitations: [
      'Unbekannte Spalten werden übersprungen statt geraten.',
      'Nike Run Club u. a. ohne Export brauchen Drittanbieter-Umwege; diese werden nicht empfohlen.',
    ],
    privacy: 'Fremd-Tools für Export-Umwege prüfen: keine Zugangsdaten teilen, wenn ein manueller Export reicht.',
  },
];

export function vendorById(id: VendorId): VendorInfo {
  const found = VENDOR_INFOS.find(v => v.id === id);
  if (!found) {
    throw new Error(`Unbekannte Datenquelle: ${id}`);
  }
  return found;
}

const FILE_VENDOR_RULES: { pattern: RegExp; vendor: VendorId }[] = [
  { pattern: /(^|\/)export\.xml$/i, vendor: 'apple_health' },
  { pattern: /workout-routes?\//i, vendor: 'apple_health' },
  { pattern: /com\.samsung\./i, vendor: 'samsung' },
  { pattern: /heart_rate-\d{4}-\d{2}-\d{2}\.json$/i, vendor: 'fitbit' },
  { pattern: /sleep-\d{4}-\d{2}-\d{2}\.json$/i, vendor: 'fitbit' },
  { pattern: /summarizedactivities\.json$/i, vendor: 'garmin' },
  { pattern: /di_connect/i, vendor: 'garmin' },
  { pattern: /^strong.*\.csv$/i, vendor: 'strong' },
  { pattern: /^sport.*\.csv$/i, vendor: 'mi_fitness' },
  { pattern: /^heartrate_auto.*\.csv$/i, vendor: 'mi_fitness' },
  { pattern: /^activity_minute.*\.csv$/i, vendor: 'mi_fitness' },
  { pattern: /^activities\.csv$/i, vendor: 'strava' },
];

/** Best-effort file hint for the UI/docs. Unknown files return 'generic'. */
export function detectVendorForFile(fileName: string): VendorId {
  const normalized = fileName.trim();
  for (const rule of FILE_VENDOR_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.vendor;
    }
  }
  const lower = normalized.toLowerCase();
  if (lower.includes('fitbit')) {
    return 'fitbit';
  }
  if (lower.includes('takeout') && lower.includes('fit')) {
    return 'google_fit';
  }
  if (lower.includes('samsung')) {
    return 'samsung';
  }
  if (lower.includes('garmin')) {
    return 'garmin';
  }
  if (lower.includes('polar')) {
    return 'polar';
  }
  if (lower.includes('huawei') || lower.includes('hihealth')) {
    return 'huawei';
  }
  if (lower.includes('zepp') || lower.includes('mifit') || lower.includes('xiaomi')) {
    return 'mi_fitness';
  }
  if (lower.includes('apple') || lower.includes('healthkit') || lower.includes('export.xml')) {
    return 'apple_health';
  }
  if (lower.includes('strong') || lower.includes('hevy') || lower.includes('fitnotes')) {
    return 'strong';
  }
  if (lower.endsWith('.fit') || lower.endsWith('.gpx') || lower.endsWith('.tcx')) {
    return 'generic';
  }
  return 'generic';
}

export interface StrongSet {
  exercise: string;
  setOrder: number;
  weight: number | null;
  reps: number | null;
  distance: number | null;
  seconds: number | null;
  rpe: number | null;
  notes: string;
}

export interface StrongWorkout {
  time: number;
  name: string;
  durationSeconds: number;
  sets: StrongSet[];
  workoutNotes: string;
}

function csvDelimiter(line: string): ',' | ';' {
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && c === ',') {
      commas++;
    } else if (!inQuotes && c === ';') {
      semicolons++;
    }
  }
  return semicolons > commas ? ';' : ',';
}

function splitCsvLine(line: string, delimiter = csvDelimiter(line)): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  out.push(current);
  return out.map(cell => cell.trim());
}

function parseNumberFlexible(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  let s = raw.trim().replace(/ /g, '');
  if (!s || s === '-' || ['n/a', 'na', 'none', 'null'].includes(s.toLowerCase())) {
    return null;
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.indexOf(',') === lastComma && s.length - lastComma - 1 >= 1 && s.length - lastComma - 1 <= 3
      ? s.replace(',', '.')
      : s.replace(/,/g, '');
  }
  s = s.replace(/[^0-9.\-eE+]/g, '');
  if (!s || s === '-' || s === '.' || s === '-.') {
    return null;
  }
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

function parseStrongTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) {
    return null;
  }
  const asNumber = Number(s);
  if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(s)) {
    return asNumber > 1e11 ? asNumber : asNumber * 1000;
  }
  const parsed = Date.parse(s.replace(' ', 'T').replace(/(\+\d{4})$/, '$1'));
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const iso = Date.parse(s);
  return Number.isFinite(iso) ? iso : null;
}

function parseStrongDuration(raw: string): number {
  const s = raw.trim();
  if (!s) {
    return 0;
  }
  if (s.includes(':')) {
    return s.split(':').reduce((total, part) => {
      const value = parseNumberFlexible(part) ?? 0;
      return total * 60 + value;
    }, 0);
  }
  const hours = /([0-9]+(?:[.,][0-9]+)?)\s*h/i.exec(s)?.[1];
  const minutes = /([0-9]+(?:[.,][0-9]+)?)\s*m(?!s)/i.exec(s)?.[1];
  const seconds = /([0-9]+(?:[.,][0-9]+)?)\s*s/i.exec(s)?.[1];
  if (hours || minutes || seconds) {
    return (parseNumberFlexible(hours) ?? 0) * 3600 +
      (parseNumberFlexible(minutes) ?? 0) * 60 +
      (parseNumberFlexible(seconds) ?? 0);
  }
  return parseNumberFlexible(s) ?? 0;
}

export function isStrongCsvContent(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const header = splitCsvLine(first).map(cell => cell.toLowerCase());
  return header.includes('exercise name') && header.includes('set order') && header.includes('date');
}

/**
 * Small, testable Strong CSV preview parser (same grouping as native code).
 * Weight unit is not exported by Strong; values are kept raw and flagged kg-assumed.
 */
export function parseStrongCsvPreview(text: string, maxRows = 60000): {
  workouts: StrongWorkout[];
  rows: number;
  skipped: number;
} {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!lines.length) {
    return { workouts: [], rows: 0, skipped: 0 };
  }
  const delimiter = csvDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delimiter).map(cell => cell.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cDate = col('date');
  const cWorkout = col('workout name');
  const cDuration = col('duration');
  const cExercise = col('exercise name');
  const cOrder = col('set order');
  const cWeight = col('weight');
  const cReps = col('reps');
  const cDistance = col('distance');
  const cSeconds = col('seconds');
  const cNotes = col('notes');
  const cWorkoutNotes = col('workout notes');
  const cRpe = col('rpe');
  if (cDate < 0 || cExercise < 0 || cOrder < 0) {
    throw new Error('Keine Strong-Kopfzeile (Date, Exercise Name, Set Order erwartet)');
  }
  const get = (cells: string[], i: number) => (i >= 0 && i < cells.length ? cells[i] : '');
  const groups = new Map<string, StrongWorkout & { key: string }>();
  let rows = 0;
  let skipped = 0;
  for (const raw of lines.slice(1)) {
    if (!raw.trim()) {
      continue;
    }
    if (++rows > maxRows) {
      break;
    }
    const cells = splitCsvLine(raw, delimiter);
    const time = parseStrongTime(get(cells, cDate));
    const exercise = get(cells, cExercise);
    if (time === null || !exercise) {
      skipped++;
      continue;
    }
    const name = get(cells, cWorkout) || 'Krafttraining';
    const key = `${time}|${name}`;
    let workout = groups.get(key);
    if (!workout) {
      workout = {
        key,
        time,
        name,
        durationSeconds: parseStrongDuration(get(cells, cDuration)),
        sets: [],
        workoutNotes: get(cells, cWorkoutNotes),
      };
      groups.set(key, workout);
    }
    const order = Number.parseInt(get(cells, cOrder), 10);
    workout.sets.push({
      exercise,
      setOrder: Number.isFinite(order) ? order : workout.sets.length + 1,
      weight: parseNumberFlexible(get(cells, cWeight)),
      reps: parseNumberFlexible(get(cells, cReps)),
      distance: parseNumberFlexible(get(cells, cDistance)),
      seconds: parseNumberFlexible(get(cells, cSeconds)),
      rpe: parseNumberFlexible(get(cells, cRpe)),
      notes: get(cells, cNotes),
    });
    if (!workout.workoutNotes) {
      workout.workoutNotes = get(cells, cWorkoutNotes);
    }
  }
  return {
    workouts: Array.from(groups.values()).map(({ key: _key, ...rest }) => rest),
    rows,
    skipped,
  };
}

export function strongWorkoutVolume(workout: StrongWorkout): number {
  return workout.sets.reduce((sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0), 0);
}

/** Apple HealthKit record type -> Runback wellness kind (null = intentionally skipped). */
export function mapAppleRecordType(type: string): string | null {
  switch (type) {
    case 'HKQuantityTypeIdentifierRestingHeartRate':
      return 'resting_hr';
    case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN':
      return 'hrv_sdnn';
    case 'HKQuantityTypeIdentifierStepCount':
      return 'steps';
    case 'HKQuantityTypeIdentifierDistanceWalkingRunning':
      return 'distance';
    case 'HKQuantityTypeIdentifierBodyMass':
      return 'weight';
    case 'HKQuantityTypeIdentifierHeight':
      return 'height';
    case 'HKQuantityTypeIdentifierBodyFatPercentage':
      return 'body_fat';
    case 'HKQuantityTypeIdentifierVO2Max':
      return 'vo2max';
    case 'HKQuantityTypeIdentifierActiveEnergyBurned':
      return 'calories';
    case 'HKQuantityTypeIdentifierBasalEnergyBurned':
      return 'calories_basal';
    case 'HKQuantityTypeIdentifierOxygenSaturation':
      return 'spo2';
    case 'HKQuantityTypeIdentifierRespiratoryRate':
      return 'respiratory_rate';
    case 'HKCategoryTypeIdentifierSleepAnalysis':
      return 'sleep_stage';
    default:
      return null;
  }
}

/** Samsung sleep stage code -> stage label. */
export function mapSamsungSleepStage(code: string): string {
  switch (code.trim()) {
    case '40001':
      return 'awake';
    case '40002':
      return 'light';
    case '40003':
      return 'deep';
    case '40004':
      return 'rem';
    default:
      return 'unknown';
  }
}
