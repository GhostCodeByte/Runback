# Runback – Muskel- und Belastungsmodell

> Rechnerische Grundlage zu [T-7, T-8, T-11 und T-12 der Trainings-Zielspezifikation](zielspezifikation-training.md).
> Dieses Dokument legt Skala, Rechenvorschrift, Parameter und Prüfverfahren fest. Es ist **versioniert**; jede Ableitung trägt die Version, mit der sie entstanden ist.
> Modellversion dieses Dokuments: `muscle-model-v1` (Entwurf, noch nicht freigegeben).
> Alle Zahlenwerte hier sind **Ausgangsannahmen**, keine gemessenen Konstanten. Sie sind ausdrücklich als solche gekennzeichnet und werden durch die Prüfung in §11 bestätigt oder verworfen.

---

## 1. Was das Modell ist und was nicht

Das Modell ist eine **Buchhaltung mit Zeitverhalten**: Es zählt, welche Belastung wann auf welche Muskelregion eingezahlt hat, und wie stark diese Einzahlung zu einem späteren Zeitpunkt noch nachwirkt. Es vergleicht diese Rechnung fortlaufend mit dem, was der Nutzer tatsächlich meldet, und passt seine Koeffizienten an.

Es ist **keine** Messung von Kraft, Regeneration, Gesundheit oder Belastbarkeit. Es sieht kein Bindegewebe, keinen Schlaf, keine Ernährung, keinen Stress und keinen Infekt. Die Formulierungsgrenzen aus §3 der Trainingsspezifikation gelten.

Der entscheidende Punkt: Die Größe, die das Modell vorhersagt, ist **dieselbe Größe, die der Nutzer meldet**. Damit ist das Modell an seiner eigenen Vorhersage prüfbar — anders als ein Score, den niemand beobachten kann.

---

## 2. Muskelregionen

Feste Liste, Version `regions-v1`. 25 Regionsnamen, davon 20 seitig geführt, ergibt 45 konkrete Regionen.

**Seitig geführt (links/rechts):** `shoulder_front`, `shoulder_side`, `shoulder_rear`, `chest_upper`, `chest_mid`, `biceps`, `triceps`, `forearm`, `oblique`, `lat`, `trap_upper`, `lower_back`, `hip_flexor`, `glute`, `quad`, `hamstring`, `adductor`, `calf_gastroc`, `calf_soleus`, `tibialis`

**Ohne Seite:** `neck`, `trap_mid`, `rhomboid`, `abs_upper`, `abs_lower`

Regeln:
- Kennungen sind stabil. Eine Region wird nie umbenannt, nur ergänzt oder als veraltet markiert.
- Meldungen werden immer seitig erfasst, wo die Region seitig ist. „Beide Waden“ ist eine Meldung auf zwei Regionen, nicht auf eine.
- Belastung aus Übungen wird standardmäßig gleich auf beide Seiten verteilt. Einseitige Übungen (Ausfallschritt, einarmiges Rudern) verteilen seitenrichtig.
- Die Darstellung darf gröber sein als das Modell. Die Figur fasst Regionen zusammen, wenn wenig Daten vorliegen. Das Modell rechnet trotzdem fein.

---

## 3. Vom Satz zum Reiz

Ein Satz erzeugt einen skalaren **Grundreiz** `s`. Zwei Beobachtungen tragen die Formel: Sätze nahe am Muskelversagen wirken deutlich stärker nach als leichte Sätze, und schwere Lasten wirken anders als leichte.

**Schritt 1 — geschätztes Einwiederholungsmaximum (Epley):**

```
e1RM = w · (1 + r / 30)
```

`w` = Last, `r` = geleistete Wiederholungen. Für jede Übung wird laufend der beste beobachtete Wert der letzten 8 Wochen als `e1RM_est` geführt.

**Schritt 2 — relative Last und Reserve:**

```
L      = w / e1RM_est                  relative Last, 0…1
r_max  = 30 · (1/L − 1)                theoretisch mögliche Wiederholungen bei L
RIR    = max(0, r_max − r)             geschätzte Wiederholungen in Reserve
```

Bei Satzart „bis zum Versagen“ wird `RIR = 0` gesetzt, unabhängig von der Rechnung. Das ist eine Nutzerangabe und schlägt die Schätzung.

**Schritt 3 — effektive Wiederholungen.** Nur die letzten Wiederholungen vor dem Versagen zählen voll:

