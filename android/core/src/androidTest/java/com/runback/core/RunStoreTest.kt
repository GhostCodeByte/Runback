package com.runback.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

@RunWith(AndroidJUnit4::class)
class RunStoreTest {
    private lateinit var store: RunStore

    @Before
    fun setUp() {
        store = RunStore(ApplicationProvider.getApplicationContext<Context>())
        store.active()?.let { store.finish() }
        store.clearAllData()
    }

    @After
    fun tearDown() {
        store.active()?.let { store.finish() }
        store.clearAllData()
    }

    @Test
    fun lifecycleStatusAndDurationAreMonotonic() {
        val started = store.start("easy", "test")
        assertEquals("recording", started.getString("status"))
        assertTrue(started.getLong("elapsedMs") >= 0)

        val paused = store.pause()!!
        assertEquals("paused", paused.getString("status"))
        assertTrue(paused.getLong("elapsedMs") >= started.getLong("elapsedMs"))

        val resumed = store.resume()!!
        assertEquals("recording", resumed.getString("status"))
        assertTrue(resumed.getLong("elapsedMs") >= paused.getLong("elapsedMs"))

        val finished = store.finish()!!
        assertEquals("completed", finished.getString("status"))
        assertTrue(finished.getLong("elapsedMs") >= resumed.getLong("elapsedMs"))
        assertNull(store.active())
        assertNull(store.finish())
    }

    @Test
    fun rawGpsIsRetainedWhileUnacceptableJumpIsExcludedFromDistance() {
        val id = store.start().getString("id")
        val first = JSONObject().put("latitude", 52.0).put("longitude", 13.0)
            .put("accuracyM", 5.0).put("opaque", "kept")
        val nearby = JSONObject().put("latitude", 52.0001).put("longitude", 13.0).put("accuracyM", 5.0)
        val jump = JSONObject().put("latitude", 53.0).put("longitude", 13.0).put("accuracyM", 5.0)
        store.appendSamples(id, listOf(
            RawSample(1_000, "gps", first),
            RawSample(2_000, "gps", nearby),
            RawSample(3_000, "gps", jump),
        ))

        val raw = store.rawSamples(id)
        assertEquals(3, raw.length())
        assertEquals("kept", raw.getJSONObject(0).getJSONObject("values").getString("opaque"))
        val detail = store.detail(id)
        assertTrue(detail.getDouble("distanceM") > 1.0)
        assertTrue(detail.getDouble("distanceM") < 100.0)
        assertEquals(1, detail.getInt("gapCount"))
        assertEquals(3, detail.getInt("rawSampleCount"))
    }

    @Test
    fun importDeduplicatesAndDeletedRunBecomesTombstone() {
        val start = System.currentTimeMillis() - 120_000
        val summary = JSONObject().put("startTime", start).put("durationSeconds", 42.0)
            .put("purpose", "imported")
        val samples = JSONArray()
        val imported = store.addImportedRun(summary, samples, "source-hash")
        assertEquals("imported", imported.getString("status"))
        val duplicate = store.addImportedRun(summary, samples, "source-hash")
        assertEquals("duplicate", duplicate.getString("status"))
        assertEquals(imported.getString("id"), duplicate.getString("id"))

        store.deleteRun(imported.getString("id"))
        assertEquals(0, store.listRuns().length())
        val deleted = store.addImportedRun(summary, samples, "source-hash")
        assertEquals("deleted", deleted.getString("status"))
    }

