#!/usr/bin/env python3
"""Validate standalone Android APKs and prepare public CI test-release assets."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def command(*args):
    return subprocess.check_output([str(arg) for arg in args], text=True, encoding="utf-8")


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def inspect_apk(path, aapt, apksigner, expected_certificate, version_code, version_name):
    signature = command(apksigner, "verify", "--verbose", "--print-certs", path)
    match = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)", signature)
    require(match is not None, f"No signing certificate found: {path}")
    certificate = match[1].lower()
    require(certificate == expected_certificate, f"APK is not signed with the committed test key: {path}")
    badging = command(aapt, "dump", "badging", path)
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    require(package is not None, f"Missing package identity: {path}")
    require(package[1] == "com.runback", f"Unexpected app identity: {package[1]}")
    require(package[2] == version_code, f"Version code mismatch: {package[2]} != {version_code}")
    require(package[3] == version_name, f"Version name mismatch: {package[3]} != {version_name}")
    require("application-debuggable" not in badging, f"Expected release build: {path}")
    with zipfile.ZipFile(path) as apk:
        entries = apk.namelist()
        require("classes.dex" in entries, f"Missing Android application code: {path}")
        if path.parent.parent.name == "app":
            # Not used for normal Gradle paths; role-specific checks are below.
            pass
        abis = sorted({name.split("/")[1] for name in entries if name.startswith("lib/") and name.endswith(".so")})
    return {"applicationId": package[1], "versionCode": int(package[2]),
            "versionName": package[3], "certificateSha256": certificate, "abis": abis}


def main():
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    require(sdk, "Set ANDROID_HOME to an Android SDK with build-tools 36.0.0.")
    build_tools = Path(sdk) / "build-tools" / "36.0.0"
    windows = os.name == "nt"
    aapt = build_tools / ("aapt.exe" if windows else "aapt")
    apksigner = build_tools / ("apksigner.bat" if windows else "apksigner")
    version_code = os.environ["VERSION_CODE"]
    version_name = os.environ["VERSION_NAME"]
    commit = os.environ.get("GITHUB_SHA") or command("git", "-C", ROOT, "rev-parse", "HEAD").strip()
    repository = os.environ.get("GITHUB_REPOSITORY", "GhostCodeByte/Runback")
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Expected a full Git commit SHA.")
    require(re.fullmatch(r"[0-9]+", version_code), "Expected a numeric version code.")
    require(re.fullmatch(r"[0-9A-Za-z.+-]+", version_name), "Invalid version name.")
    keytool = shutil.which("keytool")
    if not keytool and os.environ.get("JAVA_HOME"):
        keytool = str(Path(os.environ["JAVA_HOME"]) / "bin" / ("keytool.exe" if windows else "keytool"))
    require(keytool, "Java keytool is required to verify the committed test key.")
    certificate_bytes = subprocess.check_output([
        keytool, "-exportcert", "-keystore", str(ROOT / "android/app/debug.keystore"),
        "-storepass", "android", "-alias", "androiddebugkey",
    ])
    expected_certificate = hashlib.sha256(certificate_bytes).hexdigest()
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    assets = []
    metadata = {"commit": commit, "versionCode": int(version_code), "versionName": version_name,
                "publicTestKey": True, "apps": {}, "ciRun": os.environ.get("GITHUB_RUN_ID")}
    for role, module in [("phone", "app"), ("wear", "wear")]:
        source = ROOT / f"android/{module}/build/outputs/apk/release/{module}-release.apk"
        require(source.is_file(), f"Missing {role} APK: {source}")
        info = inspect_apk(source, aapt, apksigner, expected_certificate, version_code, version_name)
        if role == "phone":
            with zipfile.ZipFile(source) as apk:
                require("assets/index.android.bundle" in apk.namelist(), "Phone APK requires an embedded JS bundle.")
                require(apk.getinfo("assets/index.android.bundle").file_size > 0, "Phone JS bundle is empty.")
            require({"arm64-v8a", "armeabi-v7a", "x86_64"}.issubset(info["abis"]), "Phone APK must support phone and emulator architectures.")
        filename = f"runback-{role}-{version_name}-{commit[:8]}.apk"
        shutil.copyfile(source, output / filename)
        assets.append(filename)
        metadata["apps"][role] = {**info, "file": filename}
    metadata_file = "BUILD-METADATA.json"
    (output / metadata_file).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    assets.append(metadata_file)
    sums = "".join(f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n" for name in assets)
    (output / "SHA256SUMS").write_text(sums, encoding="utf-8")
    source_url = f"https://github.com/{repository}/blob/{commit}"
    ci_run = os.environ.get("GITHUB_RUN_ID")
    ci_line = (f"[CI-Protokoll](https://github.com/{repository}/actions/runs/{ci_run})" if ci_run else "Lokaler Build; kein CI-Lauf behauptet.")
    notes = f"""Automatisches **Test-Release** für Android-Telefon und Wear OS.

Commit: `{commit}` · Version: `{version_name}` · Version code: `{version_code}`

- `runback-phone-*.apk`: Telefon, ARM64 / ARMv7 / x86_64, JavaScript eingebettet; kein Metro-Server nötig.
- `runback-wear-*.apk`: eigenständige Wear-OS-App.
- Beide Apps verwenden `com.runback` und denselben öffentlichen Debug-Testschlüssel. Updates mit `adb install -r` sind möglich.
- `SHA256SUMS` und `BUILD-METADATA.json` dokumentieren Dateien, Versionen und Signatur.

Enthält eine freiwillige Einrichtung mit Import, Statistik unter „Mehr“ und einen optionalen OpenRouter-Trainingschat. `openrouter/free` bleibt Standard; andere Modelle sind erlaubt, ohne Runback-Tageslimit. Den eigenen Schlüssel unter „Mehr → Auswertung & Modelle“ speichern.

Der Workflow prüft TypeScript, JavaScript-Tests, native Core- und Chat-Unit-Tests, Android-Lint, beide Release-Builds sowie APK-Inhalte und Signaturen. {ci_line}

[Installation und Hinweise]({source_url}/README.md) · [Spec]({source_url}/docs/spec.md)

Dieses Release ist Testsoftware. CI baut und prüft automatisch; reale GPS-/Sensorgenauigkeit, Akkuverbrauch, lange Hintergrundaufzeichnung und Geräteverbindungen sind auf echten Geräten nicht vollständig nachgewiesen.
"""
    (output / "RELEASE-NOTES.md").write_text(notes, encoding="utf-8")
    print(f"Verified {len(metadata['apps'])} APKs at {commit}; release assets: {output}")


if __name__ == "__main__":
    main()
