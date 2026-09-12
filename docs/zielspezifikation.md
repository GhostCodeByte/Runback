# Runback – Zielspezifikation V1 / V2

> Für den Coding Agent. Beschreibt **Ziele und Akzeptanzkriterien**, nicht Implementierung.
> Wie ein Ziel erreicht wird, entscheidet der Agent, solange die Grundregeln in §3 gelten.
> Überarbeitete Fassung aus der Produktbesprechung. Die aktuelle Sprach- und
> Begriffsentscheidung steht in [Änderungen](aenderungen.md), die kurzen
> Übersetzungen im [Glossar](glossar.md).
> V1/V2 bezeichnen Produktstufen, nicht die Revisionsnummer dieses Dokuments.
> Aktuell wird ausschließlich die Dokumentation gepflegt. Ergänzende Ziele: [Bedienung und spätere Auslieferung](bedienung-und-auslieferung.md), [Zielspezifikation Training (Gym + Laufen)](zielspezifikation-training.md).

---

## 1. Was Runback ist

Eine Android-Lauf-App, die aus Laufdaten und Trainingskontext die **aktuell wichtigste sinnvolle Empfehlung** ableitet, sie verständlich begründet und später überprüft, ob sie umgesetzt wurde und mit einer Verbesserung verbunden war.

Interne Komplexität ist erlaubt. Der Output bleibt schmal. **Keine neue Empfehlung ist ein zulässiges Ergebnis.**

**Kernversprechen:** Ein Lauf rein → höchstens eine begründete, umsetzbare und prüfbare Empfehlung raus, wenn die Daten sie tragen. Andernfalls erklärt die App knapp, was bereits bekannt ist und was noch fehlt.

Die App unterscheidet:
- was gemessen oder subjektiv angegeben wurde;
- was ein Modell daraus schätzt;
- welche Empfehlung vorgeschlagen wird;
- ob sie umgesetzt wurde;
- welche Wirkung beobachtet wurde und wie belastbar ihre Zuordnung zur Empfehlung ist.

Eine bessere Kennzahl ist nur dann ein Trainingserfolg, wenn der Zweck der Einheit und das übergeordnete Ziel erhalten bleiben.

### Die drei Ebenen

| Ebene | Verbindliche Bedeutung |
|---|---|
| Ziel | Optionales Vorhaben mit Datum. Ein Ziel darf enden; das Datum macht Aufbau und Tapering berechenbar. |
| Fokus | Dauerhaftes allgemeines Thema ohne Enddatum. Höchstens einer ist aktiv. Der Fokus wird nicht bewertet. |
| Empfehlung | Höchstens eine konkrete, überprüfbare Handlung. Sie kann ein neues Verhalten oder bewusstes Beibehalten sein. Nur sie durchläuft den Regelkreis. |

Ziel, Fokus und Empfehlung bleiben unabhängig voneinander optional. Ein Ziel
schlägt einen passenden Fokus vor. Ohne Ziel gibt der Nutzer den Fokus selbst ein;
Runback rät dann keinen Fokus. Ein Fokuswechsel beendet eine laufende
Empfehlung nicht automatisch.

---

## 2. Rahmen (nicht verhandelbar)

- Android-only. React Native + Kotlin Native Modules. Kein iOS-Code; JS-Schnittstellen plattformneutral halten.
- Kostenloser Kern, keine kostenpflichtigen Pflichtabhängigkeiten. Quelloffene Veröffentlichung ist das Produktziel; das Dokumentationsrepository ist öffentlich. Die passende Open-Source-Lizenz wird vor einer entsprechenden Softwarefreigabe festgelegt.
- Ein Nutzer. Kein eigener Account, kein Auth, kein Multi-Tenant, kein verpflichtender Onboarding-Flow. Erforderliche Systemberechtigungen werden beim Bedarf erklärt und angefragt.
- Keine eigene Cloud, kein Server, keine zentrale Datenbank außerhalb des Geräts.
- **Local First bedeutet:** Läufe aufzeichnen, speichern, ansehen und mit den vorhandenen Daten einfach auswerten funktioniert ohne Internet. Wetter, Karten, Höhendaten und optionale LLM-Formulierung dürfen Internet verwenden.
- Externe Dienste sind auf Wetter, Karten-/Höhendaten und optional OpenRouter begrenzt. Health Connect und verbundene Sensoren sind lokale Integrationen.
- **Genaue Koordinaten bleiben erhalten** und dürfen für Wetter, Karten und Höhenmodell verwendet werden. Runback verspricht keine Standortanonymität gegenüber diesen Diensten.
- Das LLM erhält standardmäßig keine Koordinaten, weil es sie für seine Aufgabe nicht benötigt. Das ist eine zweckbezogene Datenbegrenzung, kein allgemeines Verbot externer Positionsverarbeitung.
- OpenRouter ist optional, verwendet einen nutzereigenen Key und kann je nach Modell Kosten verursachen. Ohne diesen Dienst funktioniert der Produktkern vollständig.
- Rohdaten werden möglichst umfangreich erhalten. Speichergrenzen sind ausdrücklich zulässig, sofern Löschregeln, erhaltene Daten und verbleibende Neuberechenbarkeit sichtbar sind.

### Fachliche Begriffe für die Auswertung

| Begriff | Verbindliche Bedeutung in Runback |
|---|---|
| Intensität | Anforderung pro Zeit beziehungsweise relativ zur persönlichen Leistungsfähigkeit. |
| Gesamtbelastung | Über die Einheit angesammelte Belastung; Dauer und gewählte Belastungsdimension werden genannt. |
| Subjektive Anstrengung | Vom Nutzer angegebene RPE, getrennt für Beine und Atmung. |
| Effort | Modellierte äußere Anforderung unter Berücksichtigung der unterstützten Einflussfaktoren. Kein direkt gemessener Universalwert für Ermüdung, Fitness oder Gesundheit. |
| Ziel | Optionales Vorhaben mit einem möglichen Enddatum. |
| Fokus | Dauerhaftes allgemeines Thema ohne Enddatum; höchstens einer ist aktiv. |
| Empfehlung | Höchstens eine vom Nutzer angenommene, konkret formulierte Handlung mit festgelegter Prüfung. |
| Vergleichsläufe | Frühere passende Läufe, die als Vergleichsbasis für eine Empfehlung dienen. |
| Woran erkennen wir, dass es geholfen hat? | Vor dem Start festgelegte Regel für die spätere Prüfung einer Empfehlung. |
| Vergleichbar | Für eine bestimmte Fragestellung ausreichend ähnliche oder belastbar korrigierbare Bedingungen. Nicht zwingend gleiche Strecke. |

