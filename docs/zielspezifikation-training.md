# Runback – Zielspezifikation Training (Gym + Laufen)

> Erweiterung der [Zielspezifikation V1 / V2](zielspezifikation.md). Beschreibt **Ziele und Akzeptanzkriterien**, nicht Implementierung.
> Die Invarianten aus §3 der Hauptspezifikation gelten unverändert. Wo diese Erweiterung §6 der Hauptspezifikation ändert, steht das in §3 dieses Dokuments ausdrücklich.
> Die rechnerische Grundlage des Muskelmodells steht getrennt und versioniert im [Muskel- und Belastungsmodell](muskelmodell.md).
> Begriffe: [Glossar](glossar.md).

---

## 1. Was sich ändert

Runback ist bisher eine Lauf-App. Diese Erweiterung macht daraus eine **Trainings-App mit zwei Einheitenarten**, die dasselbe Auswertungs- und Entscheidungsgerüst benutzen.

Der Kern bleibt: Eine Einheit rein → eine begründete, umsetzbare und prüfbare nächste Handlung raus, wenn die Daten sie tragen.

Neu ist, dass „die Daten“ jetzt auch Krafttraining, gemeldeten Muskelkater und Körperdaten umfassen, und dass Laufen und Krafttraining sich gegenseitig beeinflussen dürfen.

**Was ausdrücklich nicht neu ist:** die Invarianten, der Regelkreis aus Hypothese → Annahme → Prüfung → Urteil, die Trennung von Messung, Schätzung und Empfehlung, und die Regel, dass höchstens ein Arbeitsthema aktiv geprüft wird.

---

## 2. Rahmen-Ergänzungen

- Die Einheitenart ist ein **offenes Feld**, kein fest verdrahtetes Paar. Diese Stufe liefert `run` und `strength`. Weitere Arten (Rad, Schwimmen, Mobility) müssen ohne Umbau der Datenschicht ergänzt werden können.
- **Jede Funktion ist abwählbar.** Reines Laufen, reines Krafttraining und beides zusammen sind gleichwertige, vollständig nutzbare Betriebsarten. Eine abgewählte Funktion erzeugt keine Hinweise, keine Fragen und keine leeren Oberflächen.
- Der Übungskatalog, die Muskelregionen und die Muskelanteile sind **versionierte Daten**, keine im Code verstreuten Konstanten. Ihre Version wandert in jede Ableitung, die sie benutzt.
- Krafttraining funktioniert vollständig **ohne Internet**. Sprachumwandlung, Chat-Planung und LLM-Formulierung sind optionale Zusätze mit nutzereigenem Schlüssel.
- Körperdaten einschließlich Fotos liegen im App-Speicher und sind Bestandteil des Backups. Das Backup wird als Datei mit persönlichen Körperdaten gekennzeichnet.

### Fachliche Begriffe für das Krafttraining

| Begriff | Verbindliche Bedeutung in Runback |
|---|---|
| Session | Eine Trainingseinheit beliebiger Art. Trägt Zeit, Zweck, Kontext, subjektive Angaben und Herkunft. |
| Satz | Kleinste erfasste Krafteinheit: Übung, Wiederholungen oder Dauer, Last, Satzart, Pause. |
| Muskelregion | Fest definierter, benannter Eintrag aus der versionierten Regionenliste. Kein frei benannter Körperteil. |
| Muskelanteil | Anteil, mit dem eine Übung eine Region beansprucht. Katalogwert, persönlich anpassbar. |
| Belastungsreiz | Aus einem Satz oder Laufabschnitt berechnete, auf Regionen verteilte Belastungsgröße. Kein gemessener Wert. |
| Frische | Modellierte Skala 0–100 je Region. 100 bedeutet unbelastet im Sinne des Modells, 0 maximal belastet. Kein Gesundheits-, Belastbarkeits- oder Verletzungsmaß. |
| Gemeldeter Muskelkater | Vom Nutzer angegebene Empfindung je Region und Zeitpunkt. Eingabe, keine Messung, keine Diagnose. |
| Plan | Nutzerartefakt aus Einheiten-Slots mit Zielvorgaben. Vorschlag, keine Verpflichtung. |
| Durchgeführt | Was tatsächlich erfasst wurde. Bei Abweichung vom Plan immer maßgeblich. |

