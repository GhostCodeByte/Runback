package com.runback.wear

import android.Manifest
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.google.android.gms.wearable.MessageEvent
import com.runback.core.RecordingService
import com.runback.core.RunStore
import com.runback.core.RawSample
import com.runback.core.WearControlOutbox
import com.runback.core.WearCommandGate
import com.runback.core.WearProtocol
import androidx.wear.remote.interactions.RemoteActivityHelper
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.UUID

/** DataItems persist across disconnections; a phone ACK means the archive was committed locally. */
object WearSync {
    private val executor = Executors.newSingleThreadExecutor()
    private val controlExecutor = Executors.newSingleThreadExecutor()
    private val retryScheduler = Executors.newSingleThreadScheduledExecutor()
    private val remoteActivityExecutor = Executors.newCachedThreadPool()
    private val sequenceLock = Any()
    private val retryLock = Any()
    private var retryScheduled = false
    @Volatile var status: String = "Originale bleiben auf der Uhr."
        private set

    fun schedule(context: Context) {
        val app = context.applicationContext
        app.getSystemService(JobScheduler::class.java).schedule(
            JobInfo.Builder(4021, ComponentName(app, SyncJobService::class.java))
                .setPeriodic(15 * 60 * 1000L).setPersisted(true).build()
        )
    }

