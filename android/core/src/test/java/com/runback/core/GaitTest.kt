package com.runback.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin

class GaitTest {
    private fun axes(n: Int, x: (Double) -> Double, y: (Double) -> Double, z: (Double) -> Double, rate: Double) =
        Gait.Axes(DoubleArray(n) { x(it / rate) }, DoubleArray(n) { y(it / rate) }, DoubleArray(n) { z(it / rate) })

    @Test
    fun wristSwingGivesCadenceAndSwingAngle() {
        val rate = 50.0; val n = 500
        val stride = 1.4 // Hz → 168 Schritte je Minute
        val theta = 0.5 // rad je Seite → 57,3° Spannweite
        val gyro = axes(n, { theta * 2 * PI * stride * cos(2 * PI * stride * it) }, { 0.05 * sin(7.0 * it) }, { 0.0 }, rate)
        val acc = axes(n, { 0.0 }, { 3.0 * sin(2 * PI * stride * it) },
            { 9.81 + 6.0 * max(0.0, cos(2 * PI * 2 * stride * it)).pow(8) }, rate)
        val m = Gait.analyze(acc, gyro, rate, Gait.Placement.WRIST)
        assertTrue(m.moving)
        assertEquals(true, m.fits)
        assertEquals(168.0, m.cadence!!, 3.0)
        assertEquals(57.3, m.armSwingDeg!!, 5.0)
        assertTrue(m.crossShare!! < 0.1)
        assertTrue(m.regularity!! > 0.9)
        assertNull(m.oscillationCm)
    }

    @Test
    fun rotationAboutTheVerticalCountsAsCrossing() {
        val rate = 50.0; val n = 500; val stride = 1.4
        val w = { t: Double -> 0.5 * 2 * PI * stride * cos(2 * PI * stride * t) }
        // Schwungachse halb waagerecht, halb senkrecht (Schwerkraft liegt auf z).
        val gyro = axes(n, { 0.8 * w(it) }, { 0.0 }, { 0.6 * w(it) }, rate)
        val acc = axes(n, { 0.0 }, { 3.0 * sin(2 * PI * stride * it) }, { 9.81 + 2.0 * cos(2 * PI * 2 * stride * it) }, rate)
        val m = Gait.analyze(acc, gyro, rate, Gait.Placement.HAND)
        assertEquals(0.6, m.crossShare!!, 0.05)
    }

    @Test
    fun waistGivesBounceContactImpactAndBraking() {
        val rate = 100.0; val n = 1000
        val step = 170.0 / 60.0; val stride = step / 2
        val amplitude = 0.04 // m → 8 cm Spannweite
        val omega = 2 * PI * step
        val acc = axes(n,
            { 1.0 * sin(2 * PI * stride * it) },
            { 2.0 * cos(omega * it) },
            { 9.81 - amplitude * omega * omega * sin(omega * it) }, rate)
        val gyro = axes(n, { 0.3 * sin(2 * PI * stride * it) }, { 0.0 }, { 0.0 }, rate)
        val m = Gait.analyze(acc, gyro, rate, Gait.Placement.WAIST)
        assertEquals(true, m.fits)
        assertEquals(170.0, m.cadence!!, 3.0)
        assertEquals(8.0, m.oscillationCm!!, 1.0)
        assertEquals(2 * 2.0 / omega, m.brakingMps!!, 0.03)
        assertEquals(1000.0 / step / 2, m.contactMs!!, 25.0)
        assertEquals((amplitude * omega * omega + 9.81) / 9.81, m.impactG!!, 0.1)
        assertNull(m.armSwingDeg)
    }

    @Test
    fun walkingTrunkIsNotMistakenForRunning() {
        val rate = 100.0; val n = 1000
        val step = 110.0 / 60.0
        val acc = axes(n, { 0.0 }, { 0.0 },
            { 9.81 + 2.0 * sin(2 * PI * step * it) + 0.4 * sin(PI * step * it) }, rate)
        val m = Gait.analyze(acc, null, rate, Gait.Placement.WAIST)
        assertEquals(110.0, m.cadence!!, 3.0)
    }

    @Test
    fun swingingPhoneAtTheWaistDoesNotFit() {
        val rate = 100.0; val n = 1000; val stride = 1.4
        val gyro = axes(n, { 4.0 * cos(2 * PI * stride * it) }, { 0.0 }, { 0.0 }, rate)
        val acc = axes(n, { 0.0 }, { 3.0 * sin(2 * PI * stride * it) }, { 9.81 + 3.0 * sin(2 * PI * 2 * stride * it) }, rate)
        val m = Gait.analyze(acc, gyro, rate, Gait.Placement.WAIST)
        assertEquals(false, m.fits)
        assertNull(m.oscillationCm)
    }