Die mathematische Skala des Efforts, ihre Referenzbedingungen und unterstützten Einsatzbereiche werden vor der ersten Ausspielung dokumentiert und versioniert. Einheiten dürfen nicht stillschweigend vermischt werden. Die Fokus-Arten und ihre Relevanzmatrix werden ebenfalls versioniert. Die eigene Bezeichnung des Nutzers steht im UI, wird aber nicht ausgewertet.

---

## 3. Grundregeln

Gelten für jedes Feature in V1 und V2. Verletzung ist ein Bug, kein Trade-off.

1. **Originale bleiben original.** *Merksatz:* Was gespeichert ist, wird nicht heimlich besser gemacht.
   *Genauer Text:* Erhaltene Originaldaten werden nicht überschrieben. Bereinigung, Korrekturen, Reduktion und Nutzeränderungen liegen getrennt. Begrenzte Aufbewahrung und ausdrückliches Löschen sind erlaubt. Reduzierte Daten werden nicht als vollständige Originale ausgegeben.
2. **Jede Rechnung zeigt ihre Herkunft.** *Merksatz:* Jede Zahl braucht eine Spur zurück zu ihren Daten.
   *Genauer Text:* Ableitungen tragen eine `model_version`, ihre Eingabequellen und deren Versionen beziehungsweise Zustand. Neuberechnung wird nur für Ergebnisse versprochen, deren notwendige Ausgangsdaten noch vorhanden sind.
3. **Erst prüfen, dann empfehlen.** *Merksatz:* Keine Empfehlung ohne Zweck und die Frage, woran wir Hilfe erkennen.
   *Genauer Text:* Eine Empfehlung nennt konkrete Handlung, Einsatzbereich, Ziel und die vorher festgelegte Regel, woran wir erkennen, dass sie geholfen hat. Reine Messwerte, Statusmeldungen und neutrale Beobachtungen brauchen keine eigene Prüfung.
4. **Beibehalten ist erlaubt.** *Merksatz:* Nicht ständig etwas Neues zu tun ist ein vollwertiges Ergebnis.
   *Genauer Text:* „Beibehalten“, „aktuell keine Empfehlung nötig“ und „noch nicht beurteilbar“ sind unterschiedliche, begründete Ausgaben. Fehlende Belege werden nicht als Beweis für problemloses Training dargestellt.
5. **Unsicherheit bleibt sichtbar.** *Merksatz:* Lieber „eher ein Eindruck“ als eine präzise Zahl ohne Grundlage.
   *Genauer Text:* Verwendete Läufe beziehungsweise Abschnitte, Datenqualität, Annahmen und Unsicherheit sind nachvollziehbar. Messwerte und Nutzereingaben werden als solche gekennzeichnet; exakte Zählwerte brauchen kein künstliches Intervall. Nicht belastbar quantifizierbare Schätzungen dürfen nicht mit erfundenen Intervallen erscheinen.
6. **Regeln entscheiden, Sprache erklärt.** *Merksatz:* Das Sprachmodell darf formulieren; es darf keine Empfehlung oder Bewertung erfinden.
   *Genauer Text:* Empfehlungen, Bewertungen und fachliche Behauptungen entstehen aus reproduzierbaren Regeln oder versionierten Modellen. Gleiche vollständige Eingaben und gleicher Modellzustand ergeben dieselbe Entscheidung.
7. **Eine Lücke bleibt eine Lücke.** *Merksatz:* Fehlt ein Sensor, verlieren wir nur die Aussage, die ihn braucht.
   *Genauer Text:* Fehlende Daten begrenzen nur die betroffene Aussage. Es gibt keinen Absturz und keine erfundene Ersatzmessung. Nicht verfügbare Ergebnisse werden knapp erklärt; gute Daten bleiben nutzbar.
8. **Die Brücke bleibt schlank.** *Merksatz:* Viele Rohmessungen bleiben dort, wo sie gespeichert und verarbeitet werden.
   *Genauer Text:* Es gibt keine hochfrequenten Rohsample-Ströme über die JS-Grenze. JS sieht Aggregate und bei Bedarf begrenzte, für die Darstellung abgeleitete Geometrien oder Zeitreihen. Karten und Charts dürfen diese Regel nicht umgehen.
9. **Daten gehen nur für einen Grund hinaus.** *Merksatz:* Keine Weitergabe ohne klaren Zweck.
   *Genauer Text:* Externe Anfragen entsprechen §2. Es gibt keine ungefragte Synchronisation der Laufdatenbank, keine Rohsamples an das LLM und keine Schlüssel in Logs oder Exporten.
10. **Die Daten gehören dem Nutzer.** *Merksatz:* Was Runback behält, kann der Nutzer sichern, zurückholen und löschen.
   *Genauer Text:* Vollständiges Backup, Wiederherstellung und Löschen sind ohne Runback-Account möglich. Austauschformate geben ihre Einschränkungen an.
11. **Der Trainingszweck gewinnt.** *Merksatz:* Eine schönere Kennzahl ist kein Erfolg, wenn das eigentliche Training verloren geht.
   *Genauer Text:* Eine Empfehlung darf eine Kennzahl nicht durch Aufgabe des eigentlichen Trainingsziels verbessern.
12. **Vorher festlegen, später ehrlich bleiben.** *Merksatz:* Was vor dem Start galt, wird nach dem Ergebnis nicht passend gemacht.
   *Genauer Text:* Angenommene Empfehlung, Vergleichsregeln, Zielgröße, relevante Mindeständerung und Auswertungsverfahren werden vor Beginn festgehalten. Spätere Erkenntnisse dürfen eine Prüfung begründet beenden oder ersetzen, aber ihre ursprüngliche Bewertung nicht heimlich umschreiben.
13. **Drei Fragen, drei Antworten.** *Merksatz:* Erst fragen: Hat er’s gemacht? Dann: Ist es besser geworden? Erst dann: Lag’s daran? Nie zwei Schritte überspringen.
   *Genauer Text:* Umsetzung, Ergebnis und Ursache bleiben getrennt. Nicht umgesetzt ist nicht widerlegt; ein Unterschied allein ist kein kausaler Nachweis. „Kein relevanter Effekt“ erfordert ausreichend präzise Evidenz.
14. **Empfehlungen bleiben ruhig.** *Merksatz:* Ein neuer Lauf ist kein automatischer Grund für einen neuen Tipp.
   *Genauer Text:* Neue Daten lösen nicht automatisch eine neue Empfehlung aus. Ein Themenwechsel braucht einen nachvollziehbaren Grund oder einen Nutzerwunsch. Ein Fokuswechsel beendet keine laufende Empfehlung automatisch.

---

## 4. V1 — Ziele

Die bisherigen Ziel-IDs bleiben erhalten. Der Kern aus Import, Trainingszweck, wenigen belegbaren Handlungsklassen und Prüfung soll früh durchgängig funktionieren. Die Liste verlangt nicht, vor dem ersten funktionierenden Regelkreis jede Auswertung fertigzustellen.

### V1-1 · Bestehende Historie ist im System