    fun retry(context: Context, done: (() -> Unit)? = null) {
        val app = context.applicationContext
        executor.execute {
            try {
                val store = RunStore(app)
                val runs = store.listRuns(10000)
                var pending = 0
                for (index in 0 until runs.length()) {
                    val run = runs.getJSONObject(index)
                    if (run.optString("status") != "completed") continue
                    val id = run.getString("id")
                    if (store.getDocument("sync_$id")?.optString("status") == "acknowledged") continue
                    pending++
                    val outbox = File(app.filesDir, "wear_outbox").apply { mkdirs() }
                    val archive = File(outbox, "$id.zip")
                    if (!archive.exists()) {
                        val exported = store.exportSession(id)
                        val temporary = File(outbox, "$id.tmp")
                        exported.copyTo(temporary, overwrite = true)
                        check(temporary.renameTo(archive)) { "Cannot commit transfer archive" }
                        exported.delete()
                    }
                    run {
                        val digest = MessageDigest.getInstance("SHA-256")
                        archive.inputStream().use { input ->
                            val bytes = ByteArray(8192)
                            while (true) { val read = input.read(bytes); if (read < 0) break; digest.update(bytes, 0, read) }
                        }
                        val sha = digest.digest().joinToString("") { "%02x".format(it) }
                        // Persist before publishing so even an immediate ACK can be checked.
                        store.putDocument("sync_$id", JSONObject().put("status", "pending").put("sha256", sha).put("queuedAt", System.currentTimeMillis()))
                        val request = PutDataMapRequest.create("/runback/runs/$id")
                        request.dataMap.putString("runId", id)
                        request.dataMap.putString("sha256", sha)
                        request.dataMap.putInt("schemaVersion", 1)
                        request.dataMap.putAsset("bundle", Asset.createFromUri(android.net.Uri.fromFile(archive)))
                        Tasks.await(Wearable.getDataClient(app).putDataItem(request.asPutDataRequest().setUrgent()), 45, TimeUnit.SECONDS)
                    }
                }
                val peers = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 10, TimeUnit.SECONDS)
                status = when {
                    pending == 0 -> "Alle Läufe gesichert."
                    peers.isEmpty() -> "$pending ausstehend · Handy verbinden"
                    else -> "$pending gesendet · Bestätigung ausstehend"
                }
            } catch (_: Exception) {
                status = "Übertragung ausstehend · Originale gesichert"
            } finally { done?.invoke() }
        }
    }

    fun publishSamples(context: Context, runId: String, sequence: Long, samples: List<RawSample>) {
        val relevant = samples.filter { it.kind in setOf("gps", "heartRate", "cadence", "pressure") }
        if (relevant.isEmpty()) return
        controlExecutor.execute {
            runCatching {
                val nodes = Tasks.await(Wearable.getNodeClient(context).connectedNodes, 5, TimeUnit.SECONDS)
                if (nodes.isEmpty()) return@runCatching
                val payload = WearProtocol.live(runId, sequence, WearProtocol.WATCH_SOURCE, relevant)
                nodes.forEach { node ->
                    Tasks.await(Wearable.getMessageClient(context).sendMessage(node.id, WearProtocol.LIVE_PATH, payload), 5, TimeUnit.SECONDS)
                }
            }
        }
    }

    /** Start/control the phone in the foreground when possible; message delivery is the fallback. */
    fun publishControl(
        context: Context,
        action: String,
        runId: String,
        purpose: String = "easy",
        sport: String = "running",
        routePlanId: String? = null,
        target: String? = null,
        commandId: String? = null,
        sequence: Long? = null,
        allowRemoteActivity: Boolean = true,
    ) {
        val app = context.applicationContext
        val store = RunStore(app)
        val resolvedCommandId = commandId ?: UUID.randomUUID().toString()
        val resolvedSequence = sequence ?: nextSequence(store)
        WearControlOutbox.enqueue(store, JSONObject()
            .put("action", action).put("runId", runId).put("purpose", purpose).put("sport", sport)
            .put("routePlanId", routePlanId ?: JSONObject.NULL).put("target", target ?: JSONObject.NULL)
            .put("commandId", resolvedCommandId).put("sequence", resolvedSequence)
            .put("updatedAt", System.currentTimeMillis()))
        if (!WearControlOutbox.isHead(store, JSONObject()
                .put("runId", runId).put("commandId", resolvedCommandId).put("sequence", resolvedSequence))) {
            scheduleRetry(app)
            return
        }
        controlExecutor.execute {
            val nodes = runCatching { Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS) }
                .getOrDefault(emptyList())
            val sourceNodeId = if (allowRemoteActivity) {
                runCatching { Tasks.await(Wearable.getNodeClient(app).localNode, 5, TimeUnit.SECONDS).id }.getOrNull()
            } else null
            val payload = WearProtocol.control(action, runId, purpose, sport, target, routePlanId, resolvedCommandId, resolvedSequence)
            val remoteActivity = if (allowRemoteActivity) RemoteActivityHelper(app, remoteActivityExecutor) else null
            var sent = 0
            nodes.forEach { node ->
                var messageDelivered = false
                runCatching {
                    Tasks.await(Wearable.getMessageClient(app).sendMessage(node.id, WearProtocol.CONTROL_PATH, payload), 5, TimeUnit.SECONDS)
                    messageDelivered = true
                }
                var remoteDelivered = false
                if (allowRemoteActivity) runCatching {
                    remoteActivity!!.startRemoteActivity(
                        Intent(Intent.ACTION_VIEW, controlUri(action, runId, purpose, sport, routePlanId, target, resolvedCommandId, resolvedSequence, sourceNodeId))
                            .addCategory(Intent.CATEGORY_BROWSABLE)
                            .setComponent(ComponentName("com.runback", "com.runback.MainActivity")), node.id,
                    ).get(5, TimeUnit.SECONDS)
                    remoteDelivered = true
                }
                if (remoteDelivered || messageDelivered) sent++
            }
            RunStore(app).putDocument("wearLinkStatus", JSONObject()
                .put("status", if (sent > 0) "sent" else "disconnected")
                .put("message", if (sent > 0) "Handy wird ${actionLabel(action)}" else "Kein Handy verbunden")
                .put("action", action).put("runId", runId)
                .put("commandId", resolvedCommandId).put("sequence", resolvedSequence)
                .put("updatedAt", System.currentTimeMillis()))
            scheduleRetry(app)
        }
    }

    fun retryControl(context: Context, allowRemoteActivity: Boolean = false) {
        val store = RunStore(context)
        val pending = WearControlOutbox.heads(store)
        if (pending.isEmpty()) return
        pending.forEach { command ->
            val action = command.optString("action")
            val runId = command.optString("runId")
            if (System.currentTimeMillis() - command.optLong("updatedAt", 0L) > 24L * 60L * 60L * 1000L ||
                runId.isBlank() || store.runStatus(runId) == null
            ) {
                WearControlOutbox.remove(store, runId, action, command.optString("commandId"), command.optLong("sequence", 0L))
                return@forEach
            }
            publishControl(
                context,
                action,
                runId,
                command.optString("purpose", "easy"),
                command.optString("sport", "running"),
                command.optString("routePlanId").takeIf { it.isNotBlank() && it != "null" },
                command.optString("target").takeIf { it.isNotBlank() && it != "null" },
                command.optString("commandId"),
                command.optLong("sequence", 0L),
                allowRemoteActivity = allowRemoteActivity,
            )
        }
        scheduleRetry(context)
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
        .appendQueryParameter("routePlanId", routePlanId ?: "")
        .appendQueryParameter("target", target ?: "")
        .appendQueryParameter("commandId", commandId)
        .appendQueryParameter("sequence", sequence.toString())
        .appendQueryParameter("sourceNodeId", sourceNodeId ?: "")
        .build()

    private fun actionLabel(action: String): String = when (action) {
        RecordingService.START -> "gestartet"
        RecordingService.PAUSE -> "pausiert"
        RecordingService.RESUME -> "fortgesetzt"
        RecordingService.FINISH -> "beendet"
        else -> "aktualisiert"
    }

    private fun nextSequence(store: RunStore): Long {
        synchronized(sequenceLock) {
            val previous = store.getDocument("wearControlSequence")?.optLong("value", 0L) ?: 0L
            val next = (previous + 1L).coerceAtLeast(1L)
            store.putDocument("wearControlSequence", JSONObject().put("value", next))
            return next
        }
    }

    private fun scheduleRetry(context: Context) {
        synchronized(retryLock) {
            if (retryScheduled) return
            retryScheduled = true
        }
        retryScheduler.schedule({
            synchronized(retryLock) { retryScheduled = false }
            retryControl(context.applicationContext)
        }, 15L, TimeUnit.SECONDS)
    }

    fun acceptAck(context: Context, id: String, sha: String) {
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,100}")) || !sha.matches(Regex("[a-f0-9]{64}"))) return
        val store = RunStore(context)
        val record = store.getDocument("sync_$id") ?: return
        if (record.optString("sha256") != sha) return
        store.putDocument("sync_$id", record.put("status", "acknowledged").put("acknowledgedAt", System.currentTimeMillis()))
        // Delete only the transfer copy. Original recording remains in RunStore.
        File(context.filesDir, "wear_outbox/$id.zip").delete()
        status = "Auf Handy bestätigt · Original auf Uhr"
    }
}

