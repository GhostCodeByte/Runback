# Änderungen gegenüber dem ersten Entwurf

Diese Fassung beschreibt die maßgeblichen Produktentscheidungen in normaler
Sprache. Sie korrigiert die [Zielspezifikation](zielspezifikation.md) und alle
anderen Texte, wenn dort noch die alte Begriffslogik steht. Interne Namen,
Datenbankfelder und Modellkennungen dürfen davon abweichen.

Die Struktur mit Rahmen, Grundregeln, V1, V2, Ausschlüssen und Definition of
Done bleibt erhalten. Die bisherigen V1-1 bis V1-20 und V2-1 bis V2-13 behalten
ihre IDs; die Trennung von Ziel, Fokus und Empfehlung wird zusätzlich in
V1-21 und die feste Priorisierung in V1-22 festgehalten.

## Umbenennungen

Die folgenden Paare benennen dasselbe bestehende Objekt um. Es entstehen keine
zwei parallelen Objekte.

| Alt | Neu |
| --- | --- |
| Arbeitsthema | Empfehlung |
| nächste Handlung | Empfehlung |
| Intervention | entfällt; geht in die Empfehlung ein |
| Prüfbedingung / Erfolgskriterium | Woran erkennen wir, dass es geholfen hat? |
| Baseline | Vergleichsläufe |
| inconclusive | noch nicht klar |
| Invariante | Grundregel |
| Effort | bleibt Effort und erhält eine eigene Definition |

„Laufempfehlung“ wird nicht verwendet. Eine Empfehlung kann Laufen,
Krafttraining oder die Verbindung beider Trainingsarten betreffen.

## Drei Ebenen

Runback hält drei Dinge auseinander:

1. **Ziel** — optional, mit Datum. Ein Ziel darf enden. Ein Datum macht
   Aufbau und Tapering berechenbar. Ohne Ziel funktioniert Aufzeichnen und
   Auswerten weiter.
2. **Fokus** — dauerhaft, ohne Enddatum, höchstens einer aktiv. Er beschreibt,
   woran allgemein gearbeitet wird. Er bleibt bestehen, wenn ein Ziel endet
   oder eine Empfehlung abgeschlossen wird.
3. **Empfehlung** — höchstens eine, konkret und überprüfbar. Sie beschreibt,
   was jetzt ausprobiert oder bewusst beibehalten werden soll. Nur sie
   durchläuft den Regelkreis aus Umsetzung, Ergebnis und Ursache.

Der Fokus selbst wird nicht bewertet. Er hat kein eigenes Urteil, keine eigene
Antwort auf „Woran erkennen wir, dass es geholfen hat?“ und kein „erreicht“ oder
„widerlegt“.

## Fokus

Der Fokus wird in zwei Feldern gespeichert:

- **Fokus-Art:** eine kurze, versionierte Auswahl: Ausdauer aufbauen,
  schneller werden, verletzungsfrei bleiben, Gewohnheit aufbauen oder
  allgemeine Fitness. Diese Auswahl steuert die Priorisierung.
- **Eigene Bezeichnung:** freier Text des Nutzers. Er steht in der Oberfläche,
  wird aber nicht ausgewertet.

Ist ein Ziel gesetzt, schlägt Runback einen passenden Fokus vor. Ohne Ziel
trägt der Nutzer einen Fokus selbst ein; Runback rät dann keinen Fokus. Ziel,
Fokus und Empfehlung bleiben sämtlich optional.

Sehr breite Fokusse wie „fitter werden“ dürfen wie kein Fokus behandelt werden.
Alternativ kann Runback beim Anlegen mit einem Tap eine freiwillige Ergänzung
anbieten, zum Beispiel „mehr Ausdauer“ plus „lange Läufe“ oder „wöchentlicher
Umfang“. Die Ergänzung ist nie Pflicht.

Ein Fokuswechsel beendet keine laufende Empfehlung automatisch. Er darf die
Priorisierung künftiger Vorschläge verändern, aber keine unbequeme Prüfung
abkürzen.

## Priorisierung

Priorisierung ist ein festes, nachvollziehbares Verfahren:

- Eine versionierte Relevanzmatrix gibt jeder Handlungsklasse je Fokus-Art ein
  festes Gewicht. Gleiche vollständige Eingaben liefern dieselbe Reihenfolge.
