# Runback-Glossar

Begriffe aus der Runback-Spezifikation und ihrer fachlichen Besprechung. Die zweite Spalte nennt englische Fach- und Suchbegriffe; sie sind keine zusätzlich festgelegten Code-Namen. Die Erklärungen sind vereinfacht. Beispiele sind nur zur Veranschaulichung.

**Maßgebliche Definitionen:** Die [Zielspezifikation](zielspezifikation.md) legt Effort und Arbeitsthema fest. Die konkrete Effort-Skala und Umweltanpassung müssen vor Ausspielung dokumentiert werden. Englische Suchbegriffe ersetzen diese Produktdefinition nicht.

## Laufen und Körper

| Begriff aus der Spec | Englisch / Suchbegriff | Einfach erklärt |
|---|---|---|
| Pace | Pace | Zeit pro Strecke, meistens Minuten pro Kilometer. 5:00 min/km bedeutet: ein Kilometer in fünf Minuten. Eine kleinere Zahl bedeutet schneller. |
| Pacing | Pacing strategy | Einteilung von Tempo oder Anstrengung über den Lauf, etwa ruhig beginnen und später steigern. |
| Segment / Split | Segment / Split | Segment: ein ausgewählter Laufabschnitt. Split: meist dessen Zwischenzeit oder Auswertung, beispielsweise für Kilometer 3. Hier kein öffentliches Strava-Segment. |
| Kadenz | Cadence / Step rate | Schritte pro Minute, normalerweise beide Füße zusammen. Nicht automatisch ein Maß für gute Lauftechnik. |
| HR | Heart rate | Herzfrequenz, also Herzschläge pro Minute. Die Einheit bpm bedeutet beats per minute. |
| Ruhepuls | Resting heart rate / RHR | Herzfrequenz in Ruhe. Für Vergleiche sollten Messbedingungen und Messverfahren möglichst ähnlich sein. |
| HRV | Heart rate variability | Unterschiede in der Zeit zwischen aufeinanderfolgenden Herzschlägen. Kein direkter Messwert für Trainingsbereitschaft; verschiedene HRV-Kennzahlen sind nicht beliebig austauschbar. |
| [RPE](https://www.cdc.gov/physical-activity-basics/measuring/index.html) | Rating of perceived exertion | Deine subjektiv empfundene Anstrengung. Es gibt unterschiedliche Skalen. Runback soll Beine und Atmung getrennt abfragen; die genaue Skala ist noch festzulegen. |
| Intensität | Exercise intensity | Wie anstrengend die Belastung in einem Moment oder Abschnitt ist. Die relative Intensität bezieht deine persönliche Leistungsfähigkeit ein. |
| Trainingsbelastung | Training load | Belastung einer Einheit oder eines Zeitraums, abhängig unter anderem von Dauer und Intensität. Unterschiedliche Kennzahlen erfassen unterschiedliche Aspekte. |
| [GAP](https://support.strava.com/en-us/articles/15402117-grade-adjusted-pace-gap) | Grade adjusted pace | Geschätzte entsprechende Pace auf flacher Strecke, wenn Steigung oder Gefälle berücksichtigt werden. Keine tatsächlich gelaufene Pace; berücksichtigt nicht automatisch Wind und Hitze. |
| HR-Drift | Heart rate drift / Cardiovascular drift | Die Herzfrequenz steigt im Laufe einer länger anhaltenden Belastung, obwohl die äußere Leistung ungefähr gleich bleibt. |
| [Decoupling](https://www.trainingpeaks.com/coach-blog/aerobic-endurance-and-decoupling/) | Aerobic decoupling | Das Verhältnis zwischen äußerer Leistung, etwa Laufgeschwindigkeit, und Herzfrequenz verändert sich im Lauf. Beispiel: später brauchst du bei ähnlichem Tempo einen höheren Puls. Die Kennzahl allein erklärt die Ursache nicht. |
| Durability | Durability / Fatigue resistance | Wie gut du deine Leistungsfähigkeit bei zunehmender Belastungsdauer erhältst. Eine Durability-Kurve beschreibt den geschätzten Abfall, etwa über Dauer oder kumulierte Arbeit. |
| [Critical Speed / CS](https://pubmed.ncbi.nlm.nih.gov/41931241/) | Critical speed | Modellierte Grenzgeschwindigkeit, oberhalb derer eine begrenzte zusätzliche Leistungskapazität beansprucht wird. Keine Geschwindigkeit, die du unbegrenzt halten kannst. |
| [D′ / D-Prime](https://pubmed.ncbi.nlm.nih.gov/41931241/) | D-prime / Finite distance capacity above critical speed | Modellierte zusätzliche Streckenkapazität oberhalb von CS, angegeben in Metern. Vereinfacht eine Reserve für schnelleres Laufen, keine direkt gemessene Energiebatterie und nicht die gesamte oberhalb von CS laufbare Strecke. |
| Laufökonomie | Running economy | Wie viel Energie beziehungsweise Sauerstoff du bei einer bestimmten Laufgeschwindigkeit benötigst. Herzfrequenz allein misst sie nicht direkt. |
| Fuel / Fueling | Fueling / Carbohydrate intake | Energiezufuhr für den Lauf, hier vor allem Kohlenhydrate. Ein Fuel-Plan beschreibt, was du wann aufnehmen sollst. |
| Glykogen | Glycogen | Gespeicherte Kohlenhydrate in Muskeln und Leber. Der individuelle Füllstand wird durch die vorgesehenen Laufsensoren nicht direkt gemessen. |
| Bodenkontaktzeit / GCT | Ground contact time | Zeit, die ein Fuß pro Schritt den Boden berührt. In deiner Spec keine Primärmetrik. |
| Links-Rechts-Asymmetrie | Left-right asymmetry | Unterschied zwischen linker und rechter Seite, etwa bei Bodenkontaktzeiten. In deiner Spec ausgeschlossen. |
| ACWR | Acute:chronic workload ratio | Verhältnis einer kurzfristigen zu einer längerfristigen Trainingsbelastung. In deiner Spec ausdrücklich nicht vorgesehen. |

## Runback-Auswertung und Physik

| Begriff aus der Spec | Englisch / Suchbegriff | Einfach erklärt |
|---|---|---|
| Effort | Effort / Runback effort score | Modellierte äußere Anforderung unter den unterstützten Bedingungen. Skala und Referenz sind vor Ausspielung zu dokumentieren. Nicht gleich RPE, Gesamtbelastung oder gemessener Ermüdung. |
| Mechanische Leistung | Mechanical power | Mechanische Arbeit pro Zeit, angegeben in Watt. Bei Runback wäre das eine Modellschätzung aus Sensordaten, keine direkte Kraftmessung. |
| Metabolische Leistung | Metabolic power | Energieumsatz des Körpers pro Zeit. Nicht identisch mit mechanischer Leistung, da der Körper Energie unter anderem als Wärme abgibt. |
| Kumulierte Arbeit | Accumulated work | Über die Zeit aufsummierte mechanische Arbeit. Entsteht durch Integration der Leistung; zum Beispiel entspricht ein Watt über eine Sekunde einem Joule. |
| Thermischer Aufschlag | Heat adjustment / Heat penalty | Geplanter geschätzter zusätzlicher Einfluss von Wärmebedingungen auf Belastung oder Leistung. Ein modellabhängiger Runback-Begriff, keine direkt messbare Standardkennzahl. |
| Normalisierung | Normalization | Werte auf eine gemeinsame Vergleichsbasis umrechnen. Bei Runback sollen dadurch zum Beispiel unterschiedliche Streckenbedingungen berücksichtigt werden. |
| Counterfactual | Counterfactual / What-if scenario | Modellrechnung für eine nicht tatsächlich beobachtete Alternative: Wie wäre dieser Lauf unter anderen Bedingungen vermutlich ausgefallen? |
| Höhenmodell / DEM | Digital elevation model | Digitaler Datensatz zur Höhe des Geländes. Dient als Referenz; bildet nicht jede Brücke oder Unterführung passend ab. |
| Steigungskoeffizient | Grade coefficient / Slope parameter | Modellparameter dafür, wie stark sich Steigung auf die berechnete Belastung auswirkt. Seine genaue Bedeutung hängt von der Formel ab. |
| Luftwiderstandsfläche / CdA | Drag area / CdA | Produkt aus Luftwiderstandsbeiwert und Stirnfläche. Bestimmt zusammen mit Luftdichte und relativer Luftströmung den geschätzten Luftwiderstand. |
| HR-Cadence-Lock | Cadence lock | Messartefakt, bei dem eine optische Pulsmessung von der rhythmischen Bewegung beeinflusst wird und der Schrittfrequenz oder einer verwandten Frequenz folgt. Ähnliche HR und Kadenz allein beweisen den Fehler nicht. |
| Artefakt | Measurement artifact | Messfehler oder störender Anteil in einer Aufzeichnung, etwa ein GPS-Sprung. |
| Datenqualität | Data quality | Wie zuverlässig, vollständig und passend die Daten für eine bestimmte Auswertung sind. Gute GPS-Daten bedeuten nicht automatisch gute HR-Daten. |
| Sensor-Fusion | Sensor fusion | Mehrere Sensorquellen zu einer abgeleiteten gemeinsamen Schätzung verbinden. Die Originalquellen bleiben getrennt erhalten. |
| Uhrendrift | Clock drift | Geräteuhren laufen mit der Zeit auseinander. Das ist ein Zeitmessproblem und etwas anderes als HR-Drift. |

## Entscheidungen und Statistik

| Begriff aus der Spec | Englisch / Suchbegriff | Einfach erklärt |
|---|---|---|
| Insight | Insight | Eine eingeordnete Erkenntnis aus Daten. Bei Runback sollen bewertende Insights mit einer umsetzbaren Handlung und einer Prüfung verbunden sein. |
| Decision Engine | Decision engine | Der Teil der App, der aus Daten und Regeln eine Handlung auswählt. Das Sprachmodell soll diese Auswahl nicht treffen. |
| Hypothese | Hypothesis | Eine überprüfbare Vermutung. Beispiel: Ein ruhigerer Start könnte den späteren Tempoeinbruch vermindern. |
| Hypothesenklasse | Hypothesis class / Hypothesis category | In unserer Diskussion: eine Gruppe ähnlicher Vermutungen, etwa Probleme mit der Anfangseinteilung. In anderer Fachliteratur kann der Begriff anders verwendet werden. |
| Arbeitsthema | Active focus / Active experiment | Runback-Begriff für höchstens eine vom Nutzer angenommene, aktiv verfolgte Änderung mit vorher festgelegter Prüfung. |
| Intervention | Intervention | Die konkrete Änderung, die getestet wird, etwa ein bewusst ruhigerer Start. |
| Prüfbedingung | Success criterion / Evaluation criterion | Vorher festgelegte Regel, nach der später beurteilt wird, ob die gewünschte Veränderung eingetreten ist. |
| Falsifizierbar | Falsifiable | So formuliert, dass Beobachtungen gegen die Aussage sprechen können. Es muss vorher klar sein, welche Ergebnisse sie nicht stützen oder widerlegen würden. |
| Baseline | Baseline / Reference condition | Ausgangswert oder Ausgangsbedingungen, mit denen spätere Ergebnisse verglichen werden. |
| Zielgröße | Outcome / Outcome measure | Der konkrete Wert oder das Ergebnis, das sich verbessern soll. Beispiel: ein geringerer Tempoabfall im letzten Laufabschnitt. |
| Umsetzung / Adhärenz | Adherence | Ob und in welchem Umfang du die Empfehlung tatsächlich befolgt hast. Ohne Umsetzung wurde ihre Wirkung nicht sinnvoll getestet. |
| Effektgröße | Effect size | Wie groß eine Veränderung oder ein Unterschied ist. Allein noch kein Nachweis, wodurch er verursacht wurde. |
| Konfidenz | Confidence | Hier allgemein: wie gut eine Aussage abgesichert ist. Eine Prozentangabe braucht eine klare statistische Bedeutung; das Wort allein definiert keine Wahrscheinlichkeit. |
| Punktschätzung | Point estimate | Ein einzelner geschätzter Wert, etwa eine prognostizierte Wettkampfzeit. |
| Intervall | Uncertainty interval | Ein Bereich zur Darstellung von Unsicherheit. Seine Bedeutung hängt vom Verfahren ab; nicht jeder Bereich ist ein Konfidenzintervall. |
| Konfidenzintervall | Confidence interval | Statistischer Bereich aus einem Verfahren, das bei vielen entsprechenden Wiederholungen den wahren Parameter mit der angegebenen Häufigkeit überdeckt. Ein 95%-Intervall bedeutet nicht automatisch 95% Wahrscheinlichkeit für den Parameter in genau diesem berechneten Bereich. |
| Prognoseintervall | Prediction interval | Unsicherheitsbereich für eine zukünftige Beobachtung, etwa den nächsten Lauf. Enthält auch dessen zusätzliche Schwankung. |
| Bayes'sche Schätzung | Bayesian estimation | Verfahren, das Vorannahmen mit neuen Daten zu einer aktualisierten Schätzung verbindet. Es ist kein Sprachmodell. |
| Prior | Prior distribution | Statistische Ausgangsannahme vor Einbezug der betrachteten Daten, zum Beispiel aus Literaturwerten. |
| Posterior | Posterior distribution | Aktualisierte statistische Einschätzung nach Verbindung des Priors mit den Daten. |
| Glaubwürdigkeitsintervall | Credible interval | Bayes'scher Unsicherheitsbereich. Unter dem Modell und den verwendeten Annahmen liegt darin die angegebene Posterior-Wahrscheinlichkeit. |
| Fitten | Model fitting / Parameter estimation | Modellparameter so an Daten anpassen, dass das Modell diese möglichst passend beschreibt. Eine gute Anpassung garantiert noch keine guten Vorhersagen. |
| Korrelation | Correlation / Association | Zwei Größen verändern sich gemeinsam. Das beweist nicht, dass eine die andere verursacht. |
| Kausalität | Causality / Causal effect | Ein ursächlicher Zusammenhang: Eine Änderung bewirkt eine andere. Ein einfacher Vorher-nachher-Unterschied reicht dafür meist nicht aus. |
| Störfaktor | Confounder | Eine zusätzliche Einflussgröße, die den vermuteten Zusammenhang verzerren kann. Beispiel: Du änderst die Laufzeit und läufst dadurch zugleich bei kühlerem Wetter. |
| Regression zur Mitte | Regression to the mean | Nach einem zufällig extremen Ergebnis folgen häufig wieder gewöhnlichere Ergebnisse. Eine Verbesserung nach einem besonders schlechten Lauf muss deshalb nicht durch den neuen Tipp entstanden sein. |
| Evidenz | Evidence | Belege, die eine Aussage stützen oder gegen sie sprechen. Viele Samples aus demselben Lauf sind nicht dasselbe wie viele unabhängige Läufe. |
| Inconclusive | Inconclusive result | Das Ergebnis erlaubt noch kein ausreichend klares Urteil. Bedeutet weder bewiesen noch widerlegt. |
| Validierung | Validation | Prüfen, ob ein Modell oder eine Entscheidung für den vorgesehenen Zweck ausreichend zuverlässig funktioniert. |
| Overfitting | Overfitting | Ein Modell passt sich auch an Zufall und Besonderheiten alter Daten an und funktioniert dadurch bei neuen Daten schlechter. |
| Kalibrierung | Calibration | Je nach Zusammenhang: Abgleich eines Sensors mit einer Referenz oder Prüfung, ob vorhergesagte Wahrscheinlichkeiten zu beobachteten Häufigkeiten passen. |
| Deterministisch | Deterministic | Gleiche Eingaben und gleicher vollständig festgelegter Modellzustand führen zum gleichen Ergebnis. Bedeutet nachvollziehbar wiederholbar, nicht automatisch richtig. |
| Constraints | Constraints | Vorgaben und Grenzen wie verfügbare Trainingstage, Zeitbudget oder unerwünschte Trainingsformen. |

## Daten und App-Technik

| Begriff aus der Spec | Englisch / Suchbegriff | Einfach erklärt |
|---|---|---|
| Rohdaten / Rohsamples | Raw data / Raw samples | Ursprüngliche Einzelmessungen, beispielsweise GPS-Positionen oder Beschleunigungswerte mit Zeitstempel. |
| Abtastrate / Hz | Sampling rate / Hertz | Wie viele Messungen pro Sekunde aufgezeichnet werden. 50 Hz bedeutet 50 Messungen pro Sekunde. |
| Aggregate | Aggregates | Zusammenfassungen mehrerer Werte, etwa mittlere Herzfrequenz, Minimum oder Maximum eines Abschnitts. |
| Features | Features | In der Datenanalyse: berechnete Merkmale wie Tempoabfall oder HR-Drift. In der Produktplanung bedeutet Feature dagegen eine App-Funktion. |
| Ableitungen | Derived data | Aus Originaldaten berechnete Ergebnisse, etwa bereinigte Streams, GAP oder Empfehlungen. Hier keine mathematische Ableitung im engeren Sinn. |
| Stream | Time series / Data stream | Zeitlich geordnete Folge von Messwerten, beispielsweise eine Herzfrequenzreihe. |
| Reprocessing | Reprocessing | Gespeicherte Daten mit einer anderen oder neueren Auswertung erneut berechnen. Gelöschte Ausgangsdaten lassen sich dabei nicht wiederherstellen. |
| model_version | Model version | Kennung des verwendeten Rechenmodells. Hilft nachzuvollziehen, mit welchen Regeln ein Ergebnis entstanden ist. |
| Provenienz | Data provenance | Nachvollziehbare Herkunft eines Werts: Quelle, Gerät, Zeitpunkt und Verarbeitungsschritte. |
| Duplikaterkennung | Deduplication | Erkennen, dass mehrere importierte Aufzeichnungen denselben Lauf beschreiben, damit er nicht mehrfach zählt. |
| Health Connect | Android Health Connect | Android-Schnittstelle zum berechtigten Austausch von Gesundheits- und Fitnessdaten zwischen Apps. Verfügbar ist nur, was andere Quellen tatsächlich bereitstellen. |
| FIT | Flexible and interoperable data transfer | Kompaktes Dateiformat für Sportaufzeichnungen mit vielen möglichen Messfeldern. Welche Inhalte vorhanden sind, hängt von der Quelle ab. |
| GPX | GPS exchange format | Dateiformat vor allem für GPS-Tracks, Routen und Wegpunkte. Zusätzliche Fitnessdaten können über Erweiterungen enthalten sein. |
| TCX | Training center XML | Dateiformat für Trainingsdaten, häufig mit Runden, GPS und Herzfrequenz. |
| JSON | JavaScript object notation | Textformat für strukturierte Daten. Welche Runback-Daten darin stehen, bestimmt das definierte Exportschema. |
| Strava-Bulk-Export | Strava bulk export / Account data export | Gebündelter Export vieler Kontodaten und Aktivitäten. Die enthaltenen Aktivitätsdateien können unterschiedliche Formate haben. |
| Local First | Local-first | In deiner präzisierten Spec: Aufzeichnen und einfache Auswertung funktionieren lokal; die zentrale Laufdatenbank liegt auf dem Gerät. Internetdienste bleiben erlaubt. |
| API | Application programming interface | Definierte Schnittstelle, über die Programme Daten oder Funktionen anfordern, beispielsweise Wetterdaten. |
| Query-API | Query API | Abfrageschnittstelle für gezielte Fragen an Daten, etwa die letzten geeigneten Vergleichsläufe. |
| React Native | React Native | Framework zum Entwickeln der App-Oberfläche und App-Logik mit JavaScript oder TypeScript und nativen Plattformkomponenten. |
| Kotlin Native Module | Native Android module written in Kotlin | In dieser Spec: Android-Code in Kotlin, den React Native nutzen kann, etwa für die Aufzeichnung. Nicht dasselbe wie das separate Kotlin/Native-Produkt. |
| JS-Bridge | JavaScript–native boundary / Bridge | Verbindung zwischen JavaScript und dem nativen Android-Teil. Deine Regel: keine hochfrequenten Rohsample-Ströme darüber transportieren. |
| Doze | Android Doze mode | Android-Energiesparmodus, der Hintergrundaktivitäten einschränkt. |
| Foreground Service | Android foreground service | Android-Dienst für eine dem Nutzer sichtbare laufende Aufgabe, normalerweise mit Benachrichtigung. Keine Garantie gegen jedes Beenden der App. |
| BLE | Bluetooth low energy | Bluetooth-Technik für stromsparende Verbindungen, beispielsweise zu einem Brustgurt. |
| Wear OS Companion | Wear OS companion app | Begleit-App auf einer Android-Uhr, hier für Sensoren, Anzeige und später eigene Aufzeichnung. |
| LLM | Large language model | Sprachmodell, das Texte erzeugt. Bei Runback soll es bereits festgelegte Ergebnisse verständlich formulieren. |
| OpenRouter | OpenRouter | Externer Dienst zum Zugriff auf Sprachmodelle verschiedener Anbieter über eine gemeinsame Schnittstelle. |
| API-Key | API key | Geheimer Zugangsschlüssel für einen Dienst. In Runback der nutzereigene Schlüssel für den optionalen Modellzugriff. |
| Cache | Cache | Gespeichertes Ergebnis zur Wiederverwendung, damit dieselbe Berechnung oder Anfrage nicht ständig wiederholt werden muss. |
| Fallback | Fallback | Ersatzweg, wenn etwas nicht verfügbar oder ungültig ist, etwa fester Erklärungstext statt LLM-Text. |
| Degradieren | Graceful degradation | Mit weniger Daten eingeschränkt, aber nachvollziehbar weiterfunktionieren, beispielsweise ohne HR-Auswertung bei fehlendem Puls. |
| Template | Text template | Vorbereitete Textvorlage, in die geprüfte Werte eingesetzt werden. |
| Cue / Live-Cue | Cue / Real-time cue | Kurzer Hinweis während des Laufens, den du sofort umsetzen kannst. |
| Cooldown | Cooldown period | In der Hinweislogik: Wartezeit bis zum nächsten ähnlichen Cue. Nicht mit dem Auslaufen nach dem Training verwechseln. |
| Pacemaker | Virtual pacer / Pacing guide | Digitale Führung gegen einen Laufplan. Bei Runback gegen einen abschnittsweisen Effort-Plan; kein medizinischer Herzschrittmacher. |
| Preset | Preset / Saved configuration | Gespeicherte Einstellungen für einen wiederkehrenden Einsatz, etwa Geräte und aktive Hinweise. |
| Overlay | Map overlay | Zusätzliche Darstellung auf der Karte, beispielsweise eine nach Pace eingefärbte Strecke. |
| Invariante | Invariant | Regel, die bei allen betroffenen Funktionen eingehalten werden muss. |
| Akzeptanzkriterium | Acceptance criterion | Konkrete, prüfbare Bedingung, unter der ein Ziel als erreicht gilt. |
| Definition of Done | Definition of done / DoD | Gemeinsame Bedingungen dafür, wann die Version oder der Produktkern als fertig gilt. |

## Krafttraining und Muskelmodell

Maßgeblich sind die [Zielspezifikation Training](zielspezifikation-training.md) und das [Muskel- und Belastungsmodell](muskelmodell.md).

| Begriff aus der Spec | Englisch / Suchbegriff | Einfach erklärt |
|---|---|---|
| Session | Session / Workout | Eine Trainingseinheit beliebiger Art. In Runback tragen Laufen und Krafttraining dieselbe Grundstruktur. |
| Satz | Set | Eine zusammenhängende Folge von Wiederholungen einer Übung, gefolgt von einer Pause. |
| Wiederholung | Rep / Repetition | Eine einzelne Ausführung der Bewegung. |
| Muskelregion | Muscle region | Ein fest benannter Eintrag aus Runbacks versionierter Regionenliste, nicht ein frei gewählter Körperteil. |
| Muskelanteil | Muscle contribution / involvement | Anteil, mit dem eine Übung eine Region beansprucht. Eine Übung verteilt sich immer auf mehrere Regionen. |
| Frische | — (bewusst nicht „readiness“) | Runbacks gerechnete Skala 0–100 je Region. 100 bedeutet: keine nachwirkende Belastung im Sinne des Modells. Kein Maß für Gesundheit, Kraft oder Belastbarkeit. |
| Muskelkater | DOMS / Delayed onset muscle soreness | Verzögert einsetzender Muskelschmerz, meist am stärksten etwa einen Tag nach ungewohnter Belastung. In Runback eine Nutzerangabe, keine Messung. |
| Wiederholungen in Reserve | RIR / Reps in reserve | Geschätzte Zahl weiterer Wiederholungen, die im Satz noch möglich gewesen wären. Ein Satz mit RIR 0 ging bis zum Muskelversagen. |
| Einwiederholungsmaximum | 1RM / One-rep max | Last, die genau einmal bewegt werden kann. Runback schätzt sie aus Last und Wiederholungen, misst sie nicht. |
| Exzentrisch | Eccentric contraction | Der Muskel arbeitet, während er sich verlängert, etwa beim Bergablaufen oder beim Ablassen des Gewichts. Erzeugt deutlich mehr Muskelkater als die umgekehrte Richtung. |
| Impulsantwort | Impulse response | Beschreibt, wie eine einzelne Belastung über die Zeit nachwirkt: erst ansteigend, dann abklingend. Grundlage der Frische-Berechnung. |
| Robuste Trendschätzung | Theil–Sen estimator | Verfahren, das einen Verlauf aus dem Median vieler paarweiser Steigungen bestimmt. Einzelne schlechte Tage verzerren es kaum. |
| Bruchpunkterkennung | CUSUM / Change point detection | Verfahren, das erkennt, ab wann ein Verlauf sich tatsächlich verändert hat, statt nur einzelne Ausschläge zu melden. |
| Nicht unterscheidbare Koeffizienten | Collinearity / Identifiability | Zwei Werte lassen sich aus den vorhandenen Daten nicht trennen, weil sie immer gemeinsam auftreten. Runback benennt das, statt eine Zahl zu erfinden. |
| Störgröße | Confounder | Ein Einfluss, der Ursache und Wirkung gemeinsam verändert, etwa Beinermüdung bei der Bewertung eines Laufs. |
| Plan-Ist-Abweichung | Planned vs. actual | Unterschied zwischen der Zielvorgabe und dem tatsächlich Durchgeführten. In Runback eine Angabe zur Umsetzung, keine Bewertung. |

## Ein Beispiel für den Entscheidungsablauf

Du beginnst einen Dauerlauf schnell und wirst später deutlich langsamer. Das ist zunächst eine Beobachtung. Die Hypothese lautet: Ein ruhigerer Start könnte den späteren Einbruch vermindern. Die Intervention ist der ruhigere Start. Als Baseline dienen geeignete frühere Läufe. Vorher wird festgelegt, welche Verbesserung bei erhaltenem Trainingszweck zählen soll. Danach prüft Runback zunächst die Umsetzung und anschließend das Ergebnis. Reichen die Belege nicht aus, lautet das Urteil inconclusive.

