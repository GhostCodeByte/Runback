# Design Language

Gestaltungsregeln für alle Runback-Oberflächen. Token (`color`, `space`,
`radius`, `type`) und Bausteine (`Button`, `Card`, `Section`, `Row`,
`ChipGroup`, `Stat`, `Field`, `Notice`, `EmptyState`) leben ausschließlich in
`src/ui/components.tsx`. Kein Bildschirm erfindet eigene Farben, Größen oder
Varianten — wer etwas Neues braucht, ergänzt es dort.

## Prinzipien

1. **Eine Aussage je Fläche.** Zwei Aussagen sind zwei Flächen.
2. **Ein Satz für die Handlung**, im Imperativ. Eine Zahl erscheint nur, wenn
   sie eine Entscheidung verändert.
3. **Ehrliche Affordanzen.** Ein Element sieht so aus, wie es sich verhält.
4. **Inhalt trägt, nicht Dekoration.** Keine Schatten, Verläufe, Zierlinien.
5. **Kein Text ohne Konsequenz.** Was die nächste Entscheidung nicht ändert,
   wird gelöscht.

## Farbe und Typografie

- Dunkle Oberfläche, helle Schrift, **ein** grüner Akzent. Pro Bildschirm
  höchstens eine vollflächig grüne Fläche: die primäre Aktion.
- Genau zwei Textstufen (`text`, `muted`). Wer eine dritte braucht, hat zu viel
  Text.
- `danger` färbt nur Text und Rahmen, nie eine Fläche.
- Farbe ist nie die einzige Information (zusätzlich Rahmen, Häkchen,
  `accessibilityState`).
- Systemschrift. Genau ein `title` je Bildschirm. Fließtext nie kleiner als
  `label`, höchstens zwei Zeilen je Absatz. Live- und Tabellenziffern mit
  `tabular-nums`.
- Mindestens 48 dp Berührungsfläche, 54 dp für die primäre Aktion.

## Seitengerüst

1. **Kopf** — Marke oder „‹ Zurück“, rechts der Status.
2. **Titel** — einer. Kein Datum, keine Begrüßung, kein Untertitel.
3. **Empfehlung** — die eine Sache, die der Nutzer hier tun kann.
4. **Kontext** — Werte und Listen, die sie stützen.
5. **Nebenwege** — Verwaltung, Details, Löschen; unten, sekundär.

Höchstens eine primäre Aktion je Bildschirm. Drei sekundäre Buttons
untereinander sind eine Liste (`Row`).

## Text

- Ein Satz je Aussage, höchstens zwei je Fläche. Duzen, deutsche
  Anführungszeichen, ` — ` als Gedankenstrich, ` · ` als Trenner.
- Aktionen beginnen mit dem Verb: „Lauf starten“, „Fokus speichern“.
- Drei Tiefen: der Satz → zwei Zeilen warum → unter „Details“ Datenbasis,
  Modellversion, Unsicherheit.
- Unsicherheit in Worten („ziemlich sicher“, „eher ein Eindruck“, „noch nicht
  klar“), Intervalle nur unter „Details“.
- Zustände als sichtbare Labels: Vorschlag · Angenommen · Aktiv · Pausiert ·
  Abgeschlossen · Abgebrochen. Der Fokus hat kein Label, weil er nicht bewertet
  wird.
- Urteile in Alltagssprache: „Noch nicht klar“, „Zu wenig vergleichbare
  Läufe“, „Du hast es bisher nicht probiert“.
- Prüfsatz für jeden Text: **Würde ein Laufkumpel das so sagen?** „Dein Puls
  ist im letzten Drittel um 8 Schläge hochgegangen, obwohl du gleich schnell
  warst“ — ja. „HR-Drift 8 bpm bei stabiler GAP“ — nein.
- Keine Meta-Erklärung der App über sich selbst. Vorbehalte gehören auf die
  Detail-/Einstellungsseite.
- Kein Label, das den Objekttyp erklärt. „Dein Fokus“ plus der Satz reicht.
- Anleitungen erst nach der Wahl zeigen (erst Quelle wählen, dann Schritte),
  nie alle Varianten gleichzeitig.

## Affordanzen

| Symbol | Bedeutung |
|---|---|
| `›` | öffnet eine neue Ansicht (nur wenn die Zeile navigiert) |
| `⌄` | klappt Inhalt an Ort und Stelle auf |
| `‹ Zurück` | eine Ebene zurück, im Kopf links |
| `✓` | ausgewählt |

Eine Auswahl, die einen Dialog öffnet, trägt kein `⌄`. Was wie Text aussieht,
ist nicht antippbar. Nichtinteraktive Werte haben keinen Rahmen und keine
Kartenfläche.

## Zustände

Jede datengetriebene Ansicht deckt ab: **Laden**, **Leer** (`EmptyState`:
Titel, ein Satz, eine Aktion), **Fehler** (`Notice` mit dem Weg weiter, keine
Stacktraces), **Beschäftigt** (auslösendes Element `disabled`, Layout springt
nicht).

## Zahlen

Deutsches Format. km mit zwei Nachkommastellen, Tempo `m:ss /km` (Rad: `km/h`),
Dauer `m:ss` bzw. `h:mm:ss`, Puls ganzzahlig `bpm`. Einheit als `muted` neben
dem Wert. Nicht bestimmbar: `–`, nie `0` oder `NaN`.

Lauftitel kommen nur aus `runTitle()`, sportartabhängige Wörter nur aus
`sportWords()`. Dateinamen und technische IDs sind keine Titel.

## Barrierefreiheit

`accessibilityRole` auf jedem bedienbaren Element, `accessibilityState` für
Auswahl und Schalter, `accessibilityLiveRegion="polite"` für Meldungen,
Kontrast ≥ 4,5:1, keine feste Texthöhe vorausgesetzt.

## Prüfliste

- [ ] Nur Token und Bausteine aus `components.tsx`.
- [ ] Ein Titel, eine primäre Aktion.
- [ ] Kein Satz ohne Konsequenz; Hauptebene ist ein Imperativ.
- [ ] Jedes Symbol hält, was es verspricht.
- [ ] Lade-, Leer-, Fehler-, Beschäftigt-Zustand vorhanden.
- [ ] ≥ 48 dp, Rolle und Zustand gesetzt.
- [ ] Deutsches Zahlenformat, `–` als Leerwert.
