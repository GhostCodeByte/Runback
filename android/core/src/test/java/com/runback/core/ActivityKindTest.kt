package com.runback.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ActivityKindTest {
    @Test fun fitSportMapsToKinds() {
        assertEquals(ActivityKind.RUN, ActivityKind.fromFitSport("RUNNING"))
        assertEquals(ActivityKind.HIKE, ActivityKind.fromFitSport("HIKING"))
        assertEquals(ActivityKind.WALK, ActivityKind.fromFitSport("WALKING"))
        assertEquals(ActivityKind.RIDE, ActivityKind.fromFitSport("CYCLING"))
        assertEquals(ActivityKind.RIDE, ActivityKind.fromFitSport("E_BIKING"))
        assertEquals(ActivityKind.SWIM, ActivityKind.fromFitSport("SWIMMING"))
        assertEquals(ActivityKind.OTHER, ActivityKind.fromFitSport("ALPINE_SKIING"))
        assertEquals(ActivityKind.UNKNOWN, ActivityKind.fromFitSport("GENERIC"))
        assertEquals(ActivityKind.UNKNOWN, ActivityKind.fromFitSport(null))
    }

    @Test fun tcxSportMapsToKinds() {
        assertEquals(ActivityKind.RUN, ActivityKind.fromTcxSport("Running"))
        assertEquals(ActivityKind.RIDE, ActivityKind.fromTcxSport("Biking"))
        assertEquals(ActivityKind.OTHER, ActivityKind.fromTcxSport("Other"))
        assertEquals(ActivityKind.UNKNOWN, ActivityKind.fromTcxSport(null))
    }

    @Test fun gpxTypeToleratesVendorSpellings() {
        assertEquals(ActivityKind.RUN, ActivityKind.fromGpxType("running"))
        assertEquals(ActivityKind.RUN, ActivityKind.fromGpxType("Jogging"))
        assertEquals(ActivityKind.HIKE, ActivityKind.fromGpxType("Hiking"))
        assertEquals(ActivityKind.WALK, ActivityKind.fromGpxType("Walking"))
        assertEquals(ActivityKind.RIDE, ActivityKind.fromGpxType("Mountain Biking"))
        assertEquals(ActivityKind.SWIM, ActivityKind.fromGpxType("swim"))
        assertEquals(ActivityKind.OTHER, ActivityKind.fromGpxType("Yoga"))
        assertEquals(ActivityKind.UNKNOWN, ActivityKind.fromGpxType(null))
        assertEquals(ActivityKind.UNKNOWN, ActivityKind.fromGpxType("  "))
    }

    @Test fun stravaTypeMapsToKinds() {
        assertEquals(ActivityKind.RUN, ActivityKind.fromStravaType("Run"))
        assertEquals(ActivityKind.RUN, ActivityKind.fromStravaType("Trail Run"))
        assertEquals(ActivityKind.HIKE, ActivityKind.fromStravaType("Hike"))
        assertEquals(ActivityKind.WALK, ActivityKind.fromStravaType("Walk"))
        assertEquals(ActivityKind.RIDE, ActivityKind.fromStravaType("EBikeRide"))
        assertEquals(ActivityKind.SWIM, ActivityKind.fromStravaType("Swim"))
        assertEquals(ActivityKind.OTHER, ActivityKind.fromStravaType("WeightTraining"))
        assertEquals(ActivityKind.UNKNOWN, ActivityKind.fromStravaType(null))
    }

    @Test fun csvIndexMatchesFilenamesAndIds() {
        val csv = "Activity ID,Activity Date,Activity Name,Activity Type,Filename\n" +
            "12345,2026-01-01,\"Abend,runde\",Hike,activities/12345.gpx\n" +
            "67890,2026-01-02,Morgenlauf,Run, activities/morning.fit \n"
        val index = ActivityKind.parseActivitiesCsv(csv)
        assertEquals("Hike", ActivityKind.lookupCsv(index, "activities/12345.gpx")?.type)
        assertEquals("Abend,runde", ActivityKind.lookupCsv(index, "12345.gpx")?.name)
        assertEquals("Run", ActivityKind.lookupCsv(index, "morning.fit.gz")?.type)
        assertEquals("Run", ActivityKind.lookupCsv(index, "67890")?.type)
        assertNull(ActivityKind.lookupCsv(index, "unrelated.tcx"))
    }

    @Test fun csvWithoutTypeColumnStaysEmpty() {
        val index = ActivityKind.parseActivitiesCsv("Foo,Bar\n1,x\n")
        assertEquals(0, index.size)
    }

    @Test fun csvRoundTripPreservesEntries() {
        val index = ActivityKind.parseActivitiesCsv(
            "Activity ID,Activity Name,Activity Type\n42,Bergtour,Hike\n",
        )
        val restored = ActivityKind.fromJson(ActivityKind.toJson(index))
        assertEquals("Hike", restored["42"]?.type)
        assertEquals("Bergtour", restored["42"]?.name)
    }
}
