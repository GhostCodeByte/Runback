# Wochenplanung und Entwicklung

Runback behandelt Planung und Training als zwei verbundene, aber getrennte
Datenquellen. Der Kalender beschreibt eine Absicht. Die Entwicklung liest
abgeschlossene Lauf- und Kraftdaten. Ein geplanter Termin wird dadurch nicht
automatisch zu einer absolvierten Einheit.

## Kalenderdaten

Die optionale Kalenderstruktur wird in `Settings.schedule` als `ScheduleState`
gespeichert und lokal versioniert (`schedule-v1`). Sie enthält:

- `sessions`: geplante oder übersprungene Einheiten mit lokalem Datum, Dauer,
  Zweck, Trainingsart, Belastung und optionalem `activityId`;
- `availability`: verfügbares Zeitbudget je lokalem Datum;
- `routine`: üblicher Rhythmus und Minutenbudget;
- `goal`: das ausdrücklich gespeicherte Ziel mit `name`, `startDate` und den
  optionalen Feldern `targetDate` und `phase`.

`activityId` verknüpft einen Termin mit einer Aufzeichnung. Es ist kein
Abschlussflag. Ein Lauf gilt erst durch seinen eigenen abgeschlossenen Datensatz
als absolviert; eine Krafteinheit gilt erst mit Status `finished` und gültiger
Endzeit als abgeschlossen. Übersprungene Termine bleiben sichtbar und werden
nicht stillschweigend nachgeholt.

Datumswerte sind `YYYY-MM-DD`-Schlüssel der lokalen Gerätezeitzone. Woche,
Monat und Verschiebungen arbeiten mit lokalen Kalendertagen, damit
Sommer- und Winterzeit keinen Termin um einen Tag verschiebt. Der Zustand wird
normalisiert: ungültige Datumswerte und doppelte IDs werden verworfen, bevor er
gespeichert oder angezeigt wird.

## Wochen- und Monatsansicht

Die Planungsansicht zeigt Woche und Monat aus demselben Zustand. Eine neue
Woche kann aus der Routine vorgeschlagen werden. Der Vorschlag ist zunächst
eine Vorschau; erst die ausdrückliche Anwendung schreibt die Einheiten. Dabei
werden verfügbare Minuten, bereits belegte Tage und übersprungene Ausnahmen
berücksichtigt.

Eine Verschiebung erzeugt zuerst eine Prüfung. Vergangene Termine, feste
Einheiten, belegte Zieltage, zu kurze Zeitbudgets und benachbarte harte
Einheiten werden als Konflikte benannt. Mögliche Ausweichtermine sind nur
Vorschläge. Sie ändern den Kalender erst nach der bewussten Auswahl. Ein
Verschieben ersetzt keine tatsächliche Lauf- oder Kraftaufzeichnung.

Starten ist nur für eine geplante Einheit am heutigen lokalen Datum möglich.
Vor dem Start prüft die App laufende Einheiten und die für einen Lauf nötige
Standortfreigabe. Nach einem erfolgreichen Start wird die Verbindung zur
Aufzeichnung gespeichert; der Termin bleibt als Planungseintrag bestehen.

## Entwicklung und Nachweis

Die Entwicklung zeigt drei Aussagen getrennt:

1. **Ziel:** der gespeicherte Freitext und, wenn er eine eindeutige Strecke wie
   `10 km` enthält, die längste beobachtete abgeschlossene Strecke;
2. **Im Trainingsplan:** genau die gespeicherten Zielangaben und der optionale
   Schwerpunkt sowie die Kalenderwoche seit Planbeginn, bei Zieldatum mit
   Gesamtwochenzahl. Vor dem Beginn und nach dem Ende wird der Zeitraum als
   bevorstehend beziehungsweise beendet beschrieben; das belegt keine
   Zielerreichung. Eine Trainingsphase wird nicht vorhergesagt;
3. **Tatsächliches Training:** abgeschlossene Einheiten in den letzten 28
   lokalen Kalendertagen im Vergleich zu den 28 Tagen davor.

Die beiden Zeitfenster zählen einen lokalen Trainingstag höchstens einmal,
auch wenn an diesem Tag Lauf und Krafttraining stattfanden. Laufdaten werden
nach ihrer stabilen ID beziehungsweise `canonicalId` dedupliziert. In die
Berechnung gelangen nur Datensätze mit gültigen Zeiten und nichtnegativer
Distanz beziehungsweise Dauer, deren Ende nicht in der Zukunft liegt.

Bei Krafttraining werden nur bestätigte Satzwerte gezählt. Vorgaben aus dem
Plan werden nicht als Ist-Werte ausgegeben. Volumen wird nur aus tatsächlich
aufgezeichneter Last und Wiederholungen berechnet; Körpergewicht ohne bekannte
externe Last bleibt deshalb als Volumen unbekannt.

Die Anzeige stellt keinen Fitness-, Bereitschafts- oder Erfüllungsprozentsatz
her. Ein Zielabgleich mit Freitext bleibt ein beobachteter Trainingshinweis und
ist keine Prognose. Fehlen abgeschlossene Einheiten oder die gespeicherte
Planposition, benennt die Entwicklung diese Grenze ausdrücklich.

Die Übersicht lädt höchstens 1.000 Läufe und 500 Kraft-Einheiten. Wenn diese
Grenze erreicht ist, weist die Oberfläche darauf hin, dass Summen und längste
Einheit nur den geladenen Ausschnitt beschreiben. Ein Fehler beim Laden der
Kraft-Historie wird ebenfalls als nicht verfügbare Datenquelle angezeigt und
nicht als leere, vollständige Historie ausgegeben.

## Persistenz und Grenzen

Planänderungen werden nach einer erfolgreichen Speicherung aus dem lokalen
Settings-Dokument wieder eingelesen. Ein fehlgeschlagener Schreibvorgang lässt
den vorherigen Kalender unverändert und hält den Entwurf für einen neuen
Versuch offen. Die eigentlichen Trainingsdaten bleiben in Lauf- und
Kraft-Historie; Backups bewahren beide Datenbereiche gemeinsam auf.

Die Entwicklung ist damit ein nachvollziehbarer Faktenüberblick. Sie zeigt, was
im geladenen Bestand beobachtet wurde, und lässt unbekannte oder nicht geladene
Werte offen.
