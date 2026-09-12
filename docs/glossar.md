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
| Vergleichsläufe | `baselineRunIds` | Frühere passende Läufe, mit denen spätere verglichen werden. |
| Woran erkennen wir, dass es geholfen hat? | `ExperimentCriteria` | Vor dem Start festgelegte Prüfregel einer Empfehlung. |
| Umsetzung | `Adherence` | Ob die Empfehlung tatsächlich befolgt wurde. |
| Ergebnis | `ExperimentEvaluation` | Was sich in Folgeläufen beobachtet hat, unabhängig von der Ursache. |
| Ursache | — | Die vorsichtige Frage, ob die Empfehlung das Ergebnis verursacht hat. Meist offen. |
| Noch nicht klar | `inconclusive` | Ehrliches Urteil, wenn die Daten weder dafür noch dagegen reichen. |
| Datenqualität | `QualityReport` | Wie vollständig und passend die Daten für genau diese Aussage sind. |
| Zweck | `RunPurpose` | Wofür eine Einheit gedacht war: locker, lang, Intervalle, Wettkampf, frei, unbekannt. |
| Sportart | `Sport` | `running`, `cycling`; fehlt das Feld, gilt Laufen. |
| Effort | `EffortEstimate` | Modellierte äußere Anforderung eines Laufs. Kein Fitness- oder Ermüdungswert. |
| Tempoindex | `EffortEstimate` | Einfaches Tempomaß relativ zu 3 m/s. Keine Leistung, kein Score. |
| Relevanzmatrix | `prioritization.ts` | Versionierte Gewichte je Fokus-Art und Handlungsklasse. |
| Handlungsklasse | `ActionClass` | Art einer Empfehlung, z. B. Startdisziplin (`calmer_start`), Last einer Übung (`strength_load`). |
| Einheit | `StrengthSession` / `RunSummary` | Trainingseinheit beliebiger Art mit Zeit, Zweck und Herkunft. |
| Satz | `PlannedSet` / `LoggedSet` | Kleinste Krafteinheit: Übung, Wiederholungen/Dauer, Last, Pause. |
| Plan | `WorkoutTemplate` | Vorlage aus Einheiten-Slots. Vorschlag, keine Verpflichtung. |
| Durchgeführt | `LoggedSet`, Status `finished` | Was tatsächlich erfasst wurde; bei Abweichung vom Plan immer maßgeblich. |
| Muskelregion | `regionId` | Eintrag aus der versionierten Regionenliste. |
| Muskelanteil | `share` | Anteil, mit dem eine Übung eine Region beansprucht. Katalogwert, persönlich anpassbar. |
| Frische | `freshness` | Modellierte Skala 0–100 je Region. Kein Gesundheits- oder Bereitschaftsmaß. |
| Gemeldeter Muskelkater | `SorenessReport` | Nutzerangabe je Region und Zeitpunkt. Eingabe, keine Messung. |
| Zusammenfassungs-Lauf | `summaryOnly` | Importierter Lauf ohne Spur; nur Zeit und Distanz bekannt. |
| Grundregel | — | Regel, die für alles gilt und nicht gegen eine UI-Abkürzung getauscht wird. |

**Nicht mehr verwendet:** Arbeitsthema, nächste Handlung, Intervention,
Laufempfehlung, Änderung (→ Empfehlung) · Prüfbedingung, Erfolgskriterium
(→ „Woran erkennen wir, dass es geholfen hat?“) · Baseline (→ Vergleichsläufe)
· inconclusive (→ noch nicht klar) · Invariante (→ Grundregel).

**In einem Satz:** Ein Ziel kann einen Fokus nahelegen; der Fokus hilft, eine
Empfehlung auszuwählen. Nur die Empfehlung wird auf Umsetzung, Ergebnis und
Ursache geprüft — je Bereich höchstens eine.
