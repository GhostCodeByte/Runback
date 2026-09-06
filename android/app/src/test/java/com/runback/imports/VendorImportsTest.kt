package com.runback.imports

import org.junit.Assert.*
import org.junit.Test

class VendorImportsTest {
    @Test fun strongCsvGroupsSetsIntoWorkouts() {
        val csv = "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n" +
            "2024-11-02 18:30:00,Friday-lower,01:00:00,Squat (Barbell),1,100,8,,,,,8\n" +
            "2024-11-02 18:30:00,Friday-lower,01:00:00,Squat (Barbell),2,100,8,,,,,8\n" +
            "2024-11-02 18:30:00,Friday-lower,01:00:00,Lunge (Dumbbell),1,50,8,,,,,\n"
        val parsed = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(1, parsed.workouts.size)
        assertEquals(3, parsed.setsByWorkout.values.first().size)
        assertEquals("Squat (Barbell)", parsed.setsByWorkout.values.first().first().exercise)
        assertEquals(100.0, parsed.setsByWorkout.values.first().first().weight)
    }

    @Test fun strongHeaderDetection() {
        assertTrue(VendorImports.isStrongHeader(listOf("Date", "Workout Name", "Exercise Name", "Set Order", "Weight", "Reps")))
        assertFalse(VendorImports.isStrongHeader(listOf("Activity ID", "Name", "Distance")))
    }

    @Test fun semicolonStrongCsvPreservesDecimalComma() {
        val csv = "Date;Workout Name;Exercise Name;Set Order;Weight;Reps\n" +
            "2024-11-02 18:30:00;Friday;Squat;1;100,5;8\n"
        val parsed = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(100.5, parsed.setsByWorkout.values.first().first().weight!!, 0.01)
    }

    @Test fun appleRunningWorkoutDetection() {
        assertTrue(VendorImports.isAppleRunningWorkout("HKWorkoutActivityTypeRunning"))
        assertTrue(VendorImports.isAppleRunningWorkout("HKWorkoutActivityTypeTrackAndField"))
        assertFalse(VendorImports.isAppleRunningWorkout("HKWorkoutActivityTypeCycling"))
    }

    @Test fun appleRecordMappingSkipsIntradayHeartRate() {
        assertEquals("resting_hr", VendorImports.mapAppleRecordType("HKQuantityTypeIdentifierRestingHeartRate"))
        assertEquals("hrv_sdnn", VendorImports.mapAppleRecordType("HKQuantityTypeIdentifierHeartRateVariabilitySDNN"))
        assertEquals("sleep_stage", VendorImports.mapAppleRecordType("HKCategoryTypeIdentifierSleepAnalysis"))
        assertNull(VendorImports.mapAppleRecordType("HKQuantityTypeIdentifierHeartRate"))
    }

    @Test fun samsungSleepStages() {
        assertEquals("awake", VendorImports.mapSamsungSleepStage("40001"))
        assertEquals("light", VendorImports.mapSamsungSleepStage("40002"))
        assertEquals("deep", VendorImports.mapSamsungSleepStage("40003"))
        assertEquals("rem", VendorImports.mapSamsungSleepStage("40004"))
    }

    @Test fun genericActivitiesCsvParsesRunningRows() {
        val csv = "Activity ID,Name,Type,Date,Distance,Elapsed,Avg HR\n" +
            "1,Morning Run,Run,2024-05-01 07:00:00,5.2,1800,150\n" +
            "2,Evening Ride,Ride,2024-05-02 18:00:00,20,3600,130\n"
        val parsed = VendorImports.parseActivitiesCsv(csv, "strava")
        assertEquals(1, parsed.runs.size)
        assertEquals(5200.0, parsed.runs.first().distanceMeters, 1.0)
        assertEquals(150.0, parsed.runs.first().avgHeartRate!!, 0.1)
    }

    @Test fun vendorDetection() {
        assertEquals(VendorImports.Vendor.APPLE_HEALTH, VendorImports.detectVendor("export.xml"))
        assertEquals(VendorImports.Vendor.STRONG, VendorImports.detectVendor("strong.csv"))
        assertEquals(VendorImports.Vendor.SAMSUNG, VendorImports.detectVendor("com.samsung.shealth.exercise.20240101.csv"))
        assertEquals(VendorImports.Vendor.FITBIT, VendorImports.detectVendor("heart_rate-2024-03-15.json"))
        assertEquals(VendorImports.Vendor.GARMIN, VendorImports.detectVendor("summarizedActivities.json"))
    }

    @Test fun flexibleTimeParsing() {
        assertNotNull(VendorImports.parseTimeFlexible("2024-11-02 18:30:00"))
        assertNotNull(VendorImports.parseTimeFlexible("2024-11-02T18:30:00.000Z"))
        assertNotNull(VendorImports.parseTimeFlexible("1700000000000"))
        assertNull(VendorImports.parseTimeFlexible("kein Datum"))
    }

    @Test fun durationParsing() {
        assertEquals(3720.0, VendorImports.parseDurationFlexible("01:02:00")!!, 0.1)
        assertEquals(90.0, VendorImports.parseDurationFlexible("1:30")!!, 0.1)
        assertEquals(3600.0, VendorImports.parseDurationFlexible("1h")!!, 0.1)
    }

    @Test fun semicolonCsvKeepsQuotedCommasInFields() {
        assertEquals(
            listOf("2024-05-01", "Run", "Run, morning", "5"),
            VendorImports.splitCsvLine("2024-05-01;Run;\"Run, morning\";5"),
        )
    }

    @Test fun genericActivitiesUsesDistanceHeaderUnits() {
        val csv = "Name,Type,Date,Distance (m),Elapsed\n" +
            "Track,Run,2024-05-01 07:00:00,500,60\n"
        val parsed = VendorImports.parseActivitiesCsv(csv, "generic")
        assertEquals(1, parsed.runs.size)
        assertEquals(500.0, parsed.runs.first().distanceMeters, 0.1)
    }

    @Test fun genericActivitiesConvertsMilesFromDistanceHeader() {
        val csv = "Name,Type,Date,Distance (miles),Elapsed\n" +
            "Road,Run,2024-05-01 07:00:00,5,3600\n"
        val parsed = VendorImports.parseActivitiesCsv(csv, "generic")
        assertEquals(1, parsed.runs.size)
        assertEquals(8046.72, parsed.runs.first().distanceMeters, 0.01)
    }

    @Test fun genericActivitiesSkipsNegativeDuration() {
        val csv = "Name,Type,Date,Distance,Elapsed\n" +
            "Bad,Run,2024-05-01 07:00:00,5,-60\n"
        val parsed = VendorImports.parseActivitiesCsv(csv, "generic")
        assertEquals(0, parsed.runs.size)
        assertEquals(1, parsed.skipped)
    }
}
