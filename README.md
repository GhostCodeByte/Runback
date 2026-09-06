# Runback

Produktdokumentation für eine Android-Lauf-App mit Wear-OS-Companion: lokale Laufdaten, eine begründete nächste Handlung und eine nachvollziehbare Prüfung ihrer Wirkung.

Android-Telefon-App (React Native + Kotlin), eigenständige Wear-OS-App und gemeinsame lokale SQLite-Datenschicht. Dunkle Oberfläche mit hellen Texten und grünen Akzenten, ohne Konto oder Pflicht-Onboarding.

**Testsoftware, keine vollständige V1-/V2-Abnahme.** Der implementierte Kern enthält Aufzeichnung, Historie, FIT/GPX/TCX/ZIP-Import, lokale Auswertung, ein angenommenes Arbeitsthema, RPE, Backups, Health Connect, BLE und Uhrenübertragung. Persönliche Prognosemodelle bleiben mangels Validierung gesperrt. Der genaue Stand und offene Abnahmekriterien stehen im [Testbericht](docs/testing.md).

## APKs und Entwicklung

- [Automatische Test-Releases](https://github.com/GhostCodeByte/Runback/releases): je eine Telefon- und Wear-APK, mit demselben festen öffentlichen Debug-Schlüssel signiert. Kein Metro-Server erforderlich.
- [Installation und CI](docs/release.md), [Modell- und Datenregeln](docs/implementation.md).
- Lokal: Node 20.19+ oder 22, JDK 17/21, Android SDK 36 und NDK 27.1.12297006. `npm ci`, danach `cd android` und `./gradlew :app:assembleRelease :wear:assembleRelease` (Windows: `gradlew.bat`).
- Prüfungen: `npm test -- --runInBand`, `npm run typecheck`, `./gradlew :core:testDebugUnitTest :app:lintRelease :wear:lintRelease`. Android-Instrumentation: `./gradlew :core:connectedDebugAndroidTest`.

## Dokumentation

- [Zielspezifikation V1 / V2](docs/zielspezifikation.md) — Ziele, Invarianten und Akzeptanzkriterien.
- [Zielspezifikation Training (Gym + Laufen)](docs/zielspezifikation-training.md) — Krafttraining, Trainingspläne, Muskelkarte und die Verzahnung beider Trainingsarten.
- [Muskel- und Belastungsmodell](docs/muskelmodell.md) — Skala, Rechenvorschrift, Kalibrierung und Prüfverfahren der regionenbezogenen Frische.
- [Glossar](docs/glossar.md) — verständliche Bedeutungen neben englischen Fach- und Suchbegriffen.
- [Änderungen zum ursprünglichen Entwurf](docs/aenderungen.md) — übernommene Klarstellungen und fachliche Verbesserungen.
- [Bedienung und spätere Auslieferung](docs/bedienung-und-auslieferung.md) — flexible Funktionswahl, klare UI und Anforderungen an spätere Test-APKs.
- [Interaktive Systemkarte](docs/runback-system-map.html) — visueller Datenfluss von Sensorsamples bis zur Handlungsempfehlung.

Die Zielspezifikation ist fachlich maßgeblich. Das Glossar erklärt ihre Begriffe; ergänzende Dokumente konkretisieren Ziele, ohne die Invarianten abzuschwächen. Akzeptanzkriterien beschreiben gewünschtes Verhalten und sind keine Behauptung über bereits implementierte Funktionen.

Das Repository ist mit Zustimmung des Projektinhabers öffentlich. Die Lizenzwahl bleibt offen; öffentliche Sichtbarkeit allein ersetzt keine Open-Source-Lizenz.
