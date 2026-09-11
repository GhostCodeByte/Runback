package com.runback.integrations

import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.contracts.ExerciseRouteRequestContract
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Length
import androidx.health.connect.client.units.Velocity
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.reflect.KClass

/** All raw records stay on the native side. Each read is time bounded and paginated. */
class HealthConnectIntegration(private val context: Context) {
    private val readTypes = listOf(ExerciseSessionRecord::class, HeartRateRecord::class,
        SpeedRecord::class, DistanceRecord::class, StepsCadenceRecord::class,
        HeartRateVariabilityRmssdRecord::class, RestingHeartRateRecord::class,
        SleepSessionRecord::class, WeightRecord::class)
    private val writeTypes = listOf(ExerciseSessionRecord::class, HeartRateRecord::class,
        SpeedRecord::class, DistanceRecord::class, StepsCadenceRecord::class)

    suspend fun status(): JSONObject = safely {
        val sdk = HealthConnectClient.getSdkStatus(context)
        if (sdk != HealthConnectClient.SDK_AVAILABLE) return@safely result(
            if (sdk == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) "provider_update_required" else "unavailable",
            "Health Connect muss auf diesem Telefon installiert oder aktualisiert werden.")
        val granted = client().permissionController.getGrantedPermissions()
        JSONObject().put("status", if (granted.contains(HealthPermission.getReadPermission(ExerciseSessionRecord::class))) "connected" else "permission_required")
            .put("granted", JSONArray(granted.toList())).put("readTypes", JSONArray(readTypes.map { type ->
                JSONObject().put("type", type.simpleName).put("granted", granted.contains(HealthPermission.getReadPermission(type)))
            })).put("routeAccess", "Fremde Routen benötigen eine ausdrückliche Freigabe im Vordergrund.")
    }

    fun permissionIntent(write: Boolean = false, route: Boolean = false): Intent {
        val permissions = if (write) writeTypes.map { HealthPermission.getWritePermission(it) }.toMutableSet()
            else readTypes.map { HealthPermission.getReadPermission(it) }.toMutableSet()
        if (write && route) permissions.add(HealthPermission.PERMISSION_WRITE_EXERCISE_ROUTE)
        return PermissionController.createRequestPermissionResultContract().createIntent(context, permissions)
    }

    fun routeIntent(sessionId: String): Intent = ExerciseRouteRequestContract().createIntent(context, sessionId)

    fun parseRouteResult(resultCode: Int, data: Intent?): JSONArray? =
        ExerciseRouteRequestContract().parseResult(resultCode, data)?.let(::routeSamples)