Läufe aus FIT, GPX, TCX und Strava-Bulk-Export sind importierbar. Importierte und selbst aufgezeichnete Läufe nutzen dieselben Auswertungsregeln, soweit ihre Daten geeignet sind.

**Fertig, wenn:**
- Ein Strava-Export-ZIP wird in einem Durchgang eingelesen; Fehler einzelner Dateien stoppen den Import nicht.
- Der Nutzer sieht Fortschritt, importierte, doppelte und übersprungene Aktivitäten mit verständlichem Grund.
- Wiederholung oder Fortsetzung desselben Imports erzeugt keine doppelten Läufe.
- Mehrere Dateien desselben Laufs werden als Quellen erkannt und nicht als unabhängige Belege gezählt.
- Fehlende Zeit-, Positions- oder Sensordaten werden benannt; nicht unterstützte Inhalte werden nicht stillschweigend erfunden.
- Große oder beschädigte Archive können die App nicht durch unbegrenzte Verarbeitung blockieren; Abbruch lässt bereits abgeschlossene Importe konsistent.

### V1-2 · Die App zeichnet Läufe zuverlässig auf

Phone-Aufzeichnung mit GPS, Barometer und Beschleunigungssensor, soweit vorhanden und freigegeben. Start, Pause, Fortsetzen und Ende sind eindeutig bedienbar.

**Fertig, wenn:**
- Ein 90-Minuten-Lauf mit gesperrtem Display und Android-Energiesparzuständen auf dem dokumentierten Referenzgerät vollständig aufgezeichnet wird.
- Das Schließen der Oberfläche allein die Aufzeichnung nicht beendet.
- Ein Prozessabsturz höchstens die letzten fünf Sekunden noch nicht dauerhaft gespeicherter Daten verliert. Nach Neustart ist der bisherige Lauf wiederherstellbar.
- Eine Unterbrechung bleibt als Lücke erkennbar; während eines nicht laufenden Prozesses werden keine Samples behauptet.
- Bewusstes Android-Stoppen, Berechtigungsentzug oder Geräteneustart als eigene Fälle behandelt werden. Fortgesetzte Aufzeichnung gegen einen ausdrücklichen System-/Nutzerstopp wird nicht versprochen.
- Fehlender Sensor, niedriger Speicher, GPS-Ausfall und versehentliches Beenden verständlich behandelt werden.
- Akkuverbrauch und Speicherbedarf des 90-Minuten-Tests dokumentiert sind. Referenzgerät, Android-Version und feste Grenzwerte werden vor dem Abnahmetest festgelegt.

### V1-3 · Health Connect ist angebunden

Lesen: verfügbare Lauf-/Trainingseinheiten, Routen, zeitbezogene HR-, Geschwindigkeits-, Distanz- und Kadenzdaten sowie HRV, Ruhepuls, Schlaf und Körpermasse. Andere Trainingsarten dürfen als Kontext gelesen werden. Schreiben: abgeschlossene Runback-Läufe mit ausdrücklich freigegebenen Datentypen.

**Fertig, wenn:**
- Ein Lauf aus der tatsächlich getesteten Pixel-Watch-Datenkette ohne manuellen Dateiexport analysiert werden kann.
- Sichtbar ist, welche Daten die Quell-App bereitstellt, wie aktuell sie sind und welche fehlen.
- Erforderlicher Vordergrundzugriff oder zusätzliche Routenfreigabe erklärt wird, statt Hintergrundzugriff auf fremde Routen pauschal zu versprechen.
- Ein Runback-Lauf in einer getesteten kompatiblen Ziel-App erscheint.
- Erneutes Lesen/Schreiben keine Duplikate oder Rückimport-Schleife erzeugt.
- Der Nutzer entscheidet, ob die Route mitgeschrieben wird. Die lokale Weitergabe an Health Connect wird von möglichen Cloud-Funktionen anderer Apps unterschieden.
- Verweigerte Berechtigungen und ein fehlendes Health Connect die Phone-Aufzeichnung nicht verhindern.

### V1-4 · Die App weiß, welche Aussagen ihre Daten tragen

Artefakterkennung für HR-Cadence-Lock, GPS-Sprünge, Zeitfehler, Lücken und unplausible Werte. Qualitätsbewertung pro Sensor, Abschnitt und Auswertungszweck. Ein Laufwert darf dies zusammenfassen, aber keine spezifischen Ausschlüsse ersetzen.

**Fertig, wenn:**
- Ein Lauf mit bekannter kaputter HR sichtbar bleibt, während betroffene physiologische Aussagen ausgesetzt werden.
- Verlässliche Pace- oder Distanzdaten desselben Laufs weiter verwendbar sind.
- Nur betroffene Abschnitte ausgeschlossen werden, sofern die verbleibenden Daten für die Aussage ausreichen.
- Vermutete Artefakte nicht als sicher festgestellte Gerätefehler erscheinen.
- Pausen, Tunnel, Aufwärmen, Intervalle und Auslaufen passende Behandlung erhalten.
- Nutzerhinweise und Korrekturen getrennt von den Originaldaten gespeichert werden.
- Höhenmodell und Barometer als fehlerbehaftete Quellen behandelt werden; Brücken, Unterführungen und grobe Geländedaten keine unbegründete „Korrektur“ erzwingen.

### V1-5 · Läufe erhalten verfügbaren Umweltkontext

Historisches Wetter für genaue Position und Zeit, Höhe und Laufrichtung relativ zum Wind. Anreicherung darf nachträglich erfolgen.

**Fertig, wenn:**
- Ein offline aufgezeichneter Lauf nach verfügbarer Netzverbindung und erlaubter Hintergrundausführung automatisch nachbearbeitet wird.
- Alle verfügbaren Anreicherungen abgeschlossen werden; ausstehende, nicht verfügbare oder dauerhaft fehlgeschlagene Daten sichtbar begründet bleiben.
- Datenquelle, räumliche/zeitliche Auflösung und Modellstand nachvollziehbar sind.
- Regionaler Wetterwind nicht als am Körper gemessener Wind ausgegeben wird.
- Frischere oder nachgelieferte Wetterdaten eine neue Ableitung erzeugen, ohne frühere Entscheidungsgrundlagen zu überschreiben.
- Ohne Internet die Basisanalyse funktioniert; eine fehlende Hintergrundkarte als solche erkennbar ist.
- Genutzte Karten-/Höhendatenquellen den vorgesehenen Abruf und gegebenenfalls Offlinegebrauch erlauben.

### V1-6 · Effort ist definiert, berechenbar und aufschlüsselbar

Modellierte äußere Anforderung pro Lauf und geeignetem Abschnitt. GAP, geschätzte mechanische Leistung, Umweltanpassungen und Decoupling bleiben als unterschiedliche Größen erkennbar.

