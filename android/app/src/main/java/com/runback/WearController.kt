package com.runback

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import com.runback.core.RawSample
import com.runback.core.RecordingService
import com.runback.core.WearControlOutbox
import com.runback.core.RunStore
import com.runback.core.WearProtocol
import androidx.wear.remote.interactions.RemoteActivityHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.UUID

/** Phone-side control and fallback GPS publishing for an active Wear recording. */
object WearController {
    private val publisher = Executors.newSingleThreadExecutor()
    private val retryScheduler = Executors.newSingleThreadScheduledExecutor()
    private val remoteActivityExecutor = Executors.newCachedThreadPool()
    private val sequenceLock = Any()
    private val retryLock = Any()
    private var retryScheduled = false

    fun sendCommand(
        context: Context,
        action: String,
        runId: String,
        purpose: String,
        sport: String,
        routePlanId: String? = null,
        target: String? = null,
        commandId: String? = null,
        sequence: Long? = null,
        allowRemoteActivity: Boolean = true,
    ): JSONObject {
        val store = RunStore(context)
        val resolvedCommandId = commandId ?: UUID.randomUUID().toString()
        val resolvedSequence = sequence ?: nextSequence(store)
        WearControlOutbox.enqueue(store, JSONObject()
            .put("action", action).put("runId", runId).put("purpose", purpose).put("sport", sport)
            .put("routePlanId", routePlanId ?: JSONObject.NULL).put("target", target ?: JSONObject.NULL)
            .put("commandId", resolvedCommandId).put("sequence", resolvedSequence)
            .put("updatedAt", System.currentTimeMillis()))
        if (!WearControlOutbox.isHead(store, JSONObject()
                .put("runId", runId).put("commandId", resolvedCommandId).put("sequence", resolvedSequence))) {
            scheduleRetry(context)
            return JSONObject()
                .put("status", "queued")
                .put("message", "Befehl wartet auf den vorherigen Aufzeichnungsbefehl")
                .put("action", action).put("runId", runId)
                .put("commandId", resolvedCommandId).put("sequence", resolvedSequence)
                .put("updatedAt", System.currentTimeMillis())
        }
        val nodes = runCatching { connectedNodes(context) }.getOrElse {
            scheduleRetry(context)
            return JSONObject()
                .put("status", "error")
                .put("message", "Wear-OS-Dienst ist nicht verfügbar")
                .put("updatedAt", System.currentTimeMillis())
        }
        if (nodes.isEmpty()) {
            scheduleRetry(context)
            return JSONObject()
                .put("status", "disconnected")
                .put("message", "Keine Uhr verbunden")
                .put("action", action).put("runId", runId)
                .put("commandId", resolvedCommandId).put("sequence", resolvedSequence)
                .put("updatedAt", System.currentTimeMillis())
        }
        var sent = 0
        val errors = JSONArray()
        val payload = WearProtocol.control(action, runId, purpose, sport, target, routePlanId, resolvedCommandId, resolvedSequence)
        val sourceNodeId = localNodeId(context)
        val remoteActivity = if (allowRemoteActivity) RemoteActivityHelper(context, remoteActivityExecutor) else null
        val remoteIntent = if (allowRemoteActivity) Intent(
            Intent.ACTION_VIEW,
            controlUri(action, runId, purpose, sport, routePlanId, target, resolvedCommandId, resolvedSequence, sourceNodeId),
        ).addCategory(Intent.CATEGORY_BROWSABLE)
            .setComponent(ComponentName("com.runback", "com.runback.wear.MainActivity")) else null
        nodes.forEach { node ->
            var remoteDelivered = false
            var messageDelivered = false
            var lastError: Exception? = null
            try {
                Tasks.await(Wearable.getMessageClient(context).sendMessage(node.id, WearProtocol.CONTROL_PATH, payload), 5, TimeUnit.SECONDS)
                messageDelivered = true
            }
            catch (error: Exception) { lastError = error }
            if (allowRemoteActivity) {
                try { remoteActivity!!.startRemoteActivity(remoteIntent!!, node.id).get(5, TimeUnit.SECONDS); remoteDelivered = true }
                catch (error: Exception) { lastError = error }
            }
            if (remoteDelivered || messageDelivered) sent++
            else errors.put("${node.displayName}: ${lastError?.message ?: lastError?.javaClass?.simpleName ?: "unbekannter Fehler"}")
        }
        scheduleRetry(context)
        return JSONObject()
            .put("status", if (sent > 0) "sent" else "error")
            .put("message", if (sent > 0) "Uhr wird ${actionLabel(action)}" else "Uhr konnte nicht erreicht werden")
            .put("action", action)
            .put("runId", runId)
            .put("commandId", resolvedCommandId)
            .put("sequence", resolvedSequence)
            .put("nodes", JSONArray().apply { nodes.forEach { put(it.displayName) } })
            .put("errors", errors)
            .put("updatedAt", System.currentTimeMillis())
    }

