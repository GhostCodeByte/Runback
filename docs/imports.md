# Importe

Runback liest Exporte anderer Apps ein. Der Import ist optional: Aufzeichnen,
Historie und Auswertung funktionieren auch ohne. Prinzip: **dort exportieren,
hier importieren** — keine Cloud-Verbindung, kein Konto.

In der App: **Mehr → Deine Daten → App-Importe**, dann Quelle wählen und
Datei(en) auswählen. ZIP-Archive können direkt eingelesen werden.

## Dateiformate

| Format | Inhalt | Was Runback daraus macht |
|---|---|---|
| **FIT** | Garmin-Format mit Spur, Puls, Kadenz, Sportart | Voller Lauf, wie eine eigene Aufzeichnung |
| **GPX** | XML mit Spur (`<trkpt>`), optional Puls/Kadenz in `<extensions>`, Name in `<trk><name>`, Sportart in `<type>` | Voller Lauf |
| **TCX** | XML mit Spur und Sensordaten, Sportart im `Sport`-Attribut | Voller Lauf |
| **CSV / JSON** (Zusammenfassungen) | Eine Zeile bzw. ein Objekt je Aktivität ohne Spur | Zusammenfassungs-Lauf: nur Zeit und Distanz, keine Karte |
| **CSV** (Wellness) | Ruhepuls, HRV, Schlaf, Gewicht, Schritte je Zeitpunkt | Anzeige-Kontext |
| **CSV** (Kraft, Strong-Aufbau) | Eine Zeile je Satz: Datum, Übung, Gewicht, Wiederholungen | Krafteinheiten mit Sätzen |
| **ZIP** | Beliebige Kombination der obigen Dateien, bis Verschachtelungstiefe 2 | Alles Enthaltene; Spuren werden vor Zusammenfassungen gelesen |

Passwortgeschützte ZIPs werden nicht unterstützt — vorher entpacken.

## Woher die Daten kommen

| App | Export | Dateien |
|---|---|---|
| **Garmin Connect** | Aktivität → Zahnrad → „Original“ (FIT) / TCX / GPX; alles: Konto → Daten exportieren | Einzeldateien, Bulk-ZIP mit `DI_CONNECT`, `summarizedActivities.json` |
| **Strava** | Einstellungen → Meine Daten herunterladen | ZIP mit `activities.csv` + Tracks |
| **Fitbit / Google Health** | takeout.google.com → nur „Fitbit“; GPS-Läufe einzeln als TCX | Takeout-ZIP, TCX |
| **Google Fit** | takeout.google.com → nur „Fit“ | Takeout-ZIP (JSON), optional TCX/GPX |
| **Apple Health** | iPhone Health → Profil → Alle Gesundheitsdaten exportieren | `export.zip` mit `export.xml` und `workout-routes/*.gpx` |
| **Samsung Health** | Menü → Einstellungen → Persönliche Daten herunterladen | ZIP mit `com.samsung.*.csv`, einzelne GPX je Lauf |
| **Mi Fitness / Zepp Life** | Einzeltraining → Route exportieren; Archiv über user.huami.com/privacy | GPX/TCX/FIT, `SPORT*.csv`, `HEARTRATE_AUTO*.csv` |
| **Polar Flow** | Training → TCX/GPX exportieren | TCX/GPX |
| **Huawei Health** | Ich → Einstellungen → Daten exportieren | CSV/JSON, TCX/GPX |
| **Strong** (auch Hevy, FitNotes) | Profil → Einstellungen → Daten exportieren | `strong.csv` |
| Andere (Coros, Suunto, Adidas, Withings …) | „Export“ / „Daten herunterladen“ suchen | FIT/TCX/GPX bevorzugt, sonst CSV/JSON |

## Was übernommen wird

- **Läufe mit Spur** werden voll ausgewertet, mit denselben Regeln wie eigene
  Aufzeichnungen. Der Streckenname aus der Datei wird zum Lauftitel, wenn er
  sprechend ist; technische Namen (`activity_1234.fit`) werden verworfen.
- **Läufe ohne Spur** bleiben Zusammenfassungen: Zeit und Distanz für einfache
  Tempoaussagen, keine Karte, keine erfundenen Samples.
- **Ruhepuls, HRV, Schlaf, Gewicht, Schritte, VO2max** sind reiner
  Anzeige-Kontext. Sie begründen keine Empfehlung, keinen Score und keine
  Planänderung.
- **Krafttraining** (Sätze, Gewicht, Wiederholungen, RPE) erscheint als
  Krafteinheiten. Strong exportiert keine Einheit; Runback nimmt **kg** an.
- **Gewicht aus generischem JSON** nur, wenn es ausdrücklich so heißt:
  `[{"kind":"weight","date":"2024-11-02","value":70,"unit":"kg"}]`.

## Was aussortiert wird

- **Keine Läufe:** Spaziergänge, Radfahrten und andere Sportarten werden nicht
  als Lauf angelegt. Entscheidend ist zuerst die Sportart in der Datei; fehlt
  sie, das Tempo (zwischen 1,5 und 6,5 m/s gilt als Laufen).
- **Duplikate:** derselbe Lauf aus mehreren Quellen (gleiche Startzeit und
  Dauer) wird nur einmal angelegt und zählt nur einmal als Beleg.
- **Zu große Dateien:** 64 MB je Aktivität, 512 MB je Archiv entpackt,
  150.000 Samples je Aktivität. Darüber wird gezählt und übersprungen — Archiv
  teilen und erneut importieren.

Der Importbericht zeigt importierte, doppelte, übersprungene und fehlgeschlagene
Dateien je Quelle. Ein wiederholter Import erzeugt keine Duplikate.

## Privatsphäre

Alles bleibt auf dem Gerät. Exporte von Apple, Google und Samsung enthalten
Jahre an Gesundheits- und Standortdaten — nur importieren, was als Kontext
dienen soll, und Backups bewusst ablegen.

## Häufige Fragen

- **„Nur Zusammenfassung, keine Karte“** — der Export enthielt keine Spur.
  Einzeldatei (GPX/TCX/FIT) des Laufs nachliefern.
- **„Datei übersprungen“** — unbekanntes Format oder unbekannte Spalten.
- **Samsung-Zeiten wirken verschoben** — Samsung exportiert mit Zeitzonen-
  Offset; Runback zeigt Start und Ende in Ortszeit.