**Fertig, wenn:**
- Skala, Einheiten, Referenzbedingungen, Gültigkeitsbereich und Unsicherheitsbehandlung dokumentiert sind.
- Für jeden geeigneten Kilometer Tempo, Steigung und die belastbar schätzbaren Umweltbeiträge ausgewiesen werden können.
- Nicht belastbar schätzbare Faktoren ausdrücklich „nicht bestimmbar“ bleiben; fehlender Wind wird nicht als Windstille behandelt.
- Faktorbeiträge eine feste Referenz und dokumentierte Zuordnung von Wechselwirkungen haben. Anteile dürfen nicht doppelt gezählt werden.
- Intensität, Dauer, Gesamtbelastung und RPE nicht zu austauschbaren Bedeutungen derselben Zahl werden.
- Ungeeignete Abschnitte wie Pausen oder sehr kurze HR-Übergänge keine scheinpräzise physiologische Bewertung erzeugen.
- Ein transparenter einfacher Ausgangsansatz funktioniert, bevor komplexere Schätzungen freigeschaltet werden.

### V1-7 · Unterschiedliche Strecken sind für geeignete Fragen vergleichbar

Wiederholte Routen sind keine Voraussetzung. Normalisierung unterstützt Vergleiche innerhalb dokumentierter Modellgrenzen.

**Fertig, wenn:**
- Zwei Läufe unterschiedlicher Route mit nachvollziehbarer Datenbasis hinsichtlich Intensität beziehungsweise Gesamtbelastung verglichen werden können.
- Die App erklärt, in welcher Hinsicht ein Lauf härter war.
- Gleicher Gesamtscore unterschiedliche Belastungsverteilungen nicht unsichtbar macht.
- Für unzureichend vergleichbare Bedingungen eine Rangfolge verweigert werden kann.
- Vergleiche Trainingszweck, Dauer, Datenqualität und relevante Umweltbedingungen berücksichtigen.
- Die Auswahl geeigneter Vergleichsläufe vor einem Versuch feststeht und nicht nach dem gewünschten Ergebnis erfolgt.

### V1-8 · Subjektive Daten werden einfach erfasst

Nach einem Lauf: RPE getrennt für Beine und Atmung, plus optionale Notiz. Zwei Bewertungen ohne zusätzlichen Pflichtdialog.

**Fertig, wenn:**
- Jede der beiden Bewertungen mit einem Tap möglich ist; Skala und Endpunkte verständlich sind.
- Eingabe überspringbar und nachträglich ergänzbar bleibt.
- Zeitpunkt und nachträgliche Änderungen nachvollziehbar sind.
- „Nicht angegeben“ nicht als geringe Anstrengung behandelt wird.
- Ein großer Historienimport keine Flut verpflichtender Rückfragen auslöst.

### V1-9 · Empfehlungen erscheinen, sobald die Daten sie tragen

Einzellauf-Aussagen wie Pacing-Verteilung, passende Effort-Verteilung, HR-Drift und Kadenzverlauf brauchen keine künstliche Mindesthistorie. Ihre Bewertung muss zum Trainingszweck passen.

**Fertig, wenn:**
- Schon nach Lauf 1 eine konkrete Empfehlung möglich ist, sofern für genau diese Empfehlung ausreichende Daten vorliegen.
- Keine neue Empfehlung erzwungen wird, wenn nur eine Beobachtung oder eine sinnvolle Rückfrage möglich ist.
- Ein kurzer, unvollständiger oder sensorarmer Lauf eine ehrliche Einordnung statt einer erfundenen Empfehlung erhält.
- Sichtbar bleibt, auf welchen Läufen oder Abschnitten die Aussage beruht.
- Weitere Daten die Unsicherheit verringern können, ohne zwangsläufig die Handlung zu ändern.
- „Mehr Daten nötig“ möglichst konkret erklärt, welche geeignete Beobachtung fehlt.

### V1-10 · Die Decision Engine schließt den Regelkreis einer Empfehlung

Vermutung → vorgeschlagene Empfehlung → Annahme durch den Nutzer → vorher festgelegte Regel → Umsetzung → Beobachtung → Urteil.

Höchstens eine aktive Empfehlung wird geprüft. Die Reihenfolge entsteht aus
der versionierten Relevanzmatrix, Datenqualität, Umsetzbarkeit und Aufwand.
Neuheit allein rechtfertigt keinen Wechsel.

**Fertig, wenn:**
- Aus vielen Auffälligkeiten höchstens eine Hauptempfehlung entsteht; neutrale Details bleiben zugänglich.
- Der Nutzer eine Empfehlung annehmen, verschieben, ablehnen und eine Prüfung beenden kann.
- Bei Annahme Empfehlung, Einsatzbereich, Vergleichsläufe, Zielgröße, praktisch relevante Mindeständerung, Vergleichs-/Ausschlussregeln, Mindestbeobachtung, Prüfzeitpunkte und Abbruchbedingungen feststehen.
- Die Umsetzung separat erfasst oder belastbar aus Daten beurteilt wird; unbekannte Umsetzung als unbekannt bleibt.
- Die Empfehlung die Zustände „Vorschlag“, „Angenommen“, „Aktiv“, „Pausiert“, „Abgeschlossen“ und „Abgebrochen“ nachvollziehbar durchläuft.
- Das Urteil Verbesserung, Verschlechterung, keinen relevanten Effekt, „noch nicht klar“ und fehlende Umsetzung unterscheiden kann.
- Ein beobachteter Unterschied nicht automatisch als verursachte Wirkung der Empfehlung formuliert wird.
- Drei geeignete Läufe eine Zwischenbewertung erlauben; die ausreichende Datenmenge und Beobachtungsdauer von der Fragestellung abhängen.
- Ein widerlegter Versuch kontextbezogen berücksichtigt wird. Eine ganze Hypothesenklasse wird nicht dauerhaft durch einen einzelnen Fehlschlag gesperrt.
- Neue Daten, ein RPE-Nachtrag, Wetteranreicherung oder ein Fokuswechsel keinen unbegründeten Wechsel der Empfehlung erzeugt.
- Ein Modellfehler oder ein verändertes Ziel eine Prüfung begründet beenden kann; eine neue Empfehlung erhält neue, vorab fixierte Bedingungen.
- „Beibehalten“ und „noch nicht beurteilbar“ mit eigenständigen Begründungen funktionieren.

### V1-11 · Die Post-Run-Zusammenfassung bleibt schmal

Drei feste Informationsplätze:
1. Einordnung des Laufs im Verhältnis zu seinem Zweck.
2. Stand der Empfehlung beziehungsweise derzeitige Beurteilbarkeit.
3. Die konkrete Empfehlung, einschließlich Beibehalten oder Abwarten.

Lob und Verbesserungsbedarf werden nicht künstlich erzeugt. Vertiefung liegt unter „Details“.

