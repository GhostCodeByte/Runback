package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunElevationTest {
    private val start = 1_700_000_000_000L

    // Druck je Sekunde aus einer Zielhöhe (Standardatmosphäre umgekehrt).
    private fun pressureFor(altitude: Double) = 1013.25 * Math.pow(1 - altitude / 44330.0, 5.255)
    private fun pressure(altitudes: List<Double>) = altitudes.mapIndexed { i, a -> RunElevation.Pressure(start + i * 1000L, pressureFor(a)) }
    private fun gps(altitudes: List<Double>, vertical: Double? = 5.0) =
        altitudes.mapIndexed { i, a -> RunElevation.GpsAltitude(start + i * 1000L, a, vertical) }

    @Test fun barometerWinsAndCountsOnlyRealClimb() {
        // 8 m rauf über 60 s, 60 s flach mit ±1 m Rauschen, 8 m runter.
        val profile = (0 until 60).map { 100.0 + it * 8 / 60.0 } +
            (0 until 60).map { 108.0 + if (it % 2 == 0) 1.0 else -1.0 } +
            (0 until 60).map { 108.0 - it * 8 / 60.0 }
        val outcome = RunElevation.build(start, start + 180_000L, pressure(profile), gps(profile.map { it + 30 }, vertical = null))
        val result = (outcome as RunElevation.Outcome.Available).result
        assertEquals("barometer", result.source)
        // Ohne vertikale GPS-Genauigkeit gibt es keinen absoluten Bezug: Start = 0 m.
        assertEquals("start", result.reference)
        assertEquals(0.0, result.grid.first()!!, 0.6)
        // Hysterese von 3 m verschluckt den Rest eines Anstiegs; das Rauschen zählt gar nicht.
        assertTrue("ascent ${result.ascentMeters}", result.ascentMeters in 5.0..8.5)
        assertTrue("descent ${result.descentMeters}", result.descentMeters in 5.0..8.5)
    }

    @Test fun barometerIsAnchoredToGoodGpsAltitude() {
        val profile = List(120) { 100.0 }
        val outcome = RunElevation.build(start, start + 120_000L, pressure(profile), gps(List(120) { 287.0 }, vertical = 4.0))
        val result = (outcome as RunElevation.Outcome.Available).result
        assertEquals("absolute", result.reference)
        assertEquals(287.0, result.grid[10]!!, 0.5)
    }

    @Test fun gpsWithoutVerticalAccuracyYieldsNoElevation() {
        val noisy = (0 until 300).map { 280.0 + (if (it % 3 == 0) 12.0 else -6.0) }
        val outcome = RunElevation.build(start, start + 300_000L, emptyList(), gps(noisy, vertical = null))
        assertEquals(RunElevation.Outcome.Unavailable("NO_VERTICAL_ACCURACY"), outcome)
        assertEquals(RunElevation.Outcome.Unavailable("NO_ELEVATION_SOURCE"), RunElevation.build(start, start + 60_000L, emptyList(), emptyList()))
    }

    @Test fun gpsNoiseIsSmoothedAndRejectedByAccuracy() {
        // Flach mit ±6 m Zickzack: nach Median und 10 m Hysterese bleiben 0 m Höhenmeter.
        val noisy = (0 until 300).map { 280.0 + (if (it % 2 == 0) 6.0 else -6.0) }
        val points = gps(noisy, vertical = 8.0) + gps(List(20) { 400.0 }, vertical = 40.0).map { it.copy(time = it.time + 300_000L) }
        val outcome = RunElevation.build(start, start + 320_000L, emptyList(), points)
        val result = (outcome as RunElevation.Outcome.Available).result
        assertEquals("gps", result.source)
        assertEquals(20, result.rejectedSamples)
        assertEquals(0.0, result.ascentMeters, 0.01)
        assertEquals(0.0, result.descentMeters, 0.01)
        assertNull(result.grid.last())
    }

    @Test fun gradeNeedsFiftyHorizontalMeters() {
        val grid = listOf(100.0, 100.5, 101.0, 101.5, 102.0, 102.5)
        // 10 m je Fenster: erst über 5 Fenster sind 50 m erreicht.
        val distance = listOf(10.0, 20.0, 30.0, 40.0, 50.0, 60.0)
        // Fenster 0..4: 2 m auf 50 m.
        assertEquals(4.0, RunElevation.gradePercent(grid, distance, 2)!!, 0.01)
        assertNull(RunElevation.gradePercent(listOf(100.0, 130.0), listOf(5.0, 10.0), 1))
        // 3 m Höhenfehler über 5 m Strecke ergeben keine 60 %.
        assertNull(RunElevation.gradePercent(listOf(100.0, 103.0), listOf(2.5, 5.0), 1))
    }
}
