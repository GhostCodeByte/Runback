package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/** Durable, bounded queue for commands whose MessageClient delivery is best effort. */
object WearControlOutbox {
    private const val KEY = "wearControlOutbox"
    private const val MAX_ITEMS = 64

    fun enqueue(store: DocumentStore, command: JSONObject) {
        require(command.optString("runId").isNotBlank()) { "Steuerbefehl ohne Laufkennung" }
        require(command.optString("action").isNotBlank()) { "Steuerbefehl ohne Aktion" }
        require(command.optString("commandId").isNotBlank()) { "Steuerbefehl ohne Befehlskennung" }
        require(command.optLong("sequence", 0L) > 0L) { "Steuerbefehl ohne Sequenz" }
        synchronized(this) {
            val items = read(store)
            val kept = JSONArray()
            var replaced = false
            items.forEach { existing ->
                if (existing.optString("commandId") == command.optString("commandId") &&
                    existing.optString("runId") == command.optString("runId")
                ) {
                    kept.put(JSONObject(command.toString()))
                    replaced = true
                } else kept.put(existing)
            }
            if (!replaced) {
                check(kept.length() < MAX_ITEMS) { "Steuerwarteschlange ist voll. Uhr zuerst verbinden." }
                kept.put(JSONObject(command.toString()))
            }
            store.putDocument(KEY, JSONObject().put("items", kept))
        }
    }

    fun pending(store: DocumentStore): List<JSONObject> = synchronized(this) {
        read(store).sortedWith(compareBy<JSONObject> { it.optLong("sequence", 0L) }
            .thenBy { it.optLong("updatedAt", 0L) })
    }

    /** Only the oldest command of each run may cross the transport boundary. */
    fun heads(store: DocumentStore): List<JSONObject> = synchronized(this) {
        val seenRuns = HashSet<String>()
        pending(store).filter { seenRuns.add(it.optString("runId")) }
    }

    fun isHead(store: DocumentStore, command: JSONObject): Boolean = synchronized(this) {
        heads(store).any {
            it.optString("runId") == command.optString("runId") &&
                it.optString("commandId") == command.optString("commandId") &&
                it.optLong("sequence", 0L) == command.optLong("sequence", 0L)
        }
    }

    fun remove(store: DocumentStore, runId: String, action: String, commandId: String, sequence: Long): Boolean {
        synchronized(this) {
            val items = read(store)
            val kept = JSONArray()
            var removed = false
            items.forEach { existing ->
                val matches = existing.optString("runId") == runId &&
                    existing.optString("action") == action &&
                    existing.optString("commandId") == commandId &&
                    existing.optLong("sequence", 0L) == sequence
                if (matches) removed = true else kept.put(existing)
            }
            if (kept.length() == 0) store.deleteDocument(KEY)
            else if (removed) store.putDocument(KEY, JSONObject().put("items", kept))
            return removed
        }
    }

    private fun read(store: DocumentStore): List<JSONObject> {
        val document = store.getDocument(KEY) ?: return emptyList()
        val items = document.optJSONArray("items")
        if (items == null) {
            // One-release compatibility with the original single-command object.
            return if (document.optString("runId").isNotBlank() &&
                document.optString("commandId").isNotBlank() && document.optLong("sequence", 0L) > 0L
            ) listOf(document) else emptyList()
        }
        return buildList(items.length()) {
            for (index in 0 until items.length()) items.optJSONObject(index)?.let { add(JSONObject(it.toString())) }
        }
    }

    private inline fun JSONArray.forEach(block: (JSONObject) -> Unit) {
        for (index in 0 until length()) optJSONObject(index)?.let(block)
    }
}