**Fertig, wenn:**
- Die Standardansicht bei normaler Systemschrift auf einen Referenz-Handybildschirm passt.
- Größere Schrift und Bedienhilfen den Inhalt erreichbar lassen; notwendiges Scrollen ist dann erlaubt.
- Datenbasis und Unsicherheit knapp erkennbar und mit einer Aktion genauer erklärbar sind.
- Die Sprache keine unbelegte Ursache oder Sicherheit suggeriert.
- Eine laufende Empfehlung nach einem weiteren Lauf bestätigt werden kann, statt einen neuen Tipp zu erzwingen.

### V1-12 · LLM-Formulierung ist optional

OpenRouter mit nutzereigenem Key. Eingabe: geprüfte Engine-Objekte und erforderliche Segmentaggregate, standardmäßig ohne Koordinaten, ohne Rohsamples und ohne ungefragte Freitextnotizen.

**Fertig, wenn:**
- Ohne Key die gesamte Entscheidung und eine verständliche Template-Fassung verfügbar sind.
- Template zuerst erscheint; eine geprüfte LLM-Fassung ersetzt sie erst nach erfolgreicher Rückgabe.
- Zahlen, Richtung, Aussageumfang, Ursache, Sicherheit, Empfehlung und Bedingungen mit der Engine übereinstimmen.
- Nicht ausreichend prüfbare freie Aussagen verworfen oder auf kontrollierte Formulierungen begrenzt werden.
- Timeouts, Netzfehler, Budgetgrenzen und ungültige Antworten die App nicht blockieren.
- Cache-Ergebnisse an Eingabe- und Formulierungsstand gebunden sind; veraltete Prosa keine neue Entscheidung überschreibt.
- Der Key geschützt gespeichert wird und weder in Logs noch in normalen Exporten landet.
- Der Nutzer den Dienst deaktivieren und gespeicherte Formulierungen beziehungsweise den Key entfernen kann.

### V1-13 · Karte und Verlauf bleiben brauchbar

Aktivitätsliste, Detailansicht, Karte mit verfügbaren Overlays für Pace, GAP, Steigung, HR, Kadenz, Effort und Datenqualität. Zeitreihen und Karten bilden Pausen, Lücken und unterschiedliche Datenauflösungen korrekt ab.

**Fertig, wenn:**
- Nicht verfügbare Overlays verständlich deaktiviert sind.
- Karte und Diagramm denselben gewählten Abschnitt hervorheben können.
- Ein langer Lauf und eine Historie mit 1.000 Aktivitäten auf dem dokumentierten Referenzgerät ohne merkliche Eingabeblockade bedienbar sind.
- Ein fester Leistungsmaßstab vor dem Abnahmetest dokumentiert wird; Rendering im Belastungstest geprüft ist.
- Ohne geladene Kartenkacheln der Lauf mit Statistiken und gegebenenfalls Track ohne Hintergrundkarte sichtbar bleibt.
- Reduzierte Darstellungsdaten nicht als neue Originalmessungen gespeichert werden.

### V1-14 · Daten können gesichert, wiederhergestellt und neu ausgewertet werden

Vollständiges Backup des erhaltenen Datenbestands einschließlich Notizen, Kontext, Modellzuständen, Prüfaufträgen und Urteilen. Zusätzlich FIT-, GPX- und JSON-Austauschexporte entsprechend ihrer darstellbaren Inhalte.

**Fertig, wenn:**
- Eine frische Installation aus dem Backup den erhaltenen fachlichen Zustand wiederherstellen kann.
- Exportumfang, Schema-/Modellversionen und bereits gelöschte oder reduzierte Quellen erkennbar sind.
- Formatbedingt fehlende Inhalte benannt werden; GPX nicht als vollständiges App-Backup bezeichnet wird.
- Reprocessing der Historie Fortschritt, verbleibende Einschränkungen und Fehler pro Lauf zeigt.
- Frühere Entscheidungen samt damaliger Datenbasis von aktuell neu berechneten Ergebnissen unterscheidbar bleiben.
- Für einen aktiven Versuch das festgelegte Auswertungsverfahren erhalten bleibt oder der Versuch nachvollziehbar beendet wird.
- Der Nutzer Läufe samt zugehörigen Ableitungen löschen kann; Verweise aktiver Versuche darauf konsistent behandelt werden.
- Ein erneuter Import entfernte Aktivitäten nicht unbemerkt wiederherstellt.
- Keys und sonstige Zugangsdaten nicht zum normalen Backup gehören.

### V1-15 · Rohdaten bleiben möglichst vollständig, Speicherverbrauch bleibt kontrollierbar

Dauerhaft erhalten bleibt eine dokumentierte Basis für übliche Laufanalysen: verfügbare Zeit-, Positions-, Höhen-, HR-, Kadenz-, Pausen- und Quelleninformationen. Hochfrequente zusätzliche Sensorreihen und vollständige Importcontainer können begrenzten Aufbewahrungsregeln unterliegen.

Komprimierung ohne Informationsverlust hat Vorrang vor Reduktion; Reduktion hat einen sichtbar dokumentierten Informationsverlust. Keine dieser Maßnahmen macht gelöschte Daten später wiederherstellbar.

**Fertig, wenn:**
- Speicherverbrauch nach Datenart und Lauf sichtbar ist.
- Ein dokumentiertes Standardbudget und veränderbare Aufbewahrungsregeln für umfangreiche Rohdaten existieren.
- Vor Löschung oder Reduktion die vorgesehenen Ableitungen erfolgreich und dauerhaft gespeichert sind.
- Markierte Läufe von der automatischen Rohdatenbereinigung ausgenommen bleiben.
- Benötigte Daten aktiver Versuche bis zu deren Ende geschützt bleiben. Reicht das Budget nicht, wird dies erklärt statt stillschweigend zu entmarkieren.
- Bei knappem Speicher zuerst verzichtbare Caches und nicht geschützte Zusatzdaten gemäß Regeln behandelt werden; die dauerhafte Laufbasis nicht stillschweigend verschwindet.
- Pro Lauf sichtbar ist: welche Originale vorhanden sind, welche Daten reduziert/gelöscht wurden und welche Auswertungen noch neu berechenbar sind.
- Dauerhafte Basisspeicherung nicht als unbegrenzte Speicherzusage verstanden wird: Nutzer können exportieren und bewusst löschen.
- Eine geänderte Aufbewahrungsregel keine vollständige Neuberechenbarkeit bereits reduzierter Läufe vortäuscht.

### V1-16 · Trainingszweck, Ziel und Fokus steuern die Priorisierung

