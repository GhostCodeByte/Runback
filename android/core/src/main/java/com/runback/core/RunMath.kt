package com.runback.core

import kotlin.math.*

/**
 * Conservative distance derivation; original coordinates are always retained.
 *
 * 2.1: Schritte unter dem GPS-Rauschboden zählen nicht (Zickzack im Stand
 * addierte sonst echte Meter), Auf- und Abstieg werden getrennt mit
 * Hysterese summiert, Puls und Kadenz werden zeitgewichtet gemittelt.
 * Überlappende Telefon- und Wear-Sensorwerte werden pro Quelle zusammengeführt.
 */
object RunMath {
    const val MODEL_VERSION = "runback-distance-2.1"
    /** Höhenänderung, die ein Aufzeichnungsrauschen von ±1–2 m sicher übersteigt. */
    const val ELEVATION_HYSTERESIS_METERS = 3.0
    /** Längere Lücken zwischen Sensorwerten zählen nicht als abgedeckte Zeit. */
    const val SENSOR_MAX_GAP_SECONDS = 10.0

    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val a = sin(Math.toRadians(lat2 - lat1) / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(Math.toRadians(lon2 - lon1) / 2).pow(2)
        return 6371000.0 * 2 * atan2(sqrt(a.coerceIn(0.0, 1.0)), sqrt((1 - a).coerceIn(0.0, 1.0)))
    }

    /** Gültigkeit eines Schritts: Zeit, Genauigkeit, Plausibilität. null heißt Lücke. */
    fun acceptedDistance(lat1: Double, lon1: Double, time1: Long, accuracy1: Double,
                         lat2: Double, lon2: Double, time2: Long, accuracy2: Double): Double? {
        if (!listOf(lat1, lon1, lat2, lon2, accuracy1, accuracy2).all { it.isFinite() }) return null
        if (abs(lat1) > 90 || abs(lat2) > 90 || abs(lon1) > 180 || abs(lon2) > 180) return null
        val seconds = (time2 - time1) / 1000.0
        if (seconds <= 0 || seconds > 30 || accuracy1 > 50 || accuracy2 > 50) return null
        val distance = distanceMeters(lat1, lon1, lat2, lon2)
        return distance.takeIf { it / seconds <= 12.0 }
    }

    /** Unter diesem Abstand ist eine Verschiebung von Messrauschen nicht zu unterscheiden. */
    fun noiseFloorMeters(accuracy1: Double, accuracy2: Double): Double =
        ((accuracy1.coerceAtLeast(0.0) + accuracy2.coerceAtLeast(0.0)) / 2)

    /**
     * Abstand vom Ankerpunkt, sobald er den Rauschboden übersteigt; sonst null
     * und der Anker bleibt stehen. Langsames Laufen sammelt so alle paar
     * Sekunden echte Meter, Stillstand sammelt keine.
     */
    fun anchoredDistance(anchorLat: Double, anchorLon: Double, anchorAccuracy: Double,
                         lat: Double, lon: Double, accuracy: Double): Double? {
        val distance = distanceMeters(anchorLat, anchorLon, lat, lon)
        return distance.takeIf { it >= noiseFloorMeters(anchorAccuracy, accuracy) }
    }

    /** Summiert Auf- und Abstieg getrennt; kleine Schwankungen um die Referenz zählen nicht. */
    class ElevationAccumulator(private val hysteresisMeters: Double = ELEVATION_HYSTERESIS_METERS) {
        var ascent = 0.0; private set
        var descent = 0.0; private set
        private var reference: Double? = null
        fun add(altitude: Double) {
            if (!altitude.isFinite()) return
            val current = reference
            if (current == null) { reference = altitude; return }
            val delta = altitude - current
            if (delta >= hysteresisMeters) { ascent += delta; reference = altitude }
            else if (delta <= -hysteresisMeters) { descent -= delta; reference = altitude }
        }
    }

    /**
     * Zeitgewichtetes Mittel: jeder Wert gilt bis zum nächsten Sample, höchstens
     * `maxGapSeconds`. Liefert Mittel und abgedeckte Sekunden; null ohne Werte.
     */
    fun timeWeightedAverage(timesMs: List<Long>, values: List<Double>,
                            maxGapSeconds: Double = SENSOR_MAX_GAP_SECONDS,
                            breaks: Set<Int> = emptySet()): Pair<Double, Double>? {
        if (timesMs.isEmpty() || timesMs.size != values.size) return null
        var weighted = 0.0; var covered = 0.0
        for (i in timesMs.indices) {
            val weight = when {
                i + 1 == timesMs.size -> 1.0
                i + 1 in breaks -> 0.0
                else -> {
                    val seconds = (timesMs[i + 1] - timesMs[i]) / 1000.0
                    if (seconds in 0.0..maxGapSeconds) seconds else 0.0
                }
            }
            weighted += values[i] * weight; covered += weight
        }
        return if (covered > 0) Pair(weighted / covered, covered) else null
    }
}