- Ein Fokus kann Handlungsklassen auch sperren. „Verletzungsfrei bleiben“
  sperrt zum Beispiel Klassen, die den Umfang erhöhen; das nutzt denselben
  Mechanismus wie andere Gegenanzeigen.
- Ein Ziel mit Datum aktiviert reine Kalenderlogik. Die verbleibenden Wochen
  filtern unpassende Klassen hart: Ein Technikumbau drei Wochen vor dem Ziel
  und Tapering zwölf Wochen vorher werden nicht vorgeschlagen.
- Unter „Details“ stehen neben der gewählten Empfehlung auch verworfene
  Alternativen mit ihrem Grund, etwa nachrangige Relevanz oder zu schlechte
  Datenqualität.
- Während eine Empfehlung läuft, darf die nächste als „Danach vorgesehen“
  sichtbar sein. Das ändert weder die aktive Empfehlung noch ihre Prüfung.

Die Gewichte sind redaktionelle Einschätzungen. Sie werden dokumentiert und
versioniert, in der Oberfläche als „So priorisiert Runback“ erklärt und nicht
als „für dich berechnet“ ausgegeben. Sie werden nicht aus den Daten eines
einzelnen Nutzers gelernt.

### Startmatrix `relevance-v1`

Die erste Matrix nutzt feste Werte von 0 bis 5. Ein Gedankenstrich bedeutet:
Die Fokus-Art wird für diese breite Auswahl wie „kein Fokus“ behandelt; dann
entscheiden Datenqualität und Umsetzbarkeit. „Gesperrt“ ist kein niedriger
Wert, sondern ein harter Ausschluss.

| Handlungsklasse | Ausdauer aufbauen | Schneller werden | Verletzungsfrei bleiben | Gewohnheit aufbauen | Allgemeine Fitness |
| --- | ---: | ---: | ---: | ---: | ---: |
| Startdisziplin | 5 | 3 | 3 | 4 | — |
| Pulsverlauf | 4 | 3 | 2 | 1 | — |
| Kadenz | 2 | 4 | 1 | 1 | — |
| Umfang steigern | 5 | 4 | gesperrt | 3 | — |
| Technik neu aufbauen | 2 | 4 | 1 | 1 | — |
| Tapering | 2 | 3 | 3 | 0 | — |

Die Matrix wird zuerst nach harten Sperren und Kalenderphasen angewandt.
Danach gewinnt bei passenden Kandidaten das höhere Gewicht, dann die bessere
Datenqualität, dann die bessere Umsetzbarkeit, dann der kleinere Aufwand. Bei
Gleichstand entscheidet der feste Klassenname. Technik neu aufbauen ist in den
letzten drei Wochen vor einem Zieldatum gesperrt; Tapering ist mehr als zwölf
Wochen vor dem Zieldatum gesperrt. Diese Reihenfolge ist reproduzierbar und
kein lernendes Nutzerprofil.

## Warum Runback so selten etwas beweisen kann

Ein Medikament prüft man an vielen Menschen; Zufälle können sich dort
ausgleichen. Runback hat nur einen Nutzer. Ein besserer Lauf kann deshalb am
Tipp liegen, aber auch an Schlaf, Wetter oder einem zufällig schlechten Lauf
davor. „Noch nicht klar“ ist der ehrliche Normalfall. Deshalb bekommt der
Fokus kein Urteil; nur eine konkrete Empfehlung wird geprüft.

## Sprache und Oberfläche

Die Spec und alle Texte für Nutzer oder Projektinhaber verwenden normale
Sprache. Fachwörter bleiben dort, wo es keinen brauchbaren Alltagsbegriff gibt.
Die Oberfläche ist noch kürzer: ein Satz pro Bildschirm, im Imperativ, ohne
Label, das den Objekttyp erklärt. „Starte die ersten 2 km langsamer.“ reicht
unter „Dein Fokus“.

Jede Aussage hat drei Tiefen: zuerst der Satz, dann in zwei Zeilen warum, dann
unter Details Datenbasis, Modellversion und Unsicherheit. Zahlen erscheinen
nur, wenn sie eine Entscheidung ändern. Unsicherheit wird in Worten erklärt,
zum Beispiel „ziemlich sicher“ oder „eher ein Eindruck“.

Zustände stehen als sichtbare Labels da: „Vorschlag“, „Angenommen“, „Aktiv“,
„Pausiert“, „Abgeschlossen“ und „Abgebrochen“. Urteile heißen „Noch nicht
klar“, „Zu wenig vergleichbare Läufe“ oder „Du hast es bisher nicht probiert“.

