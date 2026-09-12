# Runback – Hinweise für Agenten

Runback ist eine lokale Android-Trainings-App (React Native + Kotlin) für Laufen
und Krafttraining mit Wear-OS-Companion. Sie gibt je Bereich (Laufen,
Krafttraining) **höchstens eine** begründete, prüfbare Empfehlung und sagt
sonst ehrlich, was fehlt.

Lies vor Änderungen:

- [docs/spec.md](docs/spec.md) — Ziel, Mentalität, Grundregeln, Nicht bauen.
  Die Grundregeln sind nicht verhandelbar; eine Verletzung ist ein Bug.
- [docs/design-language.md](docs/design-language.md) — jede Oberfläche folgt
  ihr. Token und Bausteine kommen nur aus `src/ui/components.tsx`.
- [docs/glossar.md](docs/glossar.md) — welche Wörter der Nutzer sieht und wie
  sie im Code heißen.

## Aufbau

- `src/domain/` — reine TypeScript-Logik, versioniert, ohne UI und ohne
  Native-Aufrufe. Hier entstehen Auswertungen, Empfehlungen, Frische, Planung.
- `src/ui/` — Bildschirme und Bausteine. `RunbackApp.tsx` ist der Einstieg.
- `src/native.ts` — die einzige Brücke nach Kotlin.
- `android/core` — SQLite, Foreground-Service, Sensoren; geteilt von Telefon
  und Uhr. `android/app` — Bridge, Importe, Health Connect, Integrationen.
  `android/wear` — eigenständige Uhr-App.
- `__tests__/` — Jest; `android/*/src/test` — JUnit.

## So arbeitest du hier

- **Der Code ist die Doku.** Schreibe keine Implementierungsberichte in
  `docs/`. Wenn etwas erklärt werden muss, gehört es als kurzer Kommentar an
  die Stelle im Code. `docs/` ändert sich nur, wenn sich Richtung, Sprache
  oder Nutzersicht ändern.
- **Versioniere Modelle.** Neue oder geänderte Rechenregeln, Kataloge und
  Matrizen bekommen eine Version, die in ihre Ableitungen wandert. Alte Daten
  behalten die Version, mit der sie bewertet wurden.
- **Unbekannt bleibt unbekannt.** Kein Fallback auf `0`, keine erfundenen
  Ersatzwerte, keine erfundenen Intervalle. Fehlende Daten begrenzen nur die
  Aussage, die sie brauchen.
- **Die Brücke bleibt schlank.** Rohsamples bleiben in Kotlin; JS bekommt
  Aggregate und begrenzte Darstellungsdaten.
- **Bereiche trennen.** Ziel, Fokus und Empfehlung gehören immer zu einem
  Bereich (`areas.ts`). Baue nichts, was eine zweite Empfehlung im selben
  Bereich erlaubt oder die Kopplungssperre umgeht. Neue Empfehlungsarten
  erweitern `AnyRecommendation` und bekommen eigene Auswahl und Prüfung.
- **Der Nutzer entscheidet.** Vorschläge sind Vorschau, bis er sie anwendet.
  Nichts ändert Pläne, Empfehlungen oder Daten ohne seine Aktion.
- **Deutsch, kurz, im Imperativ.** UI-Text nach Design Language: ein Satz,
  keine Fachwörter, Zustände als Labels, Zahlen im deutschen Format.
- **Tests zu jeder Domain-Änderung.** Pure Logik in `src/domain/` hat einen
  Jest-Test daneben; Kotlin-Parser und Mathematik haben JUnit-Tests.

Vor dem Abschluss: `npm run typecheck`, `npm test -- --runInBand`, bei
Kotlin-Änderungen `./gradlew :core:testDebugUnitTest :app:testDebugUnitTest`.
