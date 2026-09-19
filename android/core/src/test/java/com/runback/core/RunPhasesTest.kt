package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunPhasesTest {
    private val start = 1_700_000_000_000L
    private val grid = RunPhases.GRID_SECONDS

    // Synthetischer Track: je Sekunde ein Punkt, Tempo in m/s je Sekunde; 0 m/s ist
    // Stehen mit ±1,5 m Zickzack (unter dem Rauschboden von 4 m Genauigkeit).
    private fun track(speeds: List<Double>, accuracy: Double = 4.0, from: Int = 0): List<RunTimeline.GpsPoint> {
        var north = 0.0
        return speeds.mapIndexed { i, speed ->
            north += speed
            val jitter = if (speed == 0.0) (if (i % 2 == 0) 1.5 else -1.5) else 0.0
            RunTimeline.GpsPoint(start + (from + i) * 1000L, 52.0 + (north + jitter) / 111_195.0, 13.0, accuracy, 100.0)
        }
    }
    private fun rows(gps: List<RunTimeline.GpsPoint>, end: Long, cadence: List<RunTimeline.Reading> = emptyList(), cuts: List<Long> = emptyList()) =
        RunTimeline.build(start, end, gps, emptyList(), cadence, cuts, fixedStepSeconds = grid, keepEmpty = true).rows
    private fun accel(seconds: IntRange, still: Boolean) = seconds.flatMap { s ->
        (0 until 10).map { k -> RunPhases.Acceleration(start + s * 1000L + k * 100L, 0.0, 0.0, if (still) 9.81 else if (k % 2 == 0) 6.0 else 14.0) }
    }

    @Test fun runWalkStopPatternWithHysteresisAndBudgetInvariant() {
        // 120 s laufen (3 m/s), 90 s gehen (1,3 m/s), 60 s stehen, 120 s laufen.
        val speeds = List(120) { 3.0 } + List(90) { 1.3 } + List(60) { 0.0 } + List(120) { 3.0 }
        val end = start + speeds.size * 1000L
        val gps = track(speeds)
        val result = RunPhases.build(start, end, rows(gps, end), emptyList(), List(speeds.size / grid) { null })

        assertEquals(listOf(RunPhases.State.RUN, RunPhases.State.WALK, RunPhases.State.STOPPED, RunPhases.State.RUN), result.phases.map { it.state })
        val budget = result.budget
        assertEquals(390.0, budget.elapsedSeconds, 0.001)
        assertEquals(budget.elapsedSeconds,
            budget.pausedSeconds + budget.runningSeconds + budget.walkingSeconds + budget.stoppedSeconds + budget.unknownSeconds, 0.001)
        assertTrue("running ${budget.runningSeconds}", budget.runningSeconds in 220.0..260.0)
        assertTrue("walking ${budget.walkingSeconds}", budget.walkingSeconds in 70.0..110.0)
        assertTrue("stopped ${budget.stoppedSeconds}", budget.stoppedSeconds in 40.0..70.0)
        assertEquals(0.0, budget.unknownSeconds, 0.001)
        assertEquals(1, result.metrics.runWalkTransitions)
        assertEquals(0, result.metrics.trailingIdleSeconds)
        assertNull(result.metrics.fastestSustained300sSecondsPerKm)
        // Stehen sammelt keine Strecke; nur die Fensterränder tragen ein paar Meter hinein.
        assertTrue("stopped meters ${result.metrics.stopped.meters}", result.metrics.stopped.meters < 25.0)
    }

    @Test fun shortBlipsAreAbsorbedIntoThePreviousPhase() {
        // 10 s Stehen mitten im Lauf: unter 20 s, geht im RUN auf.
        val speeds = List(100) { 3.0 } + List(10) { 0.0 } + List(100) { 3.0 }
        val end = start + speeds.size * 1000L
        val result = RunPhases.build(start, end, rows(track(speeds), end), emptyList(), List(speeds.size / grid) { null })
        assertEquals(listOf(RunPhases.State.RUN), result.phases.map { it.state })
    }

    @Test fun cadenceDecidesBeforeSpeed() {
        // Langsam (1,5 m/s) aber mit 165 spm: das ist Laufen, kein Gehen.
        val speeds = List(120) { 1.5 }
        val end = start + speeds.size * 1000L
        val cadence = (0 until 120).map { RunTimeline.Reading(start + it * 1000L, 165.0) }
        val result = RunPhases.build(start, end, rows(track(speeds), end, cadence), emptyList(), List(24) { null })
        assertEquals(listOf(RunPhases.State.RUN), result.phases.map { it.state })
        // Ohne Kadenz wäre es Gehen.
        val withoutCadence = RunPhases.build(start, end, rows(track(speeds), end), emptyList(), List(24) { null })
        assertEquals(listOf(RunPhases.State.WALK), withoutCadence.phases.map { it.state })
    }

    @Test fun gpsLossIsUnknownUnlessAccelerometerProvesStillness() {
        // 60 s laufen, dann 60 s ohne GPS.
        val speeds = List(60) { 3.0 }
        val end = start + 120_000L
        val gpsRows = rows(track(speeds), end)
        assertEquals(24, gpsRows.size)
        val moving = RunPhases.build(start, end, gpsRows, emptyList(), RunPhases.stillness(start, 24, accel(60..119, still = false)))
        assertEquals(listOf(RunPhases.State.RUN, RunPhases.State.UNKNOWN), moving.phases.map { it.state })
        val still = RunPhases.build(start, end, gpsRows, emptyList(), RunPhases.stillness(start, 24, accel(60..119, still = true)))
        assertEquals(listOf(RunPhases.State.RUN, RunPhases.State.STOPPED), still.phases.map { it.state })
        assertEquals(60, still.metrics.trailingIdleSeconds)
        assertEquals(60.0, moving.budget.unknownSeconds, 0.001)
        assertEquals(0.0, moving.budget.stoppedSeconds, 0.001)
    }

    @Test fun pauseEventsArePausedNotStopped() {
        // 60 s laufen, 60 s Pause (keine Samples), 60 s laufen.
        val gps = track(List(60) { 3.0 }) + track(List(60) { 3.0 }, from = 120)
        val end = start + 180_000L
        val pauses = listOf((start + 60_000L)..(start + 120_000L))
        val result = RunPhases.build(start, end, rows(gps, end, cuts = listOf(start + 60_000L, start + 120_000L)), pauses, List(36) { null })
        assertEquals(listOf(RunPhases.State.RUN, RunPhases.State.PAUSED, RunPhases.State.RUN), result.phases.map { it.state })
        assertEquals(60.0, result.budget.pausedSeconds, 0.001)
        assertEquals(120.0, result.budget.activeSeconds, 0.001)
        assertEquals(180.0, result.budget.elapsedSeconds, 0.001)
    }

    @Test fun fastestSustainedFiveMinutesNeedsAContinuousRun() {
        val speeds = List(400) { 3.0 }
        val end = start + speeds.size * 1000L
        val result = RunPhases.build(start, end, rows(track(speeds), end), emptyList(), List(80) { null })
        val pace = result.metrics.fastestSustained300sSecondsPerKm!!
        // 3 m/s = 5:33 /km; Anker-Rundung erlaubt ein paar Sekunden.
        assertTrue("pace $pace", pace in 320.0..345.0)
        assertEquals(400, result.metrics.longestRunSeconds)
    }

    @Test fun csvLeavesUnknownCellsEmptyAndOmitsPaceWhenNotMoving() {
        val speeds = List(60) { 3.0 } + List(60) { 0.0 }
        val end = start + 120_000L
        val result = RunPhases.build(start, end, rows(track(speeds), end), emptyList(), List(24) { null })
        val csv = RunPhases.csv(result.rows)
        val lines = csv.trim().lines()
        assertEquals("elapsed_s,distance_m,state,pace_s_km,speed_mps,heart_rate,cadence_spm,elevation_m,grade_pct,gps_accuracy_m,gps_covered_s", lines[0])
        assertEquals(25, lines.size)
        val running = lines[3].split(",")
        assertEquals("RUN", running[2]); assertTrue(running[3].toInt() in 300..360); assertEquals("", running[5])
        val standing = lines.last().split(",")
        assertEquals("STOPPED", standing[2]); assertEquals("", standing[3]); assertEquals("", standing[4])
    }

    @Test fun pauseIntervalsCloseOpenPausesAtTheEnd() {
        val events = listOf("start" to start, "pause" to start + 10_000L, "resume" to start + 20_000L, "interrupted" to start + 50_000L)
        val intervals = RunPhases.pauseIntervals(events, start + 60_000L)
        assertEquals(listOf((start + 10_000L)..(start + 20_000L), (start + 50_000L)..(start + 60_000L)), intervals)
    }

    @Test fun regressionRunWalkSessionWithTrailingIdle() {
        // Nachbau des Beispiel-Laufs: 4,36 km Run/Walk in ~37 min, danach 13 min
        // mit laufender Aufzeichnung im Stand (Uhr nicht gestoppt).
        val pattern = List(6) { List(240) { 3.0 } + List(130) { 1.4 } }.flatten() + List(780) { 0.0 }
        val end = start + pattern.size * 1000L
        val gps = track(pattern)
        val result = RunPhases.build(start, end, rows(gps, end), emptyList(), RunPhases.stillness(start, pattern.size / grid, accel(2220 until pattern.size, still = true)))
        val budget = result.budget
        assertEquals(budget.elapsedSeconds, budget.pausedSeconds + budget.runningSeconds + budget.walkingSeconds + budget.stoppedSeconds + budget.unknownSeconds, 0.001)
        assertTrue("trailing ${result.metrics.trailingIdleSeconds}", result.metrics.trailingIdleSeconds >= 600)
        assertTrue("moving ${budget.movingSeconds}", budget.movingSeconds in 2100.0..2300.0)
        assertTrue("running ${budget.runningSeconds}", budget.runningSeconds in 1380.0..1500.0)
        assertEquals(11, result.metrics.runWalkTransitions)
        assertTrue(result.phases.none { it.state == RunPhases.State.UNKNOWN })
    }
}