class WearSyncListener : WearableListenerService() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED || event.dataItem.uri.path?.startsWith("/runback/acks/") != true) continue
            val data = DataMapItem.fromDataItem(event.dataItem).dataMap
            WearSync.acceptAck(this, data.getString("runId") ?: "", data.getString("sha256") ?: "")
        }
    }
    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WearProtocol.CONTROL_PATH -> executor.execute { handleControl(event) }
            WearProtocol.LIVE_PATH -> executor.execute { receivePhoneSamples(event.data) }
            WearProtocol.ACK_PATH -> executor.execute { receivePhoneAck(event.data) }
        }
    }
    override fun onPeerConnected(peer: Node) {
        WearSync.retryControl(this)
        WearSync.retry(this)
    }
    override fun onDestroy() { executor.shutdown(); super.onDestroy() }

    private fun handleControl(event: MessageEvent) {
        var action = "unknown"
        var runId = ""
        var commandId: String? = null
        var sequence = 0L
        var claimed = false
        var executionStarted = false
        try {
            val command = WearProtocol.decode(event.data)
            action = command.optString("action")
            require(action in setOf(RecordingService.START, RecordingService.PAUSE, RecordingService.RESUME, RecordingService.FINISH)) {
                "Unbekannter Aufzeichnungsbefehl"
            }
            runId = WearProtocol.requireRunId(command)
            commandId = WearProtocol.commandId(command)
            sequence = WearProtocol.commandSequence(command)
            require(!commandId.isNullOrBlank() && sequence > 0L) { "Aufzeichnungsbefehl ohne Korrelation" }
            val purpose = command.optString("purpose", "easy")
            val sport = command.optString("sport", "running")
            val target = command.optString("target").takeIf { it.isNotBlank() && it != "null" }
            val store = RunStore(this)
            val requestedRoutePlanId = command.optString("routePlanId").takeIf { it.isNotBlank() && it != "null" }
            WearCommandGate.issuePermit(
                store, action, runId, commandId, sequence, purpose, sport, requestedRoutePlanId, target, event.sourceNodeId,
            )
            var current = store.active()
            if (action == RecordingService.START && current == null) {
                val deadline = SystemClock.elapsedRealtime() + 2_000L
                while (current == null && SystemClock.elapsedRealtime() < deadline) {
                    SystemClock.sleep(50)
                    current = store.active()
                }
            }
            val routePlanId = if (action == RecordingService.START) localRoutePlanId(store, command) else null
            if (action == RecordingService.START && current != null && current.optString("id") != runId) {
                error("Auf der Uhr läuft bereits eine andere Aufzeichnung.")
            }
            if (action == RecordingService.START && !RecordingService.hasLiveService()) {
                sendAck(event.sourceNodeId, action, runId, "retry", "Uhr muss für den Start sichtbar geöffnet werden.", commandId, sequence)
                return
            }
            if (action != RecordingService.START && current?.optString("id") == runId && !RecordingService.hasLiveService()) {
                sendAck(event.sourceNodeId, action, runId, "retry", "Uhr muss für diesen Befehl sichtbar geöffnet werden.", commandId, sequence)
                return
            }
            when (WearCommandGate.claim(store, runId, commandId, sequence)) {
                WearCommandGate.Decision.INVALID, WearCommandGate.Decision.STALE -> {
                    sendAck(event.sourceNodeId, action, runId, "error", "Veralteter Aufzeichnungsbefehl.", commandId, sequence)
                    return
                }
                WearCommandGate.Decision.DUPLICATE -> {
                    try {
                        waitForState(runId, action)
                    } catch (retry: Exception) {
                        sendAck(event.sourceNodeId, action, runId, "retry", retry.message ?: "Befehl wird erneut versucht.", commandId, sequence)
                        return
                    }
                    WearCommandGate.markApplied(store, runId, commandId, sequence)
                    sendAck(event.sourceNodeId, action, runId, "accepted", "Aufzeichnungsbefehl bereits angewendet.", commandId, sequence)
                    return
                }
                WearCommandGate.Decision.WAIT -> {
                    sendAck(event.sourceNodeId, action, runId, "retry", "Vorheriger Aufzeichnungsbefehl wird noch verarbeitet.", commandId, sequence)
                    return
                }
                WearCommandGate.Decision.ACCEPT -> claimed = true
            }
            if (action == RecordingService.START && current?.optString("id") == runId &&
                current?.optString("status") in listOf("recording", "paused")) {
                WearCommandGate.markApplied(store, runId, commandId, sequence)
                sendAck(event.sourceNodeId, action, runId, "accepted", "Aufzeichnung auf der Uhr bereits aktiv.", commandId, sequence)
                return
            }
            if (action != RecordingService.START && current?.optString("id") != runId) {
                if (action == RecordingService.FINISH && store.runStatus(runId) == "completed") {
                    WearCommandGate.markApplied(store, runId, commandId, sequence)
                    sendAck(event.sourceNodeId, action, runId, "accepted", "Aufzeichnung auf der Uhr bereits beendet.", commandId, sequence)
                    return
                }
                error("Auf der Uhr läuft dieser Lauf nicht.")
            }
            val alreadyApplied = when (action) {
                RecordingService.PAUSE -> current?.optString("status") == "paused"
                RecordingService.RESUME -> current?.optString("status") == "recording"
                else -> false
            }
            if ((action == RecordingService.START && current == null) ||
                (action != RecordingService.START && !alreadyApplied)) {
                RecordingService.send(
                    this,
                    action,
                    purpose,
                    WearProtocol.WATCH_SOURCE,
                    sport,
                    routePlanId = routePlanId,
                    target = target,
                    runId = runId,
                    syncPeers = false,
                    commandId = commandId,
                    commandSequence = sequence,
                )
                executionStarted = true
            }
            waitForState(runId, action)
            WearCommandGate.markApplied(store, runId, commandId, sequence)
            sendAck(event.sourceNodeId, action, runId, "accepted", "Aufzeichnung auf der Uhr synchronisiert.", commandId, sequence)
            if (action == RecordingService.FINISH) WearSync.retry(this)
        } catch (error: Exception) {
            if (claimed && executionStarted) {
                sendAck(event.sourceNodeId, action, runId, "retry", error.message ?: "Befehl wird erneut versucht.", commandId, sequence)
                return
            }
            if (claimed && runId.isNotBlank()) {
                WearCommandGate.release(RunStore(this), runId, commandId, sequence)
            }
            sendAck(event.sourceNodeId, action, runId, "error", error.message ?: "Uhr konnte nicht gestartet werden.", commandId, sequence)
        }
    }

    /** Route plans live on the phone unless the watch was prepared independently. */
    private fun localRoutePlanId(store: RunStore, command: JSONObject): String? {
        val requested = command.optString("routePlanId").takeIf { it.isNotBlank() && it != "null" } ?: return null
        val routes = store.getDocument("route_planner")?.optJSONArray("routes") ?: return null
        for (index in 0 until routes.length()) {
            val route = routes.optJSONObject(index) ?: continue
            if (route.optString("id") == requested &&
                route.optString("source") == "brouter" &&
                route.optString("activeRunId").isBlank()
            ) return requested
        }
        return null
    }

    private fun waitForState(runId: String, action: String) {
        val expected = when (action) {
            RecordingService.PAUSE -> "paused"
            RecordingService.FINISH -> "completed"
            else -> "recording"
        }
        val deadline = SystemClock.elapsedRealtime() + 5_000L
        while (true) {
            val current = RunStore(this).active()
            if ((expected == "completed" && current == null && RunStore(this).runStatus(runId) == "completed") ||
                (current?.optString("id") == runId && current.optString("status") == expected)) return
            check(SystemClock.elapsedRealtime() < deadline) { "Die Uhr hat nicht rechtzeitig reagiert." }
            SystemClock.sleep(50)
        }
    }

    private fun receivePhoneSamples(bytes: ByteArray) {
        runCatching {
            val payload = WearProtocol.decode(bytes)
            val id = WearProtocol.requireRunId(payload)
            val samples = WearProtocol.samples(payload)
            val sequence = payload.optLong("sequence", -1L)
            require(sequence >= 0) { "Ungültige Sensorpaket-Nummer" }
            val store = RunStore(this)
            val active = store.active()
            if (active?.optString("id") != id || active?.optString("status") != "recording") return@runCatching
            val key = "phoneLive_${id}_$sequence"
            if (store.getDocument(key) != null) return@runCatching
            store.appendSamples(id, samples)
            samples.filter { it.kind == "gps" }.forEach { RecordingService.acceptRemoteLocation(id, it) }
            store.putDocument(key, JSONObject().put("receivedAt", System.currentTimeMillis()))
        }
    }

    private fun receivePhoneAck(bytes: ByteArray) {
        runCatching {
            val payload = WearProtocol.decode(bytes)
            val id = WearProtocol.requireRunId(payload)
            val store = RunStore(this)
            store.putDocument("wearLinkStatus", JSONObject()
                .put("status", payload.optString("status", "unknown"))
                .put("message", payload.optString("message"))
                .put("action", payload.optString("action"))
                .put("runId", id)
                .put("commandId", payload.optString("commandId"))
                .put("sequence", payload.optLong("sequence", 0L))
                .put("sensors", payload.optJSONObject("sensors") ?: JSONObject())
                .put("updatedAt", System.currentTimeMillis()))
            if (payload.optString("status") in setOf("accepted", "error")) {
                val removed = WearControlOutbox.remove(
                    store,
                    id,
                    payload.optString("action"),
                    payload.optString("commandId"),
                    payload.optLong("sequence", 0L),
                )
                if (removed) WearSync.retryControl(this)
            }
        }
    }

    private fun sendAck(nodeId: String, action: String, runId: String, status: String, message: String, commandId: String? = null, sequence: Long = 0L) {
        if (nodeId.isBlank() || runId.isBlank()) return
        val sensors = JSONObject().apply {
            val manager = getSystemService(SensorManager::class.java)
            put("gps", packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS))
            put("gpsPermission", hasLocationPermission())
            put("heartRate", hasHeartPermission())
            put("accelerometer", manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
            put("barometer", manager.getDefaultSensor(Sensor.TYPE_PRESSURE) != null)
        }
        runCatching {
            Tasks.await(Wearable.getMessageClient(this).sendMessage(
                nodeId, WearProtocol.ACK_PATH, WearProtocol.ack(action, runId, status, message, sensors, commandId, sequence),
            ), 5, TimeUnit.SECONDS)
        }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasHeartPermission(): Boolean {
        val permission = if (android.os.Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }
}

class SyncJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        WearSync.retryControl(this)
        WearSync.retry(this) { jobFinished(params, false) }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean = true
}
