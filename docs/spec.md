# Runback – Spec

Richtung und Haltung der App. Was hier steht, gilt für jede Funktion. Wie etwas
umgesetzt ist, steht im Code, nicht hier.

## Ziel

Runback ist eine lokale Android-Trainings-App für Laufen und Krafttraining. Aus
aufgezeichneten und importierten Einheiten leitet sie je Bereich **höchstens
eine** begründete, umsetzbare und prüfbare Empfehlung ab — und prüft später
ehrlich, ob sie umgesetzt wurde und ob sie geholfen hat.

Kernversprechen: Eine Einheit rein → höchstens eine Empfehlung für diesen
Bereich raus, wenn die Daten sie tragen. Sonst sagt die App knapp, was bekannt
ist und was fehlt. **Keine Empfehlung ist ein vollwertiges Ergebnis.**

## Mentalität

- **Ehrlich vor beeindruckend.** Ein Medikament testet man an 500 Leuten,
  Runback hat einen Nutzer. Ein besserer Lauf kann am Tipp liegen — oder am
  Schlaf, am Wetter, am zufällig schlechten Lauf davor. „Noch nicht klar“ ist
  deshalb der Normalfall, und lieber „eher ein Eindruck“ als eine präzise Zahl
  ohne Grundlage.
- **Ruhig statt reaktiv.** Ein neuer Lauf ist kein Grund für einen neuen Tipp.
  Beibehalten ist eine Empfehlung.
- **Der Nutzer entscheidet.** Die App schlägt vor, der Nutzer nimmt an. Pläne
  sind Nutzerartefakte; die App schreibt sie nicht von sich aus um.
- **Alles ist optional.** Aufzeichnen funktioniert ohne Ziel, Fokus, Plan,
  Einrichtung, Konto oder Internet. Jede Funktion ist abwählbar und erzeugt
  abgewählt weder Hinweise noch leere Flächen.
- **Schmaler Output, beliebige interne Komplexität.** Eine Aussage je Fläche,
  ein Satz im Imperativ, Tiefe unter „Details“.

## Zwei Bereiche

**Laufen** und **Krafttraining** sind getrennte Bereiche mit eigenem Ziel,
eigenem Fokus und eigener Empfehlung. Sie werden an getrennten Daten geprüft
(Läufe bzw. Sätze und Muskelkater) und stören sich in der Auswertung deshalb
kaum. Wer nur einen Bereich nutzt, sieht vom anderen nichts.

- Höchstens **eine aktive Empfehlung je Bereich**, also nie mehr als zwei.
- Eine Empfehlung, die beide Bereiche berührt („Beinbelastung vor dem langen
  Lauf runter“), belegt **beide Plätze**.
- **Kopplungssperre:** Bevor die zweite Empfehlung vorgeschlagen wird, prüft
  Runback, ob ihre Handlungsklasse die Zielgröße der ersten beeinflussen kann
  (mehr Beinvolumen → Lauftempo). Wenn ja, erscheint sie nicht parallel,
  sondern als „Danach vorgesehen“.
- Auf „Heute“ steht die Empfehlung für die Einheit, die gerade gestartet wird.
  Nie beide untereinander.

*Stand:* Der Code kennt heute eine Empfehlung für den Bereich Laufen. Die
Bereichstrennung ist die Richtung, in die jede Änderung an Ziel, Fokus und
Empfehlung führen muss.

## Die drei Ebenen

Je Bereich:

| Ebene | Bedeutung |
|---|---|
| **Ziel** | Optionales Vorhaben, ggf. mit Datum. Darf enden. Ein Datum macht Aufbau und Tapering berechenbar. |
| **Fokus** | Dauerhaftes Thema ohne Enddatum, höchstens einer aktiv je Bereich. Wird **nie bewertet**. Ein Ziel darf einen Fokus vorschlagen. |
| **Empfehlung** | Höchstens eine konkrete Handlung je Bereich, die geprüft wird. Zustände: Vorschlag → Angenommen → Aktiv / Pausiert → Abgeschlossen / Abgebrochen. |

Die drei Ebenen sind unabhängig optional. Ein Fokuswechsel beendet keine
laufende Empfehlung; das Ende eines Ziels löscht keinen Fokus.

Der Fokus hat zwei Felder: die **Fokus-Art** aus einer kurzen, versionierten
Liste je Bereich (rechnet die Priorisierung) und eine **eigene Bezeichnung** als Freitext
(steht im UI, wird nicht ausgewertet). Mit Ziel schlägt Runback eine Fokus-Art
vor; ohne Ziel rät Runback nicht, der Nutzer wählt selbst oder lässt es leer.
Ein sehr breiter Fokus („fitter werden“) wird wie „kein Fokus“ behandelt; dann
entscheiden Datenqualität und Umsetzbarkeit.

Alt und neu bezeichnen dasselbe Objekt: „Arbeitsthema“, „nächste Handlung“ und
„Intervention“ heißen heute Empfehlung. Nicht „Laufempfehlung“ — Krafttraining
gehört dazu. Nicht „Änderung“ — Beibehalten ist eine Empfehlung.

## Grundregeln

Verletzung ist ein Bug, kein Trade-off.

1. **Originale bleiben original.** Gespeicherte Daten werden nicht heimlich
   verbessert. Korrekturen liegen getrennt daneben.
2. **Jede Zahl hat eine Spur.** Ableitungen tragen Modellversion und Quellen.
   Neuberechnung wird nur versprochen, wenn die Ausgangsdaten noch da sind.
3. **Erst prüfen, dann empfehlen.** Eine Empfehlung nennt Handlung, Zweck und
   vorab die Regel „Woran erkennen wir, dass es geholfen hat?“. Neutrale
   Beobachtungen brauchen keine Prüfung.
