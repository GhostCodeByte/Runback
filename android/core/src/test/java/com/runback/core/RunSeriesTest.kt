package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunSeriesTest {
    private val start = 1_700_000_000_000L
    private val grid = RunPhases.GRID_SECONDS

    private fun row(i: Int, state: RunPhases.State, speed: Double? = 3.0, heart: Double? = 150.0, elevation: Double? = 100.0) =
        RunPhases.Row((i + 1) * grid, i * grid * 3.0, 15.0, 5.0, speed, state, heart, 170.0, elevation, 0.0, 5.0)

    /** Ein Punkt je Sekunde nach Norden mit 3 m/s. */
    private fun northTrack(seconds: Int) = (0 until seconds).map { s ->
        RunTimeline.GpsPoint(start + s * 1000L, 52.0 + s * 3.0 / 111_195.0, 13.0, 4.0, 100.0)
    }

    @Test fun bearingAndHeadwindFollowTheCompass() {
        val a = RunSeries.Position(52.0, 13.0)
        assertEquals(0.0, RunSeries.bearingDeg(a, RunSeries.Position(52.01, 13.0)), 0.5)
        assertEquals(90.0, RunSeries.bearingDeg(a, RunSeries.Position(52.0, 13.01)), 0.5)
        val fromNorth = RunSeries.Wind(4.0, 0.0)
        assertEquals(4.0, RunSeries.headwind(fromNorth, 0.0), 0.001)    // nach Norden = in den Wind
        assertEquals(-4.0, RunSeries.headwind(fromNorth, 180.0), 0.001) // nach Süden = Rückenwind
        assertEquals(0.0, RunSeries.headwind(fromNorth, 90.0), 0.001)   // quer
    }

    @Test fun rowsCarryPositionAndHeadwindOnlyWhereKnown() {
        val rows = (0 until 12).map { row(it, RunPhases.State.RUN) }
        val result = RunSeries.build(start, rows, northTrack(60), RunSeries.Wind(3.0, 0.0))
        assertEquals(grid, result.stepSeconds)
        assertEquals(12, result.rows.size)
        // Erstes Fenster hat eine Position, aber noch keinen Kurs — also keinen Wind.
        assertNotNull(result.rows[0].position)
        assertNull(result.rows[0].headwindMps)
        assertEquals(3.0, result.rows[1].headwindMps!!, 0.05)
        assertTrue(result.rows[1].position!!.latitude > result.rows[0].position!!.latitude)
    }

    @Test fun paceOnlyWhileMovingAndNoWindWithoutDirection() {
        val rows = listOf(row(0, RunPhases.State.RUN, 3.0), row(1, RunPhases.State.STOPPED, 0.2), row(2, RunPhases.State.PAUSED, 2.5), row(3, RunPhases.State.WALK, 1.4))
        val result = RunSeries.build(start, rows, northTrack(20), wind = null)
        assertEquals(listOf(3.0, null, null, 1.4), result.rows.map { it.speedMps })
        assertEquals(listOf(true, false, false, true), result.rows.map { it.moving })
        assertTrue(result.rows.all { it.headwindMps == null })
    }

    @Test fun longRunsAreMergedToTheRowLimitWithoutInventingValues() {
        val rows = (0 until 100).map { row(it, if (it % 2 == 0) RunPhases.State.RUN else RunPhases.State.STOPPED, if (it % 2 == 0) 3.0 else null, heart = if (it < 50) 140.0 else null) }
        val result = RunSeries.build(start, rows, emptyList(), wind = null, maxRows = 25)
        assertEquals(25, result.rows.size)
        assertEquals(grid * 4, result.stepSeconds)
        assertEquals(rows[3].elapsedSeconds, result.rows[0].elapsedSeconds)
        assertEquals(rows[3].distanceMeters, result.rows[0].distanceMeters, 0.001)
        assertEquals(3.0, result.rows[0].speedMps!!, 0.001)       // Mittel nur über vorhandene Werte
        assertTrue(result.rows[0].moving)
        assertEquals(140.0, result.rows[0].heartRate!!, 0.001)
        assertNull(result.rows[24].heartRate)                   // keine Pulswerte → kein Puls
        assertNull(result.rows[0].position)
    }

    @Test fun jsonOmitsMissingFields() {
        val result = RunSeries.build(start, listOf(row(0, RunPhases.State.STOPPED, null, heart = null, elevation = null)), emptyList(), null)
        val json = RunSeries.json(result, null)
        assertEquals(RunSeries.VERSION, json.getString("version"))
        assertFalse(json.has("wind"))
        val first = json.getJSONArray("rows").getJSONObject(0)
        assertFalse(first.has("speedMps")); assertFalse(first.has("heartRate")); assertFalse(first.has("elevationM")); assertFalse(first.has("latitude"))
        assertEquals(false, first.getBoolean("moving"))
    }
}
