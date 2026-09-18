package com.runback.core

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WearProtocolTest {
    @Test fun livePayloadKeepsSourceAndValues() {
        val payload = WearProtocol.decode(
            WearProtocol.live(
                "run-1",
                3,
                WearProtocol.WATCH_SOURCE,
                listOf(RawSample(1000, "heartRate", JSONObject().put("bpm", 144))),
            ),
        )

        assertEquals("run-1", WearProtocol.requireRunId(payload))
        assertEquals(1, WearProtocol.samples(payload).size)
        assertEquals(WearProtocol.WATCH_SOURCE, WearProtocol.samples(payload).single().values.getString("source"))
    }

    @Test fun controlAndAckCarryCommandCorrelation() {
        val control = WearProtocol.decode(
            WearProtocol.control(
                "com.runback.recording.PAUSE",
                "run-1",
                commandId = "cmd-7",
                sequence = 42,
            ),
        )
        assertEquals("cmd-7", WearProtocol.commandId(control))
        assertEquals(42L, WearProtocol.commandSequence(control))

        val ack = WearProtocol.decode(
            WearProtocol.ack(
                "com.runback.recording.PAUSE",
                "run-1",
                "accepted",
                commandId = WearProtocol.commandId(control),
                sequence = WearProtocol.commandSequence(control),
            ),
        )
        assertEquals("cmd-7", WearProtocol.commandId(ack))
        assertEquals(42L, WearProtocol.commandSequence(ack))
    }

    @Test fun invalidSourceAndRunIdAreRejected() {
        val payload = JSONObject()
            .put("protocolVersion", WearProtocol.VERSION)
            .put("runId", "../run")
            .put("source", "unknown")
            .put("samples", JSONArray())

        assertThrows(IllegalArgumentException::class.java) { WearProtocol.requireRunId(payload) }
        assertThrows(IllegalArgumentException::class.java) { WearProtocol.samples(payload) }
    }

    @Test fun watchValuesWinOnlyWhereTheyOverlap() {
        val samples = listOf(
            RawSample(1_000, "heartRate", JSONObject().put("bpm", 100).put("source", WearProtocol.PHONE_SOURCE)),
            RawSample(3_000, "heartRate", JSONObject().put("bpm", 140).put("source", WearProtocol.WATCH_SOURCE)),
            RawSample(20_000, "heartRate", JSONObject().put("bpm", 110).put("source", WearProtocol.PHONE_SOURCE)),
        )

        val selected = SensorSourceSelection.select(samples, "heartRate")
        assertEquals(listOf(3_000L, 20_000L), selected.map { it.time })
        assertTrue(selected.all { it.kind == "heartRate" })
        assertEquals("mixed", SensorSourceSelection.selectedSource(samples, "heartRate"))
    }

    @Test fun betterPhoneGpsSurvivesAWeakWatchFix() {
        val samples = listOf(
            RawSample(1_000, "gps", JSONObject().put("latitude", 52.0).put("longitude", 13.0)
                .put("accuracyM", 4.0).put("source", WearProtocol.PHONE_SOURCE)),
            RawSample(2_000, "gps", JSONObject().put("latitude", 52.0001).put("longitude", 13.0)
                .put("accuracyM", 35.0).put("source", WearProtocol.WATCH_SOURCE)),
        )
        assertEquals(listOf(WearProtocol.PHONE_SOURCE), SensorSourceSelection.select(samples, "gps")
            .map { it.values.getString("source") })
    }

    @Test fun betterWatchGpsWinsOverAWeakPhoneFix() {
        val samples = listOf(
            RawSample(1_000, "gps", JSONObject().put("latitude", 52.0).put("longitude", 13.0)
                .put("accuracyM", 40.0).put("source", WearProtocol.PHONE_SOURCE)),
            RawSample(2_000, "gps", JSONObject().put("latitude", 52.0001).put("longitude", 13.0)
                .put("accuracyM", 4.0).put("source", WearProtocol.WATCH_SOURCE)),
        )
        assertEquals(listOf(WearProtocol.WATCH_SOURCE), SensorSourceSelection.select(samples, "gps")
            .map { it.values.getString("source") })
    }

    @Test fun invalidWatchGpsCannotDisplaceValidPhoneGps() {
        val samples = listOf(
            RawSample(1_000, "gps", JSONObject().put("latitude", 52.0).put("longitude", 13.0)
                .put("accuracyM", 12.0).put("source", WearProtocol.PHONE_SOURCE)),
            RawSample(2_000, "gps", JSONObject().put("latitude", 999.0).put("longitude", 13.0)
                .put("accuracyM", 1.0).put("source", WearProtocol.WATCH_SOURCE)),
        )
        assertEquals(listOf(WearProtocol.PHONE_SOURCE), SensorSourceSelection.select(samples, "gps")
            .map { it.values.getString("source") })
    }

    @Test fun invalidWatchHeartRateCannotDisplaceValidPhoneHeartRate() {
        val samples = listOf(
            RawSample(1_000, "heartRate", JSONObject().put("bpm", 145.0).put("source", WearProtocol.PHONE_SOURCE)),
            RawSample(2_000, "heartRate", JSONObject().put("bpm", 0.0).put("source", WearProtocol.WATCH_SOURCE)),
        )
        assertEquals(listOf(WearProtocol.PHONE_SOURCE), SensorSourceSelection.select(samples, "heartRate")
            .map { it.values.getString("source") })
    }
}