4. **Beibehalten ist erlaubt.** „Beibehalten“, „keine Empfehlung nötig“ und
   „noch nicht beurteilbar“ sind drei verschiedene, begründete Ergebnisse.
5. **Unsicherheit bleibt sichtbar.** Keine erfundenen Intervalle, keine
   erfundenen Ersatzwerte. Messung, Nutzereingabe und Schätzung sind
   unterscheidbar.
6. **Regeln entscheiden, Sprache erklärt.** Ein LLM darf formulieren und
   Fragen beantworten, aber keine Empfehlung, Bewertung oder Datenänderung
   erzeugen. Gleiche Eingaben → gleiche Entscheidung.
7. **Eine Lücke bleibt eine Lücke.** Fehlende Daten begrenzen nur die Aussage,
   die sie braucht. Gute Daten bleiben nutzbar.
8. **Die Brücke bleibt schlank.** Rohsamples bleiben nativ. JS sieht Aggregate
   und begrenzte Darstellungsdaten.
9. **Daten gehen nur für einen Grund hinaus.** Externe Dienste nur für Wetter,
   Karten/Höhe und optional OpenRouter mit eigenem Key. Keine Koordinaten oder
   Rohdaten ans LLM, keine Schlüssel in Logs oder Backups.
10. **Die Daten gehören dem Nutzer.** Vollständiges Backup, Wiederherstellung
    und Löschen ohne Konto.
11. **Der Trainingszweck gewinnt.** Eine bessere Kennzahl ist kein Erfolg,
    wenn dafür das eigentliche Training aufgegeben wird.
12. **Vorher festlegen, später ehrlich bleiben.** Vergleichsläufe, Zielgröße
    und Prüfregel stehen vor dem Start fest und werden nicht nachträglich
    passend gemacht.
13. **Drei Fragen, drei Antworten.** Umsetzung, Ergebnis und Ursache bleiben
    getrennt. Ein Unterschied ist kein Kausalbeweis.
14. **Empfehlungen bleiben ruhig.** Neue Daten, ein RPE-Nachtrag oder ein
    Fokuswechsel lösen keinen Themenwechsel aus.
15. **Ein Bereich, eine Empfehlung.** Nie zwei im selben Bereich, nie eine
    zweite, die die Prüfung der ersten verfälschen könnte.

## Fachliche Größen

Getrennt und nie vermischt:

- **Effort** — modellierte äußere Anforderung eines Laufs. Kein Fitness-,
  Ermüdungs- oder Gesundheitswert.
- **Intensität / Gesamtbelastung / RPE** — Anforderung pro Zeit, Summe über die
  Einheit, subjektive Anstrengung (Beine und Atmung getrennt).
- **Frische** — modellierte Skala 0–100 je Muskelregion aus Sätzen, Läufen und
  gemeldetem Muskelkater. Regionenbezogen, mit sichtbarer Herkunft. Ohne
  tragfähige Grundlage bleibt eine Region **unbekannt**. Niemals formuliert
  als „bereit“, „belastbar“ oder „Verletzungsrisiko“.
- **Priorisierung** — deterministisch, kein lernendes Profil:
  - Eine versionierte **Relevanzmatrix** gibt jeder Handlungsklasse je
    Fokus-Art ein festes Gewicht. Gleiche Eingaben → gleiche Reihenfolge.
  - Ein Fokus kann Klassen **sperren**, nicht nur abwerten („verletzungsfrei
    bleiben“ sperrt Umfangssteigerung).
  - Ein Ziel mit Datum filtert per **Kalender** hart: kein Technikumbau in den
    letzten drei Wochen, kein Tapering mehr als zwölf Wochen vorher.
  - Danach zählt: höheres Gewicht, bessere Datenqualität, bessere
    Umsetzbarkeit, kleinerer Aufwand.
  - Unter „Details“ stehen auch die **verworfenen Alternativen** mit Grund.
    Läuft eine Empfehlung, darf die nächste als „Danach vorgesehen“ erscheinen,
    ohne die aktive Prüfung zu ändern.
  - Die Gewichte sind redaktionell. Im UI heißt das „So priorisiert Runback“,
    nie „für dich berechnet“.

Übungskatalog, Muskelregionen, Modelle und Matrix sind versionierte Daten;
ihre Version wandert in jede Ableitung.

## Rahmen

- Android-only, React Native + Kotlin. Telefon-App und eigenständige Wear-OS-App
  mit gemeinsamer lokaler SQLite-Schicht.
- Ein Nutzer, kein Account, kein Server, keine Cloud, kostenloser Kern.
- Einheitenarten sind ein offenes Feld (`running`, `cycling`, `strength`);
  weitere müssen ohne Umbau der Datenschicht möglich sein.
- Laufauswertung und Tempoindex zählen nur Läufe; Kraftauswertung nur Sätze.
  Andere Sportarten zeigen dort nichts statt falscher Zahlen.
- Komplexere Modelle (persönliche Prognosen, physiologische Modelle) werden
  erst nach bestandener Validierung freigeschaltet. Bis dahin bleiben sie
  sichtbar deaktiviert oder liefern nur neutrale Beobachtungen.

## Nicht bauen

iOS · Cloud/Sync/Accounts · Social Features · Segment-Matching/Ghost-Run ·
Sensor-Plugin-System · Musik-Integration · ACWR-Empfehlungen · kostenpflichtige
Pflichtdienste · medizinische Diagnosen · universeller Ganzkörper-Readiness-
oder Verletzungsrisikoscore · vollautomatischer Planwechsel ohne Bestätigung ·
garantierte Empfehlung nach jedem Lauf · Gleichsetzung von Schätzung und Messung.
