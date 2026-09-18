package com.runback.core

import kotlin.math.abs

/** Prefer watch measurements where they overlap phone measurements; fill gaps from the phone. */
object SensorSourceSelection {
    private const val OVERLAP_WINDOW_MS = 5_000L

    fun select(samples: List<RawSample>, kind: String): List<RawSample> {
        val candidates = samples.filter { it.kind == kind && validSample(it) }
        val watch = candidates.filter { it.values.optString("source") == WearProtocol.WATCH_SOURCE }.sortedBy { it.time }
        if (watch.isEmpty()) return candidates
        val phone = candidates.filter { it.values.optString("source") == WearProtocol.PHONE_SOURCE }.sortedBy { it.time }
        return candidates.filter { sample ->
            val isWatch = sample.values.optString("source") == WearProtocol.WATCH_SOURCE
            val overlapping = if (isWatch) overlappingSamples(sample.time, phone) else overlappingSamples(sample.time, watch)
            if (overlapping.isEmpty()) true
            else if (kind != "gps") isWatch
            else if (isWatch) !phoneIsBetter(overlapping, listOf(sample))
            else phoneIsBetter(listOf(sample), overlapping)
        }
    }

    private fun overlappingSamples(time: Long, samples: List<RawSample>): List<RawSample> {
        val first = lowerBound(samples, time - OVERLAP_WINDOW_MS)
        val result = ArrayList<RawSample>()
        var index = first
        while (index < samples.size && samples[index].time <= time + OVERLAP_WINDOW_MS) {
            result.add(samples[index]); index++
        }
        return result
    }

    private fun lowerBound(samples: List<RawSample>, time: Long): Int {
        var low = 0
        var high = samples.size
        while (low < high) {
            val middle = (low + high) ushr 1
            if (samples[middle].time < time) low = middle + 1 else high = middle
        }
        return low
    }

    private fun phoneIsBetter(phone: List<RawSample>, watch: List<RawSample>): Boolean {
        val phoneAccuracy = phone.mapNotNull { sample ->
            sample.values.optDouble("accuracyM", Double.NaN).takeIf { it.isFinite() && it > 0.0 }
        }.minOrNull()
        val watchAccuracy = watch.mapNotNull { sample ->
            sample.values.optDouble("accuracyM", Double.NaN).takeIf { it.isFinite() && it > 0.0 }
        }.minOrNull()
        return when {
            watchAccuracy != null && watchAccuracy > 50.0 -> phoneAccuracy != null
            phoneAccuracy != null && watchAccuracy == null -> true
            phoneAccuracy != null && watchAccuracy != null -> phoneAccuracy < watchAccuracy
            else -> false
        }
    }

    private fun validSample(sample: RawSample): Boolean = when (sample.kind) {
        "gps" -> {
            val latitude = sample.values.optDouble("latitude", Double.NaN)
            val longitude = sample.values.optDouble("longitude", Double.NaN)
            latitude.isFinite() && longitude.isFinite() && abs(latitude) <= 90.0 && abs(longitude) <= 180.0
        }
        "heartRate" -> sample.values.optDouble("bpm", Double.NaN).let { it.isFinite() && it in 30.0..240.0 }
        "cadence" -> (sample.values.optDouble("rpm", Double.NaN)
            .takeIf { it.isFinite() } ?: sample.values.optDouble("rawCadence", Double.NaN))
            .let { it.isFinite() && it in 1.0..300.0 }
        else -> true
    }

    fun selectedSource(samples: List<RawSample>, kind: String): String? {
        val sources = select(samples, kind).mapNotNull { it.values.optString("source").takeIf(String::isNotBlank) }.toSet()
        return when {
            sources.isEmpty() -> null
            sources.size == 1 -> sources.single()
            else -> "mixed"
        }
    }
}
