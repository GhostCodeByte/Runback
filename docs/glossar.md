# Runback-Glossar

Das Glossar ist eine kleine Übersetzungstabelle, kein Wörterbuch. Links steht
das Wort, das Menschen lesen. In der Mitte steht der interne Codename, der in
Code, Datenbank oder Modell vorkommen darf. Rechts steht, wozu das Ding dient.
Nur Begriffe, die in der Spezifikation oder im Produkt tatsächlich gebraucht
werden, gehören hierher.

| Alltagswort | Codename | Wozu dient es? |
| --- | --- | --- |
| Ziel | `goal` | Ein freiwilliges Vorhaben mit Datum, an dem Aufbau und Tapering ausgerichtet werden können. |
| Zieldatum | `target_date` | Der Kalendertag, an dem ein Ziel endet. Ohne Zieldatum gibt es keine Phasenrechnung. |
| Fokus-Art | `focus_type` | Eine kurze, versionierte Auswahl, mit der Runback Empfehlungen priorisiert. |
| Eigene Bezeichnung | `focus_label` | Freier Text des Nutzers, der im UI erscheint, aber nicht ausgewertet wird. |
| Fokus | `active_focus` | Das dauerhafte allgemeine Thema, an dem gerade gearbeitet wird; höchstens einer ist aktiv. |
| Empfehlung | `recommendation` | Eine konkrete Sache, die jetzt ausprobiert oder bewusst beibehalten werden kann. Höchstens eine wird gleichzeitig geprüft. |
| Vorschlag | `proposed` | Eine Empfehlung, die Runback zeigt, aber der Nutzer noch nicht angenommen hat. |
| Angenommen | `accepted` | Eine Empfehlung, deren Bedingungen der Nutzer festgeschrieben hat. |
| Aktiv / pausiert / abgeschlossen / abgebrochen | `active` / `paused` / `completed` / `aborted` | Sichtbare Zustände einer angenommenen Empfehlung. Sie sagen, wo sie im Ablauf steht. |
| Vergleichsläufe | `baseline_runs` | Frühere passende Läufe, mit denen spätere Läufe verglichen werden. |
| Woran erkennen wir, dass es geholfen hat? | `evaluation_criterion` | Die vorab festgelegte Regel, an der das Ergebnis einer Empfehlung geprüft wird. |
| Umsetzung | `adherence` | Ob und wie eine Empfehlung tatsächlich befolgt wurde. |
| Ergebnis | `outcome` | Was sich in passenden Folgeläufen beobachtet hat, unabhängig von der Ursache. |
| Ursache | `causal_effect` | Die vorsichtige Frage, ob die Empfehlung das Ergebnis verursacht hat. Bei einem Nutzer bleibt das meist offen. |
| Noch nicht klar | `inconclusive` | Ehrliches Urteil, wenn Daten weder für Hilfe noch für das Gegenteil reichen. |
| Datenqualität | `data_quality` | Wie vollständig und passend die Daten für genau diese Aussage sind. |
| Effort | `effort` | Modellierte äußere Anforderung. Kein Messwert für Fitness, Gesundheit oder Ermüdung. |
| Relevanzmatrix | `relevance_matrix` | Versionierte Tabelle mit festen Gewichten je Fokus-Art und Handlungsklasse. |
| Grundregel | `invariant` | Eine Regel, die für alle betroffenen Funktionen gilt und nicht gegen eine UI-Abkürzung getauscht werden darf. |

## Die drei Ebenen in einem Satz

Ein **Ziel** kann einen **Fokus** nahelegen; der Fokus hilft, eine **Empfehlung**
auszuwählen. Nur die Empfehlung wird auf Umsetzung, Ergebnis und mögliche
Ursache geprüft.

## Beispiel

„Starte die ersten 2 km rund 20 s/km langsamer“ ist die Empfehlung. Geeignete
frühere Läufe sind die Vergleichsläufe. „Woran erkennen wir, dass es geholfen
hat?“ steht vor dem Start fest. Wenn die Daten danach kein klares Urteil
erlauben, heißt das „Noch nicht klar“.

## Feststehende Fachwörter

**Effort** bleibt bewusst als Fachwort erhalten. Es bezeichnet nur die
modellierte äußere Anforderung. Intensität, Gesamtbelastung und subjektive
Anstrengung (RPE) sind davon getrennt. Die Skala, ihre Referenz und ihre
Unsicherheit müssen vor der ersten Ausspielung dokumentiert sein.

