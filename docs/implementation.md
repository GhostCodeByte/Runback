# Implementierungsstand und Modelle

## Architektur

`android/core` enthält SQLite-Datenhaltung und einen Foreground Service für Telefon und Uhr. GPS wird sofort geschrieben, zusätzliche Sensorwerte werden spätestens nach einer Sekunde gesammelt geschrieben. Ein dauerhafter Zeitcheckpoint erfolgt alle zwei Sekunden. Beim neuen Prozess wird eine offene Aufzeichnung als unterbrochen markiert; Fortsetzen ist eine bewusste Aktion. Android-Force-Stop wird nicht umgangen.

`android/app` enthält die React-Native-Bridge, SAF-Dateiauswahl, Garmin-FIT-/XML-/ZIP-Verarbeitung, Health Connect und optionale Dienste. Sensorverarbeitung bleibt nativ. JavaScript erhält Zusammenfassungen, Kilometerabschnitte und begrenzte Darstellungsdaten (maximal 512 Trackpunkte, 256 Zeitreihenpunkte). `android/wear` ist ohne Telefon benutzbar; Übertragungsarchive bleiben bis zur passenden SHA-256-Bestätigung erhalten, Originalaufzeichnungen bleiben auch danach auf der Uhr.

## Distanz und Tempoindex

`runback-distance-1.0`: Haversine-Distanzen auf einer Kugel mit Radius 6.371.000 m. Kanten mit Zeitdifferenz ≤0 oder >30 Sekunden, Genauigkeitsangaben >50 m, ungültigen Koordinaten oder abgeleiteter Geschwindigkeit >12 m/s zählen nicht zur bereinigten Distanz. Pausen- und Unterbrechungsgrenzen verbinden keine Trackabschnitte. Originalkoordinaten bleiben unverändert erhalten. Die Grenzwerte sind konservative technische Regeln, keine Garantie für GPS-Genauigkeit.

Der einfache Tempoindex ist `100 × Geschwindigkeit / 3 m/s`. Die aufsummierte Indexdauer wird getrennt als Index-Minuten angegeben. Das ist keine mechanische Leistung, keine metabolische Messung und kein Fitness- oder Ermüdungsscore. Wind-, Hitze-, Untergrund- und Steigungseffekte werden nicht als validierte numerische Korrekturen ausgegeben. Fehlende Faktoren bleiben unbekannt. Es gibt kein erfundenes Konfidenzintervall.

## Arbeitsthema: ruhigerer Start

Die versionierte TypeScript-Engine bietet bei lockeren/langen Läufen mit mindestens vier geeigneten Abschnitten ab 500 m und bekannten flachen Steigungen einen Pacing-Versuch an, wenn der spätere Tempoabfall mindestens 8 % beträgt. Die erste Hälfte soll etwa 5 % ruhiger begonnen werden, unter Erhalt von Zweck und Umfang. Unbekannter Zweck löst eine freiwillige Rückfrage aus; Intervall- und Wettkampfläufe erhalten diesen Vorschlag nicht.

Bei Annahme werden Baseline, Methode, relevante Mindeständerung, Dauer-/Distanzfenster, Ausschlussregeln und Beobachtungszeit festgehalten. Mindestens sechs passende Beobachtungen über 14 Tage sind für eine abschließende Einordnung vorgesehen; nach drei Läufen ist nur ein Zwischenstand möglich. Umsetzung, beobachteter Unterschied und Ursache bleiben getrennt. Ein Vorher-/Nachher-Unterschied beweist keine Kausalität. Diese Ausgangsregeln sind synthetisch getestet; langfristige Wirksamkeit ist nicht nachgewiesen.

## Dateien, Aufbewahrung und Backup

Das ZIP-Backup (Schema 2) enthält Tabellen für Läufe, Originalsamples, Ereignisse, Nutzerdokumente, Importidentitäten, Löschmarkierungen, erhaltene Quelldateien sowie optionale Wellness- und Kraftdaten (`wellness`, `strength_workouts`, `strength_sets`). Schema-1-Backups lassen sich weiterhin wiederherstellen; die neuen Tabellen bleiben dann leer. Wiederherstellung ist transaktional; beschädigte Backups lassen den bestehenden Bestand unangetastet. Die normale App-Sicherung enthält keine OpenRouter-Schlüssel. GPX, FIT und JSON sind begrenzte Austauschformate.

Originale werden nicht automatisch gelöscht. 512 MB ist die voreingestellte Budgetangabe; eine automatische Budgetbereinigung ist noch nicht freigeschaltet. Neue Aufzeichnungen werden unter 32 MB freiem Speicher abgelehnt. Importlimits: 64 MB pro Aktivität, 512 MB expandierte Gesamtmenge, 2.000 Archiveinträge, 150.000 Samples pro Aktivität. Eine automatische, geschützte Rohdatenreduktion nach V1-15 bleibt offen. Sehr große Backups benötigen zusätzliche Speicherprüfung, da Wiederherstellung derzeit tabellenweise im Speicher verarbeitet wird.

## Optionale Integrationen

