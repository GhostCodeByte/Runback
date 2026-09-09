# App-Importe: Fitbit, Google Fit, Strong, Mi Fitness, Apple Health, Samsung & Co.

> Ergänzung zur [Zielspezifikation](zielspezifikation.md) (V1-1, V1-17) und zur
> [Implementierung](implementation.md). Der Import ist vollständig optional:
> Aufzeichnung, Historie und Auswertung funktionieren ohne jeden Import.
> Importierte Daten liefern nur besseren Kontext, keine neuen Verpflichtungen.

Seite in der App: **Mehr → Daten & Speicher → App-Importe**.
Prinzip überall: **dort exportieren, hier importieren**. Es gibt keine
automatische Cloud-Synchronisierung und keinen Account.

## Was wohin gehört

| App | Export | Dateien in Runback | Was ankommt |
|---|---|---|---|
| Fitbit / Google Health | takeout.google.com → nur „Fitbit“; oder App → Profil → Einstellungen → Daten exportieren; GPS-Läufe einzeln als TCX | Takeout-ZIP + einzelne TCX | Läufe (TCX voll, Protokoll als Zusammenfassung), Puls, Ruhepuls, HRV (RMSSD), Schlaf, Schritte, Gewicht |
| Google Fit | takeout.google.com → nur „Fit“ | Takeout/Fit-ZIP (JSON) + optionale TCX/GPX | Lauf-Sessions als Zusammenfassung, Tageswerte, ggf. Puls/Gewicht |
| Strong | Profil → Einstellungen → Strong-Daten exportieren | strong.csv (eine Zeile je Satz) | Krafteinheiten mit Sätzen, Volumen, RPE — reiner Kontext, keine Laufwertung |
| Mi Fitness / Zepp Life | Einzeltraining → Route exportieren (GPX/TCX/FIT); Archiv via Einstellungen bzw. user.huami.com/privacy → Daten exportieren | Einzeldateien + SPORT\*.csv, HEARTRATE_AUTO\*.csv, ACTIVITY_MINUTE\*.csv | Outdoor-Läufe voll, Archiv als Zusammenfassung + Minutenpuls/-schritte |
| Apple Health | iPhone Health → Profil → Alle Gesundheitsdaten exportieren | export.zip mit export.xml + workout-routes/\*.gpx | Running-Workouts (mit GPX voll), Ruhepuls, HRV (SDNN), Schlaf, Gewicht, VO2max, Schritte |
| Samsung Health | Menü → Einstellungen → Persönliche Daten herunterladen | ZIP mit com.samsung.\*.csv + jsons/; einzelne GPX je Lauf | Lauftrainings (mit GPX voll), Puls, Schlaf (inkl. Phasen 40001–40004), Schritte, Gewicht |
| Garmin Connect | Aktivität → Zahnrad → Original/TCX/GPX; Konto → Daten exportieren | Einzel-FIT/TCX/GPX + Bulk-ZIP (DI_CONNECT) + summarizedActivities.json + activities.csv | Vollständigste Läufe; Wellness als Anzeige-Kontext |
| Polar Flow | Training → TCX/GPX exportieren | Einzel-TCX/GPX + ggf. Trainings-CSV | Läufe voll bzw. als Zusammenfassung |
| Strava | Einstellungen → Meine Daten herunterladen | ZIP mit activities.csv + Tracks | Läufe mit Track voll, Rest als Zusammenfassung |
| Huawei Health | Ich → Einstellungen → Daten exportieren | CSV/JSON je nach Version + Einzel-TCX/GPX | Läufe und Kontext wie oben |
| Weitere (Coros, Suunto, Adidas, Withings u. a.) | „Export“ / „Daten herunterladen“ suchen | FIT/TCX/GPX bevorzugt, sonst CSV/JSON | Mit Track voll, sonst Zusammenfassung bzw. einfache Reihen |

Hevy- und FitNotes-CSVs mit Strong-ähnlichem Aufbau werden wie Strong erkannt.

## Bereinigung beim Import

Exporte enthalten meist die gesamte Aktivitätshistorie. Spaziergänge und
Radfahrten würden dort jede Tempoauswertung und die Wochenstatistik verzerren.
Runback filtert sie deshalb beim Import:

1. **Bekannte Sportart entscheidet allein.** FIT-Session-Sport, das
   `Sport`-Attribut in TCX, `<type>` in GPX sowie Typspalten in CSV/JSON werden
   ausgewertet. Laufbegriffe (`run`, `running`, `jog`, `trail`, `treadmill`,
   `lauf`, `跑`) gewinnen gegen Gegenbegriffe, damit „Trail Running“ und
   „Laufband“ nicht an einem Teilwort scheitern.