Die Frische-Skala, ihre Referenzbedingungen und ihr Einsatzbereich sind vor der ersten Ausspielung im [Muskelmodell](muskelmodell.md) dokumentiert und versioniert. Frische, Effort und subjektive Anstrengung sind drei getrennte Größen und werden nicht vermischt.

---

## 3. Änderung an §6 der Hauptspezifikation

Die Hauptspezifikation verbietet in §6 einen „Universellen Readiness- oder Verletzungsrisikoscore“. Diese Erweiterung schärft den Eintrag, statt ihn aufzuheben.

| Bisher | Neu | Begründung |
|---|---|---|
| Universeller Readiness- oder Verletzungsrisikoscore | Universeller **Ganzkörper**-Readiness-, Belastbarkeits- oder Verletzungsrisikoscore | Eine einzelne Zahl für die Tagesform des ganzen Menschen behauptet, Schlaf, Stress, Sehnen, Immunlage und Psyche mitzumessen, die Runback nicht sieht. Das bleibt verboten. |
| — | Ergänzung: Eine **regionenbezogene Frische** ist zulässig, wenn ihre Rechenvorschrift, ihre Eingaben, ihre Unsicherheit und ihre Grenzen sichtbar sind. | Sie beruht auf tatsächlich erfassten Sätzen und Läufen sowie auf ausdrücklichen Nutzerangaben und ist damit an ihrer eigenen Datengrundlage prüfbar. |
| Vollständiger automatischer Trainingsplangenerator in V1 | Bleibt. Ergänzung: Ein Plan darf **erzeugt und geändert werden, wenn der Nutzer ihn bestätigt**; die App ändert keinen Plan von sich aus. | Der Plan ist ein Nutzerartefakt. Vorschlagen ist etwas anderes als selbsttätig umschreiben. |

Unverändert verboten bleiben: medizinische Diagnosen, Verletzungsbehandlung, Aussagen über Gesundheit oder Belastbarkeit, und die Gleichsetzung einer Modellschätzung mit einer Messung.

**Die Frische darf niemals formuliert werden als** „du bist bereit“, „du bist nicht belastbar“, „Verletzungsrisiko“ oder „dein Muskel hat noch X Prozent Kraft“. Zulässig ist die Rechengröße mit ihrer Herkunft: „Quadrizeps rechts 54 — gerechnet aus 3 Einheiten, zuletzt vor 19 Stunden, bestätigt durch deine Meldung von gestern.“

---

## 4. Ziele

### T-1 · Eine Session-Struktur trägt beide Trainingsarten

Laufen und Krafttraining sind zwei Ausprägungen desselben Grundtyps. Gemeinsam sind Zeit, Zweck, Kontext, subjektive Angaben, Datenqualität und Herkunft. Getrennt sind die Detaildaten: Abschnitte beim Laufen, Sätze beim Krafttraining.

**Fertig, wenn:**
- Historie, Backup, Wiederherstellung, RPE-Erfassung und Neuauswertung für beide Arten ohne getrennte Codepfade funktionieren.
- Eine dritte Einheitenart ergänzt werden kann, ohne bestehende Daten zu migrieren oder die Laufauswertung anzufassen.
- Eine Auswertung, die nur für eine Art gilt, bei der anderen Art nicht mit falschen Ergebnissen, sondern gar nicht erscheint.
- Bestehende Laufdaten nach der Umstellung unverändert lesbar und mit demselben Ergebnis neu auswertbar sind.
- Die Einheitenart einer bestehenden Session korrigierbar ist, ohne die ursprüngliche Einordnung zu verbergen.

### T-2 · Der Nutzer wählt, wofür er die App benutzt

