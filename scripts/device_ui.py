"""Small ADB helper: inspect accessibility nodes and tap by observed exact label."""
import argparse
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
sys.stdout.reconfigure(encoding="utf-8")
parser.add_argument("serial")
parser.add_argument("action", choices=["dump", "tap", "screenshot"])
parser.add_argument("value", nargs="?", default="screen")
args = parser.parse_args()
out = Path(__file__).resolve().parents[1] / "test-results"
out.mkdir(exist_ok=True)

def adb(*cmd):
    return subprocess.run(["adb", "-s", args.serial, *cmd], check=True, capture_output=True).stdout

if args.action == "screenshot":
    adb("shell", "screencap", "-p", "/sdcard/runback-qa.png")
    dest = out / (args.value + ".png")
    adb("pull", "/sdcard/runback-qa.png", str(dest))
    print(dest)
else:
    adb("shell", "uiautomator", "dump", "/sdcard/runback-qa.xml")
    raw = adb("shell", "cat", "/sdcard/runback-qa.xml")
    (out / (args.serial + "-ui.xml")).write_bytes(raw)
    nodes = list(ET.fromstring(raw).iter("node"))
    if args.action == "dump":
        for node in nodes:
            a = node.attrib
            if a.get("text") or a.get("content-desc"):
                print(a.get("text"), "|", a.get("content-desc"), "|", a.get("bounds"))
    else:
        matches = [n for n in nodes if args.value in (n.get("text"), n.get("content-desc"))]
        clickable = [n for n in matches if n.get("clickable") == "true"]
        if clickable:
            matches = clickable
        if len(matches) != 1:
            raise SystemExit(f"Expected one matching node, got {len(matches)}: {args.value}")
        box = list(map(int, re.findall(r"\d+", matches[0].get("bounds", ""))))
        adb("shell", "input", "tap", str((box[0]+box[2])//2), str((box[1]+box[3])//2))
        time.sleep(0.8)