## Bereits beschlossene Produktentscheidungen

- Rohdaten möglichst erhalten, umfangreiche Zusatzdaten mit sichtbaren
  Speichergrenzen; keine unmögliche Neuberechnung gelöschter Quellen
  versprechen.
- Genaue Koordinaten für Wetter, Karten und Höhenmodell zulassen. Das LLM
  erhält standardmäßig keine Koordinaten, weil es sie nicht benötigt.
- Local First bedeutet lokale Laufdatenbank, Offline-Aufzeichnung und einfache
  Offline-Analyse. Internet für Anreicherung ist erlaubt.
- Feedback nur ausspielen, wenn die vorhandenen Daten es tragen.
- Empfehlungen vor Beginn festschreiben und nicht nach jedem Lauf automatisch
  wechseln.
- Messdaten und neutrale Beobachtungen dürfen ohne eigene Empfehlung oder
  Prüfung erscheinen.
- Laufzweck und Zielkontext steuern die Bewertung einer Empfehlung.
- Effort, Intensität, Gesamtbelastung und RPE behalten getrennte Bedeutungen.
- Umsetzung, beobachtetes Ergebnis und ursächliche Wirkung werden getrennt
  bewertet.
- Nutzer können Empfehlungen annehmen, verschieben, ablehnen und Prüfungen
  beenden.
- „Drei Läufe“ ist eine mögliche Zwischenprüfung, keine allgemeine
  Beweisgrenze.
- Datenqualität gilt pro Sensor, Abschnitt und Aussage. Duplikaterkennung
  gehört bereits zum Kern.
- Health-Connect-Routen, Freigaben und konkrete getestete Gerätekette sind
  Bestandteil der Abnahme.
- Prozessabsturz und ausdrückliches Android-Stoppen sind getrennte
  Aufzeichnungsfälle.
- Vollständiges Backup umfasst Wiederherstellung; FIT/GPX bleiben begrenzte
  Austauschformate.
- Die LLM-Prüfung erfasst auch Ursache, Sicherheit und Empfehlung, nicht nur
  Zahlen.
- V2-Modelle werden nur bei geeigneten Daten und erfolgreicher Validierung
  freigeschaltet.

## Noch durch die Umsetzung zu konkretisieren

Vor Freischaltung beziehungsweise Abnahme zu dokumentieren:

- Effort-Skala, Referenzbedingungen, Faktoren, Einsatzbereich und
  Unsicherheitsverfahren.
- Handlungsklassen, Relevanzmatrix, Sperren und je Klasse die vorab
  festgelegte Regel, woran wir Hilfe erkennen.
- Speicherstandardbudget und genaue Aufbewahrungsregeln.
- Referenzgerät, unterstützte Android-Versionen sowie Akku-, Speicher- und
  Bedienleistungsgrenzen.
- Kostenfrei nutzbare Wetter-, Karten- und Höhendatenquellen mit passenden
  Nutzungsbedingungen.
- Backup-Schema und nachvollziehbare Versions-/Migrationsregeln.

Diese Konkretisierung darf die Ziele und Grundregeln der
[Zielspezifikation](zielspezifikation.md) nicht abschwächen.

## Aktueller Arbeitsumfang

Auf Wunsch wird vorerst ausschließlich die Dokumentation gepflegt.
App-Implementierung, CI-Workflows und APK-Erstellung sind nicht Teil dieses
Dokumentationsstands. Anforderungen an flexible Einstellungen, die
Telefon-/Uhr-Bedienung und spätere Test-Releases stehen in
[Bedienung und spätere Auslieferung](bedienung-und-auslieferung.md).

Das bereitgestellte GitHub-Repository ist mit ausdrücklicher Zustimmung
öffentlich. Die Lizenzwahl bleibt gesondert festzulegen.

## Was sich ausdrücklich nicht ändert

- Höchstens eine aktive Empfehlung.
- Empfehlungen werden vor Beginn festgeschrieben und nicht rückwirkend
  umgeschrieben.
- Neue Daten lösen nicht automatisch einen Themenwechsel aus.
- „Beibehalten“, „aktuell keine Empfehlung nötig“ und „noch nicht beurteilbar“
  bleiben drei unterschiedliche, begründete Ergebnisse.
- Aufzeichnen funktioniert ohne Ziel, ohne Fokus und ohne Einrichtung.