Laufen, Krafttraining oder beides. Die Wahl ist jederzeit änderbar und nicht Voraussetzung für die erste Nutzung.

**Fertig, wenn:**
- Die App ohne jede Einrichtung eine Einheit aufzeichnen kann.
- Eine abgewählte Trainingsart keine Oberflächen, Fragen, Hinweise oder Benachrichtigungen erzeugt.
- Eine nachträglich aktivierte Trainingsart vorhandene Daten der anderen Art nicht entwertet.
- Auch einzelne Zusatzfunktionen — Muskelmodell, Sprachabfrage, Körperdaten, Chat, Fotos — einzeln abschaltbar sind.
- Das Abschalten einer Funktion ihre bereits erfassten Daten nicht löscht, sondern nur ihre Ausspielung beendet, und das erkennbar ist.

### T-3 · Der Übungskatalog kennt Muskelanteile

Jede Übung verteilt ihre Beanspruchung auf mehrere Regionen einer festen, versionierten Regionenliste. Eine einzelne grobe Muskelgruppe genügt nicht.

**Fertig, wenn:**
- Die Regionenliste, ihre Seitigkeit und ihre Version dokumentiert sind und in jede darauf beruhende Ableitung eingehen.
- Jede Katalogübung Anteile, Bewegungsart und die Herkunft ihrer Werte angibt.
- Eigene Übungen anlegbar sind, mit Anteilen entweder aus einer ähnlichen Übung übernommen oder selbst gesetzt.
- Eine Übung ohne belastbare Anteile als solche gekennzeichnet ist und keine erfundenen Werte in das Modell einspeist.
- Eine spätere Katalogversion ältere Sessions nicht rückwirkend umdeutet, sondern deren damalige Version erhält.

### T-4 · Krafttraining wird schnell und ohne Reibung erfasst

Der Log-Flow ist der meistgenutzte Teil der App und entscheidet über ihren Wert. Ein Satz wird während der Pause in wenigen Sekunden bestätigt oder korrigiert.

**Fertig, wenn:**
- Ein geplanter Satz mit einer Aktion als erledigt bestätigt werden kann, mit vorbelegten Werten aus Plan oder letzter Einheit.
- Abweichende Wiederholungen, Last oder Dauer ohne Verlassen des Trainingsflusses eintragbar sind.
- Sätze, Übungen und ganze Einheiten spontan ergänzt, übersprungen oder umsortiert werden können.
- Der Pausentimer läuft, wenn die App im Hintergrund ist, und das Satzende ohne Öffnen der App bestätigt werden kann.
- Ein Absturz, ein Anruf oder ein leerer Akku die bereits bestätigten Sätze nicht verliert.
- Eine unterbrochene Einheit später fortgesetzt oder als beendet abgeschlossen werden kann, ohne dass eine erfundene Endzeit entsteht.
- Satzarten und Lastarten aus dem Katalog erhalten bleiben und nicht auf ein Einheitsformat reduziert werden.

### T-5 · Der Plan schlägt vor, die Realität zählt

Ein Plan besteht aus Einheiten-Slots mit Zielvorgaben. Erfasst wird, was tatsächlich stattgefunden hat. Die Abweichung wird festgehalten, aber nicht bewertet.

**Fertig, wenn:**
- Zielvorgabe und tatsächlicher Wert je Satz und je Einheit getrennt erhalten bleiben.
- Mehr, weniger oder anderes zu trainieren möglich ist, ohne dass die App das als Fehler behandelt.
- Eine ausgefallene Einheit als ausgefallen sichtbar ist und nicht automatisch auf andere Tage verteilt wird.
- Ein freies Training ohne Plan jederzeit möglich ist und vollständig ausgewertet wird.
- Die erfasste Abweichung als Umsetzungssignal für den Regelkreis der Hauptspezifikation zur Verfügung steht.
- Der Plan rückwirkend nicht so verändert werden kann, dass eine frühere Bewertung stillschweigend anders ausfällt.

### T-6 · Planänderungen sind seltene, begründete Vorschläge