    suspend fun importRecent(days: Int = 30, saveRun: (JSONObject, JSONArray) -> Unit): JSONObject = safely {
        val health = client()
        val granted = health.permissionController.getGrantedPermissions()
        if (!granted.contains(HealthPermission.getReadPermission(ExerciseSessionRecord::class))) {
            return@safely result("permission_required", "Bitte Trainingsdaten in Health Connect freigeben.")
        }
        val end = Instant.now()
        // Default HC access does not include data older than 30 days before first grant.
        val start = end.minusSeconds(days.coerceIn(1, 30) * 86400L)
        val warnings = JSONArray()
        val sessions = read(health, ExerciseSessionRecord::class, start, end)
        var runs = 0
        val otherTraining = JSONArray()
        for (session in sessions) {
            if (session.metadata.dataOrigin.packageName == context.packageName) continue
            if (session.exerciseType != ExerciseSessionRecord.EXERCISE_TYPE_RUNNING &&
                session.exerciseType != ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL) {
                otherTraining.put(JSONObject().put("id", session.metadata.id).put("source", session.metadata.dataOrigin.packageName)
                    .put("startTime", session.startTime.toEpochMilli()).put("endTime", session.endTime.toEpochMilli())
                    .put("exerciseType", session.exerciseType))
                continue
            }
            val raw = JSONArray()
            val availability = JSONObject()
            val origin = setOf(session.metadata.dataOrigin)
            suspend fun <T : Record> metric(type: KClass<T>, handle: (List<T>) -> Unit) {
                if (!granted.contains(HealthPermission.getReadPermission(type))) {
                    availability.put(type.simpleName!!, "permission_required")
                    return
                }
                try {
                    val records = read(health, type, session.startTime, session.endTime, origin)
                    availability.put(type.simpleName!!, if (records.isEmpty()) "no_data" else "available")
                    handle(records)
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    availability.put(type.simpleName!!, "unavailable")
                    warnings.put("${type.simpleName}: ${e.javaClass.simpleName}")
                }
            }
            var distance: Double? = null
            var hrSum = 0.0; var hrCount = 0
            var cadenceSum = 0.0; var cadenceCount = 0
            fun addSample(time: Instant, kind: String, values: JSONObject, meta: Metadata) {
                if (time < session.startTime || time >= session.endTime) return
                check(raw.length() < MAX_SAMPLES) { "Die Sitzung überschreitet das sichere Importlimit." }
                raw.put(sample(time, kind, values).put("source", meta.dataOrigin.packageName)
                    .put("recordId", meta.id).put("sourceVersion", meta.lastModifiedTime.toString()))
            }
            metric(HeartRateRecord::class) { records -> records.forEach { r -> r.samples.forEach {
                if (it.time >= session.startTime && it.time < session.endTime) { hrSum += it.beatsPerMinute; hrCount++ }
                addSample(it.time, "heartRate", JSONObject().put("bpm", it.beatsPerMinute), r.metadata)
            } } }
            metric(SpeedRecord::class) { records -> records.forEach { r -> r.samples.forEach {
                addSample(it.time, "speed", JSONObject().put("speedMps", it.speed.inMetersPerSecond), r.metadata)
            } } }
            metric(StepsCadenceRecord::class) { records -> records.forEach { r -> r.samples.forEach {
                if (it.time >= session.startTime && it.time < session.endTime) { cadenceSum += it.rate; cadenceCount++ }
                addSample(it.time, "cadence", JSONObject().put("rpm", it.rate), r.metadata)
            } } }
            metric(DistanceRecord::class) { records ->
                // Never sum partially overlapping intervals as though wholly inside the session.
                val contained = records.filter { it.startTime >= session.startTime && it.endTime <= session.endTime }
                if (contained.isNotEmpty()) distance = contained.sumOf { it.distance.inMeters }
                records.forEach { r -> addSample(maxOf(r.startTime, session.startTime), "distance",
                    JSONObject().put("distanceMeters", r.distance.inMeters).put("startTime", r.startTime.toEpochMilli())
                        .put("endTime", r.endTime.toEpochMilli()).put("fullyContained", r in contained), r.metadata) }
            }
            val routeState = when (val route = session.exerciseRouteResult) {
                is ExerciseRouteResult.Data -> { val samples = routeSamples(route.exerciseRoute)
                    for (i in 0 until samples.length()) raw.put(samples.getJSONObject(i)); "available" }
                is ExerciseRouteResult.ConsentRequired -> "consent_required"
                else -> "no_data"
            }
            val identifier = "hc:" + session.metadata.dataOrigin.packageName + ":" + session.metadata.id
            val summary = JSONObject().put("id", UUID.nameUUIDFromBytes(identifier.toByteArray()).toString())
                .put("canonicalId", identifier).put("healthConnectId", session.metadata.id)
                .put("startTime", session.startTime.toEpochMilli()).put("endTime", session.endTime.toEpochMilli())
                .put("durationSeconds", (session.endTime.toEpochMilli() - session.startTime.toEpochMilli()) / 1000.0)
                .put("distanceMeters", distance ?: 0.0).put("distanceStatus", if (distance == null) "no_data" else "available")
                .put("purpose", "unknown").put("source", "health_connect:" + session.metadata.dataOrigin.packageName)
                .put("status", "completed").put("sourceVersion", session.metadata.lastModifiedTime.toString())
                .put("importedAt", System.currentTimeMillis()).put("availability", availability).put("routeStatus", routeState)
            if (hrCount > 0) summary.put("avgHeartRate", hrSum / hrCount)
            if (cadenceCount > 0) summary.put("avgCadence", cadenceSum / cadenceCount)
            saveRun(summary, raw)
            runs++
        }
        val recovery = JSONArray()
        suspend fun <T : Record> contextRecords(type: KClass<T>, convert: (T) -> JSONObject) {
            if (!granted.contains(HealthPermission.getReadPermission(type))) return
            try { read(health, type, start, end).filter { it.metadata.dataOrigin.packageName != context.packageName }
                .forEach { recovery.put(convert(it).put("source", it.metadata.dataOrigin.packageName)
                    .put("id", it.metadata.id).put("sourceVersion", it.metadata.lastModifiedTime.toString())) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { warnings.put("${type.simpleName}: ${e.javaClass.simpleName}") }
        }
        contextRecords(HeartRateVariabilityRmssdRecord::class) { JSONObject().put("kind", "hrv_rmssd").put("time", it.time.toEpochMilli()).put("milliseconds", it.heartRateVariabilityMillis) }
        contextRecords(RestingHeartRateRecord::class) { JSONObject().put("kind", "resting_heart_rate").put("time", it.time.toEpochMilli()).put("bpm", it.beatsPerMinute) }
        contextRecords(WeightRecord::class) { JSONObject().put("kind", "body_mass").put("time", it.time.toEpochMilli()).put("kilograms", it.weight.inKilograms) }
        contextRecords(SleepSessionRecord::class) { JSONObject().put("kind", "sleep").put("startTime", it.startTime.toEpochMilli())
            .put("endTime", it.endTime.toEpochMilli()).put("stages", JSONArray(it.stages.map { stage ->
                JSONObject().put("startTime", stage.startTime.toEpochMilli()).put("endTime", stage.endTime.toEpochMilli()).put("stage", stage.stage)
            })) }
        JSONObject().put("status", if (warnings.length() == 0) "imported" else "partial")
            .put("processedRuns", runs).put("recovery", recovery).put("otherTraining", otherTraining)
            .put("warnings", warnings).put("from", start.toEpochMilli()).put("to", end.toEpochMilli())
    }

    suspend fun exportRun(run: JSONObject, samples: JSONArray, includeRoute: Boolean): JSONObject = safely {
        if (run.optString("source").startsWith("health_connect")) return@safely result("excluded", "Importierte Health-Connect-Läufe werden nicht zurückgeschrieben.")
        if (run.optString("status") != "completed") return@safely result("not_completed", "Nur abgeschlossene Läufe können geteilt werden.")
        val health = client()
        val granted = health.permissionController.getGrantedPermissions()
        if (!granted.contains(HealthPermission.getWritePermission(ExerciseSessionRecord::class))) return@safely result("permission_required", "Schreibfreigabe für Training fehlt.")
        if (includeRoute && !granted.contains(HealthPermission.PERMISSION_WRITE_EXERCISE_ROUTE)) return@safely result("route_permission_required", "Route zuerst ausdrücklich freigeben.")
        val start = Instant.ofEpochMilli(run.getLong("startTime")); val end = Instant.ofEpochMilli(run.getLong("endTime"))
        require(end > start) { "Ungültige Laufzeit" }
        val id = run.getString("id")
        // Stable IDs prevent duplicate insertion on retry; a fixed version avoids silently rewriting prior exports.
        fun metadata(kind: String) = Metadata.activelyRecorded(Device(type = if (run.optString("source").contains("wear")) Device.TYPE_WATCH else Device.TYPE_PHONE), "runback:$id:$kind", 1)
        val raw = (0 until samples.length()).map { samples.getJSONObject(it) }.filter { it.optLong("time") in start.toEpochMilli() until end.toEpochMilli() }
        val route = if (includeRoute) raw.filter { it.optString("kind") == "gps" }.mapNotNull { item ->
            val v = item.optJSONObject("values") ?: return@mapNotNull null
            val lat = v.optDouble("latitude"); val lon = v.optDouble("longitude")
            if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return@mapNotNull null
            ExerciseRoute.Location(Instant.ofEpochMilli(item.getLong("time")), lat, lon,
                horizontalAccuracy = v.optDouble("accuracyM").takeIf { it.isFinite() && it >= 0 }?.let(Length::meters),
                altitude = v.optDouble("altitudeM").takeIf { it.isFinite() }?.let(Length::meters))
        }.distinctBy { it.time }.sortedBy { it.time }.takeIf { it.isNotEmpty() }?.let(::ExerciseRoute) else null
        val cycling = run.optString("sport", "running") == "cycling"
        val records = mutableListOf<Record>(ExerciseSessionRecord(start, ZoneOffset.UTC, end, ZoneOffset.UTC,
            metadata("session"), if (cycling) ExerciseSessionRecord.EXERCISE_TYPE_BIKING else ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
            title = if (cycling) "Runback · Radfahrt" else "Runback · Lauf", exerciseRoute = route))
        if (granted.contains(HealthPermission.getWritePermission(DistanceRecord::class)) && run.optDouble("distanceMeters", 0.0) > 0) records.add(
            DistanceRecord(start, ZoneOffset.UTC, end, ZoneOffset.UTC, Length.meters(run.getDouble("distanceMeters")), metadata("distance")))
        if (granted.contains(HealthPermission.getWritePermission(HeartRateRecord::class))) {
            val points = raw.filter { it.optString("kind") == "heartRate" }.mapNotNull { item ->
                val bpm = item.optJSONObject("values")?.optLong("bpm") ?: 0
                if (bpm in 1..300) HeartRateRecord.Sample(Instant.ofEpochMilli(item.getLong("time")), bpm) else null
            }.distinctBy { it.time }.sortedBy { it.time }
            if (points.isNotEmpty()) records.add(HeartRateRecord(start, ZoneOffset.UTC, end, ZoneOffset.UTC, points, metadata("hr")))
        }
        if (granted.contains(HealthPermission.getWritePermission(StepsCadenceRecord::class))) {
            val points = raw.filter { it.optString("kind") == "cadence" }.mapNotNull { item ->
                val rate = item.optJSONObject("values")?.optDouble("rpm") ?: Double.NaN
                if (rate.isFinite() && rate in 0.0..10000.0) StepsCadenceRecord.Sample(Instant.ofEpochMilli(item.getLong("time")), rate) else null
            }.distinctBy { it.time }.sortedBy { it.time }
            if (points.isNotEmpty()) records.add(StepsCadenceRecord(start, ZoneOffset.UTC, end, ZoneOffset.UTC, points, metadata("cadence")))
        }
        if (granted.contains(HealthPermission.getWritePermission(SpeedRecord::class))) {
            val points = raw.mapNotNull { item ->
                val speed = item.optJSONObject("values")?.optDouble("speedMps") ?: Double.NaN
                if (speed.isFinite() && speed in 0.0..100.0) SpeedRecord.Sample(Instant.ofEpochMilli(item.getLong("time")), Velocity.metersPerSecond(speed)) else null
            }.distinctBy { it.time }.sortedBy { it.time }
            if (points.isNotEmpty()) records.add(SpeedRecord(start, ZoneOffset.UTC, end, ZoneOffset.UTC, points, metadata("speed")))
        }
        health.insertRecords(records)
        JSONObject().put("status", "exported").put("recordCount", records.size).put("routeIncluded", route != null)
            .put("message", "Lokal an Health Connect übergeben. Andere Apps können eigene Cloud-Synchronisierung verwenden.")
    }

    private fun client(): HealthConnectClient {
        check(HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) { "Health Connect ist nicht verfügbar." }
        return HealthConnectClient.getOrCreate(context)
    }

    private suspend fun <T : Record> read(health: HealthConnectClient, type: KClass<T>, start: Instant, end: Instant,
        origins: Set<DataOrigin> = emptySet()): List<T> {
        val records = mutableListOf<T>(); var token: String? = null
        do {
            val page = health.readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(start, end),
                dataOriginFilter = origins, pageSize = 500, pageToken = token))
            records.addAll(page.records)
            check(records.size <= 10000) { "Importlimit erreicht. Bitte einen kürzeren Zeitraum wählen." }
            token = page.pageToken
        } while (token != null)
        return records.distinctBy { it.metadata.id }
    }

    private fun routeSamples(route: ExerciseRoute): JSONArray = JSONArray(route.route.map {
        val values = JSONObject().put("latitude", it.latitude).put("longitude", it.longitude)
        it.horizontalAccuracy?.let { value -> values.put("accuracyM", value.inMeters) }
        it.altitude?.let { value -> values.put("altitudeM", value.inMeters) }
        sample(it.time, "gps", values)
    })

    private fun sample(time: Instant, kind: String, values: JSONObject) = JSONObject().put("time", time.toEpochMilli()).put("kind", kind).put("values", values)
    private fun result(status: String, message: String) = JSONObject().put("status", status).put("message", message)
    private suspend fun safely(block: suspend () -> JSONObject): JSONObject = try { block() }
        catch (e: CancellationException) { throw e }
        catch (e: SecurityException) { result("permission_required", "Health-Connect-Freigabe fehlt oder wurde widerrufen.") }
        catch (e: Exception) { result("unavailable", e.message ?: "Health Connect ist gerade nicht verfügbar.") }

    companion object { private const val MAX_SAMPLES = 200000 }
}
