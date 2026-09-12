# Runback

Lokale Android-Trainings-App für Laufen und Krafttraining, mit eigenständiger
Wear-OS-App. Alles bleibt auf dem Gerät: kein Konto, keine Cloud, keine Pflicht
zur Einrichtung.

Runback zeichnet Einheiten auf, importiert deine Historie und leitet daraus
**höchstens eine** begründete Empfehlung fürs Laufen und eine fürs Krafttraining
ab — und prüft später ehrlich, ob sie geholfen hat. „Noch nicht klar“ ist ein
normales Ergebnis.

## Was du in der App siehst

- **Heute** — Lauf, Radfahrt oder Krafttraining starten, geplante Einheit
  ansehen, Muskelkater melden, Muskelkarte, Trainingspläne.
- **Planung** — Wochen- und Monatskalender, Zeitbudget, Routine, Ziel mit
  optionalem Datum.
- **Einheiten** — alle Läufe, Radfahrten und Krafteinheiten in einer Liste;
  Detailansicht mit Karte, Abschnitten, RPE und Zweck.
- **Statistik** — die letzten acht Wochen, Tempo, RPE, Entwicklung.
- **Mehr** — Dein Fokus, Ziel & Alltag, Laufvorlagen, Geräte & Verbindungen
  (Uhr, BLE, Health Connect, Wetter), Deine Daten (Import, Backup, Löschen),
  Trainingschat, Wie Runback rechnet.

Nach einem Lauf zeigt Runback drei Dinge: wie der Lauf zu seinem Zweck passt,
wo die aktuelle Empfehlung steht und was du als Nächstes tun kannst — auch
„so weitermachen“. Details, Datenbasis und Unsicherheit liegen unter „Details“.

## Ziel, Fokus, Empfehlung

Laufen und Krafttraining sind getrennte Bereiche. Jeder hat sein eigenes Ziel,
seinen eigenen Fokus und seine eigene Empfehlung; wer nur eins macht, sieht vom
anderen nichts.

- Ein **Ziel** ist optional und darf ein Datum haben.
- Ein **Fokus** (Ausdauer, schneller werden, verletzungsfrei bleiben,
  Gewohnheit, Fitness) ist ein dauerhaftes Thema. Er wird nie bewertet.
- Eine **Empfehlung** ist die eine konkrete Sache je Bereich, die du
  ausprobierst. Du nimmst sie an, sie läuft, und Runback sagt danach, ob es
  geholfen hat, ob nicht, oder ob es noch nicht klar ist. Berührt eine
  Empfehlung beides („weniger Beinbelastung vor dem langen Lauf“), gibt es
  solange keine zweite.

## Daten

- **Import** aus Garmin, Strava, Fitbit, Google Fit, Apple Health, Samsung
  Health, Mi Fitness, Polar, Strong u. a. — siehe [Importe](docs/imports.md).
- **Backup** als ZIP mit allem, was Runback kennt; Wiederherstellung auf einer
  frischen Installation. Exporte als GPX/FIT/JSON.
- **Health Connect** lesen und (je Lauf, ausdrücklich) schreiben.
- **BLE-Sensoren** für Puls und Laufkadenz.
- **Wetter** nur nach Aktivierung, per Open-Meteo.
- **OpenRouter** optional mit eigenem Schlüssel für Formulierung und
  Trainingschat. Der Chat liest, er schreibt nichts und entscheidet nichts.

## Installation

[Test-Releases](https://github.com/GhostCodeByte/Runback/releases) enthalten je
eine Telefon- und eine Wear-APK, signiert mit einem festen öffentlichen
Debug-Schlüssel. Kein Entwicklungsserver nötig.

```sh
adb -s PHONE_SERIAL install -r runback-phone-*.apk
adb -s WATCH_SERIAL install -r runback-wear-*.apk
```

Für die Uhr: Entwickleroptionen und drahtloses Debugging aktivieren, dann
`adb pair` und `adb connect`. `adb install -r` erhält bestehende Daten.
Prüfsummen: `sha256sum --check SHA256SUMS`.

Das ist Testsoftware. Reale GPS-/Sensorgenauigkeit, Akkuverbrauch und lange
Hintergrundaufzeichnung sind auf echten Geräten nicht vollständig nachgewiesen;
persönliche Prognosemodelle bleiben bis zur Validierung gesperrt.

## Entwicklung

Node 20.19+ oder 22, JDK 17/21, Android SDK 36, NDK 27.1.12297006.

```sh
npm ci
npm run typecheck
npm test -- --runInBand
cd android && ./gradlew :core:testDebugUnitTest :app:lintRelease :wear:lintRelease :app:assembleRelease :wear:assembleRelease
```

Windows: `gradlew.bat`. CI baut bei jedem Push auf `main` ein Prerelease
(`.github/workflows/android.yml`).

## Dokumentation

- [Spec](docs/spec.md) — Ziel, Mentalität, Grundregeln.
- [Design Language](docs/design-language.md) — wie Oberflächen aussehen und sprechen.
- [Glossar](docs/glossar.md) — Alltagswort → Codename.
- [Importe](docs/imports.md) — welche Exporte woher kommen und was daraus wird.

Das Repository ist öffentlich; die Lizenz ist noch nicht festgelegt.