Ein Ziel, ein Zieldatum, Zeitbudget und Trainingstage sind bearbeitbar. Ziel
und Zieldatum bleiben optional. Der Fokus ist davon getrennt: Seine Art kommt
aus der kurzen versionierten Liste Ausdauer aufbauen, schneller werden,
verletzungsfrei bleiben, Gewohnheit aufbauen oder allgemeine Fitness. Eine
eigene Bezeichnung darf ergänzt werden; sie wird angezeigt, aber nicht
ausgewertet. Jede Einheit kann einen Zweck tragen: locker, lang,
Intervalle/Qualität, Wettkampf, freier Lauf oder unbekannt.

**Fertig, wenn:**
- Aufzeichnung ohne Einrichtung und ohne Zielangabe möglich ist.
- Ein Ziel ohne Zieldatum, ein Ziel mit Zieldatum, ein Fokus oder alle drei leer
  jeweils gültige Zustände sind.
- Ein Ziel mit Datum eine passende Fokus-Art vorschlägt, ohne sie automatisch
  zu speichern oder ein Urteil über den Fokus zu erzeugen.
- Ohne Ziel keine Fokus-Art vorgeschlagen wird; der Nutzer kann sie selbst
  festlegen oder leer lassen.
- Höchstens eine Fokus-Art gleichzeitig aktiv ist und ein Fokus kein Enddatum,
  eigene Antwort auf „Woran erkennen wir, dass es geholfen hat?“ oder ein Urteil besitzt.
- Eigene Bezeichnung und Fokus-Art getrennt gespeichert werden.
- Ein vermuteter Laufzweck vorgeschlagen und vom Nutzer korrigiert werden kann.
- Aufwärmen, Belastungs- und Erholungsphasen sowie Auslaufen getrennt berücksichtigt werden können.
- Ein korrekt ausgeführter Intervalllauf nicht allein wegen wechselnder Pace/HR als schlecht eingeteilt gilt.
- Bei unbekanntem Zweck keine zweckabhängige Fehlbewertung erzwungen wird.
- Eine Korrektur neue Ableitungen ermöglicht, ohne die ursprüngliche Einordnung zu verbergen.

### V1-17 · Die nächste Einheit ist konkret und passt in den Alltag

Vor dem Start stehen Zweck, grober Umfang und die eine aktuell angenommene
Empfehlung bereit. Ein vollständiger automatischer Trainingsplan ist für V1
nicht erforderlich.

**Fertig, wenn:**
- Der Nutzer vor der Einheit weiß, was er heute beachten soll.
- Die Oberfläche den Satz der Empfehlung ohne Fachlabel und im Imperativ zeigt.
- Zeitbudget, Trainingstage und verfügbares Training außerhalb des Laufens als Kontext berücksichtigt werden können.
- „Passt heute nicht“ eine Verschiebung erlaubt und nicht als gescheiterter Trainingsversuch zählt.
- Während der Aufzeichnung die zum gewählten Lauf nötigen Basiswerte sichtbar sind; komplexe Live-Cues bleiben V2.
- Fehlende Schlaf-/HRV-Daten oder nicht erfasste andere Sportarten keine erfundene Tagesform ergeben.
- Verpasste Einheiten nicht automatisch durch zusammengelegte Zusatzbelastung kompensiert werden.

### V1-18 · Rückfragen reduzieren entscheidende Unsicherheit

Gezielte kurze Rückfragen sind bereits ohne LLM möglich. Sie erscheinen, wenn die Antwort eine Empfehlung oder deren Bewertung voraussichtlich verändern würde.

**Fertig, wenn:**
- „War das wechselnde Tempo beabsichtigt?“ eine unpassende Pacing-Empfehlung verhindern kann.
- Der Grund einer Rückfrage erkennbar und die Antwort überspringbar ist.
- Bekannte Antworten nicht unnötig erneut abgefragt werden.
- Fehlende Daten konkret benannt werden, etwa ein geeigneter gleichmäßiger Abschnitt statt pauschal „fünf weitere Läufe“.
- Die App nicht jeden Lauf mit zusätzlichen Pflichtfragen belastet.

### V1-19 · Wenige Empfehlungstypen sind fachlich vollständig

V1 startet mit einer begrenzten, dokumentierten Auswahl von Handlungsklassen, die sich aus verfügbaren Daten sinnvoll prüfen lassen. Mehr Kennzahlen müssen nicht mehr Empfehlungen erzeugen.

**Fertig, wenn:**
- Jede freigeschaltete Handlungsklasse Zweck, Datenbedarf, Gültigkeitsbereich, Gegenanzeigen im Trainingskontext, bekannte Störfaktoren und Prüfregeln dokumentiert.
- Mindestens eine konkrete Empfehlung, Beibehalten und noch nicht klare Beurteilbarkeit durchgängig funktionieren.
- Weniger HR-Drift durch Aufgabe des geplanten Laufumfangs nicht automatisch als Trainingserfolg zählt.
- Messbare Umsetzung nicht mit dem eigentlich erhofften Nutzen verwechselt wird.
- Nicht ausreichend validierte Klassen sichtbar deaktiviert bleiben oder nur neutrale Beobachtungen liefern.

### V1-20 · Die Auswertung besteht fachliche und praktische Prüfungen

Die App muss mehr nachweisen als plausible Zahlen und technisch ausführbare Regeln. Abnahmefälle und Erfolgskriterien werden vor der Bewertung festgelegt.

**Fertig, wenn:**
- Unauffällige Referenzläufe keinen systematisch erfundenen Änderungsbedarf erzeugen.
- Bekannte Messfehler erkannt werden, ohne andere brauchbare Daten pauschal auszuschließen.
- Derselbe Lauf über mehrere Importwege keine zusätzliche Evidenz erzeugt.
- Entfernte Sensoren die betroffenen Aussagen nachvollziehbar einschränken.
- Kleine plausible Eingabeänderungen keine unbegründet gegenteiligen Empfehlungen erzeugen.
- Ein bekannter Vorher-nachher-Unterschied nicht ohne weitere Grundlage als Kausalbeweis erscheint.
- Synthetische Fälle die Logik prüfen und echte, mit Einwilligung verwendete oder geeignete offene Daten die Praxistauglichkeit prüfen.
- Prognosemodelle auf zeitlich späteren, bei der Anpassung ungesehenen Läufen bewertet werden; Abschnitte desselben Laufs nicht zwischen Anpassung und Prüfung verteilt werden.
- Komplexere Modelle mit einer einfachen Ausgangsmethode verglichen werden. Ohne belastbaren Zusatznutzen bleibt die einfachere Methode aktiv.
- Fehlalarme, Verweigerung von Aussagen, Prognosefehler und Unsicherheitskalibrierung passend zur jeweiligen Methode dokumentiert sind.
- Der komplette Ablauf vom Lauf bis zum verständlichen Urteil auf dem Referenzgerät geprüft ist.

### V1-21 · Ziel, Fokus und Empfehlung bleiben getrennt