    @Test
    fun chestLeanIsMeasuredAgainstStanding() {
        val rate = 100.0; val n = 1000
        val step = 170.0 / 60.0; val omega = 2 * PI * step
        val lean = Math.toRadians(8.0)
        val bounce = { t: Double -> 9.81 - 0.04 * omega * omega * sin(omega * t) }
        val acc = axes(n, { 0.0 }, { sin(lean) * 9.81 }, { cos(lean) * bounce(it) }, rate)
        val m = Gait.analyze(acc, null, rate, Gait.Placement.CHEST, standingGravity = doubleArrayOf(0.0, 0.0, 1.0))
        assertEquals(8.0, m.leanDeg!!, 1.0)
        assertNull(Gait.analyze(acc, null, rate, Gait.Placement.CHEST).leanDeg)
    }

    @Test
    fun standingStillIsNotMoving() {
        val rate = 100.0
        val acc = axes(1000, { 0.01 * sin(it) }, { 0.0 }, { 9.81 }, rate)
        val m = Gait.analyze(acc, null, rate, Gait.Placement.HAND)
        assertFalse(m.moving)
        assertTrue(m.still)
        assertNull(m.cadence)
    }

    @Test
    fun recorderEmitsOneWindowPerTenSecondsAndSurvivesJitter() {
        val recorder = GaitRecorder(Gait.Placement.WRIST, 50.0)
        val stride = 1.4
        val windows = ArrayList<Gait.Window>()
        var ns = 1_000_000_000L
        repeat(1250) { i ->
            val t = i / 50.0
            ns += 20_000_000L + (if (i % 3 == 0) 2_000_000L else -1_000_000L)
            recorder.addRotation(ns, 0.5 * 2 * PI * stride * cos(2 * PI * stride * t), 0.0, 0.0)
            recorder.addAcceleration(ns, 0.0, 3.0 * sin(2 * PI * stride * t), 9.81 + 2.0 * cos(2 * PI * 2 * stride * t))
                ?.let(windows::add)
        }
        assertEquals(2, windows.size)
        windows.forEach { assertEquals(168.0, it.metrics.cadence!!, 5.0) }
        val json = Gait.json(windows[0], 1L, 2L)
        assertEquals("wrist", json.getString("placement"))
        assertEquals(Gait.VERSION, json.getString("model"))
    }

    private fun window(time: Long, source: String, values: Map<String, Any>): RawSample =
        RawSample(time, "gait", JSONObject().put("source", source).put("startTime", time).put("endTime", time + 10_000)
            .put("moving", true).apply { values.forEach { (k, v) -> put(k, v) } })

    @Test
    fun summaryKeepsDevicesApartAndComparesThirds() {
        val samples = ArrayList<RawSample>()
        repeat(15) { i ->
            samples.add(window(i * 10_000L, "phone", mapOf("placement" to "hand", "cadence" to 170.0, "armSwingDeg" to 60.0 - i, "fits" to (i != 0))))
            samples.add(window(i * 10_000L + 1, "wear_os", mapOf("placement" to "wrist", "cadence" to 172.0, "armSwingDeg" to 80.0)))
        }
        // Doppelt empfangenes Fenster zählt einmal; ein gegangenes gar nicht.
        samples.add(window(0L, "phone", mapOf("placement" to "hand", "cadence" to 170.0, "armSwingDeg" to 60.0)))
        samples.add(window(200_000L, "phone", mapOf("placement" to "hand", "cadence" to 110.0)))
        val summary = GaitSummary.build(samples) { from, _ -> from < 150_000L }!!
        val phone = summary.getJSONObject("phone")
        val watch = summary.getJSONObject("watch")
        assertEquals(Gait.VERSION, summary.getString("model_version"))
        assertEquals(15, phone.getInt("windows"))
        assertEquals(1, phone.getInt("mismatch"))
        assertEquals("hand", phone.getString("placement"))
        assertEquals(53.0, phone.getDouble("armSwingDeg"), 0.01)
        assertEquals(58.0, phone.getJSONObject("early").getDouble("armSwingDeg"), 0.01)
        assertEquals(48.0, phone.getJSONObject("late").getDouble("armSwingDeg"), 0.01)
        assertEquals("wrist", watch.getString("placement"))
        assertEquals(80.0, watch.getDouble("armSwingDeg"), 0.01)
    }

    @Test
    fun summaryWithoutPhasesFallsBackToRunningCadence() {
        val samples = (0 until 4).map { window(it * 10_000L, "phone", mapOf("placement" to "pocket", "cadence" to if (it < 3) 165.0 else 100.0)) }
        val phone = GaitSummary.build(samples) { _, _ -> null }!!.getJSONObject("phone")
        assertEquals(3, phone.getInt("windows"))
        assertFalse(phone.has("early"))
        assertNotNull(GaitSummary.build(samples) { _, _ -> null })
        assertNull(GaitSummary.build(samples) { _, _ -> false })
    }
}
