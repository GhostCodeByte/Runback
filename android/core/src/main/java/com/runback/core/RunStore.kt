package com.runback.core

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.math.abs

data class RawSample(val time: Long, val kind: String, val values: JSONObject)
data class WellnessRow(val id: String = "", val kind: String, val time: Long, val endTime: Long = 0L,
    val value: Double = Double.NaN, val unit: String = "", val source: String = "import", val extra: String = "{}")
data class StrengthWorkout(val id: String, val time: Long, val name: String = "",
    val durationSec: Double = 0.0, val source: String = "import", val extra: String = "{}")
data class StrengthSet(val exercise: String, val setOrder: Int = 0, val weight: Double? = null,
    val weightUnit: String = "kg", val reps: Int? = null, val distance: Double? = null,
    val seconds: Double? = null, val rpe: Double? = null, val notes: String = "")

/** One serialized SQLite owner per process. Raw rows are append-only, corrections are separate. */
class RunStore(context: Context) {
    private val app = context.applicationContext
    private val db: SQLiteDatabase
    init {
        synchronized(lock) {
            if (helper == null) {
                helper = Database(app)
                val first = helper!!.writableDatabase
                first.rawQuery("SELECT id,json FROM runs", null).use { rows ->
                    while (rows.moveToNext()) {
                        val run = JSONObject(rows.getString(1))
                        if (run.optString("status") == "recording") {
                            run.put("status", "interrupted").remove("_tick")
                            first.update("runs", ContentValues().apply { put("json", run.toString()) }, "id=?", arrayOf(rows.getString(0)))
                        }
                    }
                }
            }
            db = helper!!.writableDatabase
        }
    }
    private fun <T> locked(block: () -> T): T = synchronized(lock, block)
    private fun <T> transaction(block: () -> T): T {
        db.beginTransaction()
        try { val result = block(); db.setTransactionSuccessful(); return result } finally { db.endTransaction() }
    }
    private fun read(id: String): JSONObject = db.rawQuery("SELECT json FROM runs WHERE id=?", arrayOf(id)).use {
        require(it.moveToFirst()) { "Lauf nicht gefunden" }; JSONObject(it.getString(0))
    }
    private fun write(run: JSONObject) { db.insertWithOnConflict("runs", null, ContentValues().apply {
        put("id", run.getString("id")); put("start", run.getLong("startTime")); put("json", run.toString())
    }, SQLiteDatabase.CONFLICT_REPLACE) }
    private fun activeId(): String? = db.rawQuery("SELECT id,json FROM runs ORDER BY start DESC", null).use {
        while (it.moveToNext()) if (JSONObject(it.getString(1)).optString("status") in listOf("recording", "paused", "interrupted")) return@use it.getString(0)
        null
    }
    private fun present(run: JSONObject): JSONObject {
        val ms = run.optLong("durationMs") + if (run.optString("status") == "recording")
            (SystemClock.elapsedRealtime() - run.optLong("_tick", SystemClock.elapsedRealtime())).coerceAtLeast(0) else 0
        run.put("durationSeconds", ms / 1000.0).put("durationSec", ms / 1000.0).put("elapsedMs", ms)
            .put("startedAt", run.optLong("startTime")).put("endedAt", run.optLong("endTime"))
            .put("distanceM", run.optDouble("distanceMeters", 0.0))
        val feedback = getDocument("feedback_${run.getString("id")}") ?: JSONObject()
        run.put("feedback", feedback)
        if (feedback.has("purpose")) run.put("purpose", feedback.getString("purpose"))
        // Sportart: fehlt sie (ältere Datensätze, Importe), ist es ein Lauf. Eine
        // spätere Korrektur liegt im Feedback; die ursprüngliche bleibt im Datensatz.
        if (feedback.has("sport")) run.put("sport", feedback.getString("sport"))
        else if (!run.has("sport")) run.put("sport", "running")
        run.remove("_tick")
        return run
    }
    fun listRuns(limit: Int = 1000, offset: Int = 0): JSONArray = locked {
        val result = JSONArray()
        db.rawQuery("SELECT json FROM runs ORDER BY start DESC LIMIT ? OFFSET ?", arrayOf(limit.coerceIn(1,10000).toString(), offset.coerceAtLeast(0).toString())).use {
            while (it.moveToNext()) result.put(present(JSONObject(it.getString(0))))
        }; result
    }
    fun active(): JSONObject? = locked { activeId()?.let { present(read(it)) } }
    private fun newRun(purpose: String, source: String, sport: String): JSONObject {
        check(app.filesDir.usableSpace > 32L * 1024 * 1024) { "Zu wenig freier Speicher. Bitte zuerst Daten sichern und Speicher freigeben." }
        val now = System.currentTimeMillis()
        return JSONObject().put("id", UUID.randomUUID().toString()).put("startTime", now).put("endTime", now)
            .put("purpose", purpose).put("sport", sport).put("source", source).put("status", "recording").put("durationMs", 0L)
            .put("_tick", SystemClock.elapsedRealtime()).put("distanceMeters", 0.0).put("rawSampleCount", 0)
            .put("model_version", RunMath.MODEL_VERSION).put("sourceVersion", "raw-v1")
    }
    fun start(purpose: String = "easy", source: String = "phone", sport: String = "running"): JSONObject = locked {
        activeId()?.let { return@locked present(read(it)) }
        val run = newRun(purpose, source, sport)
        transaction { write(run); addEvent(run.getString("id"), "start", JSONObject()) }
        present(JSONObject(run.toString()))
    }
    /** Start a route run and bind its run id to the route in one SQLite lock/transaction. */
    fun startRoute(purpose: String, source: String, sport: String, routePlanId: String): JSONObject = locked {
        check(activeId() == null) { "Ein anderer Lauf ist bereits aktiv." }
        val planner = getDocument("route_planner") ?: error("Routenplaner ist nicht vorbereitet.")
        val routes = planner.optJSONArray("routes") ?: JSONArray()
        val route = (0 until routes.length())
            .mapNotNull { routes.optJSONObject(it) }
            .firstOrNull { it.optString("id") == routePlanId }
            ?: error("Die geplante Route wurde nicht gefunden.")
        check(route.optString("source") == "brouter") { "Nur verifizierte Straßenrouten können gestartet werden." }
        check(route.optString("activeRunId").isBlank()) { "Diese Route ist bereits einem Lauf zugeordnet." }
        val run = newRun(purpose, source, sport)
        val runId = run.getString("id")
        val updatedRoutes = JSONArray()
        for (index in 0 until routes.length()) {
            val candidate = routes.optJSONObject(index) ?: continue
            if (candidate.optString("id") == routePlanId) candidate.put("activeRunId", runId)
            updatedRoutes.put(candidate)
        }
        transaction {
            write(run)
            addEvent(runId, "start", JSONObject().put("routePlanId", routePlanId))
            planner.put("routes", updatedRoutes).put("activeRoutePlanId", routePlanId)
            putDocument("route_planner", planner)
        }
        present(JSONObject(run.toString()))
    }
    fun checkpoint(id: String) = locked {
        val run = read(id)
        if (run.optString("status") == "recording") {
            val tick = SystemClock.elapsedRealtime()
            run.put("durationMs", run.optLong("durationMs") + (tick - run.optLong("_tick", tick)).coerceAtLeast(0))
            run.put("_tick", tick).put("endTime", System.currentTimeMillis())
        }
        write(run)
    }
    fun pause(): JSONObject? = setStatus("paused", "pause")
    fun finish(): JSONObject? = setStatus("completed", "finish")
    private fun setStatus(status: String, event: String): JSONObject? = locked {
        val id = activeId() ?: return@locked null
        transaction {
            checkpoint(id); val run = read(id); run.put("status", status); run.remove("_tick"); write(run)
            addEvent(id, event, JSONObject()); if (status == "completed") derive(id)
            present(read(id))
        }
    }
    fun resume(): JSONObject? = locked {
        val id = activeId() ?: return@locked null
        val run = read(id)
        if (run.optString("status") != "recording") {
            transaction { addEvent(id, "resume", JSONObject().put("previousStatus", run.optString("status")))
                run.put("status", "recording").put("_tick", SystemClock.elapsedRealtime()); write(run) }
        }; present(JSONObject(run.toString()))
    }
    fun markInterrupted(reason: String) = locked {
        activeId()?.let { id -> val run = read(id); run.put("status", "interrupted"); run.remove("_tick"); write(run)
            addEvent(id, "interrupted", JSONObject().put("message", reason)) }
    }
    fun clearRouteAssignment(runId: String) = locked {
        val planner = getDocument("route_planner") ?: return@locked
        val routes = planner.optJSONArray("routes") ?: return@locked
        var changed = false
        var activeRouteId: String? = null
        val updatedRoutes = JSONArray()
        for (index in 0 until routes.length()) {
            val route = routes.optJSONObject(index) ?: continue
            if (route.optString("activeRunId") == runId) {
                activeRouteId = route.optString("id")
                route.remove("activeRunId")
                changed = true
            }
            updatedRoutes.put(route)
        }
        if (changed) {
            planner.put("routes", updatedRoutes)
            if (planner.optString("activeRoutePlanId") == activeRouteId) planner.put("activeRoutePlanId", JSONObject.NULL)
            putDocument("route_planner", planner)
        }
    }
    fun addEvent(id: String, type: String, data: JSONObject) = locked {
        db.insertOrThrow("events", null, ContentValues().apply { put("run_id", id); put("json", JSONObject()
            .put("type", type).put("at", System.currentTimeMillis()).put("data", data).toString()) })
    }
    fun appendSamples(id: String, samples: List<RawSample>) = locked {
        if (samples.isEmpty()) return@locked
        transaction {
            val run = read(id)
            var previous: JSONObject? = db.rawQuery("SELECT time,json FROM samples WHERE run_id=? AND kind='gps' ORDER BY seq DESC LIMIT 1", arrayOf(id)).use {
                if (it.moveToFirst()) JSONObject(it.getString(1)).put("time", it.getLong(0)) else null }
            val lastBoundary = db.rawQuery("SELECT json FROM events WHERE run_id=? ORDER BY seq DESC LIMIT 1", arrayOf(id)).use {
                if (it.moveToFirst()) JSONObject(it.getString(0)) else null }
            if (lastBoundary?.optString("type") in listOf("pause", "resume", "interrupted") && (previous?.optLong("time") ?: 0) < lastBoundary!!.optLong("at")) previous = null
            var distance = run.optDouble("distanceMeters", 0.0)
            samples.forEach { sample ->
                require(sample.time > 0 && sample.kind.length <= 40) { "Ungültiger Messwert" }
                db.insertOrThrow("samples", null, ContentValues().apply {
                    put("run_id", id); put("time", sample.time); put("kind", sample.kind); put("json", sample.values.toString()) })
                if (sample.kind == "gps") {
                    val v = sample.values
                    previous?.let { p -> RunMath.acceptedDistance(p.optDouble("latitude"),p.optDouble("longitude"),p.optLong("time"),p.optDouble("accuracyM",0.0),
                        v.optDouble("latitude"),v.optDouble("longitude"),sample.time,v.optDouble("accuracyM",0.0))?.let { distance += it } }
                    previous = JSONObject(v.toString()).put("time", sample.time)
                }
                if (sample.kind == "heartRate") {
                    val bpm = sample.values.optDouble("bpm")
                    if (bpm.isFinite() && bpm in 30.0..240.0) run.put("lastHeartRate", bpm)
                }
            }
            run.put("distanceMeters", distance).put("rawSampleCount", run.optInt("rawSampleCount") + samples.size); write(run)
        }
    }
    fun rawSamples(id: String): JSONArray = locked {
        val result = JSONArray()
        db.rawQuery("SELECT time,kind,json FROM samples WHERE run_id=? ORDER BY time,seq", arrayOf(id)).use {
            while (it.moveToNext()) result.put(JSONObject().put("time", it.getLong(0)).put("kind", it.getString(1)).put("values", JSONObject(it.getString(2))))
        }; result
    }
    /** Small bounded GPS snapshot for live screens; finished-run geometry is derived separately. */
    private fun geometryForRun(id: String, limit: Int): JSONArray {
        val points = ArrayList<JSONObject>()
        val bounded = limit.coerceIn(2, 512)
        val rawLimit = (bounded * 4).coerceAtMost(2048)
        db.rawQuery("SELECT time,json FROM samples WHERE run_id=? AND kind='gps' ORDER BY time DESC,seq DESC LIMIT ?", arrayOf(id, rawLimit.toString())).use {
            while (it.moveToNext()) {
                val value = JSONObject(it.getString(1))
                points.add(JSONObject().put("latitude", value.optDouble("latitude"))
                    .put("longitude", value.optDouble("longitude")).put("time", it.getLong(0)))
            }
        }
        points.reverse()
        val boundaries = events(id)
        val cuts = (0 until boundaries.length()).mapNotNull { index ->
            boundaries.optJSONObject(index)?.takeIf { it.optString("type") in listOf("pause", "resume", "interrupted") }?.optLong("at")
        }
        val withGaps = points.mapIndexed { index, point ->
            val previousTime = if (index > 0) points[index - 1].optLong("time") else 0L
            point.put("gap", previousTime > 0L && cuts.any { it > previousTime && it <= point.optLong("time") })
        }
        if (withGaps.size <= bounded) return JSONArray(withGaps)
        return JSONArray().apply {
            repeat(bounded) { index ->
                put(withGaps[(index.toLong() * (withGaps.size - 1) / (bounded - 1)).toInt()])
            }
        }
    }
    fun activeGeometry(limit: Int = 512): JSONArray = locked {
        activeId()?.let { geometryForRun(it, limit) } ?: JSONArray()
    }
    fun activeWithGeometry(limit: Int = 512): JSONObject? = locked {
        val id = activeId() ?: return@locked null
        present(read(id)).put("route", geometryForRun(id, limit))
    }
    private fun events(id: String): JSONArray {
        val result = JSONArray(); db.rawQuery("SELECT json FROM events WHERE run_id=? ORDER BY seq", arrayOf(id)).use {
            while(it.moveToNext()) result.put(JSONObject(it.getString(0))) }; return result
    }
    /** Derive only from GPS rows, not high-frequency accelerometer history. */
    private fun derive(id: String): JSONObject {
        val geometry = JSONArray(); val segments = JSONArray(); val series = JSONArray()
        val points = ArrayList<JSONObject>()
        db.rawQuery("SELECT time,json FROM samples WHERE run_id=? AND kind='gps' ORDER BY time,seq", arrayOf(id)).use {
            while(it.moveToNext()) points.add(JSONObject(it.getString(1)).put("time",it.getLong(0))) }
        val boundaries = events(id); val cuts = (0 until boundaries.length()).map { boundaries.getJSONObject(it) }
            .filter { it.optString("type") in listOf("pause","resume","interrupted") }.map { it.optLong("at") }
        var distance = 0.0; var segmentDistance = 0.0; var segmentDuration = 0.0; var segmentRise = 0.0; var allAltitude = true
        var elevation = RunMath.ElevationAccumulator()
        var gaps = 0; var previous: JSONObject? = null
        // Anker: Distanz zählt erst, wenn die Verschiebung den GPS-Rauschboden übersteigt.
        var anchor: JSONObject? = null
        fun split() {
            if (segmentDistance > 0) {
                val s = JSONObject().put("id", "${id}:${segments.length()}").put("distanceMeters",segmentDistance)
                    .put("durationSeconds",segmentDuration).put("sourceVersion",RunMath.MODEL_VERSION)
                if (allAltitude) s.put("gradePercent",100 * segmentRise / segmentDistance)
                    .put("ascentMeters", elevation.ascent).put("descentMeters", elevation.descent)
                segments.put(s)
            }; segmentDistance=0.0;segmentDuration=0.0;segmentRise=0.0;allAltitude=true;elevation=RunMath.ElevationAccumulator();anchor=null
        }
        points.forEachIndexed { index, p ->
            var gap = false
            previous?.let { before ->
                val crossing = cuts.any { it > before.optLong("time") && it <= p.optLong("time") }
                val d = if(crossing) null else RunMath.acceptedDistance(before.optDouble("latitude"),before.optDouble("longitude"),before.optLong("time"),before.optDouble("accuracyM",0.0),
                    p.optDouble("latitude"),p.optDouble("longitude"),p.optLong("time"),p.optDouble("accuracyM",0.0))
                if(d == null) { gap=true; gaps++; split() } else {
                    segmentDuration += (p.optLong("time")-before.optLong("time"))/1000.0
                    val base = anchor ?: before
                    val step = RunMath.anchoredDistance(base.optDouble("latitude"),base.optDouble("longitude"),base.optDouble("accuracyM",0.0),
                        p.optDouble("latitude"),p.optDouble("longitude"),p.optDouble("accuracyM",0.0))
                    if (step != null) { distance += step; segmentDistance += step; anchor = p } else if (anchor == null) anchor = base
                    if(before.has("altitudeM") && p.has("altitudeM")) {
                        segmentRise += p.optDouble("altitudeM")-before.optDouble("altitudeM")
                        elevation.add(before.optDouble("altitudeM")); elevation.add(p.optDouble("altitudeM"))
                    } else allAltitude=false
                    if(segmentDistance >= 1000) split()
                }
            }
            if (gap || index == 0 || index == points.lastIndex || index % maxOf(1, (points.size+399)/400) == 0) {
                if(geometry.length()<512) geometry.put(JSONObject().put("latitude",p.optDouble("latitude")).put("longitude",p.optDouble("longitude")).put("time",p.optLong("time")).put("gap",gap))
            }; previous=p
        }; split()
        val run = read(id)
        if(points.size>1) run.put("distanceMeters",distance)
        // Zeitgewichtet statt nach Sample-Anzahl: unregelmäßige Aufzeichnung verzerrt sonst das Mittel.
        val durationSeconds = run.optDouble("durationSeconds", Double.NaN)
        for ((kind,key,output,coverage) in listOf(
            listOf("heartRate","bpm","avgHeartRate","heartRateCoverage"), listOf("cadence","rpm","avgCadence","cadenceCoverage"))) {
            val times = ArrayList<Long>(); val values = ArrayList<Double>()
            db.rawQuery("SELECT time,json FROM samples WHERE run_id=? AND kind=? ORDER BY time", arrayOf(id,kind)).use {
                while(it.moveToNext()) { val v=JSONObject(it.getString(1)).optDouble(key)
                    if(v.isFinite() && v>0 && v<=300) { times.add(it.getLong(0)); values.add(v); if(series.length()<256) series.put(JSONObject().put("time",it.getLong(0)).put("kind",kind).put("value",v)) } }
            }
            RunMath.timeWeightedAverage(times, values)?.let { (mean, covered) ->
                run.put(output, mean)
                if (durationSeconds.isFinite() && durationSeconds > 0) run.put(coverage, (covered / durationSeconds).coerceIn(0.0, 1.0))
            }
        }
        run.put("segments",segments).put("gapCount",gaps).put("model_version",RunMath.MODEL_VERSION)
        run.put("dataRetention",JSONObject().put("originals","retained").put("recomputable",true))
        write(run)
        return JSONObject().put("geometry",geometry).put("series",series)
    }
    fun detail(id: String): JSONObject = locked {
        val derived = derive(id)
        present(read(id)).put("geometry",derived.getJSONArray("geometry")).put("series",derived.getJSONArray("series")).put("events",events(id))
    }
    fun getDocument(key: String): JSONObject? = locked { db.rawQuery("SELECT json FROM documents WHERE key=?",arrayOf(key)).use {
        if(it.moveToFirst()) JSONObject(it.getString(0)) else null } }
    fun putDocument(key: String, value: JSONObject) = locked {
        require(key.length<=200)
        check(db.insertWithOnConflict("documents",null,ContentValues().apply { put("key",key);put("json",value.toString()) },SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "Dokument konnte nicht gespeichert werden" }
    }
    fun deleteDocument(key: String) = locked { db.delete("documents","key=?",arrayOf(key)); Unit }
    /** Finish or delete a strength session while serializing the index and payload update. */
    fun finishStrengthSession(session: JSONObject, summary: JSONObject) = locked {
        val id = session.optString("id").ifBlank { error("Einheit ohne Kennung kann nicht gespeichert werden.") }
        require(summary.optString("id") == id) { "Zusammenfassung gehört zu einer anderen Einheit." }
        transaction {
            putDocument("strength_session_$id", session)
            val index = getDocument("strength_index") ?: JSONObject().put("sessions", JSONArray())
            val current = index.optJSONArray("sessions") ?: JSONArray()
            val kept = JSONArray()
            for (i in 0 until current.length()) {
                val entry = current.optJSONObject(i) ?: continue
                if (entry.optString("id") != id) kept.put(entry)
            }
            kept.put(summary)
            putDocument("strength_index", index.put("sessions", kept))
            db.delete("documents", "key=?", arrayOf("strength_active"))
        }
    }
    fun deleteStrengthSession(id: String) = locked {
        transaction {
            val index = getDocument("strength_index") ?: JSONObject().put("sessions", JSONArray())
            val current = index.optJSONArray("sessions") ?: JSONArray()
            val kept = JSONArray()
            for (i in 0 until current.length()) {
                val entry = current.optJSONObject(i) ?: continue
                if (entry.optString("id") != id) kept.put(entry)
            }
            putDocument("strength_index", index.put("sessions", kept))
            db.delete("documents", "key=?", arrayOf("strength_session_$id"))
        }
    }
    fun strengthSessions(limit: Int = 100): JSONArray = locked {
        val index = getDocument("strength_index") ?: JSONObject().put("sessions", JSONArray())
        val summaries = (0 until (index.optJSONArray("sessions")?.length() ?: 0))
            .mapNotNull { index.optJSONArray("sessions")?.optJSONObject(it) }
            .sortedWith(compareByDescending<JSONObject> { it.optLong("startTime") }
                .thenByDescending { it.optLong("endTime") }
                .thenByDescending { it.optString("id") })
            .take(limit.coerceIn(1, 500))
        JSONArray().also { result ->
            summaries.forEach { summary ->
                getDocument("strength_session_${summary.optString("id")}")?.let(result::put)
            }
        }
    }
    fun settings(): JSONObject = getDocument("settings") ?: JSONObject().put("rawBudgetMb",512).put("weatherEnabled",false)
    fun saveSettings(value: JSONObject) { putDocument("settings",value) }
    fun saveFeedback(id: String, value: JSONObject) = locked {
        read(id); val feedback = getDocument("feedback_$id") ?: JSONObject()
        value.keys().forEach { feedback.put(it,value.get(it)) }; feedback.put("updatedAt",System.currentTimeMillis())
        transaction { putDocument("feedback_$id",feedback); addEvent(id,"feedback",value) }
    }
    private fun findDuplicateRunId(start: Long, durationSeconds: Double): String? {
        val duration = durationSeconds.coerceAtLeast(0.0)
        val end = start + (duration * 1000.0).toLong()
        val queryStart = start - MAX_RUN_DURATION_MS
        val queryEnd = end + MAX_RUN_DURATION_MS
        db.rawQuery("SELECT id,start,json FROM runs WHERE start BETWEEN ? AND ?",
            arrayOf(queryStart.toString(), queryEnd.toString())).use { rows ->
            while (rows.moveToNext()) {
                val otherStart = rows.getLong(1)
                val other = JSONObject(rows.getString(2))
                val otherDuration = other.optLong("durationMs", 0L).coerceAtLeast(0L) / 1000.0
                val otherEnd = otherStart + (otherDuration * 1000.0).toLong()
                val startDiff = abs(otherStart - start) / 1000.0
                val durationDiff = abs(otherDuration - duration)
                if (duration <= 0.0 && otherDuration <= 0.0) {
                    if (startDiff <= 10.0) return rows.getString(0)
                    continue
                }
                val sameStart = startDiff <= 120.0 &&
                    durationDiff <= maxOf(120.0, maxOf(duration, otherDuration) * 0.20)
                val overlap = maxOf(0L, minOf(end, otherEnd) - maxOf(start, otherStart)) / 1000.0
                val intervalMatch = duration > 0.0 && otherDuration > 0.0 &&
                    overlap >= minOf(duration, otherDuration) * 0.75 &&
                    durationDiff <= maxOf(180.0, maxOf(duration, otherDuration) * 0.20)
                if (sameStart || intervalMatch) return rows.getString(0)
            }
        }
        return null
    }

    private fun isTechnicalImportedName(value: String): Boolean {
        val name = value.trim().lowercase()
        if (name.isBlank()) return true
        if (name in setOf("lauf", "laufen", "run", "running", "activity", "track", "workout",
                "training", "importierter lauf", "garmin lauf", "google fit lauf", "mi fitness lauf")) return true
        if (Regex("\\d{6,}").containsMatchIn(name)) return true
