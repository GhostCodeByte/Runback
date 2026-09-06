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
}