```
n_eff = Σ_{i=1..r} exp( −(RIR + r − i) / λ )        λ = 4 (Ausgangsannahme)
```

Ein Satz bis zum Versagen liefert unabhängig von der Wiederholungszahl etwa `n_eff ≈ λ`. Ein Satz mit 6 Wiederholungen in Reserve liefert etwa `λ·e^{−6/4} ≈ 0,9`. Aufwärmsätze fallen dadurch von selbst fast heraus — es braucht keine Sonderregel.

**Schritt 4 — Grundreiz:**

```
s = n_eff · L^γ · ε_exercise            γ = 1,0 (Ausgangsannahme)
```

`ε_exercise` ist der **Exzentrik- und Dehnungsfaktor** der Übung: Rumänisches Kreuzheben, Ausfallschritte, Nordic Curls und tiefe Dehnungspositionen wirken erheblich länger nach als Maschinenübungen bei gleicher Arbeit. Ausgangswerte 0,7 bis 1,8 aus dem Katalog. **Genau dieser Faktor ist es, den die Kalibrierung in §6 pro Nutzer lernt.**

**Sonderfälle:**
- Zeitsätze und Isometrie: `n_eff` aus der Spannungsdauer statt aus Wiederholungen, `n_eff = t_unter_spannung / 12 s`.
- Dropsets: als Folge von Teilsätzen mit jeweils eigenem `L` gerechnet, nicht als ein Satz.
- Eigengewicht: `w` = geschätztes bewegtes Körpergewicht, aus dem Körpergewicht und einem Übungsanteil (Liegestütz ≈ 0,65). Ohne Körpergewichtsangabe wird ein Katalogwert benutzt und die Unsicherheit erhöht.

---

## 4. Vom Lauf zum Reiz

Ein Laufabschnitt mit Dauer `t` (Stunden), Geschwindigkeit `v` und Steigung `g` (als Anteil, negativ bei Gefälle) erzeugt regionsbezogene Reize direkt:

```
s_calf_gastroc = a₁ · t · (v/v_ref)^1,5
s_calf_soleus  = a₂ · t · (v/v_ref)^1,2
s_quad         = a₃ · t · (v/v_ref)^1,2 · (1 + k_dh · max(0, −g))
s_hamstring    = a₄ · t · (v/v_ref)^1,5 · (1 + k_up · max(0,  g))
s_glute        = a₅ · t · (v/v_ref)^1,2 · (1 + k_up · max(0,  g))
s_tibialis     = a₆ · t · (v/v_ref)^1,2 · (1 + k_dh · max(0, −g))
```

`v_ref` = 3 m/s, dieselbe Referenz wie beim Effort der Hauptspezifikation. `k_dh` = 12, `k_up` = 8 (Ausgangsannahmen). Der Gefälle-Term ist der wichtigste: Bergablaufen ist exzentrische Arbeit und der häufigste Grund für Quadrizeps-Muskelkater nach einem Lauf.

Die Faktoren `a₁…a₆` sind so normiert, dass ein lockerer Lauf von einer Stunde bei `v_ref` ohne Steigung eine Wadenbelastung erzeugt, die etwa drei harten Wadensätzen entspricht. Diese Normierung ist eine Setzung und wird in §11 geprüft.

Beim Laufen wird immer beidseitig gleich verteilt. Runback hat keine Daten, um Asymmetrie zu behaupten (§6 der Hauptspezifikation).

---

## 5. Zeitverhalten und Frische

### 5.1 Warum kein einfacher Zerfall

Ein Reiz wirkt nicht sofort maximal und klingt dann ab. Muskelkater **steigt erst an** und erreicht sein Maximum typischerweise nach etwa einem Tag. Ein einfacher exponentieller Zerfall würde das Gegenteil vorhersagen — dass es direkt nach dem Training am schlimmsten ist — und wäre an den Meldungen des Nutzers sofort widerlegt.

Deshalb zwei Komponenten mit einer **Impulsantwort aus der Differenz zweier Exponentialfunktionen**:

```
h(t; τ_r, τ_d) = c · ( e^{−t/τ_d} − e^{−t/τ_r} )        für t ≥ 0, sonst 0
c              = Normierung, so dass max h = 1
Maximum bei      t* = ln(τ_d/τ_r) / (1/τ_r − 1/τ_d)
```

