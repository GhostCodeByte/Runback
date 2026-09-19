package com.runback.core

/**
 * Begrenzter Zeitverlauf einer Aufzeichnung für Export und Darstellung.
 *
 * Fasst die Rohsamples in gleich lange Zeitfenster seit dem Start zusammen
 * (Uhrzeit, Pausen eingeschlossen). Je Fenster: zurückgelegte Strecke nach
 * derselben Regel wie die Distanzableitung, Sekunden mit gültigen
 * GPS-Schritten, Mittel von Puls, Kadenz, Höhe und GPS-Genauigkeit. Fenster
 * ohne einen einzigen Messwert fehlen, statt mit Nullen aufzufüllen — außer
 * `keepEmpty` verlangt ein lückenloses Raster (Phasenerkennung, CSV). Die
 * Fensterlänge wächst mit der Dauer, damit die Zeilenzahl begrenzt bleibt,
 * sofern kein festes Raster vorgegeben ist.
 *
 * `gpsCoveredSeconds` ist keine Bewegungszeit: Stillstand mit gutem Empfang
 * zählt hier voll. Bewegung entscheidet RunPhases.
 */
object RunTimeline {
    const val VERSION = "runback-timeline-2"
    val STEP_CHOICES_SECONDS = listOf(30, 60, 120, 300, 600, 900)

    data class GpsPoint(val time: Long, val latitude: Double, val longitude: Double,
                        val accuracyM: Double = 0.0, val altitudeM: Double? = null)
    data class Reading(val time: Long, val value: Double)
    data class Row(
        val elapsedSeconds: Int,
        val distanceMeters: Double,
        val stepDistanceMeters: Double,
        val gpsCoveredSeconds: Double,
        val avgHeartRate: Double?,
        val avgCadence: Double?,
        val altitudeM: Double?,
        val avgAccuracyM: Double? = null,
        /** Fenster ohne einen einzigen Messwert (nur bei `keepEmpty`). */
        val empty: Boolean = false,
    )
    data class Result(val stepSeconds: Int, val rows: List<Row>)

    /** Kleinste Fensterlänge, mit der die Zeilenzahl unter `maxRows` bleibt. */
    fun stepSeconds(durationSeconds: Double, maxRows: Int): Int {
        val duration = durationSeconds.coerceAtLeast(0.0)
        return STEP_CHOICES_SECONDS.firstOrNull { duration / it <= maxRows } ?: STEP_CHOICES_SECONDS.last()
    }