- Health Connect: ausschließlich freigegebene Datentypen; Lesen standardmäßig letzte 30 Tage. Eigene Datensätze werden vom Rückimport ausgeschlossen. Schreiben benötigt eine ausdrückliche Aktion, Route separat. [Android-Dokumentation](https://developer.android.com/health-and-fitness/health-connect/get-started).
- BLE: Standard-Herzfrequenz, Running Speed/Cadence und Batterie. Gerätequellen bleiben benannt; unbekannte Kadenzkonventionen werden nicht still in Schritte/min umgerechnet. [Android-GATT-Dokumentation](https://developer.android.com/develop/connectivity/bluetooth/ble/connect-gatt-server).
- Wetter: nur nach Aktivierung und Abruf; genaue Position und UTC-Datum an Open-Meteo Archive. Stündliches regionales Modellwetter ist keine Messung am Körper. Automatische Hintergrundanreicherung ist noch offen. [Open-Meteo Archive](https://open-meteo.com/en/docs/historical-weather-api).
- OpenRouter: deaktiviert ohne Nutzerentscheidung, Key im Android Keystore geschützt. Die bisherige alternative Textdarstellung ordnet ausschließlich unveränderte Engine-Aussagen an. Der separate Trainingschat beantwortet freie Fragen und kann auf Wunsch Profil, gespeicherte Experimente, paginierte Laufzusammenfassungen, Notizen, RPE und Kilometerabschnitte lesen. Er verändert weder Daten noch Engine-Entscheidungen. Automatische Werkzeugantworten enthalten keine GPS-Geometrie oder Rohsamples. Freitextnachrichten und Notizen können persönliche Informationen enthalten und werden an OpenRouter und den ausgewählten Anbieter übertragen. Kein Live-Aufruf ohne konfigurierten Schlüssel getestet.

## Einrichtung, Statistik und Chat

Beim ersten Start erscheint eine freiwillige Einrichtung: Ziel, Zeitbudget, Lauftage, Standardzweck, Dateiimport und optionale Aufzeichnungsberechtigungen. Schritte werden gespeichert; „Später“ beendet die Einrichtung. Unter Mehr → Einrichtung lässt sie sich erneut öffnen. Import nutzt dieselbe Verarbeitung und Duplikaterkennung wie Daten & Speicher.

Optionale App-Importe (Fitbit, Google Fit, Strong, Mi Fitness/Zepp, Apple Health, Samsung Health, Garmin, Polar, Strava, Huawei und generische FIT/GPX/TCX/CSV/JSON-Quellen) werden in [App-Importe](vendor-import.md) beschrieben: strombasierte Verarbeitung mit denselben Größenbudgets, Tracks vor Zusammenfassungen, idempotente Wellness- (`wellness`) und Krafttabellen (`strength_workouts`, `strength_sets`), Anzeige-Kontext ohne Readiness-Scores.

Mehr → Statistik zeigt abgeschlossene/importierte Läufe, acht lokale Kalenderwochen, gewichtetes Tempo ab 500 Metern sowie subjektive RPE-Mittelwerte. Wochen werden kalendarisch über Sommer-/Winterzeit gebildet. Die Oberfläche wertet die bis zu 1.000 geladenen Läufe aus und benennt diese Grenze bei entsprechend großen Beständen. Der Chat kann ältere Läufe paginiert abrufen und Gesamtsummen über den gesamten Bestand berechnen.

Mehr → Auswertung & Modelle: OpenRouter aktivieren, eigenen API-Schlüssel hinterlegen, speichern. `openrouter/free` bleibt Standard; explizit gewählte kostenpflichtige Modellkennungen sind erlaubt. Runback erzwingt kein Tageslimit für Tokens oder Anfragen. Kostenlose Kennungen behalten zusätzlich Anbieter-Preisgrenzen von null. OpenRouter-/Anbieterquoten gelten weiterhin; eine kostenpflichtige Kennung kann Guthaben verbrauchen. Modelle müssen für Trainingsdaten Werkzeugaufrufe unterstützen. Anbieter mit erlaubter Datensammlung werden ausgeschlossen.

Mehr → Trainingschat: Frage eingeben und senden. „Trainingsdaten einbeziehen“ schaltet lesende Werkzeuge ein; ein Wechsel beginnt ein neues Gespräch. Es werden bis zu 40 Nachrichten lokal im Backup gespeichert und die letzten 18 Nachrichten als Gesprächskontext gesendet. Werkzeugresultate werden nicht als Chatverlauf gespeichert. Netzwerkfehler erhalten den Entwurf und überschreiben kein abgeschlossenes Gespräch. Pro Antwort gelten technische Grenzen (4.096 Ausgabetokens, maximal vier Werkzeugrunden plus Schlussantwort); das ist kein tägliches Nutzungsbudget. Die KI hat keinen schreibenden Zugriff. Ihre Antworten sind Modellinterpretationen, keine validierten Engine-Ergebnisse.

Protokollreferenzen: [OpenRouter-Werkzeugaufrufe](https://openrouter.ai/docs/guides/features/tool-calling), [kostenloser Router](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground).

## Offene V2-Teile

Native Live-Cue-Ausgabe, segmentweiser Pacemaker, Sensor-Bridge von Uhr zu Telefon, validierte physiologische/persönliche Modelle, Race Simulator, Counterfactuals, Fuel-Prognosen sowie zeitkorrigierte Multi-Device-Fusion sind nicht vollständig umgesetzt. Die UI gibt dafür keine erfundenen Resultate aus. Vorhandene Modellverfügbarkeit und Cue-Budgetregeln sind eine Grundlage, keine vollständige Implementierung dieser Ziele.
