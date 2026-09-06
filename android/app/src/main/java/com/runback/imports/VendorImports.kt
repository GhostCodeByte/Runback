package com.runback.imports

import com.runback.core.StrengthSet
import com.runback.core.StrengthWorkout
import com.runback.core.WellnessRow
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/**
 * Vendor export parsers for optional app imports (Fitbit, Google Fit, Strong,
 * Mi Fitness/Zepp, Apple Health, Samsung Health, Garmin, Polar, Strava, Huawei).
 *
 * Every import is optional: missing files only limit the affected context note,
 * they never block recording or run analysis. Raw vendor files stay bounded
 * (same 64 MB per file / 512 MB expanded / 2.000 entry budget as track imports).
 * High-frequency intraday series are capped and summarized; derived scores
 * (readiness, training status, Body Battery) are stored as display-only context
 * and never feed recommendations.
 */
object VendorImports {
    enum class Vendor {
        FITBIT, GOOGLE_FIT, STRONG, MI_FITNESS, APPLE_HEALTH, SAMSUNG,
        GARMIN, POLAR, STRAVA, HUAWEI, GENERIC,
    }

    data class StrongParseResult(
        val workouts: List<StrengthWorkout>,
        val setsByWorkout: Map<String, List<StrengthSet>>,
        val rows: Int,
        val skipped: Int,
    )

    data class ActivitiesParseResult(
        val runs: List<RunDraft>,
        val skipped: Int,
    )

    data class RunDraft(
        val startTime: Long,
        val endTime: Long,
        val durationSeconds: Double,
        val distanceMeters: Double,
        val name: String,
        val source: String,
        val avgHeartRate: Double? = null,
        val calories: Double? = null,
    )

    const val MAX_CSV_ROWS = 60000
    const val MAX_JSON_WELLNESS = 20000
    const val MAX_APPLE_RECORDS = 120000

    fun detectVendor(fileName: String, entryPath: String = ""): Vendor? {
        val name = fileName.lowercase(Locale.ROOT)
        val path = (entryPath + "/" + fileName).lowercase(Locale.ROOT)
        if (name == "export.xml" || path.contains("apple_health") || path.contains("workout-routes/")) return Vendor.APPLE_HEALTH
        if (name.startsWith("com.samsung.") || name.startsWith("com_samsung") || path.contains("samsung")) return Vendor.SAMSUNG
        if (name.startsWith("heart_rate-") || name.startsWith("sleep-") || path.contains("fitbit") ||
            name == "weight.json" || name.startsWith("hrv-") || name.startsWith("spo2-")) return Vendor.FITBIT
        if (path.contains("/fit/") || path.contains("google fit") || name.contains("google-fit") ||
            name.contains("com.google.") || (name.endsWith(".json") && (name.contains("session") || name.contains("daily")) && path.contains("takeout"))) {
            // Takeout/Fit sessions overlap with generic session CSVs; prefer explicit markers below.
            if (path.contains("takeout") && path.contains("fit")) return Vendor.GOOGLE_FIT
        }
        if (name.contains("strong") && name.endsWith(".csv")) return Vendor.STRONG
        if (name.startsWith("sport") || name.startsWith("heartrate_auto") || name.startsWith("activity_minute") ||
            name.startsWith("activity-") && path.contains("zepp") || path.contains("mifit") || path.contains("zepp") ||
            path.contains("mi fitness") || path.contains("xiaomi")) return Vendor.MI_FITNESS
        if (name == "summarizedactivities.json" || name.contains("summarizedactivities") ||
            name.contains("sleepdata.json") || name.contains("sleep_data.json") && path.contains("di_connect") ||
            path.contains("di_connect") || path.contains("garmin")) return Vendor.GARMIN
        if (name == "activities.csv" && (path.contains("strava") || path.contains("bulk"))) return Vendor.STRAVA
        if (name.contains("polar") || path.contains("polar")) return Vendor.POLAR
        if (name.contains("huawei") || name.contains("hihealth") || path.contains("huawei")) return Vendor.HUAWEI
        return null
    }

