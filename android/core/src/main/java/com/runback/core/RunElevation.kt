package com.runback.core

/**
 * Höhenverlauf einer Aufzeichnung auf einem festen Zeitraster.
 *
 * Quelle in dieser Reihenfolge: Barometer (liegt als `pressure`-Sample vor,
 * rauscht ±1–2 m, misst aber nur Änderungen), sonst GPS-Höhe mit bekannter
 * vertikaler Genauigkeit. GPS-Höhe ohne Genauigkeitsangabe wird nicht
 * verwendet: ±5–15 m Rauschen erzeugte sonst Höhenmeter, die es nicht gab.
 * Je Rasterfenster steht der Median der Messwerte, darüber ein gleitender
 * Median; Auf- und Abstieg summieren nur Änderungen über der Hysterese.
 * Fenster ohne Messwert bleiben leer statt interpoliert.
 */
object RunElevation {
    const val VERSION = "runback-elevation-1"
    const val GRID_SECONDS = 5
    /** Gleitender Median: ±1 Fenster beim Barometer, ±3 Fenster bei GPS. */
    const val BAROMETER_SMOOTHING_WINDOWS = 1
    const val GPS_SMOOTHING_WINDOWS = 3
    const val MAX_GPS_VERTICAL_ACCURACY_METERS = 15.0
    /** Absoluter Bezug fürs Barometer: GPS-Höhe der ersten Minute, nur bei guter vertikaler Genauigkeit. */
    const val ANCHOR_WINDOW_SECONDS = 60
    const val ANCHOR_MAX_VERTICAL_ACCURACY_METERS = 10.0
    const val MIN_PRESSURE_SAMPLES = 10

    data class Pressure(val time: Long, val hPa: Double)
    data class GpsAltitude(val time: Long, val altitudeM: Double, val verticalAccuracyM: Double?)
    data class Result(
        val source: String,
        /** `absolute` (Meter über Meer) oder `start` (relativ zum Startpunkt = 0 m). */
        val reference: String,
        val ascentMeters: Double,
        val descentMeters: Double,
        val rejectedSamples: Int,
        val hysteresisMeters: Double,
        /** Geglättete Höhe je Rasterfenster; null ohne Messwert. */
        val grid: List<Double?>,
    )
    sealed class Outcome {
        data class Available(val result: Result) : Outcome()
        /** NO_ELEVATION_SOURCE · NO_VERTICAL_ACCURACY · VERTICAL_ACCURACY_TOO_LOW */
        data class Unavailable(val reason: String) : Outcome()
    }

    fun build(startTime: Long, endTime: Long, pressure: List<Pressure>, gps: List<GpsAltitude>,
              gridSeconds: Int = GRID_SECONDS): Outcome {
        val bins = binCount(startTime, endTime, gridSeconds)
        if (bins == 0) return Outcome.Unavailable("NO_ELEVATION_SOURCE")
        val barometric = pressure.mapNotNull { sample ->
            RunMath.pressureToAltitudeMeters(sample.hPa)?.let { Pair(sample.time, it) }
        }
        if (barometric.size >= MIN_PRESSURE_SAMPLES) {
            val medians = binMedians(startTime, bins, gridSeconds, barometric)
            val smoothed = rollingMedian(medians, BAROMETER_SMOOTHING_WINDOWS)
            val anchorEnd = startTime + ANCHOR_WINDOW_SECONDS * 1000L
            val gpsAnchor = median(gps.filter {
                it.time in startTime..anchorEnd && it.verticalAccuracyM != null &&
                    it.verticalAccuracyM <= ANCHOR_MAX_VERTICAL_ACCURACY_METERS
            }.map { it.altitudeM })
            val baroAnchor = median(barometric.filter { it.first in startTime..anchorEnd }.map { it.second })
            val first = smoothed.firstNotNullOfOrNull { it } ?: return Outcome.Unavailable("NO_ELEVATION_SOURCE")
            val (offset, reference) = if (gpsAnchor != null && baroAnchor != null) Pair(gpsAnchor - baroAnchor, "absolute")
                else Pair(-first, "start")
            val grid = smoothed.map { it?.plus(offset) }
            return Outcome.Available(finish("barometer", reference, grid, RunMath.ELEVATION_HYSTERESIS_METERS, 0))
        }
        if (gps.isEmpty()) return Outcome.Unavailable("NO_ELEVATION_SOURCE")
        val rated = gps.filter { it.verticalAccuracyM != null && it.verticalAccuracyM.isFinite() }
        if (rated.isEmpty()) return Outcome.Unavailable("NO_VERTICAL_ACCURACY")
        val usable = rated.filter { it.verticalAccuracyM!! <= MAX_GPS_VERTICAL_ACCURACY_METERS }
        if (usable.isEmpty()) return Outcome.Unavailable("VERTICAL_ACCURACY_TOO_LOW")
        val medians = binMedians(startTime, bins, gridSeconds, usable.map { Pair(it.time, it.altitudeM) })
        val grid = rollingMedian(medians, GPS_SMOOTHING_WINDOWS)
        return Outcome.Available(finish("gps", "absolute", grid, RunMath.GPS_ELEVATION_HYSTERESIS_METERS, rated.size - usable.size))
    }