Die Struktur eines Plans — welche Tage, welche Übungen, welcher Umfang — steht zur Diskussion, nicht unter ständiger Bearbeitung. Last, Sätze und Wiederholungen dürfen häufiger vorgeschlagen werden, weil sie ohnehin je Einheit neu gesetzt werden.

**Fertig, wenn:**
- Ein Strukturvorschlag höchstens etwa monatlich erscheint, sofern er begründet ist, und „Plan unverändert lassen“ ein zulässiges und häufiges Ergebnis ist.
- Jeder Vorschlag Anlass, betroffene Slots, erwartete Wirkung und Prüfkriterium nennt.
- Kein Vorschlag ohne Bestätigung des Nutzers wirksam wird.
- Ein abgelehnter Vorschlag nicht in der nächsten Woche unverändert wiederkehrt.
- Ein Vorschlag den erklärten Trainingszweck des Nutzers nicht durch eine bequemere Kennzahl ersetzt.

### T-7 · Frische je Muskelregion ist berechenbar und aufschlüsselbar

Eine Skala von 0 bis 100 je Region, 100 bedeutet unbelastet im Sinne des Modells. Sie entsteht aus erfassten Sätzen und Läufen und aus gemeldetem Muskelkater.

**Fertig, wenn:**
- Rechenvorschrift, Zeitverhalten, Skala, Eingaben und Einsatzbereich vor der ersten Ausspielung dokumentiert und versioniert sind.
- Jeder Regionswert aufschlüsselbar ist: welche Einheiten, welche Übungen, welcher Anteil, welche Meldungen, wie alt.
- Eine Region ohne ausreichende Datengrundlage als unbekannt erscheint und keine Zahl zeigt.
- Der Wert eine Unsicherheit trägt und diese sichtbar größer wird, wenn Meldungen fehlen oder der Katalog nur Ausgangsannahmen liefert.
- Fehlende Meldungen den Wert nicht automatisch auf 100 setzen.
- Ein prognostizierter Verlauf für die nächsten Tage möglich ist und als Prognose gekennzeichnet bleibt.
- Die Ausspielung keine Gesundheits-, Belastbarkeits- oder Verletzungsaussage enthält.

### T-8 · Das Modell lernt aus den Meldungen des Nutzers

Wenn eine Übung bei diesem Nutzer wiederholt länger oder stärker nachwirkt als der Katalog annimmt, passt sich ihr Koeffizient an.

**Fertig, wenn:**
- Ohne Meldungen die Katalogannahme gilt und als Annahme gekennzeichnet ist.
- Die persönliche Anpassung mit zunehmender Zahl übereinstimmender Meldungen zunimmt und einzelne Ausreißer sie nicht umwerfen.
- Anpassung, Ausgangsannahme, Zahl der zugrunde liegenden Meldungen und verbleibende Unsicherheit einsehbar sind.
- Koeffizienten, die aus dem Trainingsverhalten nicht unterscheidbar sind, bei ihrer Ausgangsannahme bleiben und der Grund benannt wird.
- Widersprüchliche oder unplausible Meldungen die Anpassung nicht in unmögliche Bereiche treiben.
- Eine Rücksetzung der persönlichen Anpassung möglich ist, ohne die zugrunde liegenden Meldungen zu löschen.

### T-9 · Die Körperfigur zeigt den Zustand, nicht ein Urteil

Eine Körperansicht von vorn und hinten, farblich nach Frische, mit auswählbaren Regionen.

**Fertig, wenn:**
- Jede Region antippbar ist und ihre Aufschlüsselung nach T-7 zeigt.
- Zwischen gemeldetem Muskelkater und berechneter Frische umgeschaltet werden kann; beide werden nie in einer Farbe vermischt.
- Unbekannte Regionen visuell klar von frischen unterschieden sind.
- Die Farbgebung ohne Farbunterscheidungsvermögen und bei großer Systemschrift bedienbar bleibt.
- Die Ansicht auch ohne die volle Regionenauflösung, etwa bei wenigen Daten, sinnvoll bleibt.
- Eine spätere räumliche Darstellung dieselben Regionskennungen benutzen kann, ohne dass Daten oder Modell sich ändern.

