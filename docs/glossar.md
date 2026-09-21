# Glossar

Übersetzungstabelle: links das Wort für Menschen, in der Mitte der Codename,
rechts wozu es dient. Nur Begriffe, die im Produkt wirklich vorkommen.

| Alltagswort | Codename | Wozu |
| --- | --- | --- |
| Bereich | `Area` | Laufen oder Krafttraining. Jeder Bereich hat eigenes Ziel, eigenen Fokus, eigene Empfehlung. |
| Ziel | `goal`, `targetDate` | Freiwilliges Vorhaben je Bereich, ggf. mit Datum. Darf enden. |
| Fokus-Art | `FocusKind` | Kurze, versionierte Auswahl je Bereich (Laufen: Ausdauer, schneller, verletzungsfrei, Gewohnheit, Fitness · Kraft: stärker, Muskeln, verletzungsfrei, Gewohnheit, Fitness). |
| Eigene Bezeichnung | `TrainingFocus.label` | Freitext des Nutzers zum Fokus. Wird angezeigt, nicht ausgewertet. |
| Fokus | `TrainingFocus` | Dauerhaftes Thema ohne Enddatum, höchstens einer je Bereich, wird nie bewertet. |
| Empfehlung | `AnyRecommendation` → `Experiment` | Die eine konkrete Sache je Bereich, die gerade ausprobiert oder bewusst beibehalten wird. |
| Danach vorgesehen | — | Nächste Empfehlung, die wartet, weil die aktive noch läuft oder die Kopplungssperre greift. |
| Kopplungssperre | `couplingGate` | Verhindert eine zweite Empfehlung, die die Prüfung der ersten verfälschen könnte. |
| Vorschlag / Angenommen | `proposed` / `accepted` | Empfehlung vor bzw. nach der Zustimmung des Nutzers. |
| Aktiv / Pausiert / Abgeschlossen / Abgebrochen | `ExperimentStatus` | Sichtbare Zustände einer angenommenen Empfehlung. |
| Vergleichsläufe | `baselineRunIds` | Mehrere frühere passende Läufe; ihr Median ist die Basis, nie ein einzelner Ausreißer. |
| Häufiger als zufällig | `signTest` | Vorab festgelegte Prüfung: mehr Läufe bzw. Einheiten besser als schlechter, als der Zufall erklärt. |
| Gleichmäßiger | `late_pace_fade_percent` | Ergebnis der Starteinteilung: weniger später Tempoabfall. Keine Aussage über Tempo oder Fitness. |
| Woran erkennen wir, dass es geholfen hat? | `ExperimentCriteria` | Vor dem Start festgelegte Prüfregel einer Empfehlung. |
| Umsetzung | `Adherence` | Ob die Empfehlung tatsächlich befolgt wurde. |
| Ergebnis | `ExperimentEvaluation` | Was sich in Folgeläufen beobachtet hat, unabhängig von der Ursache. |
| Ursache | — | Die vorsichtige Frage, ob die Empfehlung das Ergebnis verursacht hat. Meist offen. |
| Noch nicht klar | `inconclusive` | Ehrliches Urteil, wenn die Daten weder dafür noch dagegen reichen. |
| Stabil | `PlateauStatus` `stable` | Kraftverlauf, der nachweislich eng um null liegt. „Noch nicht klar“ ist kein Plateau. |
| Trainingstag | `collapseToDays` | Zwei Einheiten am selben Tag zählen im Kraftverlauf einmal. |
| Datenqualität | `QualityReport` | Wie vollständig und passend die Daten für genau diese Aussage sind. |
| Zweck | `RunPurpose` | Wofür eine Einheit gedacht war: locker, lang, Intervalle, Wettkampf, frei, unbekannt. |
| Sportart | `Sport` | `running`, `cycling`; fehlt das Feld, gilt Laufen. |
| Effort | `EffortEstimate` | Modellierte äußere Anforderung eines Laufs. Kein Fitness- oder Ermüdungswert. |
| Tempoindex | `EffortEstimate` | Einfaches Tempomaß relativ zu 3 m/s. Keine Leistung, kein Score. |
| Belastung | `sessionLoad` | RPE × Bewegungsminuten, je Skala (Beine, Atmung) getrennt. Kein Gesamtwert aus beiden. |
| Wiederholungen im Tank | `actualRir` | Freiwillige Nutzerangabe je Satz. Fehlt sie, bleibt sie unbekannt und wird nicht geschätzt. |
| Relevanzmatrix | `prioritization.ts` | Versionierte Gewichte je Fokus-Art und Handlungsklasse. |
| Handlungsklasse | `ActionClass` | Art einer Empfehlung, z. B. Startdisziplin (`calmer_start`), Last einer Übung (`strength_load`). |
| Einheit | `StrengthSession` / `RunSummary` | Trainingseinheit beliebiger Art mit Zeit, Zweck und Herkunft. |
| Satz | `PlannedSet` / `LoggedSet` | Kleinste Krafteinheit: Übung, Wiederholungen/Dauer, Last, Pause. |
| Plan | `WorkoutTemplate` | Vorlage aus Einheiten-Slots. Vorschlag, keine Verpflichtung. |
| Durchgeführt | `LoggedSet`, Status `finished` | Was tatsächlich erfasst wurde; bei Abweichung vom Plan immer maßgeblich. |
| Muskelregion | `regionId` | Eintrag aus der versionierten Regionenliste. |
| Muskelanteil | `share` | Anteil, mit dem eine Übung eine Region beansprucht. Katalogwert, persönlich anpassbar. |
| Frische | `freshness` | Modellierte Skala 0–100 je Region. Kein Gesundheits- oder Bereitschaftsmaß. Gesperrt bis zur bestandenen Prüfung. |
| Grobe Spanne | `roughSpreadPoints` | Feste Zuschläge zur Frische. Keine Standardabweichung, kein Vorhersageintervall. |
| Flach | `segmentIsFlat` | Auf- plus Abstieg höchstens 2 % der Strecke. Nettohöhe allein reicht nicht. |
| Gemeldeter Muskelkater | `SorenessReport` | Nutzerangabe je Region und Zeitpunkt. Eingabe, keine Messung. |
| Zusammenfassungs-Lauf | `summaryOnly` | Importierter Lauf ohne Spur; nur Zeit und Distanz bekannt. |
| Gesamtzeit | `elapsedSeconds` | Start bis Ende nach der Uhr, Pausen eingeschlossen. |
| Aufzeichnungszeit | `activeSeconds`, `durationSeconds` | Gesamtzeit ohne die vom Nutzer ausgelösten Pausen. Keine Bewegungszeit. |
| Bewegungszeit | `movingSeconds` | Laufen plus Gehen laut Phasenerkennung. Ohne Phasen unbekannt, nicht geschätzt. |
| Phase | `MovementPhase` | Zusammenhängender Abschnitt Laufen, Gehen, Stillstand, Pause oder Unbekannt (mindestens 20 s). |
| Unbekannt (Phase) | `UNKNOWN` | Weder Bewegung noch Stillstand belegbar, z. B. GPS-Ausfall ohne ruhenden Beschleunigungssensor. |
| Kilometer-Abschnitt | `SegmentAggregate` | Endet am vollen Kilometer oder an einer Pause; GPS-Lücken bleiben als `gapSeconds` darin. |
| GPS-Lücke | `GpsGap` | Schritt, der nicht zählt: zu lange ohne Fix, zu ungenau oder unplausibel schnell. |
| Verlauf | `RunSeries` | Darstellungsreihe eines Laufs (Tempo, Puls, Höhe, Kadenz, Wind je Fenster, höchstens 600 Zeilen) für die Graphen der Detailseite. Tempo nur in Bewegung. |
| Gegenwind | `headwindMps` | Windanteil entlang der Laufrichtung aus Modellwind und GPS-Kurs; positiv = von vorn. Nur mit bekannter Windrichtung. |
| Höhenmeter | `ElevationSummary` | Auf-/Abstieg aus Barometer, sonst aus GPS mit bekannter vertikaler Genauigkeit; sonst „nicht bestimmbar“. |
| Fehlstart | `isAccidentalRun` | Unter 60 s und unter 100 m. Bleibt gespeichert, zählt aber nicht als Training. |
| Einblicke | `insights.ts` | Tiefere Auswertung eines Laufs auf der Detailseite: Bewegung, Pacing, Puls, Ermüdung, Bedingungen, Vergleich. Beobachtung, keine Empfehlung. |
| Zeitbudget | `timeBudgetShares` | Ein Balken aus gelaufen, gegangen, gestanden; Pausen daneben. |
| Puls-Drift | `heartRateDrift` | Puls je Geschwindigkeit in der zweiten Hälfte gegenüber der ersten, ohne den ersten Kilometer. Unter 5 % „aerob solide“. |
| Meter je Herzschlag | `metersPerBeat` | Strecke geteilt durch alle Herzschläge in Bewegung. Vergleichbar über Läufe. |
| Flach-Äquivalent | `gradeAdjustedPace` | Geschätztes Tempo in der Ebene bei gleichem Aufwand (Minetti 2002, Nettosteigung je Kilometer). Immer als Schätzung ausgewiesen. |
| Maxpuls | `maxHeartRate` | Eingestellt gewinnt; sonst zweithöchster Spitzenwert der letzten Läufe, ab drei Läufen mit Puls. |
| Pulszonen | `heartRateZones` | Zeit in fünf Zonen als Anteil vom Maxpuls (60/70/80/90 %). |
| Ermüdungsmuster | `fatiguePattern` | Letztes gegen erstes Drittel: Tempo, Puls, Kadenz, Schrittlänge. Antwort in Worten: eher Beine, eher Kreislauf, bewusst, stabil. |
| Wind am Tempo / Wärme am Tempo | `environmentCost` | Grobe Schätzung in s/km aus Gegenwind je Fenster bzw. Temperatur über 15 °C. |
| Deine letzten Läufe | `recentRuns` | Bis zu acht Läufe derselben Art aus 120 Tagen davor, bevorzugt gleicher Zweck; ab drei gibt es einen Vergleich gegen den Median. |
| Besser · wie zuletzt · etwas schlechter · schlechter | `Rating`, `StatTone` | Farbe und Pfeil einer Zahl gegenüber dem Median der letzten Läufe. Nie Farbe allein. |
| Analyse-Export | `buildRunAnalysisExport` | Drei Dateien zum Teilen: Bericht (Markdown), Analyse (JSON), Zeitreihe (CSV, 5 s). |
| Grundregel | — | Regel, die für alles gilt und nicht gegen eine UI-Abkürzung getauscht wird. |

**Nicht mehr verwendet:** Arbeitsthema, nächste Handlung, Intervention,
Laufempfehlung, Änderung (→ Empfehlung) · Prüfbedingung, Erfolgskriterium
(→ „Woran erkennen wir, dass es geholfen hat?“) · Baseline (→ Vergleichsläufe)
· inconclusive (→ noch nicht klar) · Invariante (→ Grundregel) ·
Gesamtumfang (→ Belastung; war nur Distanz in anderer Einheit) · Plateau als
„kein Nachweis“ (→ stabil nur mit Nachweis) · Standardabweichung der Frische
(→ grobe Spanne).

**In einem Satz:** Ein Ziel kann einen Fokus nahelegen; der Fokus hilft, eine
Empfehlung auszuwählen. Nur die Empfehlung wird auf Umsetzung, Ergebnis und
Ursache geprüft — je Bereich höchstens eine.
