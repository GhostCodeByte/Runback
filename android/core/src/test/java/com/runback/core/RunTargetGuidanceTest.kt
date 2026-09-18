package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunTargetGuidanceTest {
    private fun pace(mode: String = "range") = RunTargetGuidance.pace(330.0, mode)

    @Test fun outputSelectionRemainsExplicit() {
        assertTrue(RunTargetGuidance.pace(330.0, "range", "both").wantsVoice())
        assertTrue(RunTargetGuidance.pace(330.0, "range", "both").wantsVibration())
        assertFalse(RunTargetGuidance.pace(330.0, "range", "voice").wantsVibration())
    }

    @Test fun paceNeedsAStableQualifiedExcursion() {
        val guidance = pace()
        var cue: TargetCue? = null
        // Rund 4:38 /km: klar schneller als 5:30, aber erst nach Fenster,
        // Einlaufphase und 30 Sekunden stabiler Abweichung folgt ein Hinweis.
        for (second in 0..150) {
            cue = guidance.onLocation(
                time = second * 1_000L + 1,
                latitude = 52.0 + second * 0.000036,
                longitude = 13.0,
                accuracy = 5.0,
                elapsedMs = second * 1_000L,
            ) ?: cue
        }
        assertEquals("pace_too_fast", cue?.code)
        assertFalse(cue!!.faster)
    }

    @Test fun ceilingNeverPushesAnEasyRunFaster() {
        val guidance = pace("ceiling")
        var cue: TargetCue? = null
        // Rund 9:15 /km ist langsamer als das Ziel, aber eine Obergrenze
        // fordert absichtlich kein höheres Tempo.
        for (second in 0..240) {
            cue = guidance.onLocation(
                time = second * 1_000L + 1,
                latitude = 52.0 + second * 0.000018,
                longitude = 13.0,
                accuracy = 5.0,
                elapsedMs = second * 1_000L,
            ) ?: cue
        }
        assertNull(cue)
    }

    @Test fun heartRateUsesFreshMedianAndGracePeriod() {
        val guidance = RunTargetGuidance.heartRate(130.0, 150.0, "voice")
        val base = 1_000_000L
        assertNull(guidance.onHeartRates(base, 100_000, listOf(HeartSample(base, 170.0))))
        var cue: TargetCue? = null
        for (second in 180..215) {
            val now = base + second * 1_000L
            cue = guidance.onHeartRates(now, second * 1_000L, (0..4).map { HeartSample(now - it * 1_000L, 160.0) }) ?: cue
        }
        assertEquals("heart_rate_high", cue?.code)
        assertNull(guidance.onHeartRates(base + 300_000, 300_000, listOf(HeartSample(base, 190.0))))
    }

    @Test fun missingHeartSamplesBreakTheContinuousExcursion() {
        val guidance = RunTargetGuidance.heartRate(130.0, 150.0)
        val base = 2_000_000L
        fun high(second: Int) = (0..4).map { HeartSample(base + second * 1_000L - it * 1_000L, 160.0) }
        for (second in 180..200) {
            assertNull(guidance.onHeartRates(base + second * 1_000L, second * 1_000L, high(second)))
        }
        assertNull(guidance.onHeartRates(base + 201_000L, 201_000L, emptyList()))
        var cue: TargetCue? = null
        for (second in 202..232) {
            cue = guidance.onHeartRates(base + second * 1_000L, second * 1_000L, high(second)) ?: cue
        }
        assertEquals("heart_rate_high", cue?.code)
    }
}