    /**
     * Steigung in Prozent um ein Rasterfenster: Höhendifferenz über das kleinste
     * symmetrische Fenster, das mindestens `minHorizontalMeters` Strecke
     * enthält. Zwei Nachbarpunkte reichen nie; über wenige Meter wird jede
     * Höhenungenauigkeit zu einer absurden Steigung.
     */
    fun gradePercent(grid: List<Double?>, distanceAtEnd: List<Double>, index: Int, minHorizontalMeters: Double = 50.0): Double? {
        if (index !in grid.indices || grid.size != distanceAtEnd.size) return null
        var low = index; var high = index
        while (true) {
            val distance = distanceAtEnd[high] - (if (low > 0) distanceAtEnd[low - 1] else 0.0)
            val from = grid[low]; val to = grid[high]
            if (distance >= minHorizontalMeters && from != null && to != null) {
                return 100.0 * (to - from) / distance
            }
            if (low == 0 && high == grid.lastIndex) return null
            if (low > 0) low--
            if (high < grid.lastIndex) high++
        }
    }

    fun binCount(startTime: Long, endTime: Long, gridSeconds: Int): Int {
        val stepMs = gridSeconds * 1000L
        if (endTime <= startTime) return 0
        return (((endTime - startTime) + stepMs - 1) / stepMs).toInt()
    }

    private fun finish(source: String, reference: String, grid: List<Double?>, hysteresis: Double, rejected: Int): Result {
        val accumulator = RunMath.ElevationAccumulator(hysteresis)
        grid.forEach { it?.let(accumulator::add) }
        return Result(source, reference, accumulator.ascent, accumulator.descent, rejected, hysteresis, grid)
    }

    private fun binMedians(startTime: Long, bins: Int, gridSeconds: Int, samples: List<Pair<Long, Double>>): List<Double?> {
        val stepMs = gridSeconds * 1000L
        val buckets = Array(bins) { ArrayList<Double>() }
        for ((time, value) in samples) {
            if (!value.isFinite() || time < startTime) continue
            val bin = ((time - startTime) / stepMs).toInt()
            if (bin in 0 until bins) buckets[bin].add(value)
        }
        return buckets.map { median(it) }
    }

    /** Median über die vorhandenen Werte in ±`radius` Fenstern; leere Fenster bleiben leer. */
    fun rollingMedian(values: List<Double?>, radius: Int): List<Double?> = values.indices.map { index ->
        if (values[index] == null) null else median(
            (maxOf(0, index - radius)..minOf(values.lastIndex, index + radius)).mapNotNull { values[it] })
    }

    fun median(values: List<Double>): Double? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val middle = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[middle] else (sorted[middle - 1] + sorted[middle]) / 2
    }
}
