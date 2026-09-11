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
    fun start(purpose: String = "easy", source: String = "phone", sport: String = "running"): JSONObject = locked {
        activeId()?.let { return@locked present(read(it)) }
        check(app.filesDir.usableSpace > 32L * 1024 * 1024) { "Zu wenig freier Speicher. Bitte zuerst Daten sichern und Speicher freigeben." }
        val now = System.currentTimeMillis()
        val run = JSONObject().put("id", UUID.randomUUID().toString()).put("startTime", now).put("endTime", now)
            .put("purpose", purpose).put("sport", sport).put("source", source).put("status", "recording").put("durationMs", 0L)
            .put("_tick", SystemClock.elapsedRealtime()).put("distanceMeters", 0.0).put("rawSampleCount", 0)
            .put("model_version", RunMath.MODEL_VERSION).put("sourceVersion", "raw-v1")
        transaction { write(run); addEvent(run.getString("id"), "start", JSONObject()) }
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
        var gaps = 0; var previous: JSONObject? = null
        fun split() {
            if (segmentDistance > 0) {
                val s = JSONObject().put("id", "${id}:${segments.length()}").put("distanceMeters",segmentDistance)
                    .put("durationSeconds",segmentDuration).put("sourceVersion",RunMath.MODEL_VERSION)
                if (allAltitude) s.put("gradePercent",100 * segmentRise / segmentDistance)
                segments.put(s)
            }; segmentDistance=0.0;segmentDuration=0.0;segmentRise=0.0;allAltitude=true
        }
        points.forEachIndexed { index, p ->
            var gap = false
            previous?.let { before ->
                val crossing = cuts.any { it > before.optLong("time") && it <= p.optLong("time") }
                val d = if(crossing) null else RunMath.acceptedDistance(before.optDouble("latitude"),before.optDouble("longitude"),before.optLong("time"),before.optDouble("accuracyM",0.0),
                    p.optDouble("latitude"),p.optDouble("longitude"),p.optLong("time"),p.optDouble("accuracyM",0.0))
                if(d == null) { gap=true; gaps++; split() } else {
                    distance += d; segmentDistance += d; segmentDuration += (p.optLong("time")-before.optLong("time"))/1000.0
                    if(before.has("altitudeM") && p.has("altitudeM")) segmentRise += p.optDouble("altitudeM")-before.optDouble("altitudeM") else allAltitude=false
                    if(segmentDistance >= 1000) split()
                }
            }
            if (gap || index == 0 || index == points.lastIndex || index % maxOf(1, (points.size+399)/400) == 0) {
                if(geometry.length()<512) geometry.put(JSONObject().put("latitude",p.optDouble("latitude")).put("longitude",p.optDouble("longitude")).put("time",p.optLong("time")).put("gap",gap))
            }; previous=p
        }; split()
        val run = read(id)
        if(points.size>1) run.put("distanceMeters",distance)
        for ((kind,key,output) in listOf(Triple("heartRate","bpm","avgHeartRate"),Triple("cadence","rpm","avgCadence"))) {
            var total=0.0;var count=0
            db.rawQuery("SELECT time,json FROM samples WHERE run_id=? AND kind=? ORDER BY time", arrayOf(id,kind)).use {
                while(it.moveToNext()) { val v=JSONObject(it.getString(1)).optDouble(key)
                    if(v.isFinite() && v>0 && v<=300) { total+=v;count++;if(series.length()<256) series.put(JSONObject().put("time",it.getLong(0)).put("kind",kind).put("value",v)) } }
            }; if(count>0)run.put(output,total/count)
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
    fun addImportedRun(summary: JSONObject, samples: JSONArray, sourceHash: String): JSONObject = locked {
        val start = summary.optLong("startTime",summary.optLong("startedAt"));require(start>0){"Startzeit fehlt"}
        val fingerprint = "start:${start/1000}"
        db.rawQuery("SELECT id FROM tombstones WHERE id IN (?,?)",arrayOf(sourceHash,fingerprint)).use { if(it.moveToFirst())return@locked JSONObject().put("status","deleted") }
        var duplicate: String? = null
        db.rawQuery("SELECT run_id FROM hashes WHERE hash=?",arrayOf(sourceHash)).use { if(it.moveToFirst())duplicate=it.getString(0) }
        if(duplicate==null) db.rawQuery("SELECT id,json FROM runs WHERE abs(start-?)<=10000",arrayOf(start.toString())).use { rows ->
            while(rows.moveToNext()) { val other=JSONObject(rows.getString(1));val duration=summary.optDouble("durationSeconds",0.0)
                if(abs(other.optLong("durationMs")/1000.0-duration)<=maxOf(30.0,duration*.05)) {duplicate=rows.getString(0);break} } }
        if(duplicate!=null) { db.insertWithOnConflict("hashes",null,ContentValues().apply{put("hash",sourceHash);put("run_id",duplicate)},SQLiteDatabase.CONFLICT_IGNORE)
            return@locked JSONObject().put("status","duplicate").put("id",duplicate) }
        transaction {
            val run=JSONObject(summary.toString());val id=run.optString("id").takeIf{it.matches(Regex("[A-Za-z0-9_-]{1,100}"))}?:UUID.randomUUID().toString()
            run.put("id",id).put("startTime",start).put("durationMs",(summary.optDouble("durationSeconds",0.0)*1000).toLong())
                .put("status","completed").put("rawSampleCount",0).put("sourceVersion",sourceHash).put("reportedDistanceMeters",summary.optDouble("distanceMeters",0.0)).put("distanceMeters",0.0)
            write(run)
            val batch=ArrayList<RawSample>()
            for(i in 0 until samples.length()){val s=samples.getJSONObject(i);batch.add(RawSample(s.getLong("time"),s.getString("kind"),s.getJSONObject("values")))
                if(batch.size==500){appendSamples(id,batch);batch.clear()} }
            appendSamples(id,batch);derive(id)
            db.insertOrThrow("hashes",null,ContentValues().apply{put("hash",sourceHash);put("run_id",id)})
            JSONObject().put("status","imported").put("id",id)
        }
    }
    fun storeImportedSource(id: String, file: File, name: String) = locked {
        require(file.length()<=64L*1024*1024);read(id)
        db.insertOrThrow("sources",null,ContentValues().apply {put("run_id",id);put("name",name.take(200));put("data",file.readBytes())});Unit
    }
    // ---- Optional vendor wellness & strength data (V1-17 context only, never a readiness score) ----
    // Wellness rows are append-only daily/point context (sleep, resting HR, HRV, weight, steps).
    // They never change run derivations; missing rows only limit the affected context note.
    fun addWellnessBatch(rows: List<WellnessRow>): Int = locked {
        if (rows.isEmpty()) return@locked 0
        var inserted = 0
        transaction {
            rows.take(MAX_WELLNESS_BATCH).forEach { row ->
                require(row.kind.length in 1..64 && row.time > 0) { "Ungültiger Wellness-Wert" }
                val id = row.id.ifBlank { "wellness:${row.kind}:${row.time}:${row.source}:${row.value}" }
                val changed = db.insertWithOnConflict("wellness", null, ContentValues().apply {
                    put("id", id.take(220)); put("kind", row.kind.take(64)); put("time", row.time)
                    put("end_time", row.endTime)
                    if (row.value.isFinite()) put("value", row.value) else putNull("value")
                    put("unit", row.unit.take(24))
                    put("source", row.source.take(120)); put("extra", row.extra.take(2000))
                }, SQLiteDatabase.CONFLICT_IGNORE)
                if (changed > 0) inserted++
            }
        }
        inserted
    }
    fun wellnessSummary(limitPerKind: Int = 5): JSONObject = locked {
        val result = JSONObject()
        db.rawQuery("SELECT DISTINCT kind FROM wellness", null).use { kinds ->
            while (kinds.moveToNext()) {
                val kind = kinds.getString(0)
                val items = JSONArray()
                db.rawQuery("SELECT time,end_time,value,unit,source FROM wellness WHERE kind=? ORDER BY time DESC LIMIT ?",
                    arrayOf(kind, limitPerKind.coerceIn(1, 50).toString())).use { rows ->
                    while (rows.moveToNext()) items.put(JSONObject().put("time", rows.getLong(0))
                        .put("endTime", rows.getLong(1)).put("value", rows.getDouble(2))
                        .put("unit", rows.getString(3) ?: "").put("source", rows.getString(4) ?: ""))
                }
                val count = db.rawQuery("SELECT COUNT(*) FROM wellness WHERE kind=?", arrayOf(kind)).use {
                    it.moveToFirst(); it.getLong(0) }
                result.put(kind, JSONObject().put("count", count).put("recent", items))
            }
        }
        result
    }
    fun addStrengthWorkout(workout: StrengthWorkout, sets: List<StrengthSet>): JSONObject = locked {
        require(workout.time > 0) { "Trainingszeit fehlt" }
        require(sets.size <= 2000) { "Zu viele Sätze für ein Krafttraining" }
        transaction {
            db.insertWithOnConflict("strength_workouts", null, ContentValues().apply {
                put("id", workout.id.take(120)); put("time", workout.time); put("name", workout.name.take(120))
                put("durationSec", workout.durationSec); put("source", workout.source.take(120)); put("extra", workout.extra.take(2000))
            }, SQLiteDatabase.CONFLICT_IGNORE)
            db.delete("strength_sets", "workout_id=?", arrayOf(workout.id))
            sets.forEach { set ->
                db.insertOrThrow("strength_sets", null, ContentValues().apply {
                    put("workout_id", workout.id.take(120)); put("exercise", set.exercise.take(160))
                    put("set_order", set.setOrder); put("weight", set.weight); put("weight_unit", set.weightUnit.take(8))
                    put("reps", set.reps); put("distance", set.distance); put("seconds", set.seconds)
                    put("rpe", set.rpe); put("notes", set.notes.take(500))
                })
            }
            JSONObject().put("id", workout.id).put("sets", sets.size)
        }
    }
    fun strengthSummary(limit: Int = 20): JSONObject = locked {
        val workouts = JSONArray()
        db.rawQuery("SELECT id,time,name,durationSec,source FROM strength_workouts ORDER BY time DESC LIMIT ?",
            arrayOf(limit.coerceIn(1, 100).toString())).use { rows ->
            while (rows.moveToNext()) {
                val id = rows.getString(0)
                val setCount = db.rawQuery("SELECT COUNT(*) FROM strength_sets WHERE workout_id=?", arrayOf(id)).use {
                    it.moveToFirst(); it.getInt(0) }
                val volume = db.rawQuery("SELECT SUM(COALESCE(weight,0)*COALESCE(reps,0)) FROM strength_sets WHERE workout_id=?", arrayOf(id)).use {
                    it.moveToFirst(); if (it.isNull(0)) 0.0 else it.getDouble(0) }
                workouts.put(JSONObject().put("id", id).put("time", rows.getLong(1)).put("name", rows.getString(2) ?: "")
                    .put("durationSec", rows.getDouble(3)).put("source", rows.getString(4) ?: "")
                    .put("sets", setCount).put("volume", volume))
            }
        }
        val totalWorkouts = db.rawQuery("SELECT COUNT(*) FROM strength_workouts", null).use {
            it.moveToFirst(); it.getLong(0) }
        JSONObject().put("workouts", totalWorkouts).put("recent", workouts)
    }
    /** Summary-only activity (CSV summary without track samples). Never invents samples. */
    fun addSummaryRun(summary: JSONObject, sourceHash: String): JSONObject = locked {
        val start = summary.optLong("startTime", summary.optLong("startedAt"));require(start>0){"Startzeit fehlt"}
        val duration = summary.optDouble("durationSeconds", 0.0)
        require(duration.isFinite() && duration >= 0.0) { "Ungültige Laufdauer" }
        val distance = summary.optDouble("distanceMeters", 0.0)
        require(distance.isFinite() && distance >= 0.0) { "Ungültige Laufdistanz" }
        val fingerprint = "start:${start/1000}"
        db.rawQuery("SELECT id FROM tombstones WHERE id IN (?,?)",arrayOf(sourceHash,fingerprint)).use { if(it.moveToFirst())return@locked JSONObject().put("status","deleted") }
        var duplicate: String? = null
        db.rawQuery("SELECT run_id FROM hashes WHERE hash=?",arrayOf(sourceHash)).use { if(it.moveToFirst())duplicate=it.getString(0) }
        if(duplicate==null) db.rawQuery("SELECT id,json FROM runs WHERE abs(start-?)<=10000",arrayOf(start.toString())).use { rows ->
            while(rows.moveToNext()) { val other=JSONObject(rows.getString(1));val duration=summary.optDouble("durationSeconds",0.0)
                if(abs(other.optLong("durationMs")/1000.0-duration)<=maxOf(30.0,duration*.05)) {duplicate=rows.getString(0);break} } }
        if(duplicate!=null) { db.insertWithOnConflict("hashes",null,ContentValues().apply{put("hash",sourceHash);put("run_id",duplicate)},SQLiteDatabase.CONFLICT_IGNORE)
            return@locked JSONObject().put("status","duplicate").put("id",duplicate) }
        transaction {
            val run=JSONObject(summary.toString());val id=run.optString("id").takeIf{it.matches(Regex("[A-Za-z0-9_-]{1,100}"))}?:UUID.randomUUID().toString()
            run.put("id",id).put("startTime",start).put("durationMs",(duration*1000).toLong())
                .put("status","completed").put("rawSampleCount",0).put("sourceVersion",sourceHash)
                .put("distanceMeters",distance)
                .put("summaryOnly",true)
                .put("dataRetention",JSONObject().put("originals","summary_only").put("recomputable",false))
            write(run)
            db.insertOrThrow("hashes",null,ContentValues().apply{put("hash",sourceHash);put("run_id",id)})
            JSONObject().put("status","imported").put("id",id)
        }
    }
    fun vendorSummary(): JSONObject = locked {
        JSONObject().put("wellness", wellnessSummary(3)).put("strength", strengthSummary(5))
            .put("runs", listRuns(1).length())
    }
    fun deleteRun(id: String) = locked {
        check(activeId()!=id){"Beende zuerst die Aufzeichnung."}
        transaction {
            val run=read(id)
            db.execSQL("INSERT OR IGNORE INTO tombstones(id) SELECT hash FROM hashes WHERE run_id=?",arrayOf(id))
            db.execSQL("INSERT OR IGNORE INTO tombstones(id) VALUES(?)",arrayOf("start:${run.getLong("startTime")/1000}"))
            for(table in listOf("samples","events","sources","hashes"))db.delete(table,"run_id=?",arrayOf(id))
            db.delete("runs","id=?",arrayOf(id));db.delete("documents","key=?",arrayOf("feedback_$id"))
            addDocumentDeletionNotice(id)
        }
    }
    private fun addDocumentDeletionNotice(id:String){putDocument("deleted_$id",JSONObject().put("at",System.currentTimeMillis()).put("reason","Vom Nutzer gelöscht; frühere Auswertungen nicht mehr vollständig berechenbar."))}
    fun clearAllData() = locked { check(activeId()==null);transaction { tables.forEach {db.delete(it,null,null)} } }
    fun backup(output: OutputStream) = locked {
        ZipOutputStream(BufferedOutputStream(output)).use { zip ->
            zip.putNextEntry(ZipEntry("manifest.json"));zip.write(JSONObject().put("schemaVersion",2).put("app","Runback").put("createdAt",System.currentTimeMillis()).toString().toByteArray());zip.closeEntry()
            tables.forEach { table ->
                zip.putNextEntry(ZipEntry("$table.ndjson"))
                db.rawQuery("SELECT * FROM $table",null).use { c ->while(c.moveToNext()){
                    val row=JSONObject(); for(i in 0 until c.columnCount) when(c.getType(i)){
                        android.database.Cursor.FIELD_TYPE_BLOB -> row.put(c.getColumnName(i),android.util.Base64.encodeToString(c.getBlob(i),android.util.Base64.NO_WRAP))
                        android.database.Cursor.FIELD_TYPE_INTEGER -> row.put(c.getColumnName(i),c.getLong(i))
                        android.database.Cursor.FIELD_TYPE_FLOAT -> row.put(c.getColumnName(i),c.getDouble(i))
                        else -> row.put(c.getColumnName(i),if(c.isNull(i))JSONObject.NULL else c.getString(i)) }
                    zip.write((row.toString()+"\n").toByteArray()) } };zip.closeEntry()
            }
        }
    }
    fun restore(input: InputStream): JSONObject = locked {
        check(activeId()==null){"Beende zuerst die Aufzeichnung."}
        transaction {
            ZipInputStream(BufferedInputStream(input)).use { zip ->
                require(zip.nextEntry?.name=="manifest.json"){"Kein Runback-Backup"}
                val manifest=JSONObject(readEntry(zip,65536).toString(Charsets.UTF_8));require(manifest.getInt("schemaVersion") in listOf(1,2)){"Backup-Version wird nicht unterstützt"}
                tables.forEach {db.delete(it,null,null)}
                var total=0L; val seen=HashSet<String>()
                while(true){val entry=zip.nextEntry?:break;val table=entry.name.removeSuffix(".ndjson");require(table in tables && seen.add(table)){"Ungültiger Backup-Inhalt"}
                    val bytes=readEntry(zip,512L*1024*1024-total);total+=bytes.size
                    bytes.inputStream().bufferedReader().forEachLine { line -> if(line.isNotBlank()){
                        val row=JSONObject(line);val values=ContentValues();row.keys().forEach { key ->
                            when { key=="data" && table=="sources" -> values.put(key,android.util.Base64.decode(row.getString(key),android.util.Base64.NO_WRAP))
                                row.isNull(key)->values.putNull(key)
                                row.get(key) is Double || row.get(key) is Float ->values.put(key,row.getDouble(key))
                                row.get(key) is Number ->values.put(key,row.getLong(key))
                                else->values.put(key,row.getString(key)) }
                        };db.insertOrThrow(table,null,values)
                    } }
                };require(seen.containsAll(legacyTables)){ "Backup ist unvollständig" }
                db.rawQuery("SELECT id,json FROM runs",null).use { c->while(c.moveToNext()){val run=JSONObject(c.getString(1));if(run.optString("status")=="recording"){run.put("status","interrupted");run.remove("_tick");write(run)}} }
            };JSONObject().put("restored",true).put("count",listRuns(10000).length())
        }
    }
    fun exportSession(id: String): File = locked {
        val file=File.createTempFile("runback-session-",".zip",app.cacheDir)
        ZipOutputStream(file.outputStream().buffered()).use { zip ->
            zip.putNextEntry(ZipEntry("session.json"));zip.write(JSONObject().put("schemaVersion",1).put("run",detail(id))
                .put("samples",rawSamples(id)).put("events",events(id)).toString().toByteArray());zip.closeEntry()
        };file
    }
    fun importSession(file: File): String = locked {
        ZipInputStream(file.inputStream().buffered()).use { zip ->
            require(zip.nextEntry?.name=="session.json");val session=JSONObject(readEntry(zip,256L*1024*1024).toString(Charsets.UTF_8))
            require(session.getInt("schemaVersion")==1);val run=session.getJSONObject("run");val id=run.getString("id")
            require(id.matches(Regex("[A-Za-z0-9_-]{1,100}")));val result=addImportedRun(run,session.getJSONArray("samples"),"wear:$id")
            require(result.optString("status")!="deleted"){"Der Lauf wurde auf dem Handy gelöscht"}
            if(result.optString("status")=="imported")run.optJSONObject("feedback")?.let {saveFeedback(id,it)}
            id
        }
    }
    private fun readEntry(input:InputStream,limit:Long):ByteArray {val out=ByteArrayOutputStream();val buffer=ByteArray(32768);var total=0L
        while(true){val n=input.read(buffer);if(n<0)break;total+=n;require(total<=limit){"Backup überschreitet das Größenlimit"};out.write(buffer,0,n)};return out.toByteArray()}
    private class Database(context:Context):SQLiteOpenHelper(context,"runback.db",null,2){
        override fun onConfigure(db:SQLiteDatabase){db.execSQL("PRAGMA synchronous=FULL")}
        override fun onCreate(db:SQLiteDatabase){
            db.execSQL("CREATE TABLE runs(id TEXT PRIMARY KEY,start INTEGER NOT NULL,json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE samples(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,time INTEGER NOT NULL,kind TEXT NOT NULL,json TEXT NOT NULL)")
            db.execSQL("CREATE INDEX sample_run_time ON samples(run_id,kind,time)")
            db.execSQL("CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE documents(key TEXT PRIMARY KEY,json TEXT NOT NULL)")
            db.execSQL("CREATE TABLE hashes(hash TEXT PRIMARY KEY,run_id TEXT NOT NULL)")
            db.execSQL("CREATE TABLE tombstones(id TEXT PRIMARY KEY)")
            db.execSQL("CREATE TABLE sources(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL)")
            createVendorTables(db)
        }
        override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){
            if (oldVersion < 2) createVendorTables(db)
            if (oldVersion > 2 || newVersion > 2) error("Datenbankversion wird nicht unterstützt")
        }
        private fun createVendorTables(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS wellness(id TEXT PRIMARY KEY,kind TEXT NOT NULL,time INTEGER NOT NULL,end_time INTEGER NOT NULL DEFAULT 0,value REAL,unit TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',extra TEXT NOT NULL DEFAULT '{}')")
            db.execSQL("CREATE INDEX IF NOT EXISTS wellness_kind_time ON wellness(kind,time)")
            db.execSQL("CREATE TABLE IF NOT EXISTS strength_workouts(id TEXT PRIMARY KEY,time INTEGER NOT NULL,name TEXT NOT NULL DEFAULT '',durationSec REAL NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT '',extra TEXT NOT NULL DEFAULT '{}')")
            db.execSQL("CREATE TABLE IF NOT EXISTS strength_sets(seq INTEGER PRIMARY KEY AUTOINCREMENT,workout_id TEXT NOT NULL,exercise TEXT NOT NULL,set_order INTEGER NOT NULL DEFAULT 0,weight REAL,reps INTEGER,distance REAL,seconds REAL,rpe REAL,weight_unit TEXT NOT NULL DEFAULT 'kg',notes TEXT NOT NULL DEFAULT '')")
            db.execSQL("CREATE INDEX IF NOT EXISTS strength_workout_time ON strength_workouts(time)")
            db.execSQL("CREATE INDEX IF NOT EXISTS strength_sets_workout ON strength_sets(workout_id)")
        }
    }
    companion object {private val lock=Any();private var helper:Database?=null;private val tables=listOf("runs","samples","events","documents","hashes","tombstones","sources","wellness","strength_workouts","strength_sets");private val legacyTables=listOf("runs","samples","events","documents","hashes","tombstones","sources");private const val MAX_WELLNESS_BATCH = 50000}
}
