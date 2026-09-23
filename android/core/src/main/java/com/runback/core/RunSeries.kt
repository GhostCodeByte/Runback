package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Darstellungsreihe einer Aufzeichnung für die Graphen der Detailseite.
 *
 * Baut auf den 5-s-Zeilen von RunPhases auf (Tempo geglättet, Phase, Puls,
 * Kadenz, Höhe aus RunElevation, Steigung) und ergänzt je Fenster die letzte
 * GPS-Position sowie — bei bekanntem Wind — die Gegenwindkomponente entlang
 * der Laufrichtung. Längere Läufe werden auf höchstens `maxRows` Zeilen
 * zusammengefasst, indem benachbarte Fenster gemittelt werden; Rohsamples
 * verlassen den Speicher nicht (Grundregel 8).
 *
 * Tempo gibt es nur in Bewegung (RUN/WALK); Stillstand und Pausen bleiben
 * ohne Wert statt als 0 m/s. Fenster ohne Position bleiben ohne Position.
 */
object RunSeries {
    const val VERSION = "runback-series-1"
    const val DEFAULT_MAX_ROWS = 600

    data class Position(val latitude: Double, val longitude: Double)
    /** Windrichtung meteorologisch: `fromDeg` ist, woher er kommt (0 = Nord, 90 = Ost). */
    data class Wind(val mps: Double, val fromDeg: Double)
    /** Wert über einen Zeitraum (Laufstil-Fenster), in Unix-ms. */
    data class Span(val start: Long, val end: Long, val value: Double)
    data class Row(
        val elapsedSeconds: Int,
        val distanceMeters: Double,
        val speedMps: Double?,
        val moving: Boolean,
        val heartRate: Double?,
        val cadence: Double?,
        val elevationM: Double?,
        val gradePercent: Double?,
        val position: Position?,
        /** Positiv = Gegenwind, negativ = Rückenwind, in m/s. */
        val headwindMps: Double?,
        /** Armschwung aus dem Laufstil-Fenster, das diese Zeile überdeckt (Grad). */
        val armSwingDeg: Double? = null,
    )
    data class Result(val stepSeconds: Int, val rows: List<Row>)

    /** Kurs in Grad (0 = Nord, 90 = Ost) von a nach b. */
    fun bearingDeg(a: Position, b: Position): Double {
        val lat1 = Math.toRadians(a.latitude); val lat2 = Math.toRadians(b.latitude)
        val dLon = Math.toRadians(b.longitude - a.longitude)
        val y = sin(dLon) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    /** Anteil des Winds entlang des Kurses; läuft man in den Wind, ist er positiv. */
    fun headwind(wind: Wind, bearingDeg: Double): Double =
        wind.mps * cos(Math.toRadians(bearingDeg - wind.fromDeg))

    fun build(
        startTime: Long,
        phaseRows: List<RunPhases.Row>,
        gps: List<RunTimeline.GpsPoint>,
        wind: Wind?,
        gridSeconds: Int = RunPhases.GRID_SECONDS,
        maxRows: Int = DEFAULT_MAX_ROWS,
        armSwing: List<Span> = emptyList(),
    ): Result {
        val n = phaseRows.size
        val gridMs = gridSeconds * 1000L
        val swingSum = DoubleArray(n); val swingCount = IntArray(n)
        for (span in armSwing) {
            val from = ((span.start - startTime) / gridMs).toInt().coerceAtLeast(0)
            val to = ((span.end - startTime - 1) / gridMs).toInt().coerceAtMost(n - 1)
            for (bin in from..to) { swingSum[bin] += span.value; swingCount[bin]++ }
        }
        val last = arrayOfNulls<Position>(n)
        for (point in gps) {
            val bin = ((point.time - startTime) / gridMs).toInt()
            if (bin !in 0 until n) continue
            last[bin] = Position(point.latitude, point.longitude)
        }
        // Kurs je Fenster aus der letzten Position davor; mindestens 5 m Versatz,
        // sonst ist die Richtung nur Rauschen und der Wind bleibt unbestimmt.
        val headwind = arrayOfNulls<Double>(n)
        if (wind != null) {
            var previous: Position? = null
            for (i in 0 until n) {
                val here = last[i] ?: continue
                val before = previous
                if (before != null && RunMath.distanceMeters(before.latitude, before.longitude, here.latitude, here.longitude) >= MIN_HEADING_METERS)
                    headwind[i] = headwind(wind, bearingDeg(before, here))
                previous = here
            }
        }
        val fine = phaseRows.mapIndexed { i, row ->
            val moving = row.state == RunPhases.State.RUN || row.state == RunPhases.State.WALK
            Row(
                elapsedSeconds = row.elapsedSeconds,
                distanceMeters = row.distanceMeters,
                speedMps = row.speedMps?.takeIf { moving && it >= RunPhases.STOP_SPEED_MPS },
                moving = moving,
                heartRate = row.heartRate,
                cadence = row.cadence,
                elevationM = row.elevationM,
                gradePercent = row.gradePercent,
                position = last[i],
                headwindMps = headwind[i],
                armSwingDeg = if (swingCount[i] > 0) swingSum[i] / swingCount[i] else null,
            )
        }
        val factor = if (maxRows <= 0) 1 else ((n + maxRows - 1) / maxRows).coerceAtLeast(1)
        return if (factor == 1) Result(gridSeconds, fine) else Result(gridSeconds * factor, fine.chunked(factor).map(::merge))
    }

    private const val MIN_HEADING_METERS = 5.0

    private fun merge(group: List<Row>): Row {
        fun mean(values: List<Double?>): Double? = values.filterNotNull().takeIf { it.isNotEmpty() }?.average()
        return Row(
            elapsedSeconds = group.last().elapsedSeconds,
            distanceMeters = group.last().distanceMeters,
            speedMps = mean(group.map { it.speedMps }),
            moving = group.any { it.moving },
            heartRate = mean(group.map { it.heartRate }),
            cadence = mean(group.map { it.cadence }),
            elevationM = mean(group.map { it.elevationM }),
            gradePercent = mean(group.map { it.gradePercent }),
            position = group.lastOrNull { it.position != null }?.position,
            headwindMps = mean(group.map { it.headwindMps }),
            armSwingDeg = mean(group.map { it.armSwingDeg }),
        )
    }

    fun json(result: Result, wind: Wind?): JSONObject = JSONObject()
        .put("version", VERSION)
        .put("stepSeconds", result.stepSeconds)
        .apply { if (wind != null) put("wind", JSONObject().put("mps", wind.mps).put("fromDeg", wind.fromDeg)) }
        .put("rows", JSONArray().apply {
            result.rows.forEach { row ->
                put(JSONObject().put("elapsedSeconds", row.elapsedSeconds).put("distanceMeters", row.distanceMeters).put("moving", row.moving).apply {
                    row.speedMps?.let { put("speedMps", it) }
                    row.heartRate?.let { put("heartRate", it) }
                    row.cadence?.let { put("cadence", it) }
                    row.elevationM?.let { put("elevationM", it) }
                    row.gradePercent?.let { put("gradePercent", it) }
                    row.position?.let { put("latitude", it.latitude).put("longitude", it.longitude) }
                    row.headwindMps?.let { put("headwindMps", it) }
                    row.armSwingDeg?.let { put("armSwingDeg", it) }
                })
            }
        })
}
