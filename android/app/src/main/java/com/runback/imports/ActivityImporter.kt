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
        ).import(file)
    }

    private fun supported(name: String) = name.lowercase(Locale.ROOT).removeSuffix(".gz").let {
        it.endsWith(".gpx") || it.endsWith(".tcx") || it.endsWith(".fit") ||
            it.endsWith(".csv") || it.endsWith(".json") || it.endsWith(".xml")
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
        val result = store.addImportedRun(builder.summary(), builder.samples, sha256(file))
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
        var handled = false
        when {
            lower.endsWith(".xml") || name.equals("export.xml", ignoreCase = true) ->
                handled = importAppleExportXml(file, name)
            lower.endsWith(".csv") && isStrongCsv(file) ->
                handled = importStrongCsv(file, name)
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
        file.inputStream().bufferedReader().use { reader ->
            val header = VendorImports.splitCsvLine(VendorImports.stripBom(reader.readLine() ?: return false))
            VendorImports.isStrongHeader(header)
        }
    } catch (_: Exception) { false }

    private fun importStrongCsv(file: File, name: String): Boolean {
        val text = file.bufferedReader().use { it.readText() }
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

    private fun importActivitiesCsv(file: File, name: String, vendor: String): Boolean {
        val text = file.bufferedReader().use { it.readText() }
        val header = VendorImports.splitCsvLine(VendorImports.stripBom(text.lineSequence().firstOrNull() ?: return false))
        if (!VendorImports.isGenericActivitiesHeader(header)) return false
        val parsed = VendorImports.parseActivitiesCsv(text, vendor)
        for (draft in parsed.runs) {
            checkCancelled()
            val summary = summaryFromDraft(draft)
            recordImported(store.addSummaryRun(summary, "vendor:$vendor:${sha256(file)}:${draft.startTime}"), vendor)
        }
        if (parsed.runs.isEmpty()) increment("skipped")
        return true
    }

    private fun summaryFromDraft(draft: VendorImports.RunDraft): JSONObject =
        JSONObject().put("name", draft.name).put("startTime", draft.startTime).put("endTime", draft.endTime)
            .put("durationSeconds", draft.durationSeconds).put("distanceMeters", draft.distanceMeters)
            .put("purpose", "unknown").put("source", draft.source).put("status", "completed")
            .put("avgHeartRate", draft.avgHeartRate ?: JSONObject.NULL)

    private fun importMiFitnessCsv(file: File, name: String): Boolean {
        val kind = VendorImports.miFitnessFileKind(name)
        val text = file.bufferedReader().use { it.readText() }
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

    private fun importSamsungCsv(file: File, name: String): Boolean {
        val kind = VendorImports.samsungFileKind(name)
        if (kind == "other" || kind == "weather") return false
        val text = file.bufferedReader().use { it.readText() }
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
        val text = file.bufferedReader().use { it.readText() }
        if (text.length > MAX_FILE_BYTES) return false
        return when {
            vendor == VendorImports.Vendor.FITBIT || VendorImports.fitbitFileKind(name) != "other" ->
                importFitbitJson(text, name)
            entryPath.lowercase(Locale.ROOT).contains("takeout") && entryPath.lowercase(Locale.ROOT).contains("fit") ->
                importGoogleFitJson(text, name)
            lower.contains("summarizedactivities") || entryPath.lowercase(Locale.ROOT).contains("di_connect") ->
                importGarminJson(text, name, entryPath)
            lower == "activities.csv" -> false
            else -> importGenericWellnessJson(text, name)
        }
    }

    private fun importFitbitJson(text: String, name: String): Boolean {
        val kind = VendorImports.fitbitFileKind(name)
        val rows = ArrayList<com.runback.core.WellnessRow>()
        try {
            val trimmed = text.trim()
            if (trimmed.startsWith("[")) {
                val array = org.json.JSONArray(trimmed)
                for (i in 0 until minOf(array.length(), VendorImports.MAX_JSON_WELLNESS)) {
                    checkCancelled()
                    val obj = array.optJSONObject(i) ?: continue
                    fitbitRow(obj, kind)?.let { rows.add(it) }
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
                                fitbitRow(item, kind)?.let { rows.add(it) }
                            }
                        }
                    }
                }
                // Flat daily summary objects (steps/distance/calories/resting HR).
                if (rows.isEmpty()) fitbitRow(obj, kind)?.let { rows.add(it) }
                // Intraday heart-rate series: {"dateTime":"...","value":{"bpm":..}}
                if (obj.has("value") && kind == "heart_rate") fitbitRow(obj, kind)?.let { rows.add(it) }
            }
        } catch (_: Exception) { return false }
        if (rows.isEmpty()) return false
        noteVendor("fitbit", 0, 0, store.addWellnessBatch(rows.take(VendorImports.MAX_JSON_WELLNESS)), 0)
        return true
    }

    private fun fitbitRow(obj: org.json.JSONObject, kind: String): com.runback.core.WellnessRow? {
        fun time(): Long? {
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
            "sleep" -> {
                val end = VendorImports.parseTimeFlexible(obj.optString("endTime", obj.optString("end_time", ""))) ?: t
                val minutes = obj.optDouble("minutesAsleep", Double.NaN).takeIf { it.isFinite() }
                    ?: obj.optDouble("duration", Double.NaN).takeIf { it.isFinite() }
                    ?: ((end - t) / 60000.0).takeIf { it in 0.0..1440.0 } ?: return null
                val stage = obj.optString("level", obj.optString("stage", "asleep"))
                return com.runback.core.WellnessRow(VendorImports.wellnessId("sleep_stage", t, "fitbit", minutes),
                    "sleep_stage", t, end, minutes, "min", "fitbit", JSONObject().put("stage", stage.take(20)).toString())
            }
            "hrv" -> {
                val rmssd = obj.optDouble("rmssd", obj.optDouble("dailyRmssd", Double.NaN))
                if (!rmssd.isFinite()) return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("hrv_rmssd", t, "fitbit", rmssd),
                    "hrv_rmssd", t, 0L, rmssd, "ms", "fitbit", "{}")
            }
            "weight" -> {
                val kg = VendorImports.toKilograms(obj.optDouble("weight", Double.NaN), obj.optString("unit", "kg"))
                    ?: return null
                return com.runback.core.WellnessRow(VendorImports.wellnessId("weight", t, "fitbit", kg),
                    "weight", t, 0L, kg, "kg", "fitbit", "{}")
            }
            else -> {
                // Daily activity summary: steps / distance / calories / resting HR.
                val steps = obj.optDouble("steps", Double.NaN)
                if (steps.isFinite() && steps in 0.0..200000.0) {
                    return com.runback.core.WellnessRow(VendorImports.wellnessId("steps", t, "fitbit", steps),
                        "steps", t, 0L, steps, "count", "fitbit", "{}")
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
                                    if (distance > 0 || duration > 0) {
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
