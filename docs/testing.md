# Testbericht

Aktueller Integrationsstand: 8. September 2026. Die unten dokumentierten Emulatorprüfungen bleiben gültig; die Ergänzung am Ende enthält die zusätzlichen Krafttrainings- und Muskelkartenprüfungen.

Stand: 6. September 2026 (Emulatortests am 5. und 6. September). Dieser Bericht dokumentiert Testsoftware, keine vollständige Abnahme aller V1-/V2-Ziele.

## Referenzumgebung

- Windows 11, Node 20.20, JDK 21, Android SDK 36; Release-Varianten mit eingebettetem Hermes-JavaScript und gemeinsamem öffentlichen Debug-Schlüssel.
- Pixel-8-AVD: Android 16 / API 36, x86_64, 1080 × 2400, Dichte 420.
- Pixel-Watch-2-AVD: Wear OS 5.1 / API 35, x86_64, rund 454 × 454, Dichte 320. Software-Grafikmodus nach schwarzem Bild beim ursprünglichen GPU-Modus.
- Deutsche App-Oberfläche, Europe/Berlin, Dark Mode. Die System-Berechtigungsdialoge der Images sind teilweise englisch.
- Kein echtes Telefon, keine echte Uhr und keine BLE-Sensorhardware per ADB verfügbar.

## Tatsächlich geprüft

| Prüfung | Ergebnis |
|---|---|
| Telefon- und Wear-Release erstellen | Erfolgreich lokal, zunächst x86_64 |
| TypeScript und Jest | Typecheck und 12 Tests bestanden |
| Native Mathematik-/BLE-Parser-Unit-Tests | Bestanden |
| SQLite-Instrumentation | 5 Tests auf beiden Emulatoren bestanden: Lebenszyklus, GPS-Ausreißer bei erhaltenen Rohdaten, Duplikat/Löschmarkierung, Backup-Roundtrip, Rollback beschädigter Sicherung |
| APK ohne Metro starten | Auf beiden Emulatoren erfolgreich |
| Phone-Aufzeichnung | Berechtigungen, Start, Pause, Fortsetzen, kurzer Display-Lock, simulierte GPS-Punkte, Bestätigung beim Beenden, gespeicherte Detailansicht geprüft |
| Wear-Aufzeichnung ohne Telefon | Berechtigungen, Start, Pause, Speichern und Historie geprüft; Übertragung zeigt „Handy verbinden“ statt unbestätigten Erfolg |
| ZIP-Import | Synthetisches Archiv: 1 importierter Lauf, 1 erkannte Kopie, 1 übersprungene Datei, 1 fehlerhafte GPX; andere Dateien werden trotzdem verarbeitet |
| RPE | Beine und Atmung getrennt per Tap an synthetischem Importlauf eingegeben |
| Entscheidungsablauf | Importlauf: Zweck „Locker“ ergänzt, Pacing-Vorschlag angezeigt und als Arbeitsthema angenommen; Folgeläufe korrekt noch ausstehend |
| Visuelle Kontrolle | Startseite, Aufzeichnung, Post-Run, Historie und rundes Uhrenlayout anhand echter Emulator-Screenshots geprüft |

Synthetische Daten entstehen reproduzierbar mit `python scripts/generate_test_fixtures.py`. Sie sind technische Testdaten und keine Wirksamkeitsvalidierung. `scripts/device_ui.py` unterstützt beobachtungsbasierte ADB-Interaktionen; lokale Screenshots liegen unter `test-results/` und werden nicht als Nutzerdaten veröffentlicht.

## Noch nicht nachgewiesen

- 90-Minuten-Lauf auf physischem Referenzgerät, Akkuverbrauch, GPS-/Pulsgenauigkeit und aggressive OEM-Energiesparzustände.
- Echte Pixel-Watch → Quell-App → Health-Connect-Kette und Sichtbarkeit exportierter Datensätze in einer fremden Ziel-App.
- Gekoppelte Uhr-Telefon-Data-Layer-Übertragung mit Funkabbrüchen; autonome lokale Aufzeichnung ist davon unabhängig.
- Echte BLE-Mehrsensorverbindung, Reconnect und Gerätevergleich; Parser-Tests ersetzen keine Hardwaretests.
- Belastungstest mit 1.000 Aktivitäten, großen Sicherungen und vollständiger Barrierefreiheitsprüfung.
- Langfristige Trainingswirkung oder Validierung persönlicher V2-Prognosemodelle.

Die offene Funktionsliste und Grenzen stehen in [implementation.md](implementation.md), die unveränderten Zielkriterien in [zielspezifikation.md](zielspezifikation.md).

## Ergänzung: Einrichtung, Statistik und Trainingschat (6. September 2026)

