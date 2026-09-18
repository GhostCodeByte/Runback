package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunTimelineTest {
    private val start = 1_700_000_000_000L
    // Gleichmäßiger Lauf nach Norden: 0,0001° ≈ 11,1 m je Sekunde (~ 1:30 /km,
    // absichtlich schnell, damit die Zahlen klar bleiben).
    private fun track(seconds: Int, from: Int = 0): List<RunTimeline.GpsPoint> =
        (from until from + seconds).map { RunTimeline.GpsPoint(start + it * 1000L, 52.0 + it * 0.0001, 13.0, 3.0, 100.0 + it * 0.1) }

    @Test fun choosesStepSoRowsStayBounded() {
        assertEquals(30, RunTimeline.stepSeconds(20 * 60.0, 120))
        assertEquals(60, RunTimeline.stepSeconds(90 * 60.0, 120))
        assertEquals(120, RunTimeline.stepSeconds(3 * 3600.0, 120))
        assertEquals(900, RunTimeline.stepSeconds(48 * 3600.0, 120))
    }

    @Test fun aggregatesPerWindowAndCarriesDistance() {
        val gps = track(180)
        val heart = (0 until 180 step 5).map { RunTimeline.Reading(start + it * 1000L, if (it < 60) 140.0 else 150.0) }
        val cadence = (0 until 60).map { RunTimeline.Reading(start + it * 1000L, 170.0) }
        val result = RunTimeline.build(start, start + 180_000L, gps, heart, cadence, emptyList(), maxRows = 120)

        assertEquals(30, result.stepSeconds)
        assertEquals(6, result.rows.size)
        val first = result.rows[0]
        assertEquals(30, first.elapsedSeconds)
        assertEquals(140.0, first.avgHeartRate!!, 0.01)
        assertEquals(170.0, first.avgCadence!!, 0.01)
        assertEquals(29.0, first.movingSeconds, 0.01)
        assertTrue(first.stepDistanceMeters in 300.0..340.0)
        assertEquals(first.stepDistanceMeters, first.distanceMeters, 0.01)

        val third = result.rows[2]
        assertEquals(90, third.elapsedSeconds)
        assertEquals(150.0, third.avgHeartRate!!, 0.01)
        assertNull(third.avgCadence)
        assertTrue(third.distanceMeters > result.rows[1].distanceMeters)
        val last = result.rows.last()
        assertEquals(180, last.elapsedSeconds)
        assertTrue(last.distanceMeters in 1900.0..2050.0)
        assertTrue(last.altitudeM!! > first.altitudeM!!)
    }

    @Test fun pauseNeitherAddsDistanceNorMovingTime() {
        // 60 s laufen, 60 s Pause ohne Samples, dann 60 s weiter.
        val gps = track(60) + track(60, from = 120)
        val cuts = listOf(start + 60_500L, start + 119_500L)
        val result = RunTimeline.build(start, start + 180_000L, gps, emptyList(), emptyList(), cuts, maxRows = 120)
        val elapsed = result.rows.map { it.elapsedSeconds }
        // Das Pausenfenster (60–90 s, 90–120 s) fehlt statt mit Nullen aufzutauchen.
        assertEquals(listOf(30, 60, 150, 180), elapsed)
        val beforePause = result.rows[1]
        val afterPause = result.rows[2]
        // Der Sprung über die Pause zählt weder als Strecke noch als Bewegung.
        assertEquals(29.0, afterPause.movingSeconds, 0.01)
        assertTrue(afterPause.distanceMeters - beforePause.distanceMeters < 340.0)
        assertNull(afterPause.avgHeartRate)
    }

    @Test fun windowsWithoutGpsKeepLastDistance() {
        val gps = track(60)
        val heart = (0 until 120 step 10).map { RunTimeline.Reading(start + it * 1000L, 150.0) }
        val result = RunTimeline.build(start, start + 120_000L, gps, heart, emptyList(), emptyList(), maxRows = 120)
        assertEquals(4, result.rows.size)
        assertEquals(result.rows[1].distanceMeters, result.rows[3].distanceMeters, 0.001)
        assertEquals(0.0, result.rows[3].stepDistanceMeters, 0.001)
        assertNull(result.rows[3].altitudeM)
    }

    @Test fun emptyRecordingYieldsNoRows() {
        val result = RunTimeline.build(start, start, emptyList(), emptyList(), emptyList(), emptyList())
        assertTrue(result.rows.isEmpty())
    }
}