    @Test
    fun summaryImportRejectsInvalidDurationAndDistanceBeforePersisting() {
        val start = System.currentTimeMillis() - 120_000
        val invalidDuration = JSONObject().put("startTime", start).put("durationSeconds", -1.0)
            .put("distanceMeters", 1000.0)
        try {
            store.addSummaryRun(invalidDuration, "invalid-duration")
            fail("negative duration should be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }

        val invalidDistance = JSONObject().put("startTime", start + 60_000).put("durationSeconds", 30.0)
            .put("distanceMeters", -1.0)
        try {
            store.addSummaryRun(invalidDistance, "invalid-distance")
            fail("negative distance should be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }

        assertEquals(0, store.listRuns().length())
    }

    @Test
    fun backupRestoreKeepsSettingsFeedbackAndRawSamples() {
        val id = store.start("training", "test").getString("id")
        store.appendSamples(id, listOf(RawSample(1_000, "heartRate", JSONObject().put("bpm", 155))))
        store.saveSettings(JSONObject().put("rawBudgetMb", 99).put("weatherEnabled", true))
        store.saveFeedback(id, JSONObject().put("purpose", "race").put("note", "good"))
        store.finish()
        val backup = ByteArrayOutputStream().also { store.backup(it) }.toByteArray()

        store.clearAllData()
        val restored = store.restore(ByteArrayInputStream(backup))
        assertTrue(restored.getBoolean("restored"))
        assertEquals(1, store.listRuns().length())
        assertEquals(99, store.settings().getInt("rawBudgetMb"))
        val run = store.listRuns().getJSONObject(0)
        assertEquals("race", run.getString("purpose"))
        assertEquals("good", run.getJSONObject("feedback").getString("note"))
        assertEquals(1, store.rawSamples(run.getString("id")).length())
    }

    @Test
    fun relatedDocumentWritesRollBackTogether() {
        try {
            store.updateDocumentsAtomically(
                puts = mapOf(
                    "written-before-failure" to JSONObject().put("value", 1),
                    "x".repeat(201) to JSONObject()
                )
            )
            fail("oversized document key should be rejected")
        } catch (_: IllegalArgumentException) {
            // The transaction must roll back the preceding document write too.
        }
        assertNull(store.getDocument("written-before-failure"))
    }

    @Test
    fun strengthFinishAndDeleteKeepIndexAndPayloadConsistent() {
        val session = JSONObject().put("id", "strength-1").put("startedAt", 100L)
        val summary = JSONObject().put("id", "strength-1").put("at", 200L)
        store.putDocument("strength_active", session)

        store.finishStrengthSession(session, summary)
        assertEquals(session.toString(), store.getDocument("strength_session_strength-1").toString())
        assertEquals(1, store.getDocument("strength_index")!!.getJSONArray("sessions").length())
        assertNull(store.getDocument("strength_active"))

        store.deleteStrengthSession("strength-1")
        assertNull(store.getDocument("strength_session_strength-1"))
        assertEquals(0, store.getDocument("strength_index")!!.getJSONArray("sessions").length())
    }

    @Test
    fun strengthFinishRollsBackPayloadWhenIndexWriteFails() {
        val oldSession = JSONObject().put("id", "old")
        val oldSummary = JSONObject().put("id", "old").put("at", 1L)
        store.finishStrengthSession(oldSession, oldSummary)

        val oversizedId = "x".repeat(193)
        try {
            store.finishStrengthSession(JSONObject().put("id", oversizedId), JSONObject().put("id", oversizedId))
            fail("oversized strength key should be rejected")
        } catch (_: IllegalArgumentException) {
            // The session payload and index must remain unchanged.
        }
        assertNull(store.getDocument("strength_session_$oversizedId"))
        val sessions = store.getDocument("strength_index")!!.getJSONArray("sessions")
        assertEquals(1, sessions.length())
        assertEquals("old", sessions.getJSONObject(0).getString("id"))
    }

    @Test
    fun corruptRestoreRollsBackExistingData() {
        val id = store.start().getString("id")
        store.finish()
        val corrupt = ByteArrayOutputStream()
        ZipOutputStream(corrupt).use { zip ->
            zip.putNextEntry(ZipEntry("manifest.json"))
            zip.write(JSONObject().put("schemaVersion", 1).put("app", "Runback").toString().toByteArray())
            zip.closeEntry()
            val tables = listOf("runs", "samples", "events", "documents", "hashes", "tombstones", "sources")
            tables.forEach { table ->
                zip.putNextEntry(ZipEntry("$table.ndjson"))
                if (table == "runs") zip.write("{malformed\n".toByteArray())
                zip.closeEntry()
            }
        }

        try {
            store.restore(ByteArrayInputStream(corrupt.toByteArray()))
            fail("corrupt archive should be rejected")
        } catch (_: org.json.JSONException) {
            // Expected: the transaction must restore the pre-existing rows.
        }
        assertNotNull(store.detail(id))
        assertEquals(1, store.listRuns().length())
    }
}
