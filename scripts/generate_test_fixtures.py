"""Generate explicitly synthetic, reproducible importer/quality fixtures. No real routes."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import gzip
import zipfile

OUT = Path(__file__).resolve().parents[1] / "test-results" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
start = datetime(2026, 8, 20, 7, tzinfo=timezone.utc)
points = []
elapsed = 0
for i in range(601):
    elapsed += 3 if i < 300 else 4
    stamp = (start + timedelta(seconds=elapsed)).isoformat().replace("+00:00", "Z")
    points.append(f'<trkpt lat="{52.50+i*0.00009:.7f}" lon="13.4000000"><ele>40.0</ele><time>{stamp}</time><extensions><hr>145</hr><cad>170</cad></extensions></trkpt>')
gpx = ('<?xml version="1.0"?><gpx version="1.1" creator="Runback synthetic test fixture" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Synthetischer Testlauf</name><type>running</type><trkseg>' + ''.join(points) + '</trkseg></trk></gpx>').encode()
(OUT / "synthetic-pacing.gpx").write_bytes(gpx)
(OUT / "broken.gpx").write_text('<gpx><trk>broken', encoding="utf-8")
with zipfile.ZipFile(OUT / "synthetic-strava.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("activities/one.gpx", gpx)
    archive.writestr("activities/duplicate.gpx.gz", gzip.compress(gpx))
    archive.writestr("activities/broken.gpx", "<gpx><trk>broken")
    archive.writestr("activities/unsupported.txt", "Not a workout")
print(OUT)
