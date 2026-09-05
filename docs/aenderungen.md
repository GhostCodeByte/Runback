# Änderungen gegenüber dem ersten Entwurf

Die Struktur mit Rahmen, Invarianten, V1, V2, Ausschlüssen und Definition of Done bleibt erhalten. Bestehende V1-1 bis V1-15 und V2-1 bis V2-13 behalten ihre IDs.

## Ausdrücklich geklärte Produktentscheidungen

- Rohdaten möglichst erhalten, umfangreiche Zusatzdaten mit sichtbaren Speichergrenzen; keine unmögliche Neuberechnung gelöschter Quellen versprechen.
- Genaue Koordinaten für Wetter, Karten und Höhenmodell zulassen. Das LLM erhält standardmäßig keine Koordinaten, weil es sie nicht benötigt.
- Local First bedeutet lokale Laufdatenbank, Offline-Aufzeichnung und einfache Offline-Analyse. Internet für Anreicherung ist erlaubt.
- Feedback nur ausspielen, wenn die vorhandenen Daten es tragen.
- Empfehlungen beständig halten und nicht nach jedem Lauf automatisch ändern.
- Messdaten und neutrale Beobachtungen dürfen ohne eigene Handlung oder Prüfbedingung erscheinen.

## Ergänzungen aus der fachlichen Überarbeitung

- Laufzweck und übergeordnetes Ziel steuern die Bewertung.
- Effort, Intensität, Gesamtbelastung und RPE erhalten getrennte Bedeutungen.
- Umsetzung, beobachteter Effekt und ursächliche Wirkung werden getrennt bewertet.
- Nutzer können Vorschläge annehmen, verschieben, ablehnen und Versuche beenden.
- Prüfbedingungen stehen vor Beginn fest; Modellupdates schreiben frühere Entscheidungen nicht heimlich um.
- „Drei Läufe“ ist eine mögliche Zwischenprüfung, keine allgemeine Beweisgrenze.
- Datenqualität gilt pro Sensor, Abschnitt und Aussage. Duplikaterkennung gehört bereits zu V1.
- Health-Connect-Routen, Freigaben und konkrete getestete Gerätekette sind Bestandteil der Abnahme.
- Prozessabsturz und ausdrückliches Android-Stoppen sind getrennte Aufzeichnungsfälle.
- Vollständiges Backup umfasst Wiederherstellung; FIT/GPX bleiben begrenzte Austauschformate.
- Die LLM-Prüfung erfasst auch Ursache, Sicherheit und Handlung, nicht nur Zahlen.
- Neue V1-Ziele 16–20 schließen Trainingszweck, nächsten Lauf, Rückfragen, wenige geprüfte Handlungsklassen und Validierung ein.
- V2-Modelle werden nur bei geeigneten Daten und erfolgreicher Validierung freigeschaltet.

## Noch durch die Umsetzung zu konkretisieren

Vor Freischaltung beziehungsweise Abnahme zu dokumentieren:

- Effort-Skala, Referenzbedingungen, Faktoren, Einsatzbereich und Unsicherheitsverfahren.
- Fachlich geprüfte Handlungsklassen und jeweils vorab definierte Prüfregeln.
- Speicherstandardbudget und genaue Aufbewahrungsregeln.
- Referenzgerät, unterstützte Android-Versionen sowie Akku-, Speicher- und Bedienleistungsgrenzen.
- Kostenfrei nutzbare Wetter-, Karten- und Höhendatenquellen mit passenden Nutzungsbedingungen.
- Backup-Schema und nachvollziehbare Versions-/Migrationsregeln.

Diese Konkretisierung darf die Ziele und Invarianten der [Zielspezifikation](zielspezifikation.md) nicht abschwächen.


## Aktueller Arbeitsumfang

Auf Wunsch wird vorerst ausschließlich die Dokumentation erstellt. App-Implementierung, CI-Workflows und APK-Erstellung sind nicht Teil dieses Repository-Stands. Anforderungen an flexible Einstellungen, die Telefon-/Uhr-Bedienung und spätere Test-Releases stehen in [Bedienung und spätere Auslieferung](bedienung-und-auslieferung.md).

Das bereitgestellte GitHub-Repository ist mit ausdrücklicher Zustimmung öffentlich. Die frühere Vorgabe eines privaten Entwicklungsrepositories ist damit aufgehoben; die Lizenzwahl bleibt gesondert festzulegen.