    fun build(
        startTime: Long,
        endTime: Long,
        gps: List<GpsPoint>,
        heartRate: List<Reading>,
        cadence: List<Reading>,
        cuts: List<Long>,
        maxRows: Int = 120,
        fixedStepSeconds: Int? = null,
        keepEmpty: Boolean = false,
    ): Result {
        val lastSample = listOf(gps.lastOrNull()?.time, heartRate.lastOrNull()?.time, cadence.lastOrNull()?.time)
            .filterNotNull().maxOrNull() ?: startTime
        val end = maxOf(endTime, lastSample, startTime)
        val step = fixedStepSeconds?.coerceAtLeast(1) ?: stepSeconds((end - startTime) / 1000.0, maxRows)
        if (end <= startTime) return Result(step, emptyList())
        val stepMs = step * 1000L
        val bucketCount = (((end - startTime) + stepMs - 1) / stepMs).toInt().coerceAtLeast(1)

        val distanceAtEnd = DoubleArray(bucketCount)
        val stepDistance = DoubleArray(bucketCount)
        val moving = DoubleArray(bucketCount)
        val touched = BooleanArray(bucketCount)
        val hasGps = BooleanArray(bucketCount)
        val altitudeSum = DoubleArray(bucketCount); val altitudeCount = IntArray(bucketCount)
        val accuracySum = DoubleArray(bucketCount); val accuracyCount = IntArray(bucketCount)
        val heartSum = DoubleArray(bucketCount); val heartCount = IntArray(bucketCount)
        val cadenceSum = DoubleArray(bucketCount); val cadenceCount = IntArray(bucketCount)

        fun bucketOf(time: Long): Int? {
            if (time < startTime || time > end) return null
            return ((time - startTime) / stepMs).toInt().coerceIn(0, bucketCount - 1)
        }

        // Dieselbe Distanzregel wie RunStore.derive: Schritt akzeptiert, Anker
        // gegen den Rauschboden, Pausen und Unterbrechungen trennen.
        var distance = 0.0
        var previous: GpsPoint? = null
        var anchor: GpsPoint? = null
        for (point in gps) {
            val bucket = bucketOf(point.time)
            if (bucket != null) {
                touched[bucket] = true; hasGps[bucket] = true
                point.altitudeM?.takeIf { it.isFinite() }?.let { altitudeSum[bucket] += it; altitudeCount[bucket]++ }
                if (point.accuracyM.isFinite() && point.accuracyM > 0) { accuracySum[bucket] += point.accuracyM; accuracyCount[bucket]++ }
            }
            val before = previous
            if (before != null) {
                val crossing = cuts.any { it > before.time && it <= point.time }
                val accepted = if (crossing) null else RunMath.acceptedDistance(
                    before.latitude, before.longitude, before.time, before.accuracyM,
                    point.latitude, point.longitude, point.time, point.accuracyM,
                )
                if (accepted == null) {
                    anchor = null
                } else {
                    val base = anchor ?: before
                    val stepMeters = RunMath.anchoredDistance(
                        base.latitude, base.longitude, base.accuracyM,
                        point.latitude, point.longitude, point.accuracyM,
                    )
                    if (stepMeters != null) { distance += stepMeters; anchor = point } else if (anchor == null) anchor = base
                    if (bucket != null) {
                        moving[bucket] += (point.time - before.time) / 1000.0
                        if (stepMeters != null) stepDistance[bucket] += stepMeters
                    }
                }
            }
            if (bucket != null) distanceAtEnd[bucket] = distance
            previous = point
        }
        for (reading in heartRate) {
            val bucket = bucketOf(reading.time) ?: continue
            if (!reading.value.isFinite() || reading.value <= 0 || reading.value > 300) continue
            touched[bucket] = true; heartSum[bucket] += reading.value; heartCount[bucket]++
        }
        for (reading in cadence) {
            val bucket = bucketOf(reading.time) ?: continue
            if (!reading.value.isFinite() || reading.value <= 0 || reading.value > 300) continue
            touched[bucket] = true; cadenceSum[bucket] += reading.value; cadenceCount[bucket]++
        }

        val rows = ArrayList<Row>()
        var carried = 0.0
        for (bucket in 0 until bucketCount) {
            // Ohne GPS im Fenster gilt die Strecke vom letzten Fenster weiter.
            if (hasGps[bucket]) carried = distanceAtEnd[bucket]
            if (!touched[bucket] && !keepEmpty) continue
            val elapsedEnd = minOf(((bucket + 1) * stepMs), end - startTime)
            rows.add(Row(
                elapsedSeconds = (elapsedEnd / 1000L).toInt(),
                distanceMeters = carried,
                stepDistanceMeters = stepDistance[bucket],
                gpsCoveredSeconds = moving[bucket],
                avgHeartRate = if (heartCount[bucket] > 0) heartSum[bucket] / heartCount[bucket] else null,
                avgCadence = if (cadenceCount[bucket] > 0) cadenceSum[bucket] / cadenceCount[bucket] else null,
                altitudeM = if (altitudeCount[bucket] > 0) altitudeSum[bucket] / altitudeCount[bucket] else null,
                avgAccuracyM = if (accuracyCount[bucket] > 0) accuracySum[bucket] / accuracyCount[bucket] else null,
                empty = !touched[bucket],
            ))
        }
        return Result(step, rows)
    }
}