### T-10 · Muskelkater wird in Sekunden gemeldet

Beim Öffnen der App und optional per Benachrichtigung eine kurze Abfrage. Sprache ist der schnelle Weg, Tippen der gleichwertige Ersatz.

**Fertig, wenn:**
- Die Abfrage überspringbar ist und Überspringen keine Nachteile in der Auswertung erzeugt.
- „Heute nichts“ als eigenständige, wertvolle Antwort erfassbar ist und nicht wie eine fehlende Antwort behandelt wird.
- Eine gesprochene Angabe unmittelbar sichtbar auf die Figur übertragen wird und vor dem Speichern bestätigt oder korrigiert werden kann.
- Erkennung ohne Internet funktioniert; eine bessere Erkennung über OpenRouter optional zuschaltbar ist und ihr Ausfall die Eingabe nicht blockiert.
- Nicht eindeutig zuordenbare Angaben nachgefragt statt geraten werden.
- Benachrichtigungen in Häufigkeit und Zeitpunkt einstellbar und vollständig abschaltbar sind.
- Aufnahmen nur für die Dauer der Umwandlung bestehen und ohne ausdrückliche Einwilligung nicht gespeichert werden.

### T-11 · Laufen und Krafttraining beeinflussen einander

Beide zahlen auf dieselben Regionen ein und werden bei Vorschlägen für die jeweils andere Art berücksichtigt.

**Fertig, wenn:**
- Ein Laufabschnitt seine regionsbezogene Belastung erzeugt, abhängig von Umfang, Intensität und Gefälle.
- Die Beinfrische bei Empfehlungen zum nächsten Lauf und die Laufbelastung bei Vorschlägen zum Krafttraining berücksichtigt werden.
- Weiterhin höchstens ein Arbeitsthema aktiv geprüft wird, auch wenn beide Richtungen im Modell wirken.
- Bei der Bewertung eines Versuchs vergleichbare Frischezustände herangezogen oder der Einfluss offengelegt wird.
- Ein Zusammenhang zwischen Frische und Laufergebnis als Beobachtung und nicht als Ursache dargestellt wird.
- Die Verzahnung abschaltbar ist und beide Trainingsarten dann getrennt ausgewertet bleiben.

### T-12 · Belastungssteuerung im Krafttraining ist begründet und prüfbar

Vorschläge zu Last, Sätzen und Wiederholungen entstehen aus dem beobachteten Verlauf, nicht aus einer festen Steigerungsregel.

**Fertig, wenn:**
- Der Leistungsverlauf je Übung mit Unsicherheit geschätzt wird und einzelne schlechte Tage ihn nicht kippen.
- Ein Stillstand als solcher erkannt und von normaler Schwankung unterschieden wird.
- Ein Vorschlag Zielbereich, erwartete Anstrengung und Prüfkriterium nennt.
- „So weitermachen“ ein zulässiges Ergebnis ist.
- Übertroffene oder unterschrittene Vorgaben ohne Wertung erfasst werden und in den nächsten Vorschlag eingehen.
- Eine Steigerung nicht empfohlen wird, wenn die Ausführungsqualität dafür nicht beurteilbar ist, und der Grund benannt wird.

### T-13 · Körperdaten sind optional und vollständig

Gewicht, Körperfett, Muskelmasse, Umfänge an definierten Stellen und Fotos. Jeder Datentyp einzeln nutzbar.

**Fertig, wenn:**
- Jeder Datentyp einzeln erfassbar und einzeln abschaltbar ist und keiner Voraussetzung für einen anderen ist.
- Messstellen für Umfänge benannt und über die Zeit gleich definiert sind.
- Verläufe mit ihrer Streuung dargestellt werden und tägliche Schwankungen nicht als Trend erscheinen.
- Fotos im App-Speicher liegen, im Backup enthalten sind und das Backup als Datei mit persönlichen Körperdaten gekennzeichnet ist.
- Einzelne Einträge und Fotos endgültig löschbar sind.
- Körperdaten keine Bewertung der Person erzeugen und in keine Gesundheitsaussage einfließen.

