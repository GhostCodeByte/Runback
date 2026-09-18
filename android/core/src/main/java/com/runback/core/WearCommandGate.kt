package com.runback.core

import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest

/** Rejects delayed commands while allowing the same command through both transports once. */
object WearCommandGate {
    enum class Decision { ACCEPT, DUPLICATE, STALE, INVALID, WAIT }

    private const val PERMIT_KEY = "wearRemotePermits"
    private const val PERMIT_TTL_MS = 15_000L
    // The handler waits at most five seconds, but a cold foreground service can take longer
    // to publish its state. Keep a live claim long enough to avoid a second pause/finish.
    private const val CLAIM_TTL_MS = 30_000L

    /** MessageClient issues this short-lived permit before the matching remote Activity arrives. */
    fun issuePermit(
        store: DocumentStore,
        action: String,
        runId: String,
        commandId: String?,
        sequence: Long,
        purpose: String,
        sport: String,
        routePlanId: String?,
        target: String?,
        nodeId: String,
    ) {
        if (commandId.isNullOrBlank() || sequence <= 0L) return
        synchronized(this) {
            val now = System.currentTimeMillis()
            val permits = JSONArray()
            val current = store.getDocument(PERMIT_KEY)?.optJSONArray("items")
            if (current != null) {
                for (index in 0 until current.length()) {
                    val permit = current.optJSONObject(index) ?: continue
                    if (permit.optLong("expiresAt") >= now) permits.put(permit)
                }
            }
            permits.put(JSONObject()
                .put("action", action)
                .put("runId", runId)
                .put("commandId", commandId)
                .put("sequence", sequence)
                .put("fingerprint", fingerprint(action, purpose, sport, routePlanId, target))
                .put("nodeId", nodeId)
                .put("expiresAt", now + PERMIT_TTL_MS))
            while (permits.length() > 16) permits.remove(0)
            store.putDocument(PERMIT_KEY, JSONObject().put("items", permits))
        }
    }

    fun hasPermit(
        store: DocumentStore,
        action: String,
        runId: String,
        commandId: String?,
        sequence: Long,
        purpose: String,
        sport: String,
        routePlanId: String?,
        target: String?,
        nodeId: String?,
    ): Boolean {
        if (commandId.isNullOrBlank() || sequence <= 0L || nodeId.isNullOrBlank()) return false
        synchronized(this) {
            val permits = store.getDocument(PERMIT_KEY)?.optJSONArray("items") ?: return false
            val now = System.currentTimeMillis()
            for (index in 0 until permits.length()) {
                val permit = permits.optJSONObject(index) ?: continue
                if (permit.optString("action") == action &&
                    permit.optString("runId") == runId &&
                    permit.optString("commandId") == commandId &&
                    permit.optLong("sequence") == sequence &&
                    permit.optString("fingerprint") == fingerprint(action, purpose, sport, routePlanId, target) &&
                    permit.optString("nodeId") == nodeId &&
                    permit.optLong("expiresAt") >= now
                ) return true
            }
            return false
        }
    }

    /** Claim is serialized so RemoteActivityHelper and MessageClient cannot both execute a command. */
    fun claim(store: DocumentStore, runId: String, commandId: String?, sequence: Long): Decision {
        if (commandId.isNullOrBlank() || sequence <= 0L) return Decision.INVALID
        synchronized(this) {
            val key = "wearCommand_$runId"
            val previous = store.getDocument(key)
            val previousSequence = previous?.optLong("sequence", 0L) ?: 0L
            val previousId = previous?.optString("commandId")
            val now = System.currentTimeMillis()
            if (previous != null && sequence > previousSequence && previous.optString("state") == "in_flight" &&
                now - previous.optLong("claimedAt", 0L) < CLAIM_TTL_MS
            ) return Decision.WAIT
            if (sequence < previousSequence) return Decision.STALE
            if (sequence == previousSequence && previousId == commandId) {
                val state = previous?.optString("state")
                val claimedAt = previous?.optLong("claimedAt", 0L) ?: 0L
                if (state == "applied" || (state == "in_flight" && now - claimedAt < CLAIM_TTL_MS)) return Decision.DUPLICATE
                store.putDocument(key, JSONObject(previous.toString()).put("state", "in_flight").put("claimedAt", now))
                return Decision.ACCEPT
            }
            if (sequence == previousSequence) return Decision.STALE
            store.putDocument(key, JSONObject()
                .put("commandId", commandId)
                .put("sequence", sequence)
                .put("state", "in_flight")
                .put("claimedAt", now))
            return Decision.ACCEPT
        }
    }

    fun markApplied(store: DocumentStore, runId: String, commandId: String?, sequence: Long) {
        if (commandId.isNullOrBlank() || sequence <= 0L) return
        synchronized(this) {
            val key = "wearCommand_$runId"
            val current = store.getDocument(key) ?: return
            if (current.optString("commandId") == commandId && current.optLong("sequence") == sequence) {
                store.putDocument(key, JSONObject(current.toString()).put("state", "applied").put("appliedAt", System.currentTimeMillis()))
            }
        }
    }

    fun release(store: DocumentStore, runId: String, commandId: String?, sequence: Long) {
        if (commandId.isNullOrBlank() || sequence <= 0L) return
        synchronized(this) {
            val key = "wearCommand_$runId"
            val current = store.getDocument(key) ?: return
            if (current.optString("commandId") == commandId && current.optLong("sequence") == sequence &&
                current.optString("state") == "in_flight"
            ) store.putDocument(key, JSONObject(current.toString()).put("state", "released").put("claimedAt", 0L))
        }
    }

    private fun fingerprint(action: String, purpose: String, sport: String, routePlanId: String?, target: String?): String {
        val input = listOf(action, purpose, sport, routePlanId.orEmpty(), target.orEmpty()).joinToString("\u0000")
        return MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
