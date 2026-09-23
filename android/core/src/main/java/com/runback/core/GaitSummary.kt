package com.runback.core

import org.json.JSONObject

/**
 * Laufstil eines ganzen Laufs aus den 10-s-Fenstern von [Gait], getrennt nach
 * Gerät (Handy, Uhr). Es zählen nur Fenster, in denen gelaufen wurde; ein Wert
 * braucht mindestens drei Fenster, der Vergleich erstes gegen letztes Drittel
 * mindestens zwölf (zwei Minuten).
 */
object GaitSummary {
    private const val MIN_VALUES = 3
    private const val MIN_WINDOWS_FOR_THIRDS = 12
    /** Ohne Phasen gilt ein Fenster ab dieser Kadenz als gelaufen. */
    private const val RUNNING_CADENCE = 140.0
    private val VALUE_KEYS = listOf(
        "cadence", "regularity", "armSwingDeg", "crossShare", "oscillationCm", "contactMs", "impactG", "brakingMps", "leanDeg",
    )
    private val THIRD_KEYS = listOf("cadence", "regularity", "armSwingDeg", "oscillationCm", "contactMs")

    /**
     * @param running `true`/`false`, ob zwischen Start und Ende eines Fensters
     * überwiegend gelaufen wurde; `null`, wenn die Phasen das nicht wissen.
     */
    fun build(samples: List<RawSample>, running: (Long, Long) -> Boolean?): JSONObject? {
        val windows = samples.filter { it.kind == "gait" }
            .distinctBy { "${it.values.optString("source")}|${it.values.optLong("startTime", it.time)}" }
            .sortedBy { it.time }
        val devices = windows.groupBy { if (it.values.optString("source") == WearProtocol.WATCH_SOURCE) "watch" else "phone" }
        val result = JSONObject().put("model_version", Gait.VERSION)
        var any = false
        for ((device, rows) in devices) {
            device(rows, running)?.let { result.put(device, it); any = true }
        }
        return result.takeIf { any }
    }

    private fun device(rows: List<RawSample>, running: (Long, Long) -> Boolean?): JSONObject? {
        val ran = rows.filter { row ->
            val v = row.values
            v.optBoolean("moving") && when (running(v.optLong("startTime", row.time), v.optLong("endTime", row.time + Gait.WINDOW_MS))) {
                true -> true
                false -> false
                null -> v.optDouble("cadence", Double.NaN).let { it.isFinite() && it >= RUNNING_CADENCE }
            }
        }
        if (ran.isEmpty()) return null
        val usable = ran.filter { it.values.optDouble("cadence", Double.NaN).isFinite() }
        val placement = rows.groupingBy { it.values.optString("placement", "unknown") }.eachCount().maxByOrNull { it.value }!!.key
        val checked = ran.filter { it.values.has("fits") }
        val out = JSONObject().put("source", rows.first().values.optString("source"))
            .put("placement", placement).put("windows", ran.size).put("usable", usable.size)
            .put("checked", checked.size).put("mismatch", checked.count { !it.values.optBoolean("fits") })
        val overall = medians(usable, VALUE_KEYS)
        overall.keys().forEach { key -> out.put(key, overall.get(key)) }
        if (usable.size >= MIN_WINDOWS_FOR_THIRDS) {
            val third = usable.size / 3
            val early = medians(usable.take(third), THIRD_KEYS)
            val late = medians(usable.takeLast(third), THIRD_KEYS)
            if (early.length() > 0 && late.length() > 0) out.put("early", early).put("late", late)
        }
        return out
    }

    private fun medians(rows: List<RawSample>, keys: List<String>): JSONObject = JSONObject().apply {
        for (key in keys) {
            val values = rows.mapNotNull { row -> row.values.optDouble(key, Double.NaN).takeIf { it.isFinite() } }
            if (values.size >= MIN_VALUES) put(key, Gait.median(values))
        }
    }
}