    fun publishControl(
        context: Context,
        action: String,
        runId: String,
        purpose: String = "easy",
        sport: String = "running",
        routePlanId: String? = null,
        target: String? = null,
        commandId: String? = null,
    ) {
        val app = context.applicationContext
        val store = RunStore(app)
        val resolvedCommandId = commandId ?: UUID.randomUUID().toString()
        val resolvedSequence = nextSequence(store)
        WearControlOutbox.enqueue(store, JSONObject()
            .put("action", action).put("runId", runId).put("purpose", purpose).put("sport", sport)
            .put("routePlanId", routePlanId ?: JSONObject.NULL).put("target", target ?: JSONObject.NULL)
            .put("commandId", resolvedCommandId).put("sequence", resolvedSequence)
            .put("updatedAt", System.currentTimeMillis()))
        publisher.execute {
            val result = runCatching { sendCommand(app, action, runId, purpose, sport, routePlanId, target, resolvedCommandId, resolvedSequence) }
                .getOrElse { JSONObject().put("status", "error").put("message", it.message ?: "Uhr konnte nicht erreicht werden") }
            runCatching { RunStore(app).putDocument("wearLinkStatus", result) }
        }
    }

    fun retryPending(context: Context, allowRemoteActivity: Boolean = false) {
        val store = RunStore(context)
        val pending = WearControlOutbox.heads(store)
        if (pending.isEmpty()) return
        publisher.execute {
            pending.forEach { command ->
                val action = command.optString("action")
                val runId = command.optString("runId")
                if (System.currentTimeMillis() - command.optLong("updatedAt", 0L) > 24L * 60L * 60L * 1000L ||
                    runId.isBlank() || store.runStatus(runId) == null
                ) {
                    WearControlOutbox.remove(store, runId, action, command.optString("commandId"), command.optLong("sequence", 0L))
                    return@forEach
                }
                runCatching {
                    sendCommand(
                        context,
                        action,
                        runId,
                        command.optString("purpose", "easy"),
                        command.optString("sport", "running"),
                        command.optString("routePlanId").takeIf { it.isNotBlank() && it != "null" },
                        command.optString("target").takeIf { it.isNotBlank() && it != "null" },
                        commandId = command.optString("commandId"),
                        sequence = command.optLong("sequence", 0L),
                        allowRemoteActivity = allowRemoteActivity,
                    )
                }
            }
            scheduleRetry(context)
        }
    }

    /** Sends only phone GPS; the watch keeps its own sensors and fills missing GPS locally. */
    fun publishPhoneSamples(context: Context, runId: String, sequence: Long, samples: List<RawSample>) {
        val gps = samples.filter { it.kind == "gps" }
        if (gps.isEmpty()) return
        publisher.execute {
            val nodes = runCatching { connectedNodes(context) }.getOrDefault(emptyList())
            if (nodes.isEmpty()) return@execute
            val payload = WearProtocol.live(runId, sequence, WearProtocol.PHONE_SOURCE, gps)
            nodes.forEach { node -> runCatching {
                Tasks.await(Wearable.getMessageClient(context).sendMessage(node.id, WearProtocol.LIVE_PATH, payload), 5, TimeUnit.SECONDS)
            } }
        }
    }

    private fun connectedNodes(context: Context) =
        Tasks.await(Wearable.getNodeClient(context).connectedNodes, 5, TimeUnit.SECONDS)

    private fun localNodeId(context: Context): String? =
        runCatching { Tasks.await(Wearable.getNodeClient(context).localNode, 5, TimeUnit.SECONDS).id }.getOrNull()

    private fun scheduleRetry(context: Context) {
        synchronized(retryLock) {
            if (retryScheduled) return
            retryScheduled = true
        }
        retryScheduler.schedule({
            synchronized(retryLock) { retryScheduled = false }
            retryPending(context.applicationContext)
        }, 15L, TimeUnit.SECONDS)
    }

    private fun nextSequence(store: RunStore): Long {
        synchronized(sequenceLock) {
            val previous = store.getDocument("wearControlSequence")?.optLong("value", 0L) ?: 0L
            val next = (previous + 1L).coerceAtLeast(1L)
            store.putDocument("wearControlSequence", JSONObject().put("value", next))
            return next
        }
    }

    private fun controlUri(
        action: String,
        runId: String,
        purpose: String,
        sport: String,
        routePlanId: String?,
        target: String?,
        commandId: String,
        sequence: Long,
        sourceNodeId: String?,
    ): Uri = Uri.Builder().scheme("runback").authority("recording").path("/control")
        .appendQueryParameter("action", action)
        .appendQueryParameter("runId", runId)
        .appendQueryParameter("purpose", purpose)
        .appendQueryParameter("sport", sport)
        .appendQueryParameter("routePlanId", routePlanId)
        .appendQueryParameter("target", target)
        .appendQueryParameter("commandId", commandId)
        .appendQueryParameter("sequence", sequence.toString())
        .appendQueryParameter("sourceNodeId", sourceNodeId ?: "")
        .build()

    private fun actionLabel(action: String): String = when (action) {
        "com.runback.recording.START" -> "gestartet"
        "com.runback.recording.PAUSE" -> "pausiert"
        "com.runback.recording.RESUME" -> "fortgesetzt"
        "com.runback.recording.FINISH" -> "beendet"
        else -> "aktualisiert"
    }
}
