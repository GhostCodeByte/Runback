package com.runback.core

import kotlin.math.*

/** Conservative distance derivation; original coordinates are always retained. */
object RunMath {
    const val MODEL_VERSION = "runback-distance-1.0"
    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val a = sin(Math.toRadians(lat2 - lat1) / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(Math.toRadians(lon2 - lon1) / 2).pow(2)
        return 6371000.0 * 2 * atan2(sqrt(a.coerceIn(0.0, 1.0)), sqrt((1 - a).coerceIn(0.0, 1.0)))
    }
    fun acceptedDistance(lat1: Double, lon1: Double, time1: Long, accuracy1: Double,
                         lat2: Double, lon2: Double, time2: Long, accuracy2: Double): Double? {
        if (!listOf(lat1, lon1, lat2, lon2, accuracy1, accuracy2).all { it.isFinite() }) return null
        if (abs(lat1) > 90 || abs(lat2) > 90 || abs(lon1) > 180 || abs(lon2) > 180) return null
        val seconds = (time2 - time1) / 1000.0
        if (seconds <= 0 || seconds > 30 || accuracy1 > 50 || accuracy2 > 50) return null
        val distance = distanceMeters(lat1, lon1, lat2, lon2)
        return distance.takeIf { it / seconds <= 12.0 }
    }
}
