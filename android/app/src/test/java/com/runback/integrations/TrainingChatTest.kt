package com.runback.integrations

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TrainingChatTest {
    private var stored: JSONObject? = null
    private var profile = JSONObject()
    private var run = JSONObject()
    private fun chat(reply: (JSONArray, JSONArray?, Boolean) -> JSONObject) = TrainingChat(
        { stored }, { stored = it }, { profile }, { _, _ -> JSONArray().put(run) },
        { run }, reply, { "openrouter/free" },
    )
    private fun answer(text: String) = JSONObject().put("content", text).put("role", "assistant")
    private fun call(name: String, args: JSONObject = JSONObject()) = JSONObject().put("role", "assistant")
        .put("tool_calls", JSONArray().put(JSONObject().put("id", "test-call").put("type", "function")
            .put("function", JSONObject().put("name", name).put("arguments", args.toString()))))

    @Test fun plainChatHasNoToolsAndDoesNotCarryTrainingHistory() {
        stored = JSONObject().put("includeTraining", true).put("messages", JSONArray()
            .put(JSONObject().put("role", "assistant").put("content", "PRIVATE OLD TRAINING")))
        val result = chat { messages, tools, _ ->
            assertNull(tools)
            assertFalse(messages.toString().contains("PRIVATE OLD TRAINING"))
            answer("Hallo")
        }.send("Hallo", false)
        assertEquals(2, result.getJSONArray("messages").length())
        assertFalse(result.getBoolean("includeTraining"))
    }

    @Test fun toolProjectionExcludesCoordinatesRawSamplesAndUnknownFields() {
        run = JSONObject().put("id", "run-1").put("distanceMeters", 6000)
            .put("geometry", JSONArray().put(JSONObject().put("latitude", 52)))
            .put("rawSamples", "SECRET_RAW").put("apiKey", "SECRET_KEY")
            .put("feedback", JSONObject().put("note", "Müde Beine").put("latitude", 51))
        var round = 0
        val result = chat { messages, tools, _ ->
            assertNotNull(tools)
            if (round++ == 0) call("read_run", JSONObject().put("id", "run-1"))
            else {
                val data = JSONObject(messages.getJSONObject(messages.length() - 1).getString("content"))
                assertEquals(6000, data.getInt("distanceMeters"))
                assertEquals("Müde Beine", data.getJSONObject("feedback").getString("note"))
                assertFalse(data.toString().contains("latitude"))
                assertFalse(data.toString().contains("SECRET"))
                answer("Dein Lauf war 6 km lang.")
            }
        }.send("Wie war mein Lauf?", true)
        assertEquals(2, result.getJSONArray("messages").length())
        assertFalse(result.toString().contains("tool_calls"))
    }

    @Test fun failedRequestKeepsPreviousConversationIntact() {
        stored = JSONObject().put("messages", JSONArray())
        val before = stored.toString()
        try { chat { _, _, _ -> error("offline") }.send("Hallo", true); fail("Must fail") }
        catch (_: IllegalStateException) { assertEquals(before, stored.toString()) }
    }

    @Test fun unknownToolCannotModifyData() {
        var round = 0
        chat { messages, _, _ ->
            if (round++ == 0) call("delete_all_data") else {
                assertTrue(messages.getJSONObject(messages.length() - 1).getString("content").contains("error"))
                answer("Ich kann keine Daten löschen.")
            }
        }.send("Lösche Daten", true)
        assertEquals(2, round)
    }

    @Test fun clearingDataDuringRequestPreventsHistoryResurrection() {
        lateinit var client: TrainingChat
        client = chat { _, _, _ -> client.resetData { stored = null }; answer("Stale") }
        try { client.send("Hallo", true); fail("Must fail") }
        catch (_: IllegalStateException) { assertNull(stored) }
    }

    @Test fun trainingAccessChoiceSurvivesEmptyConversationAndClear() {
        val client = chat { _, _, _ -> answer("Hallo") }
        client.clear(false)
        assertFalse(client.history().getBoolean("includeTraining"))
        client.clear()
        assertFalse(client.history().getBoolean("includeTraining"))
    }
}