### T-14 · Planung im Gespräch ist ein optionaler Weg, kein Pflichtweg

Ein Chat kann beim Einrichten und später einen Plan erzeugen und ändern. Er benötigt OpenRouter und einen nutzereigenen Schlüssel.

**Fertig, wenn:**
- Ohne Schlüssel und ohne Internet ein vollständiger Plan über Vorlagen und einen manuellen Editor entsteht.
- Das Ergebnis des Chats ein bearbeitbarer Planentwurf ist, den der Nutzer vor dem Speichern sieht und bestätigt.
- Der Chat auf gespeicherte Ableitungen zugreifen kann, aber keine Bewertung, keinen Zahlenwert und kein Urteil selbst erzeugt.
- Ein Abbruch, ein Fehler oder eine unbrauchbare Antwort keinen halben Plan speichert.
- Erkennbar bleibt, welcher Teil eines Plans aus dem Chat und welcher vom Nutzer stammt.
- Keine Rohdaten und keine Koordinaten an den Dienst gehen und die entstehenden Kosten vorher erkennbar sind.

### T-15 · Alles Neue ist sicherbar, exportierbar und löschbar

**Fertig, wenn:**
- Backup und Wiederherstellung Sessions beider Arten, Pläne, Katalog, persönliche Koeffizienten, Meldungen und Körperdaten einschließlich Fotos umfassen.
- Ein Export sein Format, seine Version und seine Einschränkungen angibt.
- Eine Wiederherstellung aus einer älteren Version entweder gelingt oder klar benennt, was fehlt.
- Das Löschen einer Session ihre Wirkung auf abgeleitete Werte nachvollziehbar entfernt, ohne dass unbemerkte Reste zurückbleiben.
- Persönliche Koeffizienten getrennt zurücksetzbar sind.

---

## 5. Prüfung gegen die Invarianten

| Invariante | Berührter Punkt | Wie sie eingehalten wird |
|---|---|---|
| 1 Originaldaten unverändert | Persönliche Koeffizienten, korrigierte Anteile | Erfasste Sätze und Meldungen bleiben unverändert. Anpassungen liegen als eigene Schicht daneben und sind rücksetzbar. |
| 2 Nachvollziehbare Ableitungen | Frische, Koeffizienten, Vorschläge | Jeder Wert trägt Modellversion, Katalogversion und die verwendeten Sessions und Meldungen. |
| 3 Kein Vorschlag ohne Prüfung | Plan-, Last- und Verzahnungsvorschläge | Jeder Vorschlag nennt Änderung, Einsatzbereich, Ziel und vorab festgelegtes Prüfkriterium. Die Frischeanzeige selbst ist eine neutrale Beobachtung und braucht keins. |
| 4 Keine Pflicht zur Veränderung | T-6, T-12 | „Plan unverändert“ und „so weitermachen“ sind ausdrücklich zulässige Ergebnisse. |
| 5 Grundlage und Unsicherheit | Frische, Koeffizienten | Zahl nur bei tragfähiger Grundlage, sonst unbekannt. Unsicherheit wird mitgeführt, Meldungen sind als Eingaben gekennzeichnet. |
| 6 LLM formuliert, Engine entscheidet | Sprachabfrage, Planungschat | Zuordnung gesprochener Angaben erfolgt regelbasiert und wird bestätigt. Der Chat schreibt Pläne, keine Bewertungen. Frische und Vorschläge entstehen reproduzierbar. |
| 7 Fehlende Daten begrenzen nur die betroffene Aussage | Unbekannte Regionen, fehlende Meldungen | Eine Region ohne Grundlage blockiert nicht die übrigen. Keine Ersatzwerte. |
| 8 Keine Rohsample-Ströme über die JS-Grenze | Sätze, Figur, Verläufe | Sätze sind bereits Aggregate. Figur und Verläufe erhalten abgeleitete, begrenzte Darstellungsdaten. |
| 9 Zweckbezogene Datenweitergabe | Sprache, Chat | Nur Transkriptionsanfrage und Planentwurf. Keine Rohdaten, keine Koordinaten, keine Fotos, keine Schlüssel in Logs oder Exporten. |
| 10 Alles gehört dem Nutzer | T-15 | Vollständiges Backup ohne Konto, einschließlich Fotos und Koeffizienten. |
| 11 Trainingszweck bleibt maßgeblich | T-6, T-11, T-12 | Ein Vorschlag darf die Frische nicht dadurch verbessern, dass er das erklärte Trainingsziel aufgibt. |
| 12 Maßstäbe ändern sich nicht rückwirkend | Katalog- und Modellversionen | Ältere Sessions behalten die Version, mit der sie bewertet wurden. Ein Versuch behält seine ursprünglichen Bedingungen. |
| 13 Umsetzung, Ergebnis, Ursache getrennt | T-5, T-11 | Plan-Ist-Abweichung ist Umsetzung, nicht Ergebnis. Zusammenhänge zwischen Frische und Laufergebnis bleiben Beobachtung. |
| 14 Empfehlungen bleiben stabil | T-6, T-10 | Eine einzelne Muskelkater-Meldung löst keinen Themenwechsel aus. Strukturvorschläge sind selten und begründet. |