2. **Ohne Sportart entscheidet das Tempofenster.** Akzeptiert wird eine
   Durchschnittsgeschwindigkeit zwischen 1,5 m/s (≈ 11:07 min/km) und
   6,5 m/s (≈ 2:34 min/km). Darunter liegt Gehen, darüber Radfahren.
3. **Fehlt Distanz oder Dauer, wird nicht gefiltert.** Ohne beide Werte gibt es
   kein Tempo; die Auswertung markiert solche Läufe ohnehin als nicht
   tempotauglich.

Aussortierte Aktivitäten werden **nicht gelöscht, sondern nicht als Lauf
angelegt**. Der Importbericht zählt sie getrennt als „Keine Läufe“. Health
Connect filtert bereits an der Quelle auf `EXERCISE_TYPE_RUNNING`.

## Benennung importierter Läufe

Dateinamen wie `activity_12345678.fit` sind keine Lauftitel. Der Import
speichert deshalb den besten verfügbaren Namen — den Streckennamen aus
`<trk><name>` bzw. dem Anbieter-Feld, sonst den Dateinamen. Die Oberfläche
entscheidet anschließend über `runTitle()`
(siehe [Design Language](design-language.md) § 13): sprechender Name, sonst
Trainingszweck, sonst Tageszeit („Morgenlauf“, „Abendlauf“). Technische Namen
(IDs, Zeitstempel, GUIDs, Anbieter-Platzhalter wie „Garmin Lauf“) werden
verworfen.

## Welche Daten Runback wofür nutzt

- **Läufe mit GPS-Spur (FIT/GPX/TCX, Apple-Routen, Mi-Einzeldateien):**
  volle Auswertung mit denselben Regeln wie eigene Aufzeichnungen
  (Distanz, Tempoindex, Pacing — soweit geeignet).
- **Zusammenfassungs-Läufe (CSV/JSON ohne Spur):**
  Zeit und Distanz bleiben für einfache Tempoaussagen nutzbar. Es werden
  **keine Samples erfunden**; in der Datenbank steht `summaryOnly`.
- **Ruhepuls, HRV, Schlaf, Gewicht, Schritte, Kalorien:**
  reiner Anzeige-Kontext im Import-Überblick (z. B. Termine von Krafteinheiten,
  Schlaf- oder Gewichtstrends). Sie begründen **keine** Empfehlung, **keinen**
  Readiness-Score, **keine** Diagnose und **keine** Planänderung.
  Apple-HRV (SDNN) bleibt getrennt von Fitbit-/Garmin-HRV (RMSSD).
- **Krafttraining (Strong & Co.):**
  Einheiten, Sätze und Volumen als Kontext außerhalb des Laufens.
  Sie zählen nie als Lauf-Evidenz.
- **VO2max, Body Battery, Trainingsstatus, Stress-Scores:**
  werden — sofern im Export enthalten — höchstens als Anzeige-Kontext
  übernommen und steuern keine Modelle.

## Datenbank (RunStore Schema 2)

- `wellness(id, kind, time, end_time, value, unit, source, extra)` mit Index
  auf `(kind, time)`. Arten u. a.: `resting_hr`, `hrv_rmssd`, `hrv_sdnn`,
  `heart_rate`, `sleep_stage` (Stufe in `extra.stage`), `sleep_session`,
  `weight`, `body_fat`, `height`, `vo2max`, `steps`, `distance`, `calories`,
  `calories_basal`, `active_minutes`, `spo2`, `stress`, `body_battery`,
  `skin_temp`, `respiratory_rate`. Einfügen ist idempotent (INSERT OR IGNORE).
- `strength_workouts(id, time, name, durationSec, source, extra)` und
  `strength_sets(workout_id, exercise, set_order, weight, weight_unit, reps,
  distance, seconds, rpe, notes)`. Strong exportiert keine Einheit;
  Runback nimmt **kg** an und dokumentiert die Annahme in UI und Export.
- Läufe ohne Spur nutzen `addSummaryRun` mit derselben Startszeit- und
  Hash-Duplikaterkennung wie Track-Importe (Start ±10 s, Dauer ±5 %/30 s).
- Backup-Schema 2 enthält die neuen Tabellen; Backups der Version 1 lassen
  sich weiterhin wiederherstellen (neue Tabellen bleiben dann leer).
