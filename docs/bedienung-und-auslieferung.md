# Bedienung und spätere Auslieferung

> Ergänzung zur [Zielspezifikation](zielspezifikation.md). Anforderungen an eine spätere Umsetzung; derzeit werden ausschließlich Dokumente gepflegt.

## Eine klare Hauptansicht

Die Oberfläche verwendet ein ruhiges dunkles Grün und eine eindeutige Informationshierarchie. Hauptaufgabe, aktuelle Handlung und Aufzeichnungszustand sind sofort erkennbar. Diagramme, Sensordetails und Modellwerte bleiben in vertiefenden Ansichten.

**Fertig, wenn:**

- Start, Pause, Fortsetzen und Ende ohne Suche bedienbar sind.
- Nach dem Lauf die drei Informationsplätze aus V1-11 die Standardansicht bilden.
- Ein aktives Arbeitsthema gegenüber weiteren Auffälligkeiten eindeutig Vorrang hat.
- Große Schrift, ausreichende Kontraste und verständliche Beschriftungen funktionieren; Farbe allein keine Bedeutung trägt.
- Während des Laufens große Bedienelemente und wenige notwendige Interaktionen genügen.

## Funktionen nach Bedarf

Ein lokales Nutzerprofil kann Geräte, Ansichten, optionale Dienste und Hinweise einstellen. Daraus entstehen weder mehrere Accounts noch ein verpflichtender Einrichtungsdialog.

**Fertig, wenn:**

- Ohne Einrichtung ein einfacher Lauf aufgezeichnet und ausgewertet werden kann.
- Eine optionale Ersteinrichtung Ziel, Zeitbudget, Lauftage, Standardzweck, Historienimport und Berechtigungen an einem Ort sammelt, jederzeit ganz oder schrittweise überspringbar bleibt und später unter „Mehr → Einrichtung" erneut geöffnet werden kann.
- Sensoren, optionale Datenquellen, LLM-Formulierung und Live-Hinweise getrennt aktivierbar sind, soweit die jeweilige Produktstufe sie unterstützt.
- Standardmäßig eine sinnvolle, reduzierte Oberfläche erscheint; zusätzliche Kennzahlen gezielt eingeblendet werden können.
- „Ausgeschaltet“, „nicht unterstützt“, „Berechtigung fehlt“ und „Daten reichen nicht“ unterscheidbar sind.
- Deaktivierung einer Funktion weder vorhandene Daten ungefragt löscht noch die Aufzeichnung anderer Kanäle stoppt.
- Abhängigkeiten sichtbar erklärt werden: Ein deaktivierter HR-Sensor verhindert beispielsweise keine GPS-Auswertung, begrenzt aber HR-bezogene Aussagen.
- Geräte-, Speicher- und Datenschutzoptionen an einem nachvollziehbaren Ort liegen; komplexe Modellparameter keine Pflicht zur Bedienung werden.
- Presets aus V2-12 Einstellungen wiederverwenden können, ohne die globale Datenhaltung oder unveränderliche Prüfbedingungen zu überschreiben.

## Telefon und Uhr

Geplant sind eine React-Native-/Kotlin-App für Android-Telefone und eine eigenständige Wear-OS-App gemäß V2-1. Wear OS bleibt in der V2-Produktstufe; diese Ergänzung behauptet keine vorgezogene Fertigstellung.

**Fertig, wenn:**

- Ein Telefonlauf ohne Uhr und ein autonomer Uhrenlauf ohne Telefon möglich sind.
- Sensor-Bridge und autonome Aufzeichnung klar unterscheidbar sind.
- Übertragung unterbrochen und wiederholt werden kann, ohne einen Lauf als mehrere unabhängige Belege zu zählen.
- Auf der Uhr erkennbar ist, ob ein Lauf nur dort gespeichert oder bereits vollständig ans Telefon übertragen wurde.
- Daten auf der Uhr erst nach bestätigter dauerhafter Übernahme und gemäß einer sichtbaren Aufbewahrungsregel entfernt werden dürfen.

## Spätere Test-APKs über GitHub

Für die spätere Implementierung sind automatische, mit Debug-Schlüsseln signierte Test-Releases vorgesehen. **Dieses Dokument richtet keinen Workflow ein und erstellt keine APKs.**

**Fertig, wenn:**

- Ein erfolgreicher Build des Hauptbranches beziehungsweise eines vorgesehenen Versions-Tags ein GitHub-Test-Release mit einer Telefon-APK und einer Wear-OS-APK bereitstellt.
- Fehlgeschlagene Prüfungen die Veröffentlichung verhindern; jeder Download eindeutig einem Commit und einer Version zugeordnet ist.
- Beide APKs ohne Entwicklungsserver direkt startbar sind.
- Telefon und Uhr eine für ihre Kommunikation passende, dokumentierte App-Identität und Signatur verwenden.
- Ein gleichbleibender Testschlüssel Updates bestehender Testinstallationen ermöglicht; sein öffentlicher Testcharakter dokumentiert ist.
- Installationsanleitung, Prüfsummen, bekannte Grenzen und tatsächlich durchgeführte Tests beim Release verlinkt sind.
- Ein neuer Build keine vollständige V1-/V2-Abnahme suggeriert. Fertigstellung richtet sich weiterhin nach der Spec.
- Die spätere Nutzung von GitHub CI innerhalb verfügbarer kostenloser Kontingente bleibt; kostenpflichtige Nutzung nicht automatisch aktiviert wird.

## Vor Umsetzung zu entscheiden

Referenzgeräte und unterstützte Android-/Wear-OS-Versionen, Speicherstandardbudget, konkrete Datenanbieter, Effort-Modell und freigegebene Handlungsklassen bleiben festzulegen. Die Entscheidung wird jeweils vor der zugehörigen Abnahme dokumentiert; sie wird nicht durch einen UI-Platzhalter ersetzt. Vorläufige Kartenwahl (keine Abnahme): grobe CARTO-Kacheln ohne Beschriftungen auf OSM-Daten, mit Quellenangabe in der App und Darstellung ohne Hintergrundkarte bei fehlendem Netz.