- **Schnelle Komponente** (neuromuskuläre Ermüdung): `τ_r = 0,5 h`, `τ_d = 10 h`. Sofort da, nach einem Tag praktisch weg.
- **Langsame Komponente** (Strukturbelastung, Muskelkater): `τ_r = 12 h`, `τ_d = 60 h` → Maximum bei etwa 24 Stunden, nach vier bis fünf Tagen nahe null.

```
h_total(t) = β_f · h(t; 0,5, 10) + β_s · h(t; 12, 60)      β_f = 0,4, β_s = 0,6
```

Das ist strukturell dasselbe Verfahren, das die Laufwissenschaft für Fitness-Ermüdungs-Modelle benutzt — hier nur je Muskelregion statt für den ganzen Körper.

### 5.2 Ermüdungslast und Frische

```
E_m(t) = Σ_i  s_i · share(exercise_i, m) · κ_{exercise_i, m} · h_total(t − t_i)
F_m(t) = 100 · exp( −E_m(t) / S_m )
```

`share` ist der Katalog-Muskelanteil, `κ` der persönlich gelernte Koeffizient (Ausgangswert 1), `S_m` der Kapazitätsmaßstab der Region.

Die Exponentialform ist bewusst gewählt: Sie hält `F` ohne Abschneiden im Bereich `(0, 100]`, wird bei viel Belastung flacher — der Unterschied zwischen „sehr platt“ und „extrem platt“ ist praktisch klein — und hat keine willkürliche Obergrenze, an der Belastung verlorengeht.

**100 bedeutet: keine nachwirkende Belastung im Sinne dieses Modells.** Nicht „ausgeruht“, nicht „bereit“, nicht „gesund“.

### 5.3 Vorhersage

`h_total` ist eine bekannte Funktion, und der Plan ist bekannt. Damit ist `F_m(t)` für die Zukunft eine direkte Auswertung derselben Formel — kein zusätzliches Modell, keine zusätzliche Annahme. Das trägt die Vorschau „Wenn du heute Beine machst, bist du am Donnerstag beim langen Lauf bei etwa 62“ und die Planbewertung in §9.

---

## 6. Kalibrierung aus den Meldungen

Hier liegt der eigentliche Wert des Verfahrens. Der Nutzer meldet Muskelkater `d ∈ [0, 10]` je Region und Zeitpunkt. Das Modell sagt genau diese Größe vorher:

```
d̂_m(t) = 10 · (1 − F_m(t)/100) = 10 · (1 − e^{−E_m(t)/S_m})
```

### 6.1 Umformung in ein lineares Problem

Die Umkehrung macht das Problem **linear in den Koeffizienten** — und damit klein, schnell und auf dem Gerät lösbar:

```
y_j = −S_m · ln(1 − d_j/10)  =  Σ_i  z_{i,m,j} · κ_{e(i), m}
z_{i,m,j} = s_i · share(e(i), m) · h_total(u_j − t_i)
```

Jede Meldung `j` ist eine Zeile, jede Übungs-Region-Kombination eine Spalte. Es entsteht eine Entwurfsmatrix `A` mit `A·κ ≈ y`.

### 6.2 Regularisierte, nichtnegative Lösung

```
minimiere   ρ(A·κ − y)  +  λ · ‖κ − κ₀‖²      unter   κ ≥ 0
```

- `κ₀` sind die Katalogwerte. Der Strafterm zieht jeden Koeffizienten dorthin zurück, solange keine Daten dagegen sprechen.
- **Daraus ergibt sich die gewünschte Zurückhaltung von selbst.** Es braucht keine Regel „ab 5 Meldungen anpassen“: Bei einer Meldung dominiert `λ`, bei zwanzig übereinstimmenden Meldungen dominieren die Daten. Der Übergang ist stetig und begründet, statt an einer willkürlichen Schwelle zu springen.
- `ρ` ist eine **Huber-Verlustfunktion**, nicht das reine Quadrat. Eine einzelne unplausible Meldung — falsch verstanden, ein Sturz, ein Muskelkater aus dem Umzug — verzerrt damit nicht das ganze Modell.
- `κ ≥ 0` erzwingt, dass keine Übung einen Muskel „erholt“.

### 6.3 Laufende Aktualisierung statt Neuberechnung

Statt bei jeder Meldung alles neu zu lösen, wird ein **rekursives Filter** je Koeffizient geführt (Kalman-Form):

```
Vorhersagefehler   e = y_j − aᵀκ
Verstärkung        K = P·a / (aᵀ·P·a + σ²)
Aktualisierung     κ ← κ + K·e
Kovarianz          P ← (I − K·aᵀ)·P + Q
```