Die drei Ebenen sind in Datenmodell, Entscheidung und Oberfläche unterscheidbar.
Ein Ziel kann enden. Ein Fokus bleibt ohne Enddatum bestehen. Eine Empfehlung
kann abgeschlossen oder abgebrochen werden, ohne Ziel oder Fokus zu löschen.

**Fertig, wenn:**

- Die App ohne Ziel, ohne Fokus und ohne Empfehlung aufzeichnen kann.
- Ein Ziel mit Datum seine verbleibenden Kalenderwochen für die Auswahl passender Handlungsklassen nutzt.
- Das Erreichen, Ende oder Streichen eines Ziels den Fokus nicht löscht.
- Das Abschließen oder Abbrechen einer Empfehlung den Fokus nicht als erledigt oder widerlegt markiert.
- Der Fokus selbst nie durch „erreicht“, „widerlegt“ oder ein anderes Urteil bewertet wird und keine eigene Regel dafür besitzt.
- Ein Fokuswechsel eine laufende Empfehlung nicht automatisch beendet.
- Höchstens eine Empfehlung gleichzeitig aktiv geprüft wird; Vorschläge sind davon getrennt und erhalten sichtbare Zustandslabels.
- Im UI keine der früheren Bezeichnungen als Name eines eigenen Objekts auftaucht.

### V1-22 · Priorisierung ist fest, sichtbar und zeitlich passend

Die Entscheidung aus mehreren zulässigen Handlungsklassen ist deterministisch.
Eine versionierte Relevanzmatrix und feste Sperren beschreiben, wie der Fokus
in die Reihenfolge eingreift. Die Gewichte sind redaktionelle Einschätzungen,
keine aus einem einzelnen Nutzer gelernte Vorliebe.

