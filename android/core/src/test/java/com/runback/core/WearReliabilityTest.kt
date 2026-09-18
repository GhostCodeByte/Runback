package com.runback.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearReliabilityTest {
    @Test fun outboxKeepsFifoHeadWhenRetryUpsertsIt() {
        val store = MemoryDocumentStore()
        val first = command("run-1", "cmd-a", 1)
        val second = command("run-1", "cmd-b", 2)

        WearControlOutbox.enqueue(store, first)
        WearControlOutbox.enqueue(store, second)
        WearControlOutbox.enqueue(store, first.put("updatedAt", 3L))

        assertEquals("cmd-a", WearControlOutbox.heads(store).single().optString("commandId"))
        assertTrue(WearControlOutbox.remove(store, "run-1", "pause", "cmd-a", 1L))
        assertEquals("cmd-b", WearControlOutbox.heads(store).single().optString("commandId"))
    }

    @Test fun commandGateBindsPermitAndRetainsSequenceAfterRelease() {
        val store = MemoryDocumentStore()
        WearCommandGate.issuePermit(
            store,
            "pause",
            "run-1",
            "cmd-a",
            1L,
            "easy",
            "running",
            null,
            null,
            "node-a",
        )

        assertTrue(WearCommandGate.hasPermit(store, "pause", "run-1", "cmd-a", 1L, "easy", "running", null, null, "node-a"))
        assertFalse(WearCommandGate.hasPermit(store, "pause", "run-1", "cmd-a", 1L, "easy", "running", null, null, "node-b"))
        assertFalse(WearCommandGate.hasPermit(store, "pause", "run-1", "cmd-a", 1L, "quality", "running", null, null, "node-a"))

        assertEquals(WearCommandGate.Decision.ACCEPT, WearCommandGate.claim(store, "run-1", "cmd-a", 1L))
        assertEquals(WearCommandGate.Decision.WAIT, WearCommandGate.claim(store, "run-1", "cmd-b", 2L))
        WearCommandGate.release(store, "run-1", "cmd-a", 1L)
        assertEquals(WearCommandGate.Decision.ACCEPT, WearCommandGate.claim(store, "run-1", "cmd-a", 1L))
        WearCommandGate.markApplied(store, "run-1", "cmd-a", 1L)
        assertEquals(WearCommandGate.Decision.DUPLICATE, WearCommandGate.claim(store, "run-1", "cmd-a", 1L))
    }

    private fun command(runId: String, commandId: String, sequence: Long): JSONObject = JSONObject()
        .put("action", "pause")
        .put("runId", runId)
        .put("commandId", commandId)
        .put("sequence", sequence)
        .put("updatedAt", sequence)

    private class MemoryDocumentStore : DocumentStore {
        private val documents = HashMap<String, JSONObject>()
        override fun getDocument(key: String): JSONObject? = documents[key]?.let { JSONObject(it.toString()) }
        override fun putDocument(key: String, value: JSONObject) { documents[key] = JSONObject(value.toString()) }
        override fun deleteDocument(key: String) { documents.remove(key) }
    }
}
