package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunMathTest {
    @Test fun knownEquatorialDistance() {
        assertEquals(111.195, RunMath.distanceMeters(0.0, 0.0, 0.0, 0.001), 0.01)
    }
    @Test fun rejectsJumpsGapsAndInvalidPositions() {
        assertNull(RunMath.acceptedDistance(52.0, 13.0, 1000, 5.0, 53.0, 13.0, 2000, 5.0))
        assertNull(RunMath.acceptedDistance(52.0, 13.0, 1000, 5.0, 52.0001, 13.0, 32000, 5.0))
        assertNull(RunMath.acceptedDistance(91.0, 13.0, 1000, 5.0, 52.0, 13.0, 2000, 5.0))
        assertNull(RunMath.acceptedDistance(52.0, 13.0, 1000, 60.0, 52.0001, 13.0, 3000, 5.0))
    }
    @Test fun shortRunningSegmentRemainsUsable() {
        assertEquals(11.12, RunMath.acceptedDistance(52.0, 13.0, 1000, 5.0, 52.0001, 13.0, 3000, 5.0)!!, 0.1)
    }
    @Test fun standstillJitterBelowNoiseFloorAddsNoDistance() {
        // 2 m Zickzack bei 5 m Genauigkeit: unter dem Rauschboden, Anker bleibt.
        assertNull(RunMath.anchoredDistance(52.0, 13.0, 5.0, 52.00002, 13.0, 5.0))
        // 11 m bei 5 m Genauigkeit: echte Verschiebung.
        assertEquals(11.12, RunMath.anchoredDistance(52.0, 13.0, 5.0, 52.0001, 13.0, 5.0)!!, 0.1)
        // Ohne Genauigkeitsangabe zählt jeder Schritt wie bisher.
        assertEquals(2.22, RunMath.anchoredDistance(52.0, 13.0, 0.0, 52.00002, 13.0, 0.0)!!, 0.1)
    }
    @Test fun elevationCountsAscentAndDescentSeparatelyWithHysteresis() {
        val accumulator = RunMath.ElevationAccumulator(3.0)
        listOf(100.0, 101.0, 100.5, 104.0, 108.0, 107.0, 103.0, 100.0).forEach { accumulator.add(it) }
        // Hoch und wieder runter: netto 0 m, aber 8 m Aufstieg und 8 m Abstieg.
        assertEquals(8.0, accumulator.ascent, 0.01)
        assertEquals(8.0, accumulator.descent, 0.01)
        val noisy = RunMath.ElevationAccumulator(3.0)
        listOf(50.0, 51.5, 49.0, 51.0, 49.5).forEach { noisy.add(it) }
        assertEquals(0.0, noisy.ascent, 0.01)
        assertEquals(0.0, noisy.descent, 0.01)
    }
    @Test fun heartRateIsTimeWeightedAndGapsAreNotCovered() {
        // 150 bpm für 10 s, dann 30 s Lücke, dann 170 bpm für 10 s.
        val result = RunMath.timeWeightedAverage(listOf(0L, 10_000L, 40_000L, 50_000L), listOf(150.0, 150.0, 170.0, 170.0))!!
        assertEquals(157.1, result.first, 0.1)
        assertEquals(31.0, result.second, 0.01)
        assertNull(RunMath.timeWeightedAverage(emptyList(), emptyList()))
    }
}
