# Design Language

Verbindliche Gestaltungsregeln für alle Runback-Oberflächen (Telefon, später Wear OS).
Wer eine neue Ansicht baut, liest dieses Dokument und benutzt ausschließlich die hier
definierten Token und Bausteine aus [`src/ui/components.tsx`](../src/ui/components.tsx).
Neue Farben, Schriftgrößen oder Abstände werden nicht im Bildschirm erfunden, sondern
hier ergänzt.

Ziel: Eine neue Seite sieht sofort richtig aus, weil sie nichts selbst entscheiden muss.

## 1. Prinzipien

1. **Eine Aussage je Fläche.** Jede Karte, jeder Abschnitt beantwortet genau eine Frage.
   Zwei Aussagen sind zwei Flächen.
2. **Zahlen statt Sätze.** Was messbar ist, wird als Wert mit Einheit gezeigt, nicht
   umschrieben. Erklärtext ist die teuerste Form von Information.
3. **Ehrliche Affordanzen.** Ein Bedienelement sieht genau so aus, wie es sich verhält
   (§ 8). Kein Symbol verspricht etwas, das nicht passiert.
4. **Der Inhalt trägt, nicht die Dekoration.** Keine Schatten, keine Verläufe, keine
   Zierlinien. Struktur entsteht durch Fläche, Abstand und eine Trennlinie.
5. **Kein Text ohne Konsequenz.** Wenn ein Satz die nächste Handlung des Nutzers nicht
   ändert, wird er gelöscht.

## 2. Farbe

Einzige Quelle: `color` aus `src/ui/components.tsx`. Dunkle Oberfläche, helle Schrift,
ein grüner Akzent.

| Token | Wert | Verwendung |
| --- | --- | --- |
| `bg` | `#101210` | Seitenhintergrund, Tab-Leiste |
| `surface` | `#1A1D1A` | Karten, Eingabefelder, Modale |
| `raised` | `#242924` | Fläche auf `surface` (eigene Chat-Blase, Hinweis) |
| `line` | `#343B34` | Trennlinien, Rahmen im Ruhezustand |
| `text` | `#F2F4EF` | Primärtext, Werte |
| `muted` | `#ADB5AB` | Sekundärtext, Einheiten, inaktive Symbole |
| `green` | `#A5D879` | Akzent: primäre Aktion, Auswahl, aktiver Tab |
| `greenSoft` | `#26331E` | Fläche einer grünen Auswahl ohne Vollton |
| `ink` | `#14200E` | Schrift auf `green` |
| `danger` | `#E4796B` | ausschließlich Text/Rahmen zerstörender Aktionen |

Regeln:

- **Es gibt genau zwei Textstufen:** `text` und `muted`. Eine dritte, dunklere Stufe
  wird nicht eingeführt — wer sie bräuchte, hat zu viel Text auf der Seite.
- **Grün ist ein Akzent, kein Flächenmaterial.** Pro Bildschirm höchstens eine
  vollflächig grüne Fläche (die primäre Aktion). Auswahlzustände in Listen und
  Chip-Gruppen benutzen `greenSoft` mit grünem Rahmen und `text`-Schrift.
- **Farbe ist nie die einzige Information.** Ein ausgewählter Zustand hat zusätzlich
  Rahmen, Häkchen oder `accessibilityState`.
- **`danger` färbt nie eine Fläche.** Zerstörende Aktionen sind sekundäre Buttons mit
  `danger`-Beschriftung; die Rückfrage übernimmt `Alert`.

## 3. Typografie

Systemschrift, keine eigenen Fonts. Skala aus `type`:

| Token | Größe / Zeilenhöhe | Gewicht | Verwendung |
| --- | --- | --- | --- |
| `display` | 56 / 60 | 400 | Einziger Livewert der Aufzeichnung |
| `title` | 28 / 34 | 600 | Seitentitel, genau einer je Bildschirm |
| `heading` | 20 / 26 | 600 | Abschnittstitel (`Section`) |
| `value` | 26 / 30 | 500 | Kennzahlen (`Stat`), tabellarische Ziffern |
| `body` | 16 / 24 | 400 | Fließtext, Zeilentitel, Eingaben |
| `label` | 14 / 20 | 500 | Feldbeschriftungen, Zeilenuntertitel |
| `micro` | 12 / 16 | 500 | Tab-Beschriftung, Zeitstempel, Zähler |

- Alle Ziffernfelder, die sich live ändern oder untereinander stehen, setzen
  `fontVariant: ['tabular-nums']`.
- Fließtext ist nie kleiner als `label`. Wer `micro` für Erklärungen benutzt, hat zu
  viel Erklärung.
- Ein Absatz Fließtext hat höchstens **zwei Zeilen**. Was länger ist, wird zu Werten,
  einer Liste oder gelöscht.

## 4. Raum