Das kostet pro Meldung Millisekunden und liefert zwei Dinge gratis:

1. **`P` ist die Unsicherheit.** Damit kann die App sagen: „Beinpresse → Quadrizeps: 1,4 ± 0,4, aus 6 Meldungen“. Das erfüllt Grundregel 5 nicht nur formal, sondern inhaltlich.
2. **`Q` erlaubt langsame Veränderung.** Wenn der Nutzer über Monate an eine Übung gewöhnt, sinkt ihr Koeffizient tatsächlich. Ein starres Modell würde das für Messrauschen halten.

### 6.4 Nicht unterscheidbare Koeffizienten

Wer Kniebeugen macht, belastet Quadrizeps und Gluteus immer gemeinsam. Aus solchen Daten lässt sich nicht bestimmen, welcher der beiden Koeffizienten hoch ist — nur ihre Summe. Ein naives Verfahren würde hier trotzdem eine Zahl ausgeben, und zwar eine falsche.

Erkennung über die **Korrelation im Posterior**:

```
corr(κ_a, κ_b) = P_ab / √(P_aa · P_bb)
```

Übersteigt sie 0,9, gilt das Paar als nicht getrennt bestimmbar. Dann:
- werden beide Koeffizienten im festen Verhältnis ihrer Katalogwerte gekoppelt und nur gemeinsam angepasst,
- wird das in der Aufschlüsselung benannt: „Quadrizeps und Gluteus sind bei dir bisher nicht getrennt beurteilbar — du belastest sie immer gemeinsam. Eine einbeinige oder isolierte Übung würde das trennen.“

Das ist zugleich die konkreteste Form von „Mehr Daten nötig“, die die Hauptspezifikation in V1-9 verlangt: nicht „trainiere mehr“, sondern „genau diese Beobachtung fehlt“.

### 6.5 Zeitkonstanten

`τ_r` und `τ_d` gehen nicht linear ein. Sie werden deshalb nicht optimiert, sondern über ein **kleines Raster** von etwa 12 vorgegebenen Paaren gewählt, bewertet nach kreuzvalidiertem Vorhersagefehler. Das ist robust, vollständig reproduzierbar und in Sekunden gerechnet. Die gewählte Kombination wird in der Aufschlüsselung genannt.

### 6.6 Übertragung auf neue Übungen

Jede Übung ist ein Vektor im Raum der Muskelanteile. Die **Kosinus-Ähnlichkeit** zweier Übungen misst, wie ähnlich sie beanspruchen. Eine neue oder selbst angelegte Übung startet nicht bei 1, sondern beim ähnlichkeitsgewichteten Mittel der bereits gelernten Koeffizienten ähnlicher Übungen. Wer gelernt hat, dass Rumänisches Kreuzheben bei ihm stark nachwirkt, bekommt diese Erwartung bei Good Mornings geschenkt.

Dieselbe Ähnlichkeit trägt den Ersatzvorschlag, wenn ein Gerät belegt ist.

---

## 7. Wann eine Region unbekannt bleibt

Eine Zahl erscheint nur, wenn alle drei Bedingungen erfüllt sind:

1. Der Katalog liefert für die beteiligten Übungen belastbare Anteile.
2. Die Vorhersageunsicherheit der Region liegt unter einer festgelegten Schranke (Ausgangsannahme: Standardabweichung ≤ 15 Punkte auf der Frische-Skala).
3. Die letzte relevante Einheit liegt innerhalb des Modellhorizonts (7 Tage), oder es gibt eine bestätigende Meldung.

Sonst: grau, keine Zahl, mit Begründung. **Fehlende Meldungen erhöhen die Unsicherheit, sie setzen die Frische nicht auf 100.** Das ist der häufigste Fehler in vergleichbaren Apps.

---

## 8. Progression im Krafttraining

**Verlaufsschätzung.** Je Übung wird pro Einheit das beste `e1RM` der Arbeitssätze geführt. Der Trend wird mit **Theil-Sen** geschätzt — dem Median aller paarweisen Steigungen. Das ist gegen einzelne schlechte Tage unempfindlich, während eine gewöhnliche Regression von einem Grippetag deutlich gezogen wird. Das Konfidenzintervall entsteht aus den Rangstatistiken derselben Steigungen.

