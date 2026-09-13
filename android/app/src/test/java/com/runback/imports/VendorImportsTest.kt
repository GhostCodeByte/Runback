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

    @Test fun runningActivityTypeDetection() {
        assertEquals(true, VendorImports.isRunningActivityType("Running"))
        assertEquals(true, VendorImports.isRunningActivityType("Trail Running"))
        assertEquals(true, VendorImports.isRunningActivityType("Waldlauf"))
        assertEquals(true, VendorImports.isRunningActivityType("treadmill_running"))
        assertEquals(false, VendorImports.isRunningActivityType("Walking"))
        assertEquals(false, VendorImports.isRunningActivityType("Nordic Walking"))
        assertEquals(false, VendorImports.isRunningActivityType("Ride"))
        assertEquals(false, VendorImports.isRunningActivityType("CYCLING"))
        assertEquals(false, VendorImports.isRunningActivityType("Radfahren"))
        assertNull(VendorImports.isRunningActivityType(""))
        assertNull(VendorImports.isRunningActivityType(null))
        assertNull(VendorImports.isRunningActivityType("Cardio"))
    }

    @Test fun unknownActivitiesFallBackToThePaceWindow() {
        // 5 km in 25 min -> Laufen.
        assertTrue(VendorImports.acceptAsRun(null, 5000.0, 1500.0))
        // 5 km in 60 min (12:00 min/km) -> Gehen.
        assertFalse(VendorImports.acceptAsRun(null, 5000.0, 3600.0))
        // 30 km in 60 min -> Radfahren.
        assertFalse(VendorImports.acceptAsRun("Cardio", 30000.0, 3600.0))
        // Ohne Distanz oder Dauer laesst sich kein Tempo bilden.
        assertTrue(VendorImports.acceptAsRun(null, 0.0, 3600.0))
    }

    @Test fun knownSportBeatsThePaceWindow() {
        assertTrue(VendorImports.acceptAsRun("Running", 5000.0, 3600.0))
        assertFalse(VendorImports.acceptAsRun("Walking", 5000.0, 1500.0))
    }

    @Test fun genericActivitiesCsvSkipsWalksAndRides() {
        val csv = "Activity ID,Name,Type,Date,Distance,Elapsed\n" +
            "1,Morning Run,Run,2024-05-01 07:00:00,5.2,1800\n" +
            "2,Abendspaziergang,Walk,2024-05-02 18:00:00,4,3600\n" +
            "3,Feierabendrunde,,2024-05-03 18:00:00,30,3600\n"
        val parsed = VendorImports.parseActivitiesCsv(csv, "strava")
        assertEquals(1, parsed.runs.size)
        assertEquals("Morning Run", parsed.runs.first().name)
        assertEquals(2, parsed.skipped)
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

    @Test fun stravaGermanCsvUsesTheActivityDateAndRichSummaryColumns() {
        val csv = "Aktivitäts-ID,Aktivitätsdatum,Name der Aktivität,Aktivitätsart," +
            "Verstrichene Zeit,Distanz,Max. Herzfrequenz," +
            "Verstrichene Zeit,Distanz,Höhenzunahme,Durchschnittliche Herzfrequenz,Kalorien\n" +
            "19404735112,\"21.07.2026, 15:09:27\",Lauf am Nachmittag,Lauf," +
            "1390,\"2,81\",190,1390,\"2,81\",0.0,148,299\n"
        val parsed = VendorImports.parseActivitiesCsv(csv, "strava")
        assertEquals(1, parsed.runs.size)
        val run = parsed.runs.first()
        assertEquals("Lauf am Nachmittag", run.name)
        assertEquals(2810.0, run.distanceMeters, 0.1)
        assertEquals(1390.0, run.durationSeconds, 0.1)
        assertEquals(148.0, run.avgHeartRate!!, 0.1)
        assertEquals(299.0, run.calories!!, 0.1)
        assertEquals("19404735112", run.sourceActivityId)
    }
    @Test fun stravaHeaderIsRecognizedEvenWithoutArchiveName() {
        assertTrue(VendorImports.isStravaActivitiesHeader(listOf(
            "Aktivitäts-ID", "Aktivitätsdatum", "Name der Aktivität", "Aktivitätsart")))
        assertFalse(VendorImports.isStravaActivitiesHeader(listOf("Date", "Name", "Type")))
    }

    @Test fun googleHealthExerciseJsonKeepsRichRunMetrics() {
        val json = """[
            {"logId":12345,"activityName":"Laufen","averageHeartRate":154,
             "calories":512,"distance":5.4,"distanceUnit":"Kilometer","duration":1800000,
             "elevationGain":38,"steps":6012,"startTime":"08/27/25 06:03:35",
             "pace":333,"speed":10.8,"activeZoneMinutes":{"totalMinutes":31}}
        ]""".trimIndent()
        val parsed = VendorImports.parseFitbitExerciseJson(json)
        assertEquals(1, parsed.runs.size)
        val run = parsed.runs.first()
        assertEquals(5400.0, run.distanceMeters, 0.1)
        assertEquals(1800.0, run.durationSeconds, 0.1)
        assertEquals(6012.0, run.steps!!, 0.1)
        assertEquals(38.0, run.elevationGainMeters!!, 0.1)
        assertEquals("12345", run.sourceActivityId)
        assertTrue(run.details!!.contains("activeZoneMinutes"))
    }

    @Test fun googleHealthExerciseCsvUsesExplicitMillimeterFields() {
        val csv = "exercise_id,exercise_start,exercise_end,activity_name,tracker_total_distance_mm," +
            "tracker_total_calories,tracker_total_steps,tracker_total_altitude_mm,tracker_avg_heart_rate\n" +
            "abc,2026-05-30 06:00:00+0000,2026-05-30 06:30:00+0000,Outdoor Run,5000000,300,4200,12000,149\n"
        val parsed = VendorImports.parseFitbitExerciseCsv(csv)
        assertEquals(1, parsed.runs.size)
        val run = parsed.runs.first()
        assertEquals(5000.0, run.distanceMeters, 0.1)
        assertEquals(1800.0, run.durationSeconds, 0.1)
        assertEquals(4200.0, run.steps!!, 0.1)
        assertEquals(12.0, run.elevationGainMeters!!, 0.1)
        assertEquals("abc", run.sourceActivityId)
    }

    @Test fun googleHealthAndStrongMeasurementFilesAreRecognized() {
        assertEquals(VendorImports.Vendor.FITBIT,
            VendorImports.detectVendor("exercise-0.json", "Takeout/Google Health/Global Export Data"))
        assertEquals("vo2max", VendorImports.fitbitFileKind("demographic_vo2_max-2025-08-23.json"))
        assertEquals("fitness_data", VendorImports.miFitnessFileKind("20260909_MiFitness_hlth_center_aggregated_fitness_data.csv"))
        assertEquals(VendorImports.Vendor.STRONG, VendorImports.detectVendor("weight.csv"))
        assertEquals("weight", VendorImports.strongMeasurementKind("weight.csv"))
        assertEquals("body_fat", VendorImports.strongMeasurementKind("body_fat_percentage.csv"))
        assertEquals("%", VendorImports.strongMeasurementUnit("body_fat"))
    }
}