- 21 JavaScript-Tests: bisherige Engine sowie Einrichtung (Minutenvalidierung, Überspringen, Importabbruch, Berechtigungszustände) und Statistik (Filter, Duplikate, gewichtetes Tempo, RPE, Kalenderwochen einschließlich Zeitumstellung).
- Sechs native Chat-Protokolltests mit simulierten Modellantworten: Datenfreigabe, persistenter Datenzugriff-Schalter, Ausschluss von Geometrie/Rohsamples/geheimen Feldern, unbekannte Werkzeuge ohne Schreibzugriff, unveränderter Verlauf bei Netzwerkfehler und keine Wiederherstellung gelöschter Daten durch eine verspätete Antwort. Kein bezahlter oder kostenloser Live-Modellaufruf: Es ist kein OpenRouter-Schlüssel eingerichtet.
- TypeScript, native Core-Tests, Android-Lint und Release-Builds für Telefon/Uhr erfolgreich. Neue native Tests sind auch Teil der GitHub-CI und ihrer Berichte.
- Telefon-Emulator Pixel 8, API 36: vorhandene Testdaten beim APK-Update erhalten; Einrichtung durchlaufen, Trainingstag gewählt, bestehende synthetische GPX im Onboarding importiert und korrekt als Duplikat erkannt, Berechtigungsstatus angezeigt, Einrichtung beendet. Statistik mit vorhandenen Läufen und Chat-Einstieg visuell geprüft. OpenRouter-Einstellungen zeigen den kostenlosen Standard und kein Tageslimit. Keine AndroidRuntime-/ReactNativeJS-Fehler bei diesen Schritten.
- Wear-OS-Emulator Pixel Watch 2, API 35: aktualisierte APK installiert und Startansicht geprüft. Onboarding, Statistik und Chat sind Telefonfunktionen. Keine neue komplexe Sensor-/Synchronisations-Testserie; kein physisches Telefon angeschlossen.

## Ergänzung: Krafttraining, Muskelmodell und Körperkarte (8. September 2026)

- 18 Jest-Suites mit 202 Tests bestanden. Abgedeckt sind unter anderem getaktete Kraftsätze, persistierte aktive Sessions, bearbeitbare Trainingspläne, Progressionsrichtung, Run-/Kraft-Kopplung, regionale Frische sowie deutsche Muskelkater-Spracherfassung mit unbekannten Regionen.
- `npm run typecheck` und `npm run lint` erfolgreich; ESLint meldet weiterhin nur vorhandene Warnungen und keine Fehler.
- `:core:testDebugUnitTest :app:lintRelease :wear:lintRelease` mit JDK 21 erfolgreich. Die native Android-Erweiterung für Soreness-Persistenz und den optionalen deutschen SpeechRecognizer baut und lintet damit sauber.
- Die neue Körperkarte wurde als React-Native-Komponente und mit UI-Tests geprüft. Die native SpeechRecognizer-Berechtigung und echte Spracherkennung wurden nicht auf physischer Hardware nachgewiesen; OpenRouter bleibt für diese Funktion optional und wurde ohne konfigurierten Schlüssel nicht live getestet.

## PR-Review und Integration (9. September 2026)

- Regressionen für eindeutige Satzkennungen, deterministische Kopplungsgruppen, ungültige Planzeiten und IDs, Muskelregionen, Segmentprovenienz und deutsche Seitenzuordnung ergänzt.
- Elf native Datenbanktests auf dem Telefon-Emulator (API 36) bestanden. Der neue Fehlerfall bricht den Index-Write per SQLite-Trigger nach dem Session-Write ab und prüft den tatsächlichen Rollback einschließlich aktiver Einheit. Die Historienbegrenzung berücksichtigt den Trainingsbeginn statt der Speicherreihenfolge.
- Die synchrone Modellvalidierung ist für die Oberfläche zu langsam: bei 30 synthetischen Kraftsessions wurden für 5/10/20 Regionsmeldungen etwa 283/922/4.615 ms gemessen; 60 Meldungen waren nach 40 Sekunden nicht abgeschlossen. Die Frischeanzeige bleibt daher gesperrt, bis eine außerhalb des UI-Threads ermittelte Prüfung mit Daten- und Modellversion verknüpft verfügbar ist. Gemeldeter Muskelkater bleibt unabhängig davon nutzbar. Ein vollständig kalibrierter Zustand darf nicht in frühere Hold-outs übernommen werden (Datenleck).
- Sprache verwendet ausschließlich die Android-On-Device-Erkennung ab API 31. Fehlt sie, bleibt die Texteingabe verfügbar. Eine echte deutsche Spracherkennung auf physischer Hardware wurde nicht nachgewiesen.