**Stillstand.** Wenn das Intervall der Steigung über mindestens vier Wochen die Null enthält, gilt der Verlauf als flach. Das ist ausdrücklich etwas anderes als „drei Einheiten in Folge nicht gesteigert“, was bei normaler Streuung ständig vorkommt.

**Bruch im Verlauf.** Ein **CUSUM-Test** auf den Residuen erkennt einen Knick früher als eine Neuschätzung des ganzen Trends: Er summiert die vorzeichenbehafteten Abweichungen und schlägt an, wenn diese Summe eine Schranke überschreitet. Er unterscheidet damit „läuft weiter wie bisher, heute war nur schlecht“ von „seit drei Wochen geht es nicht mehr“.

**Vorschlag für die nächste Einheit.**

```
Zielprozent   p = 1 / (1 + (r_ziel + RIR_ziel) / 30)
Zielgewicht   w = e1RM_est · p · (0,92 + 0,08 · F_region/100)
```

Der Frischeanteil ist bewusst klein — höchstens 8 Prozent. Das Modell darf die Tagesform mitdenken, aber nicht behaupten, sie genau zu kennen. Zusätzlich ist der Schritt zur letzten Einheit auf ±5 Prozent begrenzt, damit ein einzelner guter Tag keinen unrealistischen Sprung erzeugt.

---

## 9. Verzahnung von Laufen und Krafttraining

**Frische als Störgröße in der Laufbewertung.** Die bestehende Pacing-Analyse misst das Nachlassen im späteren Laufverlauf. Wer am Vortag schwer Beine trainiert hat, lässt stärker nach — ohne dass an seinem Lauf etwas falsch war. Zwei Wege, je nach Datenlage:

- Ab etwa zehn vergleichbaren Läufen: eine kleine Regression `Nachlassen ~ β₀ + β₁·(100 − F_bein) + β₂·Temperatur`, höchstens zwei Störgrößen. Ausgegeben wird der bereinigte Anteil, ausdrücklich als Beobachtung.
- Darunter: **Caliper-Vergleich** — nur Läufe heranziehen, deren Beinfrische sich um höchstens 10 Punkte unterscheidet. Weniger Läufe, aber ein ehrlicher Vergleich.

Beides sind Vergleichsregeln, keine Ursachenbehauptungen (Grundregel 13).

**Vorwärtssimulation für die Planung.** Aus §5.3 ergibt sich für jeden geplanten Termin eine erwartete Frische. Ein Vorschlag entsteht, wenn eine als wichtig markierte Einheit vorhersehbar bei niedriger Frische der für sie entscheidenden Region landet.

**Monatliche Plansuche.** Der Suchraum ist winzig: die Zuordnung weniger Einheiten auf sieben Wochentage, mit den vom Nutzer festgelegten Fixterminen. Das wird **vollständig durchgezählt**, nicht optimiert. Zielgröße ist die minimale vorhergesagte Frische an den wichtigen Einheiten; bei Gleichstand gewinnt die geringere Abweichung vom bestehenden Plan. Deterministisch, reproduzierbar, in Millisekunden. Ein aufwendigeres Verfahren wäre hier reine Zierde.

---

## 10. Sprache zu Struktur

1. **Umwandlung.** Android-Spracherkennung offline als Kern, OpenRouter optional als Verbesserung.
2. **Zuordnung, regelbasiert.** Ein Lexikon bildet Wörter auf Regionen ab („Wade“, „Waden“, „Zwilling“ → `calf_gastroc`), auf Seiten („links“, „rechts“, „beide“) und auf Stärken („leicht“ = 3, „mittel“ = 5, „ordentlich“ = 6, „stark“ = 8, „extrem“ = 9). Diese Zuordnung ist festgeschrieben und versioniert, nicht bei jedem Aufruf neu erfunden.
3. **Unschärfe.** Erkennungsfehler werden über normalisierte Levenshtein-Distanz (≥ 0,8) und Trigramm-Ähnlichkeit gegen das Lexikon abgefangen.
4. **Bestätigung.** Das Ergebnis färbt sofort die Figur. Erst ein Tippen speichert.
5. **Der LLM-Weg endet an derselben Prüfung.** Wenn OpenRouter benutzt wird, liefert es strukturierte Felder, die durch dasselbe Lexikon müssen. Eine Region, die es nicht gibt, wird verworfen, nicht erfunden. Damit bleibt Grundregel 6 gewahrt: Das Modell hört zu, die Regeln entscheiden.