Die verbindliche Startmatrix `relevance-v1`, ihre sechs Handlungsklassen und
die Reihenfolge der Tie-Breaker stehen in [Änderungen § Priorisierung](aenderungen.md#priorisierung).

**Fertig, wenn:**

- Jede Handlungsklasse für jede Fokus-Art ein dokumentiertes Gewicht besitzt.
- Der Fokus „verletzungsfrei bleiben“ umfangssteigernde Klassen sperren kann.
- Ein Zieldatum Technikumbau in den letzten drei Wochen und Tapering mehr als zwölf Wochen vor dem Ziel hart ausfiltert.
- Die Auswahl bei gleichen vollständigen Eingaben und gleichem Modellstand reproduzierbar ist.
- Datenqualität und Umsetzbarkeit unabhängig vom Fokus berücksichtigt werden.
- Unter „Details“ die gewählte Empfehlung und verworfene Alternativen samt verständlichem Grund sichtbar sind.
- Während eine Empfehlung läuft die nächste als „Danach vorgesehen“ gezeigt werden kann, ohne die aktive Prüfung zu verändern.
- Die Oberfläche die Logik als „So priorisiert Runback“ beschreibt und nicht als „für dich berechnet“.
- Die Relevanzmatrix eine eigene Version trägt und nicht aus den Daten eines einzelnen Nutzers gelernt wird.

---

## 5. V2 — Ziele

Jedes V2-Ziel übernimmt §3. Freischaltung richtet sich nach geeigneter Evidenz und erfolgreicher Prüfung, nicht allein nach einer Anzahl vorhandener Läufe.

### V2-1 · Wear-OS-Companion

Eigenständige App auf der Uhr. Sensoren, Anzeige, Vibrationsfeedback. Sensor-Bridge zuerst, autonome Aufzeichnung danach.

**Fertig, wenn:** Aufzeichnung und Übertragung in den freigeschalteten Modi bei Verbindungsabbrüchen keine stillen Lücken oder Duplikate erzeugen und die autonome Aufzeichnung ohne Telefon nutzbar ist.

### V2-2 · BLE-Sensoren

Standardprofile für Herzfrequenz, Laufgeschwindigkeit/Kadenz und Akku. Mehrere Sensoren gleichzeitig, Reconnect während des Laufs.

**Fertig, wenn:** Quellenwechsel und Ausfälle sichtbar sind, Reconnect getestet ist und widersprüchliche Daten nicht ungekennzeichnet vermischt werden.

### V2-3 · Live-Cues

Regelbasierte Hinweise mit deklarativen Regeln, hartem Budget pro Stunde, Cooldowns und Prioritäten. Ein Cue muss in Sekunden umsetzbar und messbar sein. Feedbackreihenfolge: Vibration, dann Audio, dann Display, soweit verfügbar und gewünscht.

**Fertig, wenn:** Budget und Cooldowns auch bei vielen gleichzeitigen Regeln eingehalten werden, Cues zum aktiven Plan passen und sich jederzeit deaktivieren lassen.

### V2-4 · Pacemaker gegen Plan

Führt gegen einen segmentweisen Effort-Plan. Abweichungen werden gegen das Restprofil und die noch vertretbare Belastung bewertet.

**Fertig, wenn:** Zeitverlust keinen pauschalen Auftrag zum aggressiven Aufholen erzeugt und veränderte Bedingungen einen nachvollziehbaren neuen Plan statt eines unerreichbaren Restziels ergeben.

### V2-5 · Physiologische Modelle

Critical Speed und D′, Bayes'sche Fitness-Schätzung mit Unsicherheit, Durability-Kurve.

**Fertig, wenn:** Geeignete Leistungsbereiche, Aktualität und Datenqualität die Schätzung tragen, spätere ungesehene Läufe zur Prüfung dienen und fehlende Beobachtungstypen konkret erklärt werden. Eine reine Laufanzahl schaltet kein Modell frei.

### V2-6 · Personalisierte Modellparameter

Steigungskoeffizient, Hitzeempfindlichkeit und Luftwiderstandsfläche dürfen aus der eigenen Historie geschätzt werden, soweit deren Einflüsse ausreichend voneinander unterscheidbar sind.

**Fertig, wenn:** Ausgangsannahme und persönliche Anpassung sichtbar sind, der Wechsel einen nachgewiesenen Zusatznutzen hat und einzelne nicht identifizierbare Parameter bei ihrer Ausgangsannahme bleiben können.

### V2-7 · Race Simulator

Streckendatei, Wettervorhersage und persönliches Modell ergeben einen segmentweisen Pacing- und optionalen Fuel-Plan.

**Fertig, wenn:** Prognosen Unsicherheit und Modellgrenzen nennen, Strecken außerhalb des belegten Einsatzbereichs erkannt werden und der Pacemaker auf veränderte Bedingungen angemessen reagieren kann.

### V2-8 · Counterfactuals

Interaktive Modellrechnung für andere Wind-, Temperatur- oder Streckenbedingungen mit Aufschlüsselung nach Faktoren.

**Fertig, wenn:** Das Ergebnis als Szenario unter benannten Annahmen erscheint, unzulässige Extrapolation verhindert wird und Faktorbeiträge mit der verwendeten Referenz übereinstimmen.

### V2-9 · Fuel-Modell

Kohlenhydratbedarf und Einnahmeplanung aus Intensität, Dauer, relevanten Nutzerangaben und belegbaren Annahmen. Individuelle Verträglichkeit und bekannte Aufnahmegrenzen werden berücksichtigt.

**Fertig, wenn:** Der Plan ohne behauptete direkte Messung des Glykogenspeichers auskommt. Ein individueller Einbruchszeitpunkt erscheint nur bei ausreichend validierter Schätzbarkeit; andernfalls bleiben Szenariobereiche oder ein Plan ohne diese Prognose.

### V2-10 · Sensor-Diagnose

Systematische Abweichungen zwischen Geräten und ihre Konsequenzen für Auswertungen werden sichtbar.

**Fertig, wenn:** Die App zwischen „Geräte widersprechen sich“ und „Gerät A ist nachweislich unzuverlässiger“ unterscheidet und ein Schuldurteil nur mit geeigneter Referenz oder zusätzlicher Evidenz ausgibt.

### V2-11 · Multi-Device-Fusion

Auf V1-Duplikaterkennung aufbauend: Zeitabgleich, Uhrendrift-Korrektur und Fusion zu abgeleiteten Streams unter Erhalt verfügbarer Originale.

**Fertig, wenn:** Jede Teilstrecke ihre Quellen erkennen lässt, unauflösbare Widersprüche markiert bleiben und Fusion keine zusätzliche unabhängige Evidenz erzeugt.

### V2-12 · Presets

Gespeicherte Laufkonfigurationen mit Geräten, Ziel, aktiven Cues und optionalem Fuel-Plan.

**Fertig, wenn:** Ein Preset mit wenigen Eingaben startbar ist und fehlende Geräte beziehungsweise veraltete Ziele vor dem Start verständlich behandelt werden.

### V2-13 · Agent mit Rückfragen

Tool-Zugriff auf eine begrenzte Query-API statt Rohdaten im Prompt. Fragen wie „Was ist mein größtes Problem?“, „Warum empfiehlst du das?“ und „Was müsste deine Empfehlung ändern?“ sind beantwortbar.

**Fertig, wenn:** Fachliche Behauptungen und Unsicherheit auf Engine-Ergebnisse zurückführbar bleiben, fehlende Ergebnisse nicht erfunden werden und eine Unterhaltung keine aktiven Prüfregeln oder Trainingsziele stillschweigend verändert.

---

## 6. Nicht bauen

| Nicht bauen | Grund |
|---|---|
| iOS | Nicht Bestandteil dieser Produktstufen. |
| Eigene Cloud, Synchronisationsserver, Accounts | Die zentrale Datenhaltung bleibt lokal. |
| Social Features, Bestenlisten | Kein Produktziel. |
| Streckennetz, öffentliches Segment-Matching, Ghost-Run | Der Kern muss ohne wiederholte Strecken funktionieren. |
| Plugin-System für beliebige Sensoren | Unnötiger Aufwand vor validierten Anwendungsfällen. |
| Spotify-Integration, BPM-Matching | Nicht Bestandteil des Lauf- und Entscheidungsablaufs. |
| Links/Rechts-Asymmetrie, Bodenkontaktzeit als Primärmetrik | Keine vorausgesetzte geeignete Hardware. |
| ACWR-basierte Empfehlungen | Kein gewählter Ansatz für diese App. |
| Kostenpflichtige Pflichtbibliotheken oder Pflichtdienste | Der Kern muss kostenlos nutzbar bleiben. |
| Medizinische Diagnosen, Gesundheitsfreigaben, Verletzungsbehandlung | Außerhalb des Produktumfangs. Beschwerden dürfen Anlass sein, eine Trainingsempfehlung auszusetzen, aber nicht für automatische Diagnosen. |
| Universeller **Ganzkörper**-Readiness-, Belastbarkeits- oder Verletzungsrisikoscore | Die vorgesehenen Daten rechtfertigen keine solche Garantie. Eine regionenbezogene Frische mit offengelegter Rechenvorschrift ist davon ausgenommen, siehe [Zielspezifikation Training §3](zielspezifikation-training.md). |
| Vollständiger automatischer Trainingsplangenerator in V1 | Zunächst den nächsten Lauf und den überprüfbaren Regelkreis beherrschen. Vorschlagen und vom Nutzer bestätigen lassen bleibt zulässig. |
| Garantierte Empfehlung nach jedem Lauf | Würde unbegründeten Handlungsbedarf erzeugen. |
| Vollständige Neuberechenbarkeit nach Rohdatenlöschung | Physisch nicht erfüllbar. |
| Gleichsetzung einer Modellschätzung mit einer Messung | Verletzt die Nachvollziehbarkeit der Aussagen. |

---

## 7. Definition of Done für V1

> Ein Lauf wird aufgezeichnet oder importiert und im Kontext seines Trainingszwecks mit den verfügbaren Daten ausgewertet. Runback zeigt höchstens eine begründete Empfehlung oder erklärt, warum Beibehalten beziehungsweise noch keine Bewertung sinnvoll ist.
>
> Der Nutzer kann die Empfehlung annehmen. Vor der nächsten passenden Einheit ist sie konkret sichtbar. Die App erkennt oder erfragt ihre Umsetzung und bewertet geeignete spätere Läufe nach vorher festgelegten Regeln. Nach drei geeigneten Läufen kann sie einen Zwischenstand geben; ein endgültiges Urteil richtet sich nach Fragestellung und Belegen.
>
> Verbesserung, Verschlechterung, kein relevanter Effekt, fehlende Umsetzung und „noch nicht klar“ bleiben unterscheidbar. Die App behauptet keinen kausalen Erfolg allein aufgrund eines besseren Folgelaufs. Entscheidungen bleiben mit ihrer damaligen Datenbasis nachvollziehbar.
>
> Der Ablauf funktioniert ohne Internet für vorhandene lokale Daten, übersteht die festgelegten Aufzeichnungsfälle und lässt sich vollständig sichern und wiederherstellen, soweit Daten gemäß den sichtbaren Aufbewahrungsregeln erhalten wurden.

Der Nutzer kann ein Ziel setzen, einen dauerhaften Fokus wählen oder beides leer
lassen. Der Fokus bleibt ohne eigenes Urteil bestehen. Eine Empfehlung wird als
„Vorschlag“ oder „Angenommen“ sichtbar und durchläuft danach die Zustände
„Aktiv“, „Pausiert“, „Abgeschlossen“ oder „Abgebrochen“.

Wenn dieser Ablauf mit wenigen fachlich geprüften Handlungsklassen steht, ist der Kern demonstriert. Das ist noch kein Nachweis, dass jede Empfehlung langfristig die Laufleistung steigert. Die übrigen V1-Ziele bleiben für die vollständige V1-Abnahme verbindlich.

