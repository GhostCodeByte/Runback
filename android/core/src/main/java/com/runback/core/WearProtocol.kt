package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/** Versioned, native-only payloads for the phone/watch data layer. */
object WearProtocol {
    const val VERSION = 1
    const val CONTROL_PATH = "/runback/control/v1"
    const val LIVE_PATH = "/runback/live/v1"
    const val ACK_PATH = "/runback/ack/v1"
    const val WATCH_SOURCE = "wear_os"
    const val PHONE_SOURCE = "phone"
    private const val MAX_PAYLOAD_BYTES = 128 * 1024
    private const val MAX_SAMPLES = 256

    fun control(
        action: String,
        runId: String,
        purpose: String = "easy",
        sport: String = "running",
        target: String? = null,
        routePlanId: String? = null,
        commandId: String? = null,
        sequence: Long = 0L,
    ): ByteArray = JSONObject().apply {
        put("protocolVersion", VERSION)
        put("action", action)
        put("runId", runId)
        put("purpose", purpose)
        put("sport", sport)
        put("target", target ?: JSONObject.NULL)
        put("routePlanId", routePlanId ?: JSONObject.NULL)
        put("commandId", commandId ?: JSONObject.NULL)
        put("sequence", sequence)
    }.toString().toByteArray(Charsets.UTF_8)

    fun live(runId: String, sequence: Long, source: String, samples: List<RawSample>): ByteArray {
        require(sequence >= 0) { "Ungültige Sensorpaket-Nummer" }
        require(samples.size <= MAX_SAMPLES) { "Zu viele Sensorwerte in einem Paket" }
        return JSONObject().apply {
            put("protocolVersion", VERSION)
            put("runId", runId)
            put("sequence", sequence)
            put("source", source)
            put("samples", JSONArray().apply {
                samples.forEach { sample ->
                    put(JSONObject().put("time", sample.time).put("kind", sample.kind).put("values", sample.values))
                }
            })
        }.toString().toByteArray(Charsets.UTF_8)
    }

    fun ack(
        action: String,
        runId: String,
        status: String,
        message: String? = null,
        sensors: JSONObject? = null,
        commandId: String? = null,
        sequence: Long = 0L,
    ): ByteArray = JSONObject().apply {
        put("protocolVersion", VERSION)
        put("action", action)
        put("runId", runId)
        put("status", status)
        put("message", message ?: JSONObject.NULL)
        put("sensors", sensors ?: JSONObject.NULL)
        put("commandId", commandId ?: JSONObject.NULL)
        put("sequence", sequence)
    }.toString().toByteArray(Charsets.UTF_8)

    fun decode(bytes: ByteArray): JSONObject {
        require(bytes.size <= MAX_PAYLOAD_BYTES) { "Wear-Paket ist zu groß" }
        val payload = JSONObject(bytes.toString(Charsets.UTF_8))
        require(payload.optInt("protocolVersion") == VERSION) { "Unbekannte Wear-Protokollversion" }
        return payload
    }

    fun requireRunId(payload: JSONObject): String {
        val runId = payload.optString("runId")
        require(runId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Ungültige Laufkennung" }
        return runId
    }

    fun commandId(payload: JSONObject): String? {
        val raw = payload.optString("commandId")
        if (raw.isBlank() || raw == "null") return null
        require(raw.length <= 100 && raw.matches(Regex("[A-Za-z0-9_-]+"))) { "Ungültige Befehlskennung" }
        return raw
    }

    fun commandSequence(payload: JSONObject): Long = payload.optLong("sequence", 0L).also {
        require(it >= 0) { "Ungültige Befehlsnummer" }
    }

    fun samples(payload: JSONObject): List<RawSample> {
        val source = payload.optString("source")
        require(source == PHONE_SOURCE || source == WATCH_SOURCE) { "Ungültige Sensorquelle" }
        val raw = payload.optJSONArray("samples") ?: JSONArray()
        require(raw.length() <= MAX_SAMPLES) { "Zu viele Sensorwerte in einem Paket" }
        return buildList(raw.length()) {
            for (index in 0 until raw.length()) {
                val sample = raw.getJSONObject(index)
                val time = sample.optLong("time")
                val kind = sample.optString("kind")
                require(time > 0 && kind.length in 1..40) { "Ungültiger Messwert" }
                val values = JSONObject(sample.optJSONObject("values")?.toString() ?: "{}")
                    .put("source", source)
                add(RawSample(time, kind, values))
            }
        }
    }
}