- Volle Sicherung und Wiederherstellung schließen Wellness- und Kraftdaten
  ein; Löschen einzelner Läufe und „Alle lokalen Daten löschen“ schließen
  sie ebenfalls ein.

## Verarbeitung und Grenzen

- Dieselben Budgets wie bisher: 64 MB je Aktivität, 512 MB expandiert,
  2.000 Archiveinträge, 150.000 Samples je Aktivität, Abbruch lässt
  abgeschlossene Importe konsistent. Zusätzlich: höchstens 60.000 CSV-Zeilen
  je Datei, 20.000 Wellness-Zeilen je JSON/CSV, 120.000 Apple-Records je
  export.xml (der Rest wird gezählt und übersprungen).
- ZIPs werden sortiert verarbeitet: **Tracks zuerst, Zusammenfassungen danach**,
  damit eine GPS-Spur nicht als Duplikat einer zuvor gelesenen
  Zusammenfassung verloren geht. Garmin-Verschachtelungen
  (`UploadedFiles_*.zip`) werden bis Tiefe 2 geöffnet.
- `export.xml` wird strombasiert gelesen (kein DOM); Dokumenttypen,
  Tiefen- und Textlängen-Grenzen gelten wie bei Track-XML.
- Intraday-Puls aus Apple-Exporten wird bewusst nicht zeilenweise
  übernommen (Millionen Zeilen möglich); workout-naher Puls kommt über
  GPX/TCX/FIT. Minutenreihen aus Samsung/Mi-Archiven werden begrenzt
  übernommen.
- Dezimalkommas (`1.234,56`) und Punktformate werden erkannt; unbekannte
  Einheiten oder Spalten werden übersprungen statt geraten.
  Entfernungs-Heuristik für einheitenlose Bulk-CSVs: Werte >500 gelten als
  Meter, Werte bis einschließlich 500 als Kilometer. Explizite Einheiten
  in Spaltenköpfen oder Werten haben Vorrang vor dieser Heuristik.
- Die App-Seite zeigt aggregierte Zähler für importierte und doppelte Läufe
  sowie übersprungene und fehlgeschlagene Dateien. Fehlgeschlagene Dateien werden
  mit Dateiname und Grund angezeigt; übersprungene Dateien werden nur als
  Gesamtzahl gezählt, ohne individuellen Grund. Zusätzlich zeigt die Seite
  vorhandene Kontext- und Kraftdaten.
- Zähler je Quelle erscheinen, wenn der Importer die Quelle anhand des
  Dateinamens bzw. Archivpfads identifizieren kann. Generische FIT/GPX/TCX-
  Dateien ohne erkennbaren Anbieter werden in der Quelle „Generisch“
  zusammengefasst.

Generisches JSON importiert nur ausdrücklich bezeichnete Gewichtswerte, z. B.
`[{"kind":"weight","date":"2024-11-02","value":70,"unit":"kg"}]`.
`time` kann statt `date` verwendet werden. Unterstützte Gewichtseinheiten
werden nach kg umgerechnet; unbekannte Metriken oder fehlende Einheiten
werden übersprungen und niemals als Gewicht geraten.

## Privatsphäre

- Alles bleibt lokal auf dem Gerät. Es gibt keinen Upload, keine
  Synchronisierung und keine Schlüssel in Backups.
- Takeout-, Apple- und Samsung-Archive enthalten Jahre sensibler
  Gesundheits- und Standortdaten: nur importieren, was als Kontext dienen
  soll, und Backups bewusst ablegen.
- An Health Connect oder andere Apps wird nichts automatisch
  weitergegeben; Schreiben an Health Connect bleibt eine ausdrückliche
  Aktion je Lauf.

## Fehlersuche

- „Datei wird übersprungen“: Format prüfen (unbekannte Spalten, leere
  Zeilen, passwortgeschützte ZIPs werden nicht unterstützt).
- „Nur Zusammenfassung, keine Karte“: kein GPS im Export (z. B. Mi-Bulk,
  Strong-Zeilen, Samsung-CSV ohne Einzel-GPX) — Einzeldatei nachliefern.
- „Duplikat“: derselbe Lauf ist bereits vorhanden (Startzeit + Dauer) —
  kein zweiter Beleg, kein Datenverlust.
- „Zu groß“: Datei bzw. Archiv teilen (z. B. Takeout in kleineren
  Zeiträumen anfordern) und erneut importieren.
- Samsung-Zeiten wirken verschoben: Samsung exportiert mit Zeitzonen-Offset;
  Runback übernimmt Start/Ende wie exportiert und zeigt sie in Ortszeit.