---

## 6. Definition of Done für diese Erweiterung

> Der Nutzer wählt, ob er läuft, Kraft trainiert oder beides. Er legt einen Plan an — von Hand, aus einer Vorlage oder im Gespräch — und trainiert danach oder auch anders. Sätze werden während der Einheit in Sekunden bestätigt, Abweichungen ohne Wertung erfasst.
>
> Beim Öffnen der App meldet er in wenigen Sekunden, wo er Muskelkater hat, sieht das unmittelbar auf der Körperfigur und bestätigt es. Aus erfassten Einheiten und Meldungen entsteht je Region eine Frische mit sichtbarer Herkunft und Unsicherheit; ohne ausreichende Grundlage bleibt eine Region unbekannt.
>
> Meldungen, die dem Modell widersprechen, verschieben mit der Zeit die Koeffizienten der betroffenen Übungen — sichtbar, gedämpft und rücksetzbar. Nicht unterscheidbare Koeffizienten bleiben begründet bei ihrer Ausgangsannahme.
>
> Krafttraining und Laufen zahlen auf dieselben Regionen ein und gehen wechselseitig in die Vorschläge ein. Es bleibt bei höchstens einem geprüften Arbeitsthema. Vorschläge zu Plan und Last nennen Grund, erwartete Wirkung und Prüfkriterium; Beibehalten bleibt zulässig.
>
> Alles funktioniert ohne Internet, jede Zusatzfunktion ist abschaltbar, und der gesamte Datenbestand einschließlich Körperdaten lässt sich sichern, wiederherstellen und löschen.

---

## 7. Bewusst offen

- **Räumliche Körperdarstellung.** Die Regionskennungen sind so gewählt, dass eine spätere räumliche Ansicht sie unverändert benutzen kann. Ob sie kommt, entscheidet sich nach dem Nutzen der flächigen Ansicht.
- **Weitere Trainingsarten.** Rad und Schwimmen sind durch die Session-Struktur vorbereitet, aber nicht Bestandteil dieser Stufe.
- **Übernahme aus anderen Apps.** Kein Importer in dieser Stufe.
- **Automatische Erkennung der Ausführungsqualität.** Ohne geeignete Sensorik nicht vorgesehen; T-12 verlangt stattdessen, das Fehlen dieser Beurteilbarkeit zu benennen.
- **Ernährung und Schlaf.** Nicht Bestandteil dieser Stufe und ausdrücklich keine stillschweigende Eingangsgröße des Frische-Modells.
