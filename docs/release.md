# Test-APKs installieren und veröffentlichen

Die [GitHub-Test-Releases](https://github.com/GhostCodeByte/Runback/releases) enthalten jeweils eine Telefon-APK, eine Wear-OS-APK, `SHA256SUMS` und `BUILD-METADATA.json`. Beide Apps lassen sich ohne Entwicklungsserver starten. V1 und V2 bezeichnen Funktionsziele derselben Apps, keine getrennten APK-Varianten. Der [Testbericht](testing.md) beschreibt den tatsächlich geprüften Umfang und offene Punkte.

## Installation

1. Beide APKs desselben Releases herunterladen; im Dateinamen steht `phone` beziehungsweise `wear`.
2. Die Telefon-APK auf dem Android-Telefon öffnen und die Installation aus dieser Quelle freigeben. Alternativ USB-Debugging aktivieren und ADB verwenden.
3. Auf der Uhr Entwickleroptionen und drahtloses Debugging einschalten. Mit den auf der Uhr angezeigten Adressen zuerst `adb pair IP:PAIRING_PORT`, danach `adb connect IP:DEBUG_PORT` ausführen. Pairing- und Debug-Port können verschieden sein.
4. Die richtige Gerätekennung aus `adb devices -l` verwenden:

```sh
adb -s PHONE_SERIAL install -r runback-phone-VERSION-COMMIT.apk
adb -s WATCH_SERIAL install -r runback-wear-VERSION-COMMIT.apk
adb -s PHONE_SERIAL shell monkey -p com.runback 1
adb -s WATCH_SERIAL shell monkey -p com.runback 1
```

Die Dateinamen durch die heruntergeladenen Namen ersetzen. Standort- und Sensorberechtigungen auf jedem Gerät nach Bedarf erteilen. Eine ADB-Verbindung zur Uhr richtet allein noch keine Telefon-Uhr-Kopplung für Wear OS ein; dafür die Uhr regulär mit dem Telefon verbinden. Für Emulatoren die Wear-OS-Kopplung in Android Studio verwenden.

`adb install -r` erhält die lokalen App-Daten bei kompatiblen Updates. Beide Apps haben die ID `com.runback` und verwenden dauerhaft `android/app/debug.keystore` (Alias `androiddebugkey`, öffentliches Kennwort `android`). Dieser Schlüssel ist ausdrücklich ein öffentlicher Testschlüssel, kein Produktionsschlüssel. Eine Installation mit einer anderen Signatur lässt sich damit nicht direkt aktualisieren; vor einem erforderlichen Deinstallieren vorhandene Laufdaten sichern.

Prüfsummen im Download-Verzeichnis prüfen:

```sh
sha256sum --check SHA256SUMS
```

Unter PowerShell lässt sich beispielsweise `(Get-FileHash .\runback-phone-VERSION-COMMIT.apk -Algorithm SHA256).Hash` mit dem passenden Eintrag in `SHA256SUMS` vergleichen. Die Metadaten enthalten den vollständigen Commit, Versionen, Architekturen und den SHA-256-Fingerabdruck des Signaturzertifikats.

## Automatische GitHub CI

Der Workflow [android.yml](../.github/workflows/android.yml) läuft bei Pull Requests, Pushes auf `main` und manuellem Start. Er installiert Node 22, Java 17 und die im Projekt verwendeten Android-Build-Werkzeuge; `npm ci` nutzt die eingecheckte Lockdatei.

Vor der Veröffentlichung müssen TypeScript-Prüfung, Jest, native Core-Tests, Android-Lint und beide Release-Builds erfolgreich sein. Das Verpackungsskript prüft außerdem die gemeinsame App-ID, Versionsnummern, Signatur gegen den eingecheckten Testschlüssel, Android-Code sowie den eingebetteten JavaScript-Bundle und die Telefon-Architekturen ARM64, ARMv7 und x86_64. Release-Builds sind mit dem Debug-Schlüssel signiert; sie benötigen keinen Metro-Server und aktivieren keinen Debug-Modus.

Jeder erfolgreiche Build liefert für 14 Tage herunterladbare Workflow-Artefakte. Ausschließlich erfolgreiche Push-Builds von `main` veröffentlichen zusätzlich ein dauerhaftes GitHub-Prerelease. Pull Requests und manuelle Workflow-Starts veröffentlichen keine Releases. Fehlgeschlagene Prüfungen verhindern APK-Veröffentlichung; verfügbare Testberichte werden trotzdem hochgeladen.

Versionsname: `0.1.<GitHub run_number>`. Versionscode: `<GitHub run_number>`. Tag: `test-0.1.<run_number>-<commit-prefix>`, fest auf den tatsächlich geprüften Commit gesetzt. Wiederholung eines bereits veröffentlichten Laufs ersetzt keine bestehenden Release-Dateien. Releases werden als Vorabversionen gekennzeichnet und behaupten keine vollständige V1-/V2-Abnahme.

Die Actions sind auf vollständige Commit-Hashes fixiert. Nur der Veröffentlichungsjob erhält `contents: write`; Build-Jobs benötigen keinen Zugriff auf Geheimnisse. Normale GitHub-gehostete Ubuntu-Runner werden verwendet, keine kostenpflichtigen Runner oder Dienste eingerichtet. Kontingente und Abrechnungseinstellungen bleiben unter Kontrolle des Repository-Inhabers.

## Lokal denselben Build erstellen

Voraussetzungen: Node 22, Java 17, Android SDK mit Plattform 36, Build Tools 36.0.0, NDK 27.1.12297006 und CMake 3.22.1. `ANDROID_HOME` zeigt auf das SDK.

```sh
npm ci
npx tsc --noEmit
npm test -- --runInBand
cd android
./gradlew :core:testDebugUnitTest :app:lintRelease :wear:lintRelease :app:assembleRelease :wear:assembleRelease -PversionCode=1 -PversionName=0.1.1 -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
```

Unter Windows `gradlew.bat` verwenden und das Argument mit der Architekturliste in Anführungszeichen setzen. APKs liegen unter `android/app/build/outputs/apk/release/app-release.apk` beziehungsweise `android/wear/build/outputs/apk/release/wear-release.apk`. Versionscode und -name für beide Apps gleich setzen; für Updates einen mindestens gleich hohen Versionscode wählen.

Optional aus dem Repository-Stamm mit `VERSION_CODE` und `VERSION_NAME` passend zum Build `python scripts/package-release.py` starten. Es erzeugt dieselben geprüften Assets unter `dist/`; ohne GitHub-Umgebung wird der lokale Git-Commit protokolliert. Der lokale Arbeitsbaum muss dafür dem dokumentierten Commit entsprechen.