    fun isStrongHeader(header: List<String>): Boolean {
        val lower = header.map { it.trim().lowercase(Locale.ROOT) }.toSet()
        return lower.contains("exercise name") && lower.contains("set order") && lower.contains("date")
    }

    fun isGenericActivitiesHeader(header: List<String>): Boolean {
        val lower = header.map { it.trim().lowercase(Locale.ROOT) }.toSet()
        val hasDate = lower.any { it.contains("date") || it.contains("start") || it == "zeit" }
        val hasDist = lower.any { it.contains("dist") || it.contains("km") || it.contains("miles") }
        val hasDur = lower.any { it.contains("dur") || it.contains("time") || it.contains("elapsed") }
        return hasDate && (hasDist || hasDur)
    }

    // ---- CSV utilities ----

    fun splitCsvLine(line: String): List<String> {
        val out = ArrayList<String>()
        val current = StringBuilder()
        var inQuotes = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length && line[i + 1] == '"') { current.append('"'); i += 2; continue }
                    inQuotes = false; i++; continue
                }
                current.append(c); i++; continue
            }
            when (c) {
                '"' -> { inQuotes = true; i++ }
                ',' -> { out.add(current.toString()); current.setLength(0); i++ }
                ';' -> {
                    // Only treat semicolon as delimiter when the line has no commas
                    // (Central-European exports). Mixed lines keep comma splitting.
                    if (!line.contains(',')) { out.add(current.toString()); current.setLength(0) }
                    else current.append(c)
                    i++
                }
                else -> { current.append(c); i++ }
            }
        }
        out.add(current.toString())
        return out.map { it.trim() }
    }

    fun parseDoubleFlexible(raw: String?): Double? {
        if (raw == null) return null
        var s = raw.trim().replace("\u00a0", "")
        if (s.isEmpty() || s == "-" || s.lowercase(Locale.ROOT) in listOf("n/a", "na", "none", "null")) return null
        // "1.234,56" (de) vs "1,234.56" (en): last separator wins as decimal mark.
        val lastComma = s.lastIndexOf(','); val lastDot = s.lastIndexOf('.')
        if (lastComma >= 0 && lastDot >= 0) {
            s = if (lastComma > lastDot) s.replace(".", "").replace(',', '.') else s.replace(",", "")
        } else if (lastComma >= 0) {
            s = if (s.count { it == ',' } == 1 && s.length - lastComma - 1 in 1..3) s.replace(',', '.') else s.replace(",", "")
        }
        s = s.replace(Regex("[^0-9.\\-eE+]"), "")
        if (s.isEmpty() || s == "-" || s == "." || s == "-.") return null
        return s.toDoubleOrNull()
    }

    fun parseLongFlexible(raw: String?): Long? = parseDoubleFlexible(raw)?.toLong()

    private val datePatterns = listOf(
        "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd",
        "dd.MM.yyyy HH:mm:ss", "dd.MM.yyyy HH:mm", "dd.MM.yyyy",
        "MM/dd/yyyy HH:mm:ss", "MM/dd/yyyy HH:mm", "MM/dd/yyyy",
        "yyyy/MM/dd HH:mm:ss", "yyyy/MM/dd HH:mm",
    ).map { DateTimeFormatter.ofPattern(it) }

    fun parseTimeFlexible(raw: String?): Long? {
        if (raw == null) return null
        val s = raw.trim()
        if (s.isEmpty()) return null
        s.toLongOrNull()?.let {
            // Epoch seconds vs millis heuristic.
            return if (it > 100000000000L) it else it * 1000
        }
        parseDoubleFlexible(s)?.takeIf { it > 1e9 && s.matches(Regex("[0-9.,\\s]+")) }?.let {
            return if (it > 1e11) it.toLong() else (it * 1000).toLong()
        }
        try { return Instant.parse(s).toEpochMilli() } catch (_: Exception) {}
        try { return OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (_: Exception) {}
        for (pattern in datePatterns) {
            try {
                return if (pattern.toString().contains('H')) LocalDateTime.parse(s, pattern).toInstant(ZoneOffset.UTC).toEpochMilli()
                else LocalDate.parse(s, pattern).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            } catch (_: Exception) { }
        }
        // Samsung/Apple style "2024-03-15 08:12:00 +0100"
        try {
            return OffsetDateTime.parse(s, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss Z")).toInstant().toEpochMilli()
        } catch (_: Exception) { }
        try {
            return LocalDateTime.parse(s.take(19), DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                .toInstant(ZoneOffset.UTC).toEpochMilli()
        } catch (_: Exception) { }
        return null
    }

    fun parseDurationFlexible(raw: String?): Double? {
        if (raw == null) return null
        val s = raw.trim()
        if (s.isEmpty()) return null
        if (s.contains(':')) {
            val parts = s.split(':').mapNotNull { parseDoubleFlexible(it) }
            if (parts.isEmpty()) return null
            var total = 0.0
            for (p in parts) total = total * 60 + p
            return total
        }
        // "1h2m30s", "45 min", "3600 sec"
        val hours = Regex("(\\d+(?:[.,]\\d+)?)\\s*h").find(s)?.groupValues?.get(1)?.let { parseDoubleFlexible(it) } ?: 0.0
        val minutes = Regex("(\\d+(?:[.,]\\d+)?)\\s*m(?!s)").find(s)?.groupValues?.get(1)?.let { parseDoubleFlexible(it) } ?: 0.0
        val seconds = Regex("(\\d+(?:[.,]\\d+)?)\\s*s").find(s)?.groupValues?.get(1)?.let { parseDoubleFlexible(it) } ?: 0.0
        if (hours > 0 || minutes > 0 || seconds > 0) return hours * 3600 + minutes * 60 + seconds
        return parseDoubleFlexible(s)
    }

    // ---- Unit conversions (never invent precision; unknown units -> null) ----

    fun toKilograms(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "kg", "kgs", "kilogram", "kilograms" -> value
            "lb", "lbs", "pound", "pounds" -> value * 0.45359237
            "g", "gram" -> value / 1000.0
            else -> null
        }
    }

    fun toMeters(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "m", "meter", "meters" -> value
            "km", "kms", "kilometer", "kilometers" -> value * 1000.0
            "mi", "mile", "miles" -> value * 1609.344
            "ft", "feet", "foot" -> value * 0.3048
            "yd", "yard", "yards" -> value * 0.9144
            "cm" -> value / 100.0
            else -> null
        }
    }

    fun toKcal(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "kcal", "cal", "calories", "calorie" -> value
            "kj", "kjoule" -> value / 4.184
            "j", "joule" -> value / 4184.0
            else -> null
        }
    }

    fun toMillis(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "ms", "millis", "milliseconds" -> value
            "s", "sec", "secs", "second", "seconds" -> value * 1000.0
            "min" -> value * 60000.0
            else -> null
        }
    }

    // ---- Strong CSV (one row per set) ----

    fun parseStrongCsv(text: String, source: String): StrongParseResult {
        val lines = text.lineSequence().take(MAX_CSV_ROWS + 2).toList()
        if (lines.isEmpty()) return StrongParseResult(emptyList(), emptyMap(), 0, 0)
        val header = splitCsvLine(stripBom(lines.first()))
        require(isStrongHeader(header)) { "Keine Strong-Kopfzeile (Date, Exercise Name, Set Order erwartet)" }
        val idx = header.map { it.trim().lowercase(Locale.ROOT) }
        fun col(name: String): Int = idx.indexOf(name)
        val cDate = col("date"); val cWorkout = col("workout name"); val cDuration = col("duration")
        val cExercise = col("exercise name"); val cOrder = col("set order"); val cWeight = col("weight")
        val cReps = col("reps"); val cDistance = col("distance"); val cSeconds = col("seconds")
        val cNotes = col("notes"); val cWorkoutNotes = col("workout notes"); val cRpe = col("rpe")
        data class Key(val time: Long, val name: String)
        val groups = LinkedHashMap<Key, MutableList<Map<String, String>>>()
        var skipped = 0
        var rows = 0
        for (raw in lines.drop(1)) {
            if (raw.isBlank()) continue
            if (++rows > MAX_CSV_ROWS) break
            val cells = splitCsvLine(raw)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val time = parseTimeFlexible(get(cDate)) ?: run { skipped++; continue }
            val exercise = get(cExercise).take(160)
            if (exercise.isBlank()) { skipped++; continue }
            val key = Key(time, get(cWorkout).ifBlank { "Krafttraining" }.take(120))
            groups.getOrPut(key) { ArrayList() }.add(mapOf(
                "exercise" to exercise, "order" to get(cOrder), "weight" to get(cWeight),
                "reps" to get(cReps), "distance" to get(cDistance), "seconds" to get(cSeconds),
                "notes" to get(cNotes), "workoutNotes" to get(cWorkoutNotes), "rpe" to get(cRpe),
                "duration" to get(cDuration),
            ))
        }
        val workouts = ArrayList<StrengthWorkout>()
        val setsByWorkout = LinkedHashMap<String, List<StrengthSet>>()
        for ((key, setRows) in groups) {
            if (setRows.size > 2000) continue
            val id = "strong:" + UUID.nameUUIDFromBytes("${key.time}:${key.name}".toByteArray()).toString()
            val duration = setRows.firstNotNullOfOrNull { parseDurationFlexible(it["duration"]) } ?: 0.0
            val workoutNotes = setRows.firstNotNullOfOrNull { it["workoutNotes"]?.takeIf(String::isNotBlank) } ?: ""
            workouts.add(StrengthWorkout(id, key.time, key.name, duration.coerceIn(0.0, 12 * 3600.0), source,
                "{\"workoutNotes\":${jsonStr(workoutNotes)},\"sets\":${setRows.size}}"))
            setsByWorkout[id] = setRows.mapIndexed { i, r ->
                StrengthSet(
                    exercise = r["exercise"] ?: "",
                    setOrder = r["order"]?.toIntOrNull() ?: (i + 1),
                    weight = parseDoubleFlexible(r["weight"])?.takeIf { it.isFinite() && it in 0.0..1500.0 },
                    weightUnit = "kg",
                    reps = parseDoubleFlexible(r["reps"])?.toInt()?.takeIf { it in 0..1000 },
                    distance = parseDoubleFlexible(r["distance"])?.takeIf { it.isFinite() && it in 0.0..100000.0 },
                    seconds = parseDoubleFlexible(r["seconds"])?.takeIf { it.isFinite() && it in 0.0..86400.0 },
                    rpe = parseDoubleFlexible(r["rpe"])?.takeIf { it.isFinite() && it in 0.0..10.0 },
                    notes = (r["notes"] ?: "").take(500),
                )
            }
        }
        return StrongParseResult(workouts, setsByWorkout, rows, skipped)
    }

    // ---- Generic activities CSV (Strava/Garmin/Polar bulk summaries) ----

    fun parseActivitiesCsv(text: String, source: String): ActivitiesParseResult {
        val lines = text.lineSequence().take(MAX_CSV_ROWS + 2).toList()
        if (lines.isEmpty()) return ActivitiesParseResult(emptyList(), 0)
        val header = splitCsvLine(stripBom(lines.first())).map { it.lowercase(Locale.ROOT) }
        fun find(vararg names: String): Int {
            names.forEach { want ->
                val i = header.indexOfFirst { it == want || it.contains(want) }
                if (i >= 0) return i
            }
            return -1
        }
        val cDate = find("start", "date", "begin", "zeit", "startzeit")
        val cDist = find("distance", "distanz", "km")
        val cDur = find("duration", "elapsed", "dauer", "moving time", "zeit")
        val cType = find("type", "sport", "activity type", "aktivität")
        val cName = find("name", "title", "titel")
        val cHr = find("avg hr", "average heart", "avg_heartrate", "heartrate", "herzfrequenz", "avg_hr")
        val cCal = find("calories", "kalorien", "energy", "kcal")
        if (cDate < 0) return ActivitiesParseResult(emptyList(), lines.size - 1)
        val runs = ArrayList<RunDraft>()
        var skipped = 0
        lines.drop(1).take(MAX_CSV_ROWS).forEach { raw ->
            if (raw.isBlank()) return@forEach
            val cells = splitCsvLine(raw)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val start = parseTimeFlexible(get(cDate)) ?: run { skipped++; return@forEach }
            if (cType >= 0) {
                val t = get(cType).lowercase(Locale.ROOT)
                val isRun = t.contains("run") || t.contains("lauf") || t.contains("jog") || t.contains("treadmill") ||
                    t.contains("trail") || t.isBlank()
                if (!isRun) { skipped++; return@forEach }
            }
            val distance = parseDoubleFlexible(get(cDist))?.let { guessDistanceMeters(it, get(cDist)) } ?: 0.0
            val duration = parseDurationFlexible(get(cDur)) ?: 0.0
            if (distance <= 0 && duration <= 0) { skipped++; return@forEach }
            val end = start + (duration * 1000).toLong().coerceIn(0, 24 * 3600 * 1000L)
            runs.add(RunDraft(start, if (end > start) end else start, duration, distance,
                get(cName).ifBlank { "Importierter Lauf" }.take(120), source,
                parseDoubleFlexible(get(cHr))?.takeIf { it in 30.0..240.0 },
                parseDoubleFlexible(get(cCal))?.takeIf { it in 0.0..20000.0 }))
        }
        return ActivitiesParseResult(runs, skipped)
    }

    private fun guessDistanceMeters(value: Double, rawCell: String): Double {
        if (!value.isFinite() || value < 0) return 0.0
        // Heuristic only for unit-less bulk CSVs: marathon-scale numbers are meters,
        // everyday numbers are kilometers. Documented in vendor-import.md.
        val cell = rawCell.lowercase(Locale.ROOT)
        if (cell.contains("mi")) return value * 1609.344
        if (cell.contains("km")) return value * 1000.0
        if (cell.contains(" m") || cell.endsWith("m")) return value
        return if (value > 500) value else value * 1000.0
    }

    // ---- Apple Health record mapping ----

    /** Maps an Apple HK type to a Runback wellness kind, or null when intentionally skipped. */
    fun mapAppleRecordType(type: String): String? = when (type) {
        "HKQuantityTypeIdentifierRestingHeartRate" -> "resting_hr"
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN" -> "hrv_sdnn"
        "HKQuantityTypeIdentifierStepCount" -> "steps"
        "HKQuantityTypeIdentifierDistanceWalkingRunning" -> "distance"
        "HKQuantityTypeIdentifierBodyMass" -> "weight"
        "HKQuantityTypeIdentifierHeight" -> "height"
        "HKQuantityTypeIdentifierBodyFatPercentage" -> "body_fat"
        "HKQuantityTypeIdentifierVO2Max" -> "vo2max"
        "HKQuantityTypeIdentifierActiveEnergyBurned" -> "calories"
        "HKQuantityTypeIdentifierBasalEnergyBurned" -> "calories_basal"
        "HKQuantityTypeIdentifierOxygenSaturation" -> "spo2"
        "HKQuantityTypeIdentifierRespiratoryRate" -> "respiratory_rate"
        // Intraday heart rate is intentionally not stored row-by-row (export.xml can
        // hold millions of samples); workout-linked HR arrives via TCX/GPX/FIT.
        // Sleep records map to sleep_stage with the stage kept in extra.stage.
        "HKCategoryTypeIdentifierSleepAnalysis" -> "sleep_stage"
        else -> null
    }

    fun mapAppleSleepStage(value: String): String = when (value.trim()) {
        "HKCategoryValueSleepAnalysisAsleepCore" -> "light"
        "HKCategoryValueSleepAnalysisAsleepDeep" -> "deep"
        "HKCategoryValueSleepAnalysisAsleepREM" -> "rem"
        "HKCategoryValueSleepAnalysisAsleepUnspecified", "HKCategoryValueSleepAnalysisAsleep" -> "asleep"
        "HKCategoryValueSleepAnalysisAwake", "HKCategoryValueSleepAnalysisAwakeInBed" -> "awake"
        "HKCategoryValueSleepAnalysisInBed" -> "in_bed"
        else -> "unknown"
    }

    fun isAppleRunningWorkout(type: String): Boolean =
        type == "HKWorkoutActivityTypeRunning" || type == "HKWorkoutActivityTypeTrackAndField"

    // ---- Samsung Health mapping ----

    fun mapSamsungSleepStage(code: String): String = when (code.trim()) {
        "40001" -> "awake"
        "40002" -> "light"
        "40003" -> "deep"
        "40004" -> "rem"
        else -> "unknown"
    }

    fun samsungFileKind(fileName: String): String {
        val n = fileName.lowercase(Locale.ROOT)
        return when {
            n.contains("exercise") && n.contains("weather") -> "weather"
            n.contains("exercise") -> "exercise"
            n.contains("sleep_stage") -> "sleep_stage"
            n.contains("sleep") -> "sleep"
            n.contains("heart_rate") || n.contains("heartrate") -> "heart_rate"
            n.contains("hrv") -> "hrv"
            n.contains("stress") && !n.contains("histogram") -> "stress"
            n.contains("oxygen") || n.contains("spo2") -> "spo2"
            n.contains("weight") -> "weight"
            n.contains("height") -> "height"
            n.contains("step") || n.contains("pedometer") -> "steps"
            n.contains("floors_climbed") -> "floors"
            n.contains("skin") || n.contains("temperature") -> "skin_temp"
            else -> "other"
        }
    }

    fun isSamsungRunningExercise(exerciseType: String): Boolean {
        val t = exerciseType.trim().lowercase(Locale.ROOT)
        return t.contains("run") || t.contains("lauf") || t == "1001" || t == "11007"
    }

    // ---- Fitbit / Google Fit / Garmin filename helpers ----

    fun fitbitFileKind(fileName: String): String {
        val n = fileName.lowercase(Locale.ROOT)
        return when {
            n.startsWith("heart_rate-") -> "heart_rate"
            n.startsWith("sleep-") -> "sleep"
            n.startsWith("hrv-") -> "hrv"
            n.startsWith("spo2-") || n.contains("spo2") || n.contains("oxygen") -> "spo2"
            n.startsWith("activities-") || n.contains("daily") && n.contains("activit") -> "daily_activity"
            n.contains("weight") -> "weight"
            n.contains("distance") -> "distance"
            n.contains("steps") -> "steps"
            n.contains("calories") -> "calories"
            else -> "other"
        }
    }

    fun miFitnessFileKind(fileName: String): String {
        val n = fileName.lowercase(Locale.ROOT)
        return when {
            n.startsWith("sport") -> "sport"
            n.startsWith("heartrate_auto") || n.startsWith("heartrate") -> "heart_rate"
            n.startsWith("activity_minute") || n.startsWith("activity-") -> "steps"
            n.contains("sleep") -> "sleep"
            n.contains("weight") -> "weight"
            else -> "other"
        }
    }

    fun wellnessId(kind: String, time: Long, source: String, value: Double): String =
        "$kind:" + UUID.nameUUIDFromBytes("$kind:$time:$source:$value".toByteArray()).toString()

    fun stripBom(s: String): String = s.removePrefix("\uFEFF")

    private fun jsonStr(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").take(500) + "\""
}
