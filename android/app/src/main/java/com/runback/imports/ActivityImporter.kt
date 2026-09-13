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
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
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
import java.util.zip.ZipException

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
            .put("failed", 0).put("skipped", 0).put("nonRunning", 0).put("errors", JSONArray()) }
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
        ImportArchive(
            tempRoot = context.cacheDir,
            maxEntries = MAX_ENTRIES,
            maxDepth = 2,
            copyBounded = { input, target -> copyBounded(input, target, MAX_FILE_BYTES, true) },
            drainBounded = ::drainBounded,
            supported = ::supported,
            checkCancelled = ::checkCancelled,
            process = ::processFile,
            onError = ::recordError,
            onSkipped = { increment("skipped") },
            supportedEntry = ::supportedEntry,
            drainIgnored = ::drainIgnored,
        ).import(file)
    }

    private fun supported(name: String) = name.lowercase(Locale.ROOT).removeSuffix(".gz").let {
        it.endsWith(".gpx") || it.endsWith(".tcx") || it.endsWith(".fit") ||
            it.endsWith(".csv") || it.endsWith(".json") || it.endsWith(".xml")
    }

    /**
     * Google Health Takeout contains more than 500 MB of unrelated exports.
     * Keep the files that carry workouts or bounded context and drain the rest
     * without charging them against the useful-data budget.
     */
    private fun supportedEntry(name: String, entryPath: String): Boolean {
        if (!supported(name)) return false
        val path = entryPath.lowercase(Locale.ROOT)
        if (!path.contains("google health")) return true
        val kind = VendorImports.fitbitFileKind(name, entryPath)
        if (kind in setOf("exercise", "exercise_csv", "sleep", "sleep_csv", "sleep_score_csv",
                "sleep_stage_csv", "resting_hr", "weight", "heart_rate", "hrv", "vo2max", "vo2max_csv",
                "steps", "calories", "active_minutes", "active_energy")) return true
        // Keep the compact daily HRV CSVs even when their filename is localized.
        if (path.contains("heart rate variability") && (path.endsWith(".csv") || path.endsWith(".json"))) return true
        return false
    }

    private fun processFile(original: File, name: String, entryPath: String = "") {
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
            val lower = name.lowercase(Locale.ROOT).removeSuffix(".gz")
            when {
                lower.endsWith(".fit") || lower.endsWith(".gpx") || lower.endsWith(".tcx") -> importTrackFile(file, original, name, entryPath)
                lower.endsWith(".xml") -> importVendorFile(file, if (name.endsWith(".gz", true)) name.dropLast(3) else name, entryPath)
                lower.endsWith(".csv") || lower.endsWith(".json") -> importVendorFile(file, if (name.endsWith(".gz", true)) name.dropLast(3) else name, entryPath)
                else -> increment("skipped")
            }
        } finally { expanded?.delete() }
    }

    private fun importTrackFile(file: File, original: File, name: String, entryPath: String) {
        val builder = ActivityBuilder(name)
        if (name.lowercase(Locale.ROOT).removeSuffix(".gz").endsWith(".fit")) parseFit(file, builder)
        else file.inputStream().buffered().use { parseXml(it, builder) }
        checkCancelled()
        val summary = builder.summary()
        // Spaziergaenge und Radfahrten werden nicht als Lauf gespeichert: sie
        // verzerren sonst jede Tempoauswertung und die Wochenstatistik.
        if (!VendorImports.acceptAsRun(builder.activityType,
                summary.optDouble("distanceMeters", 0.0), summary.optDouble("durationSeconds", 0.0))) {
            increment("nonRunning")
            increment("processed")
            return
        }
        val result = store.addImportedRun(summary, builder.samples, sha256(file))
        if (result.optString("status") == "imported") {
            val id = result.optString("id", result.optJSONObject("run")?.optString("id") ?: "")
            if (id.isNotBlank()) store.storeImportedSource(id, original, name)
        }
        val vendor = VendorImports.detectVendor(name, entryPath)?.name?.lowercase(Locale.ROOT) ?: "generic"
        recordImported(result, vendor)
        increment("processed")
    }

    /**
     * Optional vendor exports (Strong, Apple Health, Samsung, Fitbit, Google Fit,
     * Mi Fitness, Garmin, Polar, Strava, Huawei). Each file contributes runs,
     * wellness context and/or strength sessions; unknown content is counted as skipped
     * instead of inventing data.
     */
    private fun importVendorFile(file: File, name: String, entryPath: String) {
        val vendor = VendorImports.detectVendor(name, entryPath)
        val lower = name.lowercase(Locale.ROOT).removeSuffix(".gz")
        val fitbitKind = VendorImports.fitbitFileKind(name, entryPath)
        val strongMeasurement = VendorImports.strongMeasurementKind(name)
        var handled = false
        when {
            lower.endsWith(".xml") || name.equals("export.xml", ignoreCase = true) ->
                handled = importAppleExportXml(file, name)
            lower.endsWith(".csv") && isStrongCsv(file) ->
                handled = importStrongCsv(file, name)
            lower.endsWith(".csv") && strongMeasurement != null && isStrongMeasurementCsv(file, name) ->
                handled = importStrongMeasurementCsv(file, name, strongMeasurement)
            lower.endsWith(".csv") && fitbitKind == "exercise_csv" ->
                handled = importFitbitExerciseCsv(file, name)
            lower.endsWith(".csv") && fitbitKind in FITBIT_CONTEXT_CSV_KINDS ->
                handled = importFitbitContextCsv(file, name, entryPath, fitbitKind)
            lower.endsWith(".csv") && VendorImports.samsungFileKind(name) != "other" ->
                handled = importSamsungCsv(file, name)
            lower.endsWith(".csv") && VendorImports.miFitnessFileKind(name) != "other" ->
                handled = importMiFitnessCsv(file, name)
            lower.endsWith(".csv") ->
                handled = importActivitiesCsv(file, name, (vendor?.name ?: "generic").lowercase(Locale.ROOT))
            lower.endsWith(".json") ->
                handled = importVendorJson(file, name, entryPath, vendor)
        }
        if (!handled) increment("skipped")
        else increment("processed")
    }

    private fun noteVendor(vendor: String, imported: Int, duplicates: Int, wellness: Int, strength: Int) = update {
        val vendors = it.optJSONObject("vendors") ?: JSONObject().also { obj -> it.put("vendors", obj) }
        val current = vendors.optJSONObject(vendor) ?: JSONObject().put("imported", 0).put("duplicates", 0)
            .put("wellness", 0).put("strength", 0).also { obj -> vendors.put(vendor, obj) }
        current.put("imported", current.optInt("imported") + imported)
        current.put("duplicates", current.optInt("duplicates") + duplicates)
        current.put("wellness", current.optInt("wellness") + wellness)
        current.put("strength", current.optInt("strength") + strength)
        it.put("wellness", it.optInt("wellness") + wellness)
        it.put("strength", it.optInt("strength") + strength)
    }

    private fun recordImported(summaryHash: JSONObject, vendor: String) {
        when (summaryHash.optString("status")) {
            "imported" -> { increment("imported"); noteVendor(vendor, 1, 0, 0, 0) }
            "duplicate" -> { increment("duplicates"); noteVendor(vendor, 0, 1, 0, 0) }
            "deleted" -> increment("deleted")
            else -> error("Unbekanntes Importergebnis")
        }
    }

    private fun isStrongCsv(file: File): Boolean = try {
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(readText(file).lineSequence().firstOrNull() ?: return false))
        VendorImports.isStrongHeader(header)
    } catch (_: Exception) { false }

    private fun importStrongCsv(file: File, name: String): Boolean {
        val text = readText(file)
        val parsed = VendorImports.parseStrongCsv(text, "strong")
        var strength = 0
        for (workout in parsed.workouts) {
            checkCancelled()
            store.addStrengthWorkout(workout, parsed.setsByWorkout[workout.id] ?: emptyList())
            strength++
        }
        noteVendor("strong", 0, 0, 0, strength)
        return true
    }

    private fun isStrongMeasurementCsv(file: File, name: String): Boolean = try {
        val kind = VendorImports.strongMeasurementKind(name) ?: return false
        val header = VendorImports.splitCsvLine(
            VendorImports.stripBom(readText(file).lineSequence().firstOrNull() ?: return false), ';')
        VendorImports.findHeaderIndex(header, "date") >= 0 && header.size >= 2 && kind.isNotBlank()
    } catch (_: Exception) { false }

    private fun importStrongMeasurementCsv(file: File, name: String, kind: String): Boolean {
        val text = readText(file)
        val lines = text.lineSequence().take(VendorImports.MAX_CSV_ROWS + 1).toList()
        if (lines.size < 2) return false
        val delimiter = VendorImports.csvDelimiter(lines.first())
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(lines.first()), delimiter)
        val cDate = VendorImports.findHeaderIndex(header, "date", "datum")
        val cValue = (1 until header.size).firstOrNull { i ->
            VendorImports.normalizeHeader(header[i]) !in setOf("date", "datum")
        } ?: return false
        val unit = VendorImports.strongMeasurementUnit(kind)
        val rows = ArrayList<com.runback.core.WellnessRow>()
        for (raw in lines.drop(1)) {
            if (raw.isBlank()) continue
            checkCancelled()
            val cells = VendorImports.splitCsvLine(raw, delimiter)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val time = VendorImports.parseTimeFlexible(get(cDate)) ?: continue
            val value = VendorImports.parseDoubleFlexible(get(cValue)) ?: continue
            if (!value.isFinite()) continue
            val valid = when (kind) {
                "weight" -> value in 1.0..500.0
                "body_fat" -> value in 0.0..80.0
                "calories_intake" -> value in 0.0..100000.0
                else -> value in 0.0..500.0
            }
            if (!valid) continue
            rows.add(com.runback.core.WellnessRow(
                VendorImports.wellnessId(kind, time, "strong", value), kind, time, 0L, value,
                unit, "strong", JSONObject().put("file", name.take(120)).toString()))
        }
        if (rows.isEmpty()) return false
        noteVendor("strong", 0, 0, store.addWellnessBatch(rows), 0)
        return true
    }

    private fun importFitbitExerciseCsv(file: File, name: String): Boolean {
        val parsed = VendorImports.parseFitbitExerciseCsv(readText(file), "fitbit")
        for (draft in parsed.runs) {
            checkCancelled()
            if (!acceptDraft(draft, draft.sourceActivityType)) continue
            recordImported(store.addSummaryRun(summaryFromDraft(draft),
                "vendor:fitbit:${sha256(file)}:${draft.sourceActivityId ?: draft.startTime}"), "fitbit")
        }
        if (parsed.runs.isEmpty()) increment("skipped")
        return true
    }

    private fun importFitbitContextCsv(file: File, name: String, entryPath: String, kind: String): Boolean {
        val lines = readText(file).lineSequence().take(VendorImports.MAX_CSV_ROWS + 1).toList()
        if (lines.size < 2) return false
        val delimiter = VendorImports.csvDelimiter(lines.first())
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(lines.first()), delimiter)
        val rows = ArrayList<com.runback.core.WellnessRow>()
        fun get(cells: List<String>, index: Int): String = if (index >= 0 && index < cells.size) cells[index] else ""
        fun add(kindName: String, time: Long, end: Long, value: Double, unit: String, extra: JSONObject = JSONObject()) {
            if (!value.isFinite() || rows.size >= VendorImports.MAX_JSON_WELLNESS) return
            rows.add(com.runback.core.WellnessRow(
                VendorImports.wellnessId(kindName, time, "fitbit", value), kindName, time, end, value, unit,
                "fitbit", extra.toString()))
        }
        when (kind) {
            "sleep_csv" -> {
                val cStart = VendorImports.findHeaderIndex(header, "sleep start", "start")
                val cEnd = VendorImports.findHeaderIndex(header, "sleep end", "end")
                val cAsleep = VendorImports.findHeaderIndex(header, "minutes asleep", "asleep")
                val cAwake = VendorImports.findHeaderIndex(header, "minutes awake", "awake")
                val cBed = VendorImports.findHeaderIndex(header, "minutes in sleep period", "time in bed")
                if (cStart < 0) return false
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val start = VendorImports.parseTimeFlexible(get(cells, cStart)) ?: continue
                    val end = VendorImports.parseTimeFlexible(get(cells, cEnd)) ?: start
                    val asleep = VendorImports.parseDoubleFlexible(get(cells, cAsleep))
                        ?: VendorImports.parseDoubleFlexible(get(cells, cBed)) ?: continue
                    if (asleep !in 0.0..1440.0) continue
                    add("sleep_session", start, end, asleep, "min", JSONObject()
                        .put("minutesAwake", VendorImports.parseDoubleFlexible(get(cells, cAwake)) ?: JSONObject.NULL)
                        .put("timeInBed", VendorImports.parseDoubleFlexible(get(cells, cBed)) ?: JSONObject.NULL))
                }
            }
            "sleep_score_csv" -> {
                val cTime = VendorImports.findHeaderIndex(header, "score time", "sleep score time")
                val cScore = VendorImports.findHeaderIndex(header, "overall score")
                val cDeep = VendorImports.findHeaderIndex(header, "deep sleep minutes")
                val cRem = VendorImports.findHeaderIndex(header, "rem sleep percent")
                val cResting = VendorImports.findHeaderIndex(header, "resting heart rate")
                if (cTime < 0) return false
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val time = VendorImports.parseTimeFlexible(get(cells, cTime)) ?: continue
                    val score = VendorImports.parseDoubleFlexible(get(cells, cScore))
                    if (score != null && score in 0.0..100.0) add("sleep_score", time, 0L, score, "score",
                        JSONObject().put("deepMinutes", VendorImports.parseDoubleFlexible(get(cells, cDeep)) ?: JSONObject.NULL)
                            .put("remPercent", VendorImports.parseDoubleFlexible(get(cells, cRem)) ?: JSONObject.NULL))
                    val resting = VendorImports.parseDoubleFlexible(get(cells, cResting))
                    if (resting != null && resting in 30.0..120.0) add("resting_hr", time, 0L, resting, "bpm")
                }
            }
            "sleep_stage_csv" -> {
                val cStart = VendorImports.findHeaderIndex(header, "sleep stage start", "stage start", "start")
                val cEnd = VendorImports.findHeaderIndex(header, "sleep stage end", "stage end", "end")
                val cStage = VendorImports.findHeaderIndex(header, "sleep stage type", "stage", "type")
                if (cStart < 0 || cStage < 0) return false
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val start = VendorImports.parseTimeFlexible(get(cells, cStart)) ?: continue
                    val end = VendorImports.parseTimeFlexible(get(cells, cEnd)) ?: start
                    val minutes = ((end - start) / 60000.0).takeIf { it > 0.0 && it <= 1440.0 } ?: continue
                    add("sleep_stage", start, end, minutes, "min",
                        JSONObject().put("stage", get(cells, cStage).take(20)))
                }
            }
            "hrv" -> {
                val cTime = VendorImports.findHeaderIndex(header, "timestamp", "time")
                val cRmssd = VendorImports.findHeaderIndex(header, "rmssd")
                val cNrem = VendorImports.findHeaderIndex(header, "nremhr", "nrem hr")
                val cEntropy = VendorImports.findHeaderIndex(header, "entropy")
                if (cTime < 0) return false
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val time = VendorImports.parseTimeFlexible(get(cells, cTime)) ?: continue
                    val rmssd = VendorImports.parseDoubleFlexible(get(cells, cRmssd))
                    if (rmssd != null && rmssd in 1.0..500.0) add("hrv_rmssd", time, 0L, rmssd, "ms")
                    val nrem = VendorImports.parseDoubleFlexible(get(cells, cNrem))
                    if (nrem != null && nrem in 30.0..240.0) add("sleep_hr", time, 0L, nrem, "bpm")
                    val entropy = VendorImports.parseDoubleFlexible(get(cells, cEntropy))
                    if (entropy != null && entropy >= 0.0) add("hrv_entropy", time, 0L, entropy, "score")
                }
            }
            "vo2max", "vo2max_csv" -> {
                val cTime = VendorImports.findHeaderIndex(header, "timestamp", "time")
                val cValue = VendorImports.findHeaderIndex(header, "run vo2 max", "demographic vo2max",
                    "demographic vo2 max", "vo2 max value", "daily vo2 max value", "vo2 max")
                if (cTime < 0 || cValue < 0) return false
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val time = VendorImports.parseTimeFlexible(get(cells, cTime)) ?: continue
                    val value = VendorImports.parseDoubleFlexible(get(cells, cValue)) ?: continue
                    if (value in 10.0..100.0) add("vo2max", time, 0L, value, "ml/kg/min")
                }
            }
            "steps", "calories", "active_minutes", "active_energy" -> {
                val cTime = VendorImports.findHeaderIndex(header, "timestamp", "time")
                if (cTime < 0) return false
                val valueColumns = when (kind) {
                    "steps" -> listOf(VendorImports.findHeaderIndex(header, "steps"))
                    "calories" -> listOf(VendorImports.findHeaderIndex(header, "calories"))
                    "active_energy" -> listOf(VendorImports.findHeaderIndex(header, "kilocalories", "kcal", "calories"))
                    else -> listOf(
                        VendorImports.findHeaderIndex(header, "light"),
                        VendorImports.findHeaderIndex(header, "moderate"),
                        VendorImports.findHeaderIndex(header, "very"),
                    )
                }.filter { it >= 0 }
                if (valueColumns.isEmpty()) return false
                data class Bucket(
                    var first: Long = Long.MAX_VALUE,
                    var last: Long = 0L,
                    var sum: Double = 0.0,
                    var min: Double = Double.POSITIVE_INFINITY,
                    var max: Double = Double.NEGATIVE_INFINITY,
                    var count: Int = 0,
                )
                val buckets = linkedMapOf<Long, Bucket>()
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val time = VendorImports.parseTimeFlexible(get(cells, cTime)) ?: continue
                    val values = valueColumns.mapNotNull { VendorImports.parseDoubleFlexible(get(cells, it)) }
                    if (values.isEmpty()) continue
                    val value = values.sum()
                    if (!value.isFinite() || value < 0.0) continue
                    val bucket = buckets.getOrPut(fitbitDayStart(get(cells, cTime), time)) { Bucket() }
                    bucket.first = minOf(bucket.first, time); bucket.last = maxOf(bucket.last, time)
                    bucket.sum += value; bucket.min = minOf(bucket.min, value); bucket.max = maxOf(bucket.max, value)
                    bucket.count++
                }
                buckets.toSortedMap().forEach { (day, bucket) ->
                    val unit = when (kind) {
                        "steps" -> "count"
                        "active_minutes" -> "min"
                        else -> "kcal"
                    }
                    add(kind, day, bucket.last, bucket.sum, unit,
                        JSONObject().put("aggregate", "sum").put("count", bucket.count)
                            .put("min", bucket.min).put("max", bucket.max))
                }
            }
            else -> return false
        }
        if (rows.isEmpty()) return false
        noteVendor("fitbit", 0, 0, store.addWellnessBatch(rows), 0)
        return true
    }

    private fun importActivitiesCsv(file: File, name: String, vendor: String): Boolean {
        val text = readText(file)
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(text.lineSequence().firstOrNull() ?: return false))
        if (!VendorImports.isGenericActivitiesHeader(header)) return false
        val source = if (VendorImports.isStravaActivitiesHeader(header)) "strava" else vendor
        val parsed = VendorImports.parseActivitiesCsv(text, source)
        for (draft in parsed.runs) {
            checkCancelled()
            val summary = summaryFromDraft(draft)
            recordImported(store.addSummaryRun(summary, "vendor:$source:${sha256(file)}:${draft.startTime}"), source)
        }
        if (parsed.runs.isEmpty()) increment("skipped")
        return true
    }

    /** Gibt true zurueck, wenn der Entwurf als Lauf gespeichert werden darf. */
    private fun acceptDraft(draft: VendorImports.RunDraft, activityType: String? = null): Boolean {
        if (VendorImports.acceptAsRun(activityType, draft.distanceMeters, draft.durationSeconds)) return true
        increment("nonRunning")
        return false
    }

    private fun summaryFromDraft(draft: VendorImports.RunDraft): JSONObject =
        JSONObject().put("name", draft.name).put("startTime", draft.startTime).put("endTime", draft.endTime)
            .put("durationSeconds", draft.durationSeconds).put("distanceMeters", draft.distanceMeters)
            .put("purpose", "unknown").put("source", draft.source).put("status", "completed")
            .put("importVersion", VendorImports.IMPORT_VERSION)
            .put("avgHeartRate", draft.avgHeartRate ?: JSONObject.NULL).also { summary ->
                draft.calories?.let { summary.put("calories", it) }
                draft.steps?.let { summary.put("steps", it) }
                draft.elevationGainMeters?.let { summary.put("elevationGainMeters", it) }
                draft.sourceActivityId?.let { summary.put("sourceActivityId", it) }
                draft.sourceActivityType?.let { summary.put("sourceActivityType", it) }
                draft.details?.let { details ->
                    try { summary.put("importDetails", JSONObject(details)) }
                    catch (_: Exception) { summary.put("importDetails", details.take(2000)) }
                }
            }

    private fun importMiFitnessCsv(file: File, name: String): Boolean {
        val kind = VendorImports.miFitnessFileKind(name)
        val text = readText(file)
        if (kind == "sport") return importMiFitnessSportRecord(text, name)
        if (kind == "fitness_data") return importMiFitnessFitnessData(text, name)
        if (kind == "sport_track") return false
        val lines = text.lineSequence().take(VendorImports.MAX_CSV_ROWS + 1).toList()
        if (lines.size < 2) return false
        val delimiter = VendorImports.csvDelimiter(lines.first())
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(lines.first()), delimiter).map { it.lowercase(Locale.ROOT) }
        fun col(vararg names: String): Int {
            names.forEach { want -> val i = header.indexOfFirst { it.contains(want) }; if (i >= 0) return i }
            return -1
        }
        when (kind) {
            "sport" -> {
                val cStart = col("start", "begin", "time"); val cType = col("type", "sport")
                val cDist = col("dist"); val cDur = col("dur", "elapsed", "cost")
                val cCal = col("calor"); val cHr = col("heart", "hr", "bpm")
                if (cStart < 0) return false
                for (raw in lines.drop(1)) {
                    if (raw.isBlank()) continue
                    checkCancelled()
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
                    val type = get(cType)
                    val isRun = type.lowercase(Locale.ROOT).contains("run") || type.contains("跑") ||
                        type.contains("lauf") || type.trim() in listOf("1", "9", "10") || type.isBlank()
                    if (!isRun) continue
                    val start = VendorImports.parseTimeFlexible(get(cStart)) ?: continue
                    val distance = VendorImports.parseDoubleFlexible(get(cDist)) ?: 0.0
                    val distM = if (distance > 0 && distance < 500) distance * 1000 else distance
                    val duration = VendorImports.parseDurationFlexible(get(cDur))
                        ?: VendorImports.parseDoubleFlexible(get(cDur)) ?: 0.0
                    if (distM <= 0 && duration <= 0) continue
                    val end = start + (duration * 1000).toLong().coerceIn(0, 24 * 3600 * 1000L)
                    val draft = VendorImports.RunDraft(start, if (end > start) end else start, duration, distM,
                        "Mi Fitness Lauf", "mi_fitness",
                        VendorImports.parseDoubleFlexible(get(cHr))?.takeIf { it in 30.0..240.0 },
                        VendorImports.parseDoubleFlexible(get(cCal)))
                    if (!acceptDraft(draft, type)) continue
                    recordImported(store.addSummaryRun(summaryFromDraft(draft),
                        "vendor:mi_fitness:${sha256(file)}:$start"), "mi_fitness")
                }
                return true
            }
            "heart_rate", "steps" -> {
                val wellnessKind = if (kind == "heart_rate") "heart_rate" else "steps"
                val unit = if (kind == "heart_rate") "bpm" else "count"
                val rows = ArrayList<com.runback.core.WellnessRow>()
                for (raw in lines.drop(1)) {
                    if (raw.isBlank() || rows.size >= VendorImports.MAX_JSON_WELLNESS) break
                    val cells = VendorImports.splitCsvLine(raw, delimiter)
                    val time = cells.firstNotNullOfOrNull { VendorImports.parseTimeFlexible(it) } ?: continue
                    val value = cells.mapNotNull { VendorImports.parseDoubleFlexible(it) }
                        .firstOrNull { it in 1.0..100000.0 } ?: continue
                    if (wellnessKind == "heart_rate" && value !in 30.0..240.0) continue
                    rows.add(com.runback.core.WellnessRow(
                        VendorImports.wellnessId(wellnessKind, time, "mi_fitness", value),
                        wellnessKind, time, 0L, value, unit, "mi_fitness", "{}"))
                }
                val inserted = store.addWellnessBatch(rows)
                noteVendor("mi_fitness", 0, 0, inserted, 0)
                return true
            }
            else -> return false
        }
    }

    /** Mi Fitness DSGVO sport_record.csv: the metrics are JSON in the Value column. */
    private fun importMiFitnessSportRecord(text: String, name: String): Boolean {
        val lines = text.lineSequence().take(VendorImports.MAX_CSV_ROWS + 1).toList()
        if (lines.size < 2) return false
        val delimiter = VendorImports.csvDelimiter(lines.first())
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(lines.first()), delimiter)
        val cKey = VendorImports.findHeaderIndex(header, "key")
        val cTime = VendorImports.findHeaderIndex(header, "time")
        val cCategory = VendorImports.findHeaderIndex(header, "category")
        val cValue = VendorImports.findHeaderIndex(header, "value")
        if (cValue < 0) return false
        var found = false
        for (raw in lines.drop(1)) {
            if (raw.isBlank()) continue
            checkCancelled()
            val cells = VendorImports.splitCsvLine(raw, delimiter)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val metrics = try { JSONObject(get(cValue)) } catch (_: Exception) { continue }
            val type = get(cKey).ifBlank { get(cCategory) }
            val start = listOf("start_time", "time").firstNotNullOfOrNull {
                metrics.optLong(it, Long.MIN_VALUE).takeIf { value -> value > 0 }?.let { value -> value * 1000L }
            } ?: VendorImports.parseTimeFlexible(get(cTime)) ?: continue
            val rawEnd = metrics.optLong("end_time", Long.MIN_VALUE)
            val endFromFile = rawEnd.takeIf { it > 0 }?.let { it * 1000L }
            val duration = metrics.optDouble("duration", Double.NaN).takeIf { it.isFinite() && it >= 0 }
                ?: if (endFromFile != null && endFromFile > start) (endFromFile - start) / 1000.0 else 0.0
            val end = endFromFile?.takeIf { it >= start }
                ?: (start + (duration * 1000.0).toLong().coerceAtMost(24 * 3600 * 1000L))
            val distance = metrics.optDouble("distance", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
            val cal = metrics.optDouble("total_cal", Double.NaN).takeIf { it.isFinite() }
                ?: metrics.optDouble("calories", Double.NaN).takeIf { it.isFinite() }
            val hr = metrics.optDouble("avg_hrm", Double.NaN).takeIf { it in 30.0..240.0 }
            val details = JSONObject().put("miKey", type.take(80))
            listOf("sport_type", "max_hrm", "max_speed", "min_pace", "max_pace",
                "valid_duration", "anaerobic_train_effect").forEach { key ->
                if (metrics.has(key)) details.put(key, metrics.opt(key))
            }
            val draft = VendorImports.RunDraft(
                startTime = start,
                endTime = if (end > start) end else start,
                durationSeconds = duration,
                distanceMeters = distance,
                name = if (VendorImports.isRunningActivityType(type) == true) "Lauf" else type.ifBlank { "Mi Fitness Aktivität" }.take(120),
                source = "mi_fitness",
                avgHeartRate = hr,
                calories = cal?.takeIf { it in 0.0..20000.0 },
                sourceActivityId = "${type.take(60)}:${start / 1000}",
                sourceActivityType = type.takeIf { it.isNotBlank() }?.take(80),
                details = details.toString(),
            )
            if (!acceptDraft(draft, type)) continue
            found = true
            recordImported(store.addSummaryRun(summaryFromDraft(draft),
                "vendor:mi_fitness:$name:${draft.sourceActivityId}"), "mi_fitness")
        }
        return found
    }

    /** Mi Fitness center_fitness_data.csv: daily JSON metrics become context rows. */
    private fun importMiFitnessFitnessData(text: String, name: String): Boolean {
        val lines = text.lineSequence().take(VendorImports.MAX_CSV_ROWS + 1).toList()
        if (lines.size < 2) return false
        val delimiter = VendorImports.csvDelimiter(lines.first())
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(lines.first()), delimiter)
        val cKey = VendorImports.findHeaderIndex(header, "key")
        val cTime = VendorImports.findHeaderIndex(header, "time")
        val cValue = VendorImports.findHeaderIndex(header, "value")
        if (cKey < 0 || cTime < 0 || cValue < 0) return false
        val rows = ArrayList<com.runback.core.WellnessRow>()
        data class AggregateBucket(
            val kind: String,
            val unit: String,
            val day: Long,
            var last: Long = 0L,
            var sum: Double = 0.0,
            var min: Double = Double.POSITIVE_INFINITY,
            var max: Double = Double.NEGATIVE_INFINITY,
            var count: Int = 0,
            val extras: MutableMap<String, Double> = linkedMapOf(),
        )
        val aggregates = linkedMapOf<String, AggregateBucket>()
        val averageKinds = setOf("heart_rate", "resting_hr", "stress", "spo2")
        fun add(kind: String, time: Long, end: Long = 0L, value: Double, unit: String, extra: JSONObject = JSONObject()) {
            if (!value.isFinite() || rows.size >= VendorImports.MAX_JSON_WELLNESS) return
            rows.add(com.runback.core.WellnessRow(
                VendorImports.wellnessId(kind, time, "mi_fitness", value), kind, time, end, value, unit,
                "mi_fitness", extra.toString()))
        }
        fun aggregate(kind: String, time: Long, value: Double, unit: String, extras: Map<String, Double> = emptyMap()) {
            if (!value.isFinite()) return
            val day = Math.floorDiv(time, DAY_MILLIS) * DAY_MILLIS
            val bucket = aggregates.getOrPut("$kind:$day") { AggregateBucket(kind, unit, day) }
            bucket.last = maxOf(bucket.last, time); bucket.sum += value
            bucket.min = minOf(bucket.min, value); bucket.max = maxOf(bucket.max, value); bucket.count++
            extras.forEach { (keyName, extraValue) ->
                if (extraValue.isFinite()) bucket.extras[keyName] = (bucket.extras[keyName] ?: 0.0) + extraValue
            }
        }
        fun putFinite(target: JSONObject, keyName: String, value: Double) {
            if (value.isFinite()) target.put(keyName, value)
        }
        for (raw in lines.drop(1)) {
            if (raw.isBlank()) continue
            checkCancelled()
            val cells = VendorImports.splitCsvLine(raw, delimiter)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val time = VendorImports.parseTimeFlexible(get(cTime)) ?: continue
            val key = get(cKey).lowercase(Locale.ROOT)
            val value = try { JSONObject(get(cValue)) } catch (_: Exception) { continue }
            when (key) {
                "steps" -> {
                    val steps = value.optDouble("steps", Double.NaN)
                    if (steps.isFinite() && steps in 0.0..200000.0) {
                        val extras = linkedMapOf<String, Double>()
                        value.optDouble("distance", Double.NaN).takeIf { it.isFinite() }?.let { extras["distanceM"] = it }
                        value.optDouble("calories", Double.NaN).takeIf { it.isFinite() }?.let { extras["calories"] = it }
                        aggregate("steps", time, steps, "count", extras)
                    }
                }
                "calories" -> {
                    val calories = value.optDouble("calories", Double.NaN)
                    if (calories.isFinite() && calories in 0.0..100000.0) aggregate("calories", time, calories, "kcal")
                }
                "heart_rate" -> {
                    val avg = value.optDouble("avg_hr", Double.NaN).takeIf { it in 30.0..240.0 }
                        ?: value.optDouble("bpm", Double.NaN).takeIf { it in 30.0..240.0 }
                    if (avg != null) aggregate("heart_rate", time, avg, "bpm")
                    val resting = value.optDouble("avg_rhr", Double.NaN)
                    if (resting in 30.0..120.0) aggregate("resting_hr", time, resting, "bpm")
                }
                "resting_heart_rate" -> {
                    val resting = value.optDouble("bpm", Double.NaN)
                    if (resting in 30.0..120.0) aggregate("resting_hr", time, resting, "bpm")
                }
                "sleep" -> {
                    // Mi Fitness uses `duration` (minutes) and stores the real
                    // session boundaries plus stage segments as epoch seconds.
                    // Do not anchor the night at the export row timestamp.
                    fun extra(source: JSONObject): JSONObject = JSONObject().apply {
                        putFinite(this, "sleepScore", source.optDouble("sleep_score", Double.NaN))
                        putFinite(this, "avgHeartRate", source.optDouble("avg_hr", Double.NaN))
                        putFinite(this, "minHeartRate", source.optDouble("min_hr", Double.NaN))
                        putFinite(this, "maxHeartRate", source.optDouble("max_hr", Double.NaN))
                        putFinite(this, "avgSpo2", source.optDouble("avg_spo2", Double.NaN))
                        putFinite(this, "minSpo2", source.optDouble("min_spo2", Double.NaN))
                        putFinite(this, "maxSpo2", source.optDouble("max_spo2", Double.NaN))
                        put("awakeCount", source.optInt("awake_count", 0))
                        putFinite(this, "deepMinutes", source.optDouble("sleep_deep_duration", Double.NaN))
                        putFinite(this, "lightMinutes", source.optDouble("sleep_light_duration", Double.NaN))
                        putFinite(this, "remMinutes", source.optDouble("sleep_rem_duration", Double.NaN))
                        putFinite(this, "awakeMinutes", source.optDouble("sleep_awake_duration", Double.NaN))
                    }
                    val details = value.optJSONArray("segment_details")
                    if (details != null && details.length() > 0) {
                        // Aggregated Mi exports contain one summary object per
                        // sleep segment rather than the raw `items` timeline.
                        for (i in 0 until minOf(details.length(), MAX_SLEEP_STAGE_ROWS)) {
                            val segment = details.optJSONObject(i) ?: continue
                            val segmentStart = segment.optLong("bedtime", Long.MIN_VALUE)
                                .takeIf { it > 0 }?.times(1000L) ?: continue
                            val segmentMinutes = listOf("duration", "total_duration")
                                .firstNotNullOfOrNull { keyName ->
                                    segment.optDouble(keyName, Double.NaN).takeIf { it.isFinite() }
                                } ?: Double.NaN
                            if (segmentMinutes !in 0.0..1440.0) continue
                            val segmentEnd = segment.optLong("wake_up_time", Long.MIN_VALUE)
                                .takeIf { it > segmentStart / 1000L }?.times(1000L)
                                ?: (segmentStart + (segmentMinutes * 60000.0).toLong())
                            add("sleep_session", segmentStart, segmentEnd, segmentMinutes, "min", extra(segment))
                        }
                    } else {
                        val minutes = listOf("total_duration", "duration")
                            .firstNotNullOfOrNull { keyName ->
                                value.optDouble(keyName, Double.NaN).takeIf { it.isFinite() }
                            } ?: Double.NaN
                        if (minutes !in 0.0..1440.0) continue
                        val sessionStart = value.optLong("bedtime", Long.MIN_VALUE)
                            .takeIf { it > 0 }?.times(1000L) ?: time
                        val sessionEnd = value.optLong("wake_up_time", Long.MIN_VALUE)
                            .takeIf { it > sessionStart / 1000L }?.times(1000L)
                            ?: (sessionStart + (minutes * 60000.0).toLong())
                        add("sleep_session", sessionStart, sessionEnd, minutes, "min", extra(value))
                        val segments = value.optJSONArray("items")
                        if (segments != null) {
                            for (i in 0 until minOf(segments.length(), MAX_SLEEP_STAGE_ROWS)) {
                                val segment = segments.optJSONObject(i) ?: continue
                                val stageStart = segment.optLong("start_time", Long.MIN_VALUE)
                                    .takeIf { it > 0 }?.times(1000L) ?: continue
                                val stageEnd = segment.optLong("end_time", Long.MIN_VALUE)
                                    .takeIf { it > stageStart / 1000L }?.times(1000L) ?: continue
                                if (stageStart < sessionStart || stageEnd > sessionEnd || stageEnd - stageStart > 24 * 3600 * 1000L) continue
                                val stage = when (segment.optInt("state", -1)) {
                                    1, 5 -> "awake"
                                    2 -> "deep"
                                    3 -> "light"
                                    4 -> "rem"
                                    else -> continue
                                }
                                val stageMinutes = (stageEnd - stageStart) / 60000.0
                                if (stageMinutes > 0.0)
                                    add("sleep_stage", stageStart, stageEnd, stageMinutes, "min",
                                        JSONObject().put("stage", stage))
                            }
                        }
                    }
                }
                "min_heart_rate", "max_heart_rate" -> {
                    val bpm = value.optDouble("bpm", Double.NaN)
                    if (bpm in 30.0..240.0) {
                        val kindName = if (key == "min_heart_rate") "heart_rate_min" else "heart_rate_max"
                        add(kindName, time, value = bpm, unit = "bpm")
                    }
                }
                "stress" -> {
                    val stress = value.optDouble("avg_stress", value.optDouble("stress", Double.NaN))
                    if (stress.isFinite() && stress in 0.0..100.0) aggregate("stress", time, stress, "score")
                }
                "spo2", "single_spo2" -> {
                    val spo2 = value.optDouble("avg_spo2", value.optDouble("spo2", Double.NaN))
                    if (spo2.isFinite() && spo2 in 50.0..100.0) aggregate("spo2", time, spo2, "%")
                }
                "intensity" -> {
                    val minutes = value.optDouble("duration", Double.NaN)
                    if (minutes.isFinite() && minutes in 0.0..1440.0) aggregate("active_minutes", time, minutes, "min")
                }
                "valid_stand" -> {
                    val count = value.optDouble("count", Double.NaN)
                    if (count.isFinite() && count in 0.0..100.0) {
                        aggregate("stand_count", time, count, "count")
                    } else {
                        // A raw valid_stand row is one observed standing interval;
                        // counting the row is explicit and does not invent minutes.
                        aggregate("stand_count", time, 1.0, "count")
                    }
                }
                "weight" -> {
                    val weight = value.optDouble("weight", Double.NaN)
                    if (weight.isFinite() && weight in 1.0..500.0) add("weight", time, value = weight, unit = "kg")
                }
            }
        }
        aggregates.values
            .sortedWith(compareBy<AggregateBucket> { it.day }.thenBy { it.kind })
            .forEach { bucket ->
                val aggregateValue = if (bucket.kind in averageKinds) {
                    bucket.sum / bucket.count.coerceAtLeast(1)
                } else {
                    bucket.sum
                }
                val extra = JSONObject().apply {
                    put("aggregate", "daily")
                    put("count", bucket.count)
                    putFinite(this, "min", bucket.min)
                    putFinite(this, "max", bucket.max)
                    bucket.extras.forEach { (keyName, extraValue) -> putFinite(this, keyName, extraValue) }
                }
                add(bucket.kind, bucket.day, value = aggregateValue, unit = bucket.unit, extra = extra)
            }
        if (rows.isEmpty()) return false
        noteVendor("mi_fitness", 0, 0, store.addWellnessBatch(rows), 0)
        return true
    }

    private fun importSamsungCsv(file: File, name: String): Boolean {
        val kind = VendorImports.samsungFileKind(name)
        if (kind == "other" || kind == "weather") return false
        val text = readText(file)
        val lines = text.lineSequence().take(VendorImports.MAX_CSV_ROWS + 1).toList()
        if (lines.size < 2) return false
        // Samsung files carry namespaced headers (com.samsung.health....); match by suffix.
        val delimiter = VendorImports.csvDelimiter(lines.first())
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(lines.first()), delimiter).map { it.lowercase(Locale.ROOT) }
        fun col(vararg wants: String): Int {
            wants.forEach { want ->
                val i = header.indexOfFirst { it.endsWith(want) || it.contains(want) }
                if (i >= 0) return i
            }
            return -1
        }
        val cStart = col("start_time", "starttime"); val cEnd = col("end_time", "endtime")
        if (kind == "exercise") {
            val cType = col("exercise_type", "type"); val cDist = col("distance")
            val cDur = col("duration"); val cCal = col("calorie")
            for (raw in lines.drop(1)) {
                if (raw.isBlank()) continue
                checkCancelled()
                val cells = VendorImports.splitCsvLine(raw, delimiter)
                fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
                if (!VendorImports.isSamsungRunningExercise(get(cType))) continue
                val start = VendorImports.parseTimeFlexible(get(cStart)) ?: continue
                val end = VendorImports.parseTimeFlexible(get(cEnd)) ?: start
                val duration = VendorImports.parseDurationFlexible(get(cDur))
                    ?: if (end > start) (end - start) / 1000.0 else 0.0
                val distance = VendorImports.parseDoubleFlexible(get(cDist)) ?: 0.0
                if (distance <= 0 && duration <= 0) continue
                val draft = VendorImports.RunDraft(start, if (end > start) end else start, duration, distance,
                    "Samsung Health Lauf", "samsung_health", null,
                    VendorImports.parseDoubleFlexible(get(cCal)))
                if (!acceptDraft(draft)) continue
                recordImported(store.addSummaryRun(summaryFromDraft(draft),
                    "vendor:samsung:${sha256(file)}:$start"), "samsung")
            }
            return true
        }
        if (kind == "sleep_stage") {
            val cStage = col("sleep_stage", "stage", "sleep_type")
            val rows = ArrayList<com.runback.core.WellnessRow>()
            for (raw in lines.drop(1)) {
                if (raw.isBlank() || rows.size >= VendorImports.MAX_JSON_WELLNESS) break
                val cells = VendorImports.splitCsvLine(raw, delimiter)
                fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
                val start = VendorImports.parseTimeFlexible(get(cStart)) ?: continue
                val end = VendorImports.parseTimeFlexible(get(cEnd)) ?: start
                val stage = VendorImports.mapSamsungSleepStage(get(cStage))
                val minutes = ((end - start) / 60000.0).coerceIn(0.0, 1440.0)
                rows.add(com.runback.core.WellnessRow(
                    VendorImports.wellnessId("sleep_stage", start, "samsung", minutes),
                    "sleep_stage", start, end, minutes, "min", "samsung",
                    "{\"stage\":\"$stage\"}"))
            }
            noteVendor("samsung", 0, 0, store.addWellnessBatch(rows), 0)
            return true
        }
        // Generic wellness kinds: heart_rate, sleep, weight, steps, stress, spo2, hrv.
        val valueCol = when (kind) {
            "heart_rate" -> col("heart_rate", "bpm")
            "sleep" -> col("sleep_duration", "duration", "efficiency", "sleep_score")
            "weight" -> col("weight")
            "steps" -> col("count", "step", "steps")
            "stress" -> col("stress", "score")
            "spo2" -> col("spo2", "oxygen")
            "hrv" -> col("hrv", "rmssd", "sdnn")
            else -> -1
        }
        if (cStart < 0 || valueCol < 0) return false
        val unit = mapOf("heart_rate" to "bpm", "weight" to "kg", "steps" to "count",
            "stress" to "score", "spo2" to "%", "hrv" to "ms", "sleep" to "min")[kind] ?: ""
        val rows = ArrayList<com.runback.core.WellnessRow>()
        for (raw in lines.drop(1)) {
            if (raw.isBlank() || rows.size >= VendorImports.MAX_JSON_WELLNESS) break
            val cells = VendorImports.splitCsvLine(raw, delimiter)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val start = VendorImports.parseTimeFlexible(get(cStart)) ?: continue
            val end = VendorImports.parseTimeFlexible(get(cEnd)) ?: start
            val value = VendorImports.parseDoubleFlexible(get(valueCol)) ?: continue
            if (!value.isFinite()) continue
            rows.add(com.runback.core.WellnessRow(
                VendorImports.wellnessId(kind, start, "samsung", value),
                kind, start, end, value, unit, "samsung", "{}"))
        }
        noteVendor("samsung", 0, 0, store.addWellnessBatch(rows), 0)
        return true
    }

    private fun importVendorJson(file: File, name: String, entryPath: String, vendor: VendorImports.Vendor?): Boolean {
        val lower = name.lowercase(Locale.ROOT)
        // Large Takeout archives can be tens of MB of JSON; stream via text with caps.
        val text = readText(file)
        if (text.length > MAX_FILE_BYTES) return false
        return when {
            vendor == VendorImports.Vendor.FITBIT || VendorImports.fitbitFileKind(name, entryPath) != "other" ->
                importFitbitJson(text, name, entryPath)
            entryPath.lowercase(Locale.ROOT).contains("takeout") && entryPath.lowercase(Locale.ROOT).contains("fit") ->
                importGoogleFitJson(text, name)
            lower.contains("summarizedactivities") || entryPath.lowercase(Locale.ROOT).contains("di_connect") ->
                importGarminJson(text, name, entryPath)
            lower == "activities.csv" -> false
            else -> importGenericWellnessJson(text, name)
        }
    }

    private fun importFitbitJson(text: String, name: String, entryPath: String): Boolean {
        val kind = VendorImports.fitbitFileKind(name, entryPath)
        if (kind == "exercise") return importFitbitExerciseJson(text)
        if (kind in setOf("heart_rate", "steps", "calories")) {
            return importFitbitTimeSeries(text, kind)
        }
        val rows = ArrayList<com.runback.core.WellnessRow>()
        try {
            val trimmed = text.trim()
            if (trimmed.startsWith("[")) {
                val array = org.json.JSONArray(trimmed)
                for (i in 0 until minOf(array.length(), VendorImports.MAX_JSON_WELLNESS)) {
                    checkCancelled()
                    val obj = array.optJSONObject(i) ?: continue
                    if (kind == "sleep") rows.addAll(fitbitSleepRows(obj))
                    else fitbitRow(obj, kind)?.let { rows.add(it) }
                }
            } else {
                val obj = org.json.JSONObject(trimmed)
                // heart_rate-YYYY-MM-DD.json wraps intraday series; sleep files wrap levels.
                for (key in listOf("heart_rate", "activities-heart", "sleep", "activities", "hrv", "weight")) {
                    if (obj.has(key)) {
                        val nested = obj.opt(key)
                        if (nested is org.json.JSONArray) {
                            for (i in 0 until minOf(nested.length(), VendorImports.MAX_JSON_WELLNESS)) {
                                val item = nested.optJSONObject(i) ?: continue
                                if (kind == "sleep") rows.addAll(fitbitSleepRows(item))
                                else fitbitRow(item, kind)?.let { rows.add(it) }
                            }
                        }
                    }
                }
                // Flat daily summary objects (steps/distance/calories/resting HR).
                if (rows.isEmpty()) {
                    if (kind == "sleep") rows.addAll(fitbitSleepRows(obj))
                    else fitbitRow(obj, kind)?.let { rows.add(it) }
                }
                // Intraday heart-rate series: {"dateTime":"...","value":{"bpm":..}}
                if (obj.has("value") && kind == "heart_rate") fitbitRow(obj, kind)?.let { rows.add(it) }
            }
        } catch (_: Exception) { return false }
        if (rows.isEmpty()) return false
        noteVendor("fitbit", 0, 0, store.addWellnessBatch(rows.take(VendorImports.MAX_JSON_WELLNESS)), 0)
        return true
    }

    private fun importFitbitExerciseJson(text: String): Boolean {
        val parsed = VendorImports.parseFitbitExerciseJson(text, "fitbit")
        for (draft in parsed.runs) {
            checkCancelled()
            recordImported(store.addSummaryRun(summaryFromDraft(draft),
                "vendor:fitbit:exercise:${draft.sourceActivityId ?: draft.startTime}"), "fitbit")
        }
        if (parsed.runs.isEmpty()) increment("skipped")
        return true
    }

    /** Store bounded daily aggregates instead of tens of thousands of intraday rows. */
    private fun importFitbitTimeSeries(text: String, kind: String): Boolean {
        data class Bucket(
            var first: Long = Long.MAX_VALUE,
            var last: Long = 0L,
            var sum: Double = 0.0,
            var min: Double = Double.POSITIVE_INFINITY,
            var max: Double = Double.NEGATIVE_INFINITY,
            var count: Int = 0,
        )
        val buckets = linkedMapOf<Long, Bucket>()
        try {
            val trimmed = text.trim()
            val array = if (trimmed.startsWith("[")) JSONArray(trimmed) else return false
            for (i in 0 until minOf(array.length(), MAX_TIMESERIES_VALUES)) {
                checkCancelled()
                val obj = array.optJSONObject(i) ?: continue
                val time = VendorImports.parseTimeFlexible(obj.optString("dateTime", obj.optString("time", "")))
                    ?: continue
                val nested = obj.optJSONObject("value")
                val rawValue = when {
                    kind == "heart_rate" -> nested?.opt("bpm") ?: obj.opt("bpm") ?: obj.opt("value")
                    else -> obj.opt("value") ?: nested?.opt("value")
                }
                val value = when (rawValue) {
                    is Number -> rawValue.toDouble()
                    else -> VendorImports.parseDoubleFlexible(rawValue?.toString())
                } ?: continue
                val valid = when (kind) {
                    "heart_rate" -> value in 30.0..240.0
                    "steps" -> value in 0.0..200000.0
                    "calories" -> value in 0.0..100000.0
                    else -> false
                }
                if (!valid) continue
                val rawTime = obj.optString("dateTime", obj.optString("time", ""))
                val bucket = buckets.getOrPut(fitbitDayStart(rawTime, time)) { Bucket() }
                bucket.first = minOf(bucket.first, time); bucket.last = maxOf(bucket.last, time)
                bucket.sum += value; bucket.min = minOf(bucket.min, value); bucket.max = maxOf(bucket.max, value)
                bucket.count++
            }
        } catch (_: Exception) { return false }
        if (buckets.isEmpty()) return false
        val rows = buckets.toSortedMap().mapNotNull { (day, bucket) ->
            if (bucket.count == 0 || bucket.first == Long.MAX_VALUE) return@mapNotNull null
            val aggregate = if (kind == "heart_rate") bucket.sum / bucket.count else bucket.sum
            val extra = JSONObject().put("aggregate", if (kind == "heart_rate") "average" else "sum")
                .put("count", bucket.count).put("min", bucket.min).put("max", bucket.max)
            com.runback.core.WellnessRow(
                VendorImports.wellnessId(kind, day, "fitbit", aggregate), kind, day, bucket.last,
                aggregate, if (kind == "heart_rate") "bpm" else if (kind == "steps") "count" else "kcal",
                "fitbit", extra.toString())
        }.take(VendorImports.MAX_JSON_WELLNESS)
        if (rows.isEmpty()) return false
        noteVendor("fitbit", 0, 0, store.addWellnessBatch(rows), 0)
        return true
    }

    private fun fitbitDayStart(rawTime: String, epochMillis: Long): Long {
        val datePart = rawTime.trim().substringBefore('T').substringBefore(' ')
        if (datePart.any { it == '-' || it == '/' || it == '.' }) {
            VendorImports.parseTimeFlexible(datePart)?.let { return it }
        }
        return Math.floorDiv(epochMillis, DAY_MILLIS) * DAY_MILLIS
    }

    private fun fitbitSleepRows(obj: JSONObject): List<com.runback.core.WellnessRow> {
        val start = listOf("startTime", "start_time", "dateOfSleep", "date")
            .firstNotNullOfOrNull { VendorImports.parseTimeFlexible(obj.optString(it, "")) } ?: return emptyList()
        val end = VendorImports.parseTimeFlexible(obj.optString("endTime", obj.optString("end_time", "")))
            ?: start
        val minutes = obj.optDouble("minutesAsleep", Double.NaN).takeIf { it.isFinite() }
            ?: obj.optDouble("timeInBed", Double.NaN).takeIf { it.isFinite() }
            ?: ((end - start) / 60000.0).takeIf { it in 0.0..1440.0 }
            ?: return emptyList()
        val rows = ArrayList<com.runback.core.WellnessRow>()
        val summary = JSONObject()
        listOf("logId", "minutesAwake", "minutesToFallAsleep", "minutesAfterWakeup",
            "timeInBed", "efficiency", "type", "mainSleep").forEach { key ->
            if (obj.has(key)) summary.put(key, obj.opt(key))
        }
        rows.add(com.runback.core.WellnessRow(
            VendorImports.wellnessId("sleep_session", start, "fitbit", minutes),
            "sleep_session", start, end, minutes, "min", "fitbit", summary.toString()))
        val levels = obj.optJSONObject("levels")?.optJSONArray("data") ?: return rows
        for (i in 0 until minOf(levels.length(), MAX_SLEEP_STAGE_ROWS)) {
            val stage = levels.optJSONObject(i) ?: continue
            val stageStart = VendorImports.parseTimeFlexible(stage.optString("dateTime", "")) ?: continue
            val seconds = stage.optDouble("seconds", Double.NaN)
            if (!seconds.isFinite() || seconds <= 0.0 || seconds > 24 * 3600.0) continue
            val stageEnd = stageStart + (seconds * 1000.0).toLong()
            rows.add(com.runback.core.WellnessRow(
                VendorImports.wellnessId("sleep_stage", stageStart, "fitbit", seconds),
                "sleep_stage", stageStart, stageEnd, seconds / 60.0, "min", "fitbit",
                JSONObject().put("stage", stage.optString("level", "unknown").take(20)).toString()))
        }
        return rows
    }

    private fun fitbitRow(obj: org.json.JSONObject, kind: String): com.runback.core.WellnessRow? {
        fun time(): Long? {
            val date = obj.optString("date", "")
            val clock = obj.optString("time", "")
            if (date.isNotBlank() && clock.contains(':')) {
                VendorImports.parseTimeFlexible("$date $clock")?.let { return it }
            }
            for (key in listOf("dateTime", "datetime", "time", "startTime", "start_time", "date")) {
                VendorImports.parseTimeFlexible(obj.optString(key, ""))?.let { return it }
            }
            return null
        }
        val t = time() ?: return null
        when (kind) {
            "heart_rate" -> {
                val nested = obj.optJSONObject("value")
                val bpm = nested?.optDouble("bpm", Double.NaN)?.takeIf { it.isFinite() }
                    ?: obj.optDouble("bpm", Double.NaN).takeIf { it.isFinite() }
                    ?: obj.optDouble("value", Double.NaN).takeIf { it.isFinite() } ?: return null
                if (bpm !in 30.0..240.0) return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("heart_rate", t, "fitbit", bpm),
                    "heart_rate", t, 0L, bpm, "bpm", "fitbit", "{}")
            }
            "hrv" -> {
                val nested = obj.optJSONObject("value")
                val rmssd = obj.optDouble("rmssd", obj.optDouble("dailyRmssd",
                    nested?.optDouble("rmssd", Double.NaN) ?: Double.NaN))
                if (!rmssd.isFinite()) return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("hrv_rmssd", t, "fitbit", rmssd),
                    "hrv_rmssd", t, 0L, rmssd, "ms", "fitbit", "{}")
            }
            "weight" -> {
                // Google Health's Fitbit weight export is pounds when no unit field is emitted.
                val unit = obj.optString("unit", "lb").ifBlank { "lb" }
                val kg = VendorImports.toKilograms(obj.optDouble("weight", Double.NaN), unit)
                    ?: return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("weight", t, "fitbit", kg),
                    "weight", t, 0L, kg, "kg", "fitbit", JSONObject().put("sourceUnit", unit).toString())
            }
            "resting_hr" -> {
                val nested = obj.optJSONObject("value")
                val resting = nested?.optDouble("value", Double.NaN)?.takeIf { it.isFinite() }
                    ?: obj.optDouble("restingHeartRate", Double.NaN)
                if (resting !in 30.0..120.0) return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("resting_hr", t, "fitbit", resting),
                    "resting_hr", t, 0L, resting, "bpm", "fitbit", "{}")
            }
            "vo2max", "vo2max_csv" -> {
                val nested = obj.optJSONObject("value")
                val vo2 = nested?.optDouble("filteredRunVO2Max", Double.NaN)?.takeIf { it.isFinite() }
                    ?: nested?.optDouble("runVO2Max", Double.NaN)?.takeIf { it.isFinite() }
                    ?: nested?.optDouble("filteredDemographicVO2Max", Double.NaN)?.takeIf { it.isFinite() }
                    ?: nested?.optDouble("demographicVO2Max", Double.NaN)?.takeIf { it.isFinite() }
                    ?: obj.optDouble("vo2Max", Double.NaN).takeIf { it.isFinite() }
                val value = vo2?.takeIf { it in 10.0..100.0 } ?: return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("vo2max", t, "fitbit", value),
                    "vo2max", t, 0L, value, "ml/kg/min", "fitbit", "{}")
            }
            else -> {
                // Daily activity summary: steps / distance / calories / resting HR.
                val steps = obj.optDouble("steps", Double.NaN)
                if (steps.isFinite() && steps in 0.0..200000.0) {
                    return com.runback.core.WellnessRow(VendorImports.wellnessId("steps", t, "fitbit", steps),
                        "steps", t, 0L, steps, "count", "fitbit", "{}")
                }
                val calories = obj.optDouble("calories", Double.NaN)
                if (calories.isFinite() && calories in 0.0..100000.0) {
                    return com.runback.core.WellnessRow(VendorImports.wellnessId("calories", t, "fitbit", calories),
                        "calories", t, 0L, calories, "kcal", "fitbit", "{}")
                }
                val resting = obj.optDouble("restingHeartRate", obj.optDouble("resting_hr", Double.NaN))
                if (resting.isFinite() && resting in 30.0..120.0) {
                    return com.runback.core.WellnessRow(VendorImports.wellnessId("resting_hr", t, "fitbit", resting),
                        "resting_hr", t, 0L, resting, "bpm", "fitbit", "{}")
                }
                return null
            }
        }
    }

    private fun importGoogleFitJson(text: String, name: String): Boolean {
        val rows = ArrayList<com.runback.core.WellnessRow>()
        var runs = 0; var dups = 0
        try {
            val trimmed = text.trim()
            val objects = if (trimmed.startsWith("[")) {
                val arr = org.json.JSONArray(trimmed)
                (0 until minOf(arr.length(), VendorImports.MAX_JSON_WELLNESS)).mapNotNull { arr.optJSONObject(it) }
            } else listOf(org.json.JSONObject(trimmed))
            for (obj in objects) {
                checkCancelled()
                val type = obj.optString("activityType", obj.optString("activity_type", "")).lowercase(Locale.ROOT)
                val start = VendorImports.parseTimeFlexible(obj.optString("startTime", obj.optString("start_time",
                    obj.optString("startTimeMillis", "")))) ?: continue
                val end = VendorImports.parseTimeFlexible(obj.optString("endTime", obj.optString("end_time",
                    obj.optString("endTimeMillis", "")))) ?: start
                if (type.contains("run")) {
                    val distance = obj.optDouble("distance", obj.optDouble("distanceMeters", 0.0))
                    val duration = obj.optDouble("durationSeconds",
                        if (end > start) (end - start) / 1000.0 else 0.0)
                    if (distance <= 0 && duration <= 0) continue
                    val draft = VendorImports.RunDraft(start, end, duration, distance,
                        obj.optString("name", "Google Fit Lauf").take(120), "google_fit")
                    if (!acceptDraft(draft, type)) continue
                    when (store.addSummaryRun(summaryFromDraft(draft), "vendor:google_fit:$start").optString("status")) {
                        "imported" -> runs++
                        "duplicate" -> dups++
                        else -> {}
                    }
                    continue
                }
                val steps = obj.optDouble("steps", obj.optDouble("step_count", Double.NaN))
                if (steps.isFinite() && steps in 0.0..200000.0 && rows.size < VendorImports.MAX_JSON_WELLNESS) {
                    rows.add(com.runback.core.WellnessRow(VendorImports.wellnessId("steps", start, "google_fit", steps),
                        "steps", start, end, steps, "count", "google_fit", "{}"))
                }
            }
        } catch (_: Exception) { return false }
        if (runs == 0 && rows.isEmpty()) return false
        if (rows.isNotEmpty()) store.addWellnessBatch(rows)
        noteVendor("google_fit", runs, dups, rows.size, 0)
        if (runs > 0) repeat(runs) { increment("imported") }
        if (dups > 0) repeat(dups) { increment("duplicates") }
        return true
    }

    private fun importGarminJson(text: String, name: String, entryPath: String): Boolean {
        val lower = (name + " " + entryPath).lowercase(Locale.ROOT)
        var runs = 0; var dups = 0
        val rows = ArrayList<com.runback.core.WellnessRow>()
        try {
            val trimmed = text.trim()
            if (lower.contains("summarizedactivities")) {
                val arr = if (trimmed.startsWith("[")) org.json.JSONArray(trimmed)
                    else org.json.JSONObject(trimmed).optJSONArray("activities") ?: return false
                for (i in 0 until minOf(arr.length(), VendorImports.MAX_JSON_WELLNESS)) {
                    checkCancelled()
                    val obj = arr.optJSONObject(i) ?: continue
                    val type = obj.optString("activityType", obj.optString("type", "")).lowercase(Locale.ROOT)
                    if (!type.contains("run")) continue
                    val start = VendorImports.parseTimeFlexible(obj.optString("startTime", obj.optString("beginTimestamp", ""))) ?: continue
                    val distance = obj.optDouble("distance", 0.0)
                    val duration = obj.optDouble("duration", obj.optDouble("elapsedDuration", 0.0))
                    val draft = VendorImports.RunDraft(start, start + (duration * 1000).toLong(), duration, distance,
                        obj.optString("name", "Garmin Lauf").take(120), "garmin",
                        obj.optDouble("avgHr", Double.NaN).takeIf { it in 30.0..240.0 },
                        obj.optDouble("calories", Double.NaN).takeIf { it in 0.0..20000.0 })
                    if (!acceptDraft(draft, type)) continue
                    when (store.addSummaryRun(summaryFromDraft(draft), "vendor:garmin:$start").optString("status")) {
                        "imported" -> runs++
                        "duplicate" -> dups++
                        else -> {}
                    }
                }
            } else {
                // Wellness JSON (sleep/stress/HRV): store nightly values as display-only context.
                val obj = if (trimmed.startsWith("{")) org.json.JSONObject(trimmed) else return false
                val day = VendorImports.parseTimeFlexible(obj.optString("calendarDate", obj.optString("date", "")))
                    ?: System.currentTimeMillis()
                fun put(kind: String, value: Double, unit: String) {
                    if (value.isFinite() && rows.size < VendorImports.MAX_JSON_WELLNESS) {
                        rows.add(com.runback.core.WellnessRow(VendorImports.wellnessId(kind, day, "garmin", value),
                            kind, day, 0L, value, unit, "garmin", "{\"displayOnly\":true}"))
                    }
                }
                put("sleep_session", obj.optDouble("sleepTime", obj.optDouble("duration", Double.NaN)), "min")
                put("hrv_rmssd", obj.optDouble("hrv", obj.optDouble("rmssd", Double.NaN)), "ms")
                put("resting_hr", obj.optDouble("restingHr", obj.optDouble("resting_hr", Double.NaN)), "bpm")
                put("stress", obj.optDouble("stress", Double.NaN), "score")
                put("spo2", obj.optDouble("spo2", Double.NaN), "%")
            }
        } catch (_: Exception) { return false }
        if (runs == 0 && rows.isEmpty()) return false
        if (rows.isNotEmpty()) store.addWellnessBatch(rows)
        noteVendor("garmin", runs, dups, rows.size, 0)
        repeat(runs) { increment("imported") }
        repeat(dups) { increment("duplicates") }
        return true
    }

    private fun importGenericWellnessJson(text: String, name: String): Boolean {
        val rows = GenericWellnessJson.parse(text, ::checkCancelled)
        if (rows.isEmpty()) return false
        noteVendor("generic", 0, 0, store.addWellnessBatch(rows), 0)
        return true
    }

    /** Streaming Apple Health export.xml: running workouts become summary runs, mapped records become wellness. */
    private fun importAppleExportXml(file: File, name: String): Boolean {
        // Clinical CDA twin of the Health export carries no training data.
        if (name.equals("export_cda.xml", ignoreCase = true)) return false
        // export.xml can exceed 64 MB for long histories; stream with the same depth/text guards as track XML.
        val rows = ArrayList<com.runback.core.WellnessRow>()
        var runs = 0; var dups = 0; var records = 0; var skippedRecords = 0
        file.inputStream().buffered().use { input ->
            val parser = android.util.Xml.newPullParser()
            parser.setFeature(org.xmlpull.v1.XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            parser.setInput(input, null)
            var depth = 0
            while (parser.eventType != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) {
                checkCancelled()
                when (parser.eventType) {
                    org.xmlpull.v1.XmlPullParser.START_TAG -> {
                        require(++depth <= 16) { "XML ist zu tief verschachtelt" }
                        when (parser.name) {
                            "Workout" -> {
                                val type = parser.getAttributeValue(null, "workoutActivityType") ?: ""
                                val start = VendorImports.parseTimeFlexible(parser.getAttributeValue(null, "startDate"))
                                val end = VendorImports.parseTimeFlexible(parser.getAttributeValue(null, "endDate"))
                                if (VendorImports.isAppleRunningWorkout(type) && start != null && end != null) {
                                    val durationAttr = parser.getAttributeValue(null, "duration")?.toDoubleOrNull()
                                    val durationUnit = parser.getAttributeValue(null, "durationUnit") ?: "min"
                                    val duration = when (durationUnit.lowercase(Locale.ROOT)) {
                                        "s", "sec", "secs" -> (durationAttr ?: 0.0)
                                        "h", "hr", "hour" -> (durationAttr ?: 0.0) * 3600
                                        else -> (durationAttr ?: 0.0) * 60
                                    }.takeIf { it > 0 } ?: ((end - start) / 1000.0)
                                    val distAttr = parser.getAttributeValue(null, "totalDistance")?.toDoubleOrNull() ?: 0.0
                                    val distUnit = parser.getAttributeValue(null, "totalDistanceUnit") ?: "km"
                                    val distance = VendorImports.toMeters(distAttr, distUnit) ?: 0.0
                                    if ((distance > 0 || duration > 0) &&
                                        VendorImports.plausibleRunSpeed(distance, duration)) {
                                        val draft = VendorImports.RunDraft(start, end, duration, distance,
                                            "Apple Health Lauf", "apple_health")
                                        when (store.addSummaryRun(summaryFromDraft(draft),
                                            "vendor:apple:$start").optString("status")) {
                                            "imported" -> runs++
                                            "duplicate" -> dups++
                                            else -> {}
                                        }
                                    }
                                }
                            }
                            "Record" -> {
                                if (++records > VendorImports.MAX_APPLE_RECORDS) {
                                    skippedRecords++
                                } else {
                                    appleWellnessRow(parser)?.let {
                                        if (rows.size < VendorImports.MAX_JSON_WELLNESS) rows.add(it)
                                        else skippedRecords++
                                    } ?: run { skippedRecords++ }
                                }
                            }
                        }
                    }
                    org.xmlpull.v1.XmlPullParser.END_TAG -> depth--
                }
                parser.nextToken()
            }
        }
        if (rows.isNotEmpty()) store.addWellnessBatch(rows)
        noteVendor("apple_health", runs, dups, rows.size, 0)
        repeat(runs) { increment("imported") }
        repeat(dups) { increment("duplicates") }
        return true
    }

    private fun appleWellnessRow(parser: org.xmlpull.v1.XmlPullParser): com.runback.core.WellnessRow? {
        val type = parser.getAttributeValue(null, "type") ?: return null
        val kind = VendorImports.mapAppleRecordType(type) ?: return null
        val start = VendorImports.parseTimeFlexible(parser.getAttributeValue(null, "startDate")) ?: return null
        val end = VendorImports.parseTimeFlexible(parser.getAttributeValue(null, "endDate")) ?: start
        val source = "apple_health:" + (parser.getAttributeValue(null, "sourceName") ?: "Health").take(60)
        val rawValue = parser.getAttributeValue(null, "value") ?: ""
        val unit = parser.getAttributeValue(null, "unit") ?: ""
        if (kind == "sleep_stage") {
            val stage = VendorImports.mapAppleSleepStage(rawValue)
            val minutes = ((end - start) / 60000.0).takeIf { it in 0.0..1440.0 } ?: return null
            return com.runback.core.WellnessRow(VendorImports.wellnessId(kind, start, source, minutes),
                kind, start, end, minutes, "min", source, "{\"stage\":\"$stage\"}")
        }
        val value = rawValue.toDoubleOrNull() ?: return null
        val converted = when (kind) {
            "weight" -> VendorImports.toKilograms(value, unit)
            "height" -> VendorImports.toMeters(value, unit)?.times(100) // store cm
            "distance" -> VendorImports.toMeters(value, unit)
            "calories", "calories_basal" -> VendorImports.toKcal(value, unit)
            "vo2max" -> value.takeIf { it in 10.0..100.0 }
            "resting_hr" -> value.takeIf { it in 30.0..120.0 }
            "hrv_sdnn" -> value.takeIf { it in 1.0..500.0 }
            "steps" -> value.takeIf { it in 0.0..200000.0 }
            "spo2" -> (if (unit == "%" || value <= 1.0) value * (if (value <= 1.0) 100.0 else 1.0) else value)
                .takeIf { it in 50.0..100.0 }
            "respiratory_rate" -> value.takeIf { it in 4.0..60.0 }
            "body_fat" -> value.takeIf { it in 0.0..80.0 }
            else -> null
        } ?: return null
        val storeUnit = mapOf("weight" to "kg", "height" to "cm", "distance" to "m",
            "calories" to "kcal", "calories_basal" to "kcal", "vo2max" to "ml/kg/min",
            "resting_hr" to "bpm", "hrv_sdnn" to "ms", "steps" to "count", "spo2" to "%",
            "respiratory_rate" to "/min", "body_fat" to "%")[kind] ?: unit.take(24)
        return com.runback.core.WellnessRow(VendorImports.wellnessId(kind, start, source, converted),
            kind, start, end, converted, storeUnit, source, "{}")
    }

    private fun increment(key: String) = update { it.put(key, it.optInt(key) + 1) }
    private fun recordError(name: String, error: Exception) = update {
        it.put("failed", it.optInt("failed") + 1)
        val errors = it.getJSONArray("errors")
        if (errors.length() < 50) {
            val message = if (error is ZipException) {
                "Passwortgeschütztes oder beschädigtes ZIP. Entpacke es zuerst mit dem Passwort."
            } else {
                error.message ?: "Datei konnte nicht importiert werden"
            }
            errors.put(JSONObject().put("file", name.take(200)).put("message", message.take(300)))
        }
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
    private fun drainIgnored(input: InputStream) {
        val buffer = ByteArray(32 * 1024)
        while (true) { checkCancelled(); if (input.read(buffer) < 0) break }
    }
    /** Strava's German bulk CSV is Windows-1252; UTF-8 is still the default. */
    private fun readText(file: File): String {
        val bytes = file.readBytes()
        val utf8 = try {
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: Exception) {
            Charset.forName("windows-1252").decode(ByteBuffer.wrap(bytes)).toString()
        }
        return utf8.removePrefix("\uFEFF")
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
        // Nur <name>/<type> innerhalb von <trk> beschreiben die Aktivität. In
        // <metadata> oder <Creator> steht der Dateiautor bzw. das Uhrenmodell.
        var inTrack = false
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            checkCancelled()
            when (parser.eventType) {
                XmlPullParser.DOCDECL -> error("XML-Dokumenttypen werden nicht unterstützt")
                XmlPullParser.START_TAG -> {
                    require(++depth <= 64) { "XML ist zu tief verschachtelt" }
                    leaf = parser.name.lowercase(Locale.ROOT)
                    text.setLength(0)
                    if (leaf == "trk") inTrack = true
                    if (leaf == "activity" && builder.activityType == null) {
                        parser.getAttributeValue(null, "Sport")?.let { builder.activityType = it.take(60) }
                    }
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
                    if (inTrack && point == null) {
                        val value = text.toString().trim()
                        if (value.isNotEmpty()) {
                            if (tag == "name" && builder.trackName == null) builder.trackName = value.take(120)
                            if (tag == "type" && builder.activityType == null) builder.activityType = value.take(60)
                        }
                    }
                    if (tag == "trk") inTrack = false
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
            if (builder.activityType == null) session.sport?.let { builder.activityType = it.name }
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
        b.append(xml(run.optString("name", "Runback activity"))).append("</name>")
        b.append("<type>").append(if (run.optString("sport", "running") == "cycling") "cycling" else "running").append("</type><trkseg>")
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
                    sport = if (run.optString("sport", "running") == "cycling") Sport.CYCLING else Sport.RUNNING; subSport = SubSport.GENERIC
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
        /** Sportart aus der Datei (FIT-Session, TCX-Activity, GPX-<type>). */
        var activityType: String? = null
        /** Streckenname aus der Datei; besser als der Dateiname. */
        var trackName: String? = null
        private var start = Long.MAX_VALUE
        private var end = 0L
        private var distance = 0.0
        private var previous: Triple<Long, Double, Double>? = null
        private var previousAltitude: Double? = null
        private var elevationGain = 0.0
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
            altitude?.takeIf { it.isFinite() }?.let { currentAltitude ->
                previousAltitude?.let { previousValue ->
                    if (currentAltitude > previousValue) elevationGain += currentAltitude - previousValue
                }
                previousAltitude = currentAltitude
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
            // Der Streckenname der Datei schlaegt den Dateinamen; die Oberflaeche
            // verwirft technische Namen anschliessend ueber runTitle().
            val title = trackName?.takeIf { it.isNotBlank() }
                ?: name.removeSuffix(".gz").substringBeforeLast('.')
            return JSONObject().put("name", title.take(120))
                .put("startTime", start).put("endTime", end)
                .put("durationSeconds", reportedDuration?.takeIf { it.isFinite() && it >= 0 } ?: ((end - start) / 1000.0))
                .put("distanceMeters", if (reportedDistance.isFinite() && reportedDistance > 0) reportedDistance else distance)
                .put("purpose", "unknown").put("source", "import")
                .put("importVersion", VendorImports.IMPORT_VERSION)
                .put("avgHeartRate", if (hrCount > 0) hrTotal / hrCount else JSONObject.NULL)
                .put("avgCadence", if (cadenceCount > 0) cadenceTotal / cadenceCount else JSONObject.NULL)
                .put("elevationGainMeters", if (elevationGain > 0) elevationGain else JSONObject.NULL)
        }
    }

    companion object {
        private const val MAX_FILE_BYTES = 64L * 1024 * 1024
        private const val MAX_ARCHIVE_BYTES = 512L * 1024 * 1024
        private const val MAX_ENTRIES = 10000
        private const val MAX_SAMPLES = 150000
        private const val MAX_TIMESERIES_VALUES = 100000
        private const val MAX_SLEEP_STAGE_ROWS = 5000
        private const val DAY_MILLIS = 24L * 60 * 60 * 1000
        private val FITBIT_CONTEXT_CSV_KINDS = setOf(
            "sleep_csv", "sleep_score_csv", "sleep_stage_csv", "hrv", "vo2max", "vo2max_csv",
            "steps", "calories", "active_minutes", "active_energy",
        )
        internal fun parseTime(value: String?): Long? = value?.let {
            try { Instant.parse(it).toEpochMilli() }
            catch (_: Exception) { try { OffsetDateTime.parse(it).toInstant().toEpochMilli() } catch (_: Exception) { null } }
        }
    }
}