---

## 11. Prüfung vor der Freischaltung

Das Modell bleibt gesperrt, bis es diese Prüfungen besteht — dieselbe Haltung, die die Hauptspezifikation für die persönlichen Prognosemodelle einnimmt.

**Vorhersageprüfung.** Aus den Daten bis zum Zeitpunkt `t` wird die nächste Meldung vorhergesagt und mit der tatsächlichen verglichen. Der mittlere absolute Fehler muss **alle drei** einfachen Vergleichsmaßstäbe schlagen:
1. immer den persönlichen Median vorhersagen,
2. immer die letzte Meldung wiederholen,
3. immer „kein Muskelkater“ vorhersagen.

Schlägt das Modell diese nicht, ist es Zierde und bleibt aus.

**Kalibrierungsprüfung.** Vorhergesagte gegen beobachtete Werte, in Klassen zusammengefasst. Wenn das Modell bei Vorhersage 7 im Mittel 4 beobachtet, ist die Skala falsch und wird korrigiert, nicht die Beschriftung.

**Zeitverhaltensprüfung.** Der beobachtete Anstieg nach einer harten Einheit muss die Form von `h_total` treffen. Wenn Meldungen regelmäßig ihr Maximum nach 48 statt nach 24 Stunden erreichen, sind die Zeitkonstanten falsch.

**Stabilitätsprüfung.** Eine einzelne zusätzliche Meldung darf keine Region um mehr als eine festgelegte Spanne verschieben (Grundregel 14).

**Ausfallprüfung.** Ohne Meldungen, ohne Katalogwerte, mit widersprüchlichen Angaben und mit einer Lücke von Monaten muss das Modell „unbekannt“ liefern und nicht abstürzen (Grundregel 7).

---

## 12. Parameterübersicht

| Parameter | Ausgangswert | Bedeutung | Persönlich gelernt |
|---|---|---|---|
| `λ` | 4 | Reichweite der effektiven Wiederholungen | nein |
| `γ` | 1,0 | Gewicht der relativen Last | nein |
| `ε_exercise` | 0,7–1,8 | Exzentrik-/Dehnungsfaktor je Übung | **ja**, über `κ` |
| `κ_{exercise, m}` | 1,0 | persönlicher Übungs-Regions-Koeffizient | **ja** |
| `share(exercise, m)` | Katalog | Muskelanteil der Übung | korrigierbar |
| `S_m` | Katalog | Kapazitätsmaßstab der Region | **ja** |
| `τ_r`, `τ_d` (schnell) | 0,5 h / 10 h | neuromuskuläre Ermüdung | über Raster |
| `τ_r`, `τ_d` (langsam) | 12 h / 60 h | Strukturbelastung, Maximum bei ca. 24 h | über Raster |
| `β_f`, `β_s` | 0,4 / 0,6 | Gewichtung der beiden Komponenten | über Raster |
| `k_dh`, `k_up` | 12 / 8 | Gefälle- und Steigungsfaktor beim Laufen | nein |
| `v_ref` | 3 m/s | Referenzgeschwindigkeit, wie beim Effort | nein |
| `λ` (Regularisierung) | siehe §6.2 | Zurückhaltung gegenüber Katalogwerten | nein |
| `Q` | klein | zugelassene langsame Veränderung der Koeffizienten | nein |

---

## 13. Bekannte Grenzen

- **Muskelkater ist nicht Ermüdung.** Beides hängt zusammen, ist aber nicht dasselbe. Das Modell sagt Muskelkater vorher, weil nur der gemeldet wird. Die schnelle Komponente ist ein Zusatz, den die Meldungen nur mittelbar prüfen können.
- **Wer nichts meldet, bekommt Katalogwerte.** Das Modell ist dann eine plausible Buchhaltung, keine persönliche Aussage. Es muss das auch so sagen.
- **Gemeinsam trainierte Muskeln bleiben verbunden.** §6.4 macht das sichtbar, löst es aber nicht auf.
- **Alles außerhalb der App fehlt.** Umzug, Wandertag, Gartenarbeit erzeugen Meldungen ohne Ursache im Modell. Die Huber-Verlustfunktion begrenzt den Schaden; ein Nachtrag „das war nicht vom Training“ sollte möglich sein.
- **Die Anfangswerte sind Literaturannahmen.** Bis §11 durchlaufen ist, sind sie begründete Setzungen und nichts weiter. Sie werden auch so beschriftet.
