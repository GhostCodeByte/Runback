package com.runback.imports

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Xml
import com.garmin.fit.Decode
import com.garmin.fit.MesgBroadcaster
import com.garmin.fit.RecordMesgListener
import com.garmin.fit.SessionMesgListener
import com.runback.core.RunMath
import com.runback.core.RunStore
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import java.util.Date
import com.garmin.fit.Activity
import com.garmin.fit.ActivityMesg
import com.garmin.fit.DateTime
import com.garmin.fit.Event
import com.garmin.fit.EventType
import com.garmin.fit.FileEncoder
import com.garmin.fit.FileIdMesg
import com.garmin.fit.File as FitFile
import com.garmin.fit.Manufacturer
import com.garmin.fit.RecordMesg
import com.garmin.fit.SessionMesg
import com.garmin.fit.Sport
import com.garmin.fit.SubSport
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream

/** SAF streams are copied to bounded private temporary files, never bridged through JavaScript. */
class ActivityImporter(private val context: Context, private val store: RunStore) {
    private val running = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)
    private val lock = Any()
    private var progress = JSONObject().put("state", "idle")
    private var expandedBytes = 0L

    fun cancel() { cancelled.set(true) }
    fun status(): JSONObject = synchronized(lock) { JSONObject(progress.toString()) }
    private fun update(block: (JSONObject) -> Unit) = synchronized(lock) { block(progress) }
    private fun checkCancelled() { if (cancelled.get()) throw CancellationException("Import abgebrochen") }

    fun importUris(uris: List<Uri>): JSONObject {
        check(running.compareAndSet(false, true)) { "Ein Import läuft bereits" }
        cancelled.set(false)
        expandedBytes = 0
        update { progress = JSONObject().put("state", "running").put("totalFiles", uris.size)
            .put("processed", 0).put("imported", 0).put("duplicates", 0).put("deleted", 0)
            .put("failed", 0).put("skipped", 0).put("errors", JSONArray()) }
        try {
            require(uris.size <= MAX_ENTRIES) { "Zu viele Dateien (maximal $MAX_ENTRIES)" }
            for (uri in uris) {
                checkCancelled()
                val name = displayName(uri)
                try {
                    val file = File.createTempFile("runback-import-", ".tmp", context.cacheDir)
                    try {
                        context.contentResolver.openInputStream(uri)?.use { copyBounded(it, file, MAX_ARCHIVE_BYTES, false) }
                            ?: error("Datei kann nicht geöffnet werden")
                        if (name.lowercase(Locale.ROOT).endsWith(".zip") || isZip(file)) importZip(file)
                        else processFile(file, name)
                    } finally { file.delete() }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { recordError(name, e) }
            }
            update { it.put("state", "completed") }
        } catch (_: CancellationException) { update { it.put("state", "cancelled") } }
        catch (e: Exception) { recordError("Import", e); update { it.put("state", "failed") } }
        finally { running.set(false) }
        return status()
    }

    private fun displayName(uri: Uri): String = try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        } ?: uri.lastPathSegment ?: "Aktivität"
    } catch (_: Exception) { uri.lastPathSegment ?: "Aktivität" }

    private fun isZip(file: File): Boolean = file.inputStream().use {
        val header = ByteArray(4)
        it.read(header) == 4 && header[0] == 0x50.toByte() && header[1] == 0x4b.toByte()
    }

    private fun importZip(file: File) {
        ZipInputStream(file.inputStream().buffered()).use { zip ->
            var entries = 0
            while (true) {
                checkCancelled()
                val entry = zip.nextEntry ?: break
                require(++entries <= MAX_ENTRIES) { "ZIP enthält zu viele Dateien" }
                // Entry names are labels only; no archive path is ever used on the filesystem.
                if (!entry.isDirectory) {
                    val name = entry.name.substringAfterLast('/').substringAfterLast('\\')
                    if (supported(name)) {
                        val temp = File.createTempFile("runback-entry-", ".tmp", context.cacheDir)
                        try {
                            copyBounded(zip, temp, MAX_FILE_BYTES, true)
                            try { processFile(temp, name) }
                            catch (e: CancellationException) { throw e }
                            catch (e: Exception) { recordError(name, e) }
                        } finally { temp.delete() }
                    } else {
                        // Drain through the same limit so an ignored ZIP bomb cannot bypass the budget.
                        drainBounded(zip)
                        increment("skipped")
                    }
                }
                zip.closeEntry()
            }
        }
    }

    private fun supported(name: String) = name.lowercase(Locale.ROOT).removeSuffix(".gz").let {
        it.endsWith(".gpx") || it.endsWith(".tcx") || it.endsWith(".fit")
    }

    private fun processFile(original: File, name: String) {
        checkCancelled()
        update { it.put("currentFile", name.take(200)) }
        if (!supported(name)) { increment("skipped"); return }
        require(original.length() <= MAX_FILE_BYTES) { "Aktivität ist größer als 64 MB" }
        var expanded: File? = null
        try {
            val file = if (name.lowercase(Locale.ROOT).endsWith(".gz")) {
                File.createTempFile("runback-gzip-", ".tmp", context.cacheDir).also { target ->
                    expanded = target
                    GZIPInputStream(original.inputStream()).use { copyBounded(it, target, MAX_FILE_BYTES, true) }
                }
            } else original
            val builder = ActivityBuilder(name)
            if (name.lowercase(Locale.ROOT).removeSuffix(".gz").endsWith(".fit")) parseFit(file, builder)
            else file.inputStream().buffered().use { parseXml(it, builder) }
            checkCancelled()
            val result = store.addImportedRun(builder.summary(), builder.samples, sha256(file))
            when (result.optString("status")) {
                "imported" -> {
                    val id = result.optString("id", result.optJSONObject("run")?.optString("id") ?: "")
                    if (id.isNotBlank()) store.storeImportedSource(id, original, name)
                    increment("imported")
                }
                "duplicate" -> increment("duplicates")
                "deleted" -> increment("deleted")
                else -> error("Unbekanntes Importergebnis")
            }
            increment("processed")
        } finally { expanded?.delete() }
    }

    private fun increment(key: String) = update { it.put(key, it.optInt(key) + 1) }
    private fun recordError(name: String, error: Exception) = update {
        it.put("failed", it.optInt("failed") + 1)
        val errors = it.getJSONArray("errors")
        if (errors.length() < 50) errors.put(JSONObject().put("file", name.take(200))
            .put("message", (error.message ?: "Datei konnte nicht importiert werden").take(300)))
    }

    private fun copyBounded(input: InputStream, file: File, limit: Long, account: Boolean) {
        var count = 0L
        file.outputStream().buffered().use { out ->
            val buffer = ByteArray(32 * 1024)
            while (true) {
                checkCancelled()
                val n = input.read(buffer)
                if (n < 0) break
                count += n
                require(count <= limit) { "Datei überschreitet das Größenlimit" }
                if (account) accountBytes(n)
                out.write(buffer, 0, n)
            }
        }
    }
    private fun drainBounded(input: InputStream) {
        val buffer = ByteArray(32 * 1024)
        while (true) { checkCancelled(); val n = input.read(buffer); if (n < 0) break; accountBytes(n) }
    }
    private fun accountBytes(n: Int) {
        expandedBytes += n
        require(expandedBytes <= MAX_ARCHIVE_BYTES) { "Entpackte Dateien überschreiten 512 MB" }
    }
    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(32 * 1024)
            while (true) { checkCancelled(); val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun parseXml(input: InputStream, builder: ActivityBuilder) {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
        parser.setInput(input, null)
        var point: MutableMap<String, String>? = null
        var leaf = ""
        val text = StringBuilder()
        var depth = 0
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            checkCancelled()
            when (parser.eventType) {
                XmlPullParser.DOCDECL -> error("XML-Dokumenttypen werden nicht unterstützt")
                XmlPullParser.START_TAG -> {
                    require(++depth <= 64) { "XML ist zu tief verschachtelt" }
                    leaf = parser.name.lowercase(Locale.ROOT)
                    text.setLength(0)
                    if (leaf == "trkpt" || leaf == "rtept" || leaf == "trackpoint") {
                        point = mutableMapOf()
                        parser.getAttributeValue(null, "lat")?.let { point?.put("lat", it) }
                        parser.getAttributeValue(null, "lon")?.let { point?.put("lon", it) }
                    }
                }
                XmlPullParser.TEXT -> {
                    require(text.length + parser.text.length <= 16384) { "XML-Text ist zu lang" }
                    text.append(parser.text)
                }
                XmlPullParser.END_TAG -> {
                    val tag = parser.name.lowercase(Locale.ROOT)
                    if (tag == leaf && point != null) point[tag] = text.toString().trim()
                    if (tag == "trkpt" || tag == "rtept" || tag == "trackpoint") {
                        val p = point ?: emptyMap()
                        val time = parseTime(p["time"])
                        if (time != null) {
                            builder.point(time, (p["lat"] ?: p["latitudedegrees"])?.toDoubleOrNull(),
                                (p["lon"] ?: p["longitudedegrees"])?.toDoubleOrNull(),
                                (p["ele"] ?: p["altitudemeters"])?.toDoubleOrNull(), p["speed"]?.toDoubleOrNull(),
                                (p["hr"] ?: p["value"])?.toDoubleOrNull(),
                                (p["cad"] ?: p["cadence"] ?: p["runcadence"])?.toDoubleOrNull())
                            p["distancemeters"]?.toDoubleOrNull()?.let { builder.reportedDistance = maxOf(builder.reportedDistance, it) }
                        }
                        point = null
                    }
                    depth--
                    text.setLength(0)
                }
            }
            parser.nextToken()
        }
    }

    private fun parseFit(file: File, builder: ActivityBuilder) {
        val decode = Decode()
        val broadcaster = MesgBroadcaster(decode)
        broadcaster.addListener(RecordMesgListener { record ->
            checkCancelled()
            val time = record.timestamp?.date?.time ?: return@RecordMesgListener
            builder.point(time, record.positionLat?.let { it * 180.0 / 2147483648.0 },
                record.positionLong?.let { it * 180.0 / 2147483648.0 },
                (record.enhancedAltitude ?: record.altitude)?.toDouble(),
                (record.enhancedSpeed ?: record.speed)?.toDouble(), record.heartRate?.toDouble(), record.cadence?.toDouble())
            record.distance?.toDouble()?.let { builder.reportedDistance = maxOf(builder.reportedDistance, it) }
        })
        broadcaster.addListener(SessionMesgListener { session ->
            session.totalDistance?.toDouble()?.let { builder.reportedDistance = maxOf(builder.reportedDistance, it) }
            session.totalTimerTime?.toDouble()?.let { builder.reportedDuration = it }
        })
        file.inputStream().buffered().use { require(decode.read(it, broadcaster, broadcaster)) { "FIT-Datei ist beschädigt" } }
    }

    /** Writes an exchange copy from the immutable store data; this is never a backup. */
    fun exportRun(id: String, extension: String, output: OutputStream) {
        val run = store.detail(id)
        val samples = store.rawSamples(id)
        when (extension.lowercase(Locale.ROOT)) {
            "json" -> output.writer(StandardCharsets.UTF_8).apply { write(JSONObject().put("run", run).put("samples", samples).toString(2)); flush() }
            "gpx" -> writeGpx(run, samples, output)
            "fit" -> writeFit(run, samples, output)
            else -> error("Unterstützt: GPX, JSON, FIT")
        }
    }

    private fun writeGpx(run: JSONObject, samples: JSONArray, output: OutputStream) {
        val b = StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"Runback\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v1\"><trk><name>")
        b.append(xml(run.optString("name", "Runback activity"))).append("</name><trkseg>")
        var previous = Long.MIN_VALUE
        for (i in 0 until samples.length()) {
            val sample = samples.optJSONObject(i) ?: continue
            if (sample.optString("kind") != "gps") continue
            val values = sample.optJSONObject("values") ?: continue
            val time = sample.optLong("time", Long.MIN_VALUE)
            val lat = values.optDouble("latitude", Double.NaN); val lon = values.optDouble("longitude", Double.NaN)
            if (!lat.isFinite() || !lon.isFinite() || time == Long.MIN_VALUE) continue
            if (previous != Long.MIN_VALUE && time - previous > 5 * 60 * 1000L) b.append("</trkseg><trkseg>")
            b.append("<trkpt lat=\"").append(lat).append("\" lon=\"").append(lon).append("\">")
            if (values.has("altitudeM")) b.append("<ele>").append(values.optDouble("altitudeM")).append("</ele>")
            b.append("<time>").append(Instant.ofEpochMilli(time)).append("</time>")
            b.append("</trkpt>"); previous = time
        }
        b.append("</trkseg></trk></gpx>")
        output.write(b.toString().toByteArray(StandardCharsets.UTF_8))
    }

    private fun writeFit(run: JSONObject, samples: JSONArray, output: OutputStream) {
        val temp = File.createTempFile("runback-export-", ".fit", context.cacheDir)
        try {
            val encoder = FileEncoder(temp)
            val fileId = FileIdMesg().apply { type = FitFile.ACTIVITY; manufacturer = Manufacturer.GARMIN; productName = "Runback" }
            encoder.write(fileId)
            for (i in 0 until samples.length()) {
                val sample = samples.optJSONObject(i) ?: continue
                val time = sample.optLong("time", Long.MIN_VALUE); if (time == Long.MIN_VALUE) continue
                val values = sample.optJSONObject("values") ?: continue
                val record = RecordMesg().apply {
                    timestamp = DateTime(Date(time))
                    values.optDouble("latitude", Double.NaN).takeIf { it.isFinite() }?.let { positionLat = (it * 2147483648.0 / 180.0).toInt() }
                    values.optDouble("longitude", Double.NaN).takeIf { it.isFinite() }?.let { positionLong = (it * 2147483648.0 / 180.0).toInt() }
                    values.optDouble("altitudeM", Double.NaN).takeIf { it.isFinite() }?.let { altitude = it.toFloat() }
                    values.optDouble("speedMps", Double.NaN).takeIf { it.isFinite() }?.let { speed = it.toFloat() }
                    values.optDouble("bpm", Double.NaN).takeIf { it.isFinite() }?.let { heartRate = it.toInt().toShort() }
                    values.optDouble("rpm", Double.NaN).takeIf { it.isFinite() }?.let { cadence = it.toInt().toShort() }
                }
                encoder.write(record)
            }
            val start = run.optLong("startTime", Long.MIN_VALUE)
            val end = run.optLong("endTime", start)
            if (start != Long.MIN_VALUE) {
                val session = SessionMesg().apply {
                    startTime = DateTime(Date(start)); timestamp = DateTime(Date(end))
                    event = Event.SESSION; eventType = EventType.STOP
                    sport = Sport.RUNNING; subSport = SubSport.GENERIC
                    val duration = run.optDouble("durationSeconds", ((end - start) / 1000.0)).toFloat()
                    totalElapsedTime = duration; totalTimerTime = duration
                    run.optDouble("distanceMeters", Double.NaN).takeIf { it.isFinite() }?.let { totalDistance = it.toFloat() }
                    run.optDouble("avgHeartRate", Double.NaN).takeIf { it.isFinite() }?.let { avgHeartRate = it.toInt().toShort() }
                    run.optDouble("avgCadence", Double.NaN).takeIf { it.isFinite() }?.let { avgCadence = it.toInt().toShort() }
                }
                encoder.write(session)
                encoder.write(ActivityMesg().apply {
                    timestamp = DateTime(Date(end)); totalTimerTime = session.totalTimerTime
                    numSessions = 1; type = Activity.MANUAL; event = Event.ACTIVITY; eventType = EventType.STOP
                })
            }
            encoder.close()
            temp.inputStream().use { it.copyTo(output) }
        } finally { temp.delete() }
    }

    private fun xml(value: String): String = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;")

    private inner class ActivityBuilder(private val name: String) {
        val samples = JSONArray()
        var reportedDistance = 0.0
        var reportedDuration: Double? = null
        private var start = Long.MAX_VALUE
        private var end = 0L
        private var distance = 0.0
        private var previous: Triple<Long, Double, Double>? = null
        private var hrTotal = 0.0
        private var hrCount = 0
        private var cadenceTotal = 0.0
        private var cadenceCount = 0
        fun point(time: Long, lat: Double?, lon: Double?, altitude: Double?, speed: Double?, hr: Double?, cadence: Double?) {
            require(samples.length() < MAX_SAMPLES - 3) { "Aktivität enthält zu viele Messwerte" }
            start = minOf(start, time); end = maxOf(end, time)
            if (lat != null && lon != null && lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0) {
                val values = JSONObject().put("latitude", lat).put("longitude", lon)
                altitude?.takeIf { it.isFinite() }?.let { values.put("altitudeM", it) }
                speed?.takeIf { it.isFinite() && it >= 0 }?.let { values.put("speedMps", it) }
                add(time, "gps", values)
                previous?.let { p -> if (time > p.first) distance += RunMath.distanceMeters(p.second, p.third, lat, lon) }
                previous = Triple(time, lat, lon)
            }
            hr?.takeIf { it.isFinite() && it in 1.0..255.0 }?.let {
                add(time, "heartRate", JSONObject().put("bpm", it)); hrTotal += it; hrCount++
            }
            cadence?.takeIf { it.isFinite() && it in 0.0..300.0 }?.let {
                add(time, "cadence", JSONObject().put("rpm", it)); cadenceTotal += it; cadenceCount++
            }
        }
        private fun add(time: Long, kind: String, values: JSONObject) {
            samples.put(JSONObject().put("time", time).put("kind", kind).put("values", values))
        }
        fun summary(): JSONObject {
            require(samples.length() > 0 && start != Long.MAX_VALUE) { "Keine zeitgestempelten Aktivitätsdaten gefunden" }
            return JSONObject().put("name", name.removeSuffix(".gz").substringBeforeLast('.').take(120))
                .put("startTime", start).put("endTime", end)
                .put("durationSeconds", reportedDuration?.takeIf { it.isFinite() && it >= 0 } ?: ((end - start) / 1000.0))
                .put("distanceMeters", if (reportedDistance.isFinite() && reportedDistance > 0) reportedDistance else distance)
                .put("purpose", "unknown").put("source", "import")
                .put("avgHeartRate", if (hrCount > 0) hrTotal / hrCount else JSONObject.NULL)
                .put("avgCadence", if (cadenceCount > 0) cadenceTotal / cadenceCount else JSONObject.NULL)
        }
    }

    companion object {
        private const val MAX_FILE_BYTES = 64L * 1024 * 1024
        private const val MAX_ARCHIVE_BYTES = 512L * 1024 * 1024
        private const val MAX_ENTRIES = 2000
        private const val MAX_SAMPLES = 150000
        internal fun parseTime(value: String?): Long? = value?.let {
            try { Instant.parse(it).toEpochMilli() }
            catch (_: Exception) { try { OffsetDateTime.parse(it).toInstant().toEpochMilli() } catch (_: Exception) { null } }
        }
    }
}