Abstände kommen aus `space` (4, 8, 12, 16, 20, 24, 32, 40). Andere Werte gibt es nicht.

- Seitenrand: `space.lg` (24) horizontal.
- Abstand zwischen Elementen eines Abschnitts: `space.sm` (12).
- Abstand zwischen Abschnitten: `space.xl` (32).
- Karteninnenraum: `space.md` (16) bis `space.lg` (24).
- Radien aus `radius`: `sm` 8 (Eingaben, kleine Flächen), `md` 12 (Buttons, Karten),
  `lg` 16 (Modal, Chat-Blase), `pill` 999 (Chips).
- Mindestens **48 dp** Berührungsfläche für jedes bedienbare Element, 54 dp für die
  primäre Aktion. Kleiner wird nichts, auch nicht ein Textlink.

## 5. Bausteine

Alles Folgende existiert in `src/ui/components.tsx`. Kein Bildschirm definiert eigene
Varianten davon.

- **`Button`** — `primary` (grün, gefüllt), `secondary` (Fläche `surface`, Rahmen
  `line`), `danger` (sekundär mit `danger`-Text), Größe `small` für Nebenwege.
  **Höchstens eine primäre Aktion je Bildschirm.** Drei sekundäre Buttons untereinander
  sind ein Zeichen für eine falsche Informationsarchitektur — dann wird eine Liste
  (`Row`) daraus.
- **`Card`** — `surface`, `radius.md`, Innenraum `space.lg`. Trägt eine Aussage und
  optional die dazugehörige Aktion.
- **`Section`** — Titel (`heading`) plus Inhalt. Der Titel benennt den Inhalt, er
  erklärt ihn nicht.
- **`Row`** — Listenzeile: Titel, optionaler Untertitel, optionales `trailing`.
  Navigierende Zeilen bekommen `›` **automatisch** — nur wenn `onPress` gesetzt ist.
- **`ChipGroup`** — waagerechte Einfachauswahl direkt auf der Seite. Ersetzt jeden
  Dialog, dessen Optionen in eine Zeile passen.
- **`Stat`** — Wert plus Einheitenlabel. Werte stehen nie in Fließtext.
- **`Field`** — Beschriftung plus `TextInput` in `surface` mit `line`-Rahmen.
- **`Notice`** — Fehler- oder Erfolgsmeldung, `raised` mit grünem Balken links,
  antippbar zum Schließen, `accessibilityLiveRegion="polite"`.
- **`EmptyState`** — Titel, ein Satz, genau eine Aktion. Leere Zustände erklären nicht
  die App, sondern bieten den nächsten Schritt an.

## 6. Seitengerüst

Jeder Bildschirm folgt derselben Reihenfolge:

1. **Kopf** — Marke (Startseite) oder „Zurück“, rechts der Status (`Aufzeichnung aktiv`,
   Ladeanzeige).
2. **Titel** — genau ein `title` je Bildschirm. Kein Datum, keine Begrüßung, kein
   Untertitel, der den Titel wiederholt.
3. **Handlung** — die eine Sache, die der Nutzer hier tun kann, so weit oben wie möglich.
4. **Kontext** — Werte und Listen, die diese Handlung stützen.
5. **Nebenwege** — Verwaltung, Details, Löschen; unten, sekundär, gern hinter
   „Details ansehen“.

Verboten im Kopfbereich: aktuelles Datum, Uhrzeit, Begrüßungsformeln, Zustandsprosa
(„Starte einfach …“). Das Gerät zeigt Datum und Uhrzeit bereits an.

## 7. Textregeln

- **Ein Satz je Aussage. Höchstens zwei Sätze je Fläche.**
- Kein Satz beschreibt, was der Nutzer ohnehin sieht. Statt „Zeit und Distanz sind für
  eine einfache Tempoauswertung nutzbar“ steht dort das Tempo.
- Keine Meta-Erklärung der App über sich selbst („Runback passt sich deinem Lauf an“).
- Fachliche Vorbehalte (Modellgrenzen, Unsicherheiten, Datenschutzhinweise) gehören in
  die zugehörige Detail- oder Einstellungsseite, nicht auf die Startseite. Sie
  verschwinden nicht, sie stehen nur dort, wo sie gebraucht werden.
- Aktionen beginnen mit dem Verb: „Lauf starten“, „Backup exportieren“,
  „Fokus festlegen“.
- Anleitungen werden erst gezeigt, **nachdem** der Nutzer gewählt hat, worum es geht
  (§ 9). Nie alle Varianten gleichzeitig.
- Duzen, deutsche Anführungszeichen („…“), Halbgeviertstrich mit Leerzeichen als
  Gedankenstrich (` — `), Mittelpunkt als Trennzeichen in Werteketten (` · `).

## 8. Affordanzen

Ein Symbol ist ein Versprechen. Es gibt genau diese:

| Symbol | Bedeutung | Erlaubt wenn |
| --- | --- | --- |
| `›` | öffnet eine neue Ansicht | die Zeile navigiert |
| `⌄` an einer Karte | klappt Inhalt **an Ort und Stelle** auf/zu | der Inhalt wirklich in dieser Karte erscheint |
| `‹ Zurück` | eine Ebene zurück | im Kopf, links |
| `✓` | ausgewählt | in Auswahllisten |

Daraus folgt:

- Eine Auswahl, die einen Dialog öffnet, trägt **kein** `⌄`. Entweder sie wird zur
  `ChipGroup` auf der Seite, oder sie wird zur `Row` mit `›`.
- Was wie ein Button aussieht, ist ein Button. Was wie Text aussieht, ist nicht
  antippbar.
- Nichtinteraktive Werte bekommen keinen Rahmen, keine Kartenfläche und keinen
  Druckzustand.

## 9. Fortschritt statt Wand

Seiten mit mehreren möglichen Wegen (App-Importe, Einrichtung) zeigen **erst die Wahl,
dann die Schritte**:

1. Der Nutzer wählt die Quelle bzw. das Ziel.
2. Erst danach erscheinen die Schritte, Dateimuster und Besonderheiten **genau dieser**
   Wahl (etwa das ZIP-Passwort, das nur Mi Fitness verschickt).
3. Alles Übrige bleibt eingeklappt.

Eine Seite zeigt nie die Anleitung für zehn Anbieter gleichzeitig.

## 10. Zustände

Jede datengetriebene Ansicht deckt vier Zustände ab:

- **Laden** — `ActivityIndicator` in `green` plus eine Zeile `muted`.
- **Leer** — `EmptyState`: Titel, ein Satz, eine Aktion.
- **Fehler** — `Notice` mit dem, was nicht ging, und dem Weg weiter. Keine Stacktraces,
  keine Schuldzuweisung.
- **Beschäftigt** — auslösendes Element `disabled`, Statusanzeige im Kopf. Die
  Oberfläche springt dabei nicht um.

## 11. Barrierefreiheit

- Jedes bedienbare Element hat `accessibilityRole` und, wenn die Beschriftung allein
  nicht reicht, `accessibilityLabel`.
- Auswahl- und Schaltzustände über `accessibilityState` (`selected`, `checked`,
  `disabled`, `expanded`).
- Meldungen als `accessibilityLiveRegion="polite"` bzw. `accessibilityRole="alert"`.
- Kontrast mindestens 4,5:1 für Text; die Token in § 2 erfüllen das auf ihrer
  vorgesehenen Fläche.
- Kein Bildschirm setzt eine feste Texthöhe voraus; Werte in `Stat` skalieren mit
  `adjustsFontSizeToFit`.

## 12. Zahlen und Einheiten

- Deutsches Format: Dezimalkomma, Tausenderpunkt.
- Distanz in km mit zwei Nachkommastellen, Tempo als `m:ss /km`, Dauer als `m:ss` bzw.
  `h:mm:ss`, Herzfrequenz als ganzzahlige `bpm`.
- Die Einheit steht als `muted` neben dem Wert, nie im Wert selbst.
- Nicht bestimmbare Werte: `–` (Halbgeviertstrich), niemals `0` oder `NaN`.

## 13. Benennung von Läufen

Ein Lauf trägt nie einen Dateinamen als Titel. `runTitle()` aus
[`src/domain/runTitle.ts`](../src/domain/runTitle.ts) ist die einzige Quelle für
Lauftitel in der Oberfläche:

1. ein sprechender Name aus der Quelle („Morning Run“, „Intervalle Bahn“),
2. sonst der Trainingszweck, wenn er gesetzt ist,
3. sonst die Tageszeit des Starts je Sportart („Morgenlauf“, „Abendfahrt“).

Die Sportart wechselt außerdem die Wörter der Oberfläche (`sportWords()` in
[`src/domain/sport.ts`](../src/domain/sport.ts)): „Lauf“/„Radfahrt“, „Laufzeit“/
„Fahrzeit“, `min/km`/`km/h`. Kein Bildschirm schreibt diese Wörter selbst.

Technische Namen (`activity_12345678`, GUIDs, `2024-05-01T07-00-00`) gelten als nicht
sprechend und werden verworfen.

## 14. Prüfliste vor dem Merge

- [ ] Nur Token aus `color`, `space`, `radius`, `type` verwendet.
- [ ] Genau ein `title`, genau eine primäre Aktion.
- [ ] Kein Satz, der die nächste Handlung nicht ändert.
- [ ] Jedes Symbol hält, was § 8 verspricht.
- [ ] Leer-, Lade-, Fehler- und Beschäftigt-Zustand vorhanden.
- [ ] Berührungsflächen ≥ 48 dp, `accessibilityRole` und `-State` gesetzt.
- [ ] Werte im deutschen Format mit `–` als Leerwert.
