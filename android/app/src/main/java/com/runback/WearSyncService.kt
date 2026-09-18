package com.runback

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.*
import com.runback.core.RecordingService
import com.runback.core.RunStore
import com.runback.core.WearControlOutbox
import com.runback.core.WearCommandGate
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

/** Acknowledges a watch transfer only after its complete original bundle is durable. */
class WearSyncService : WearableListenerService() {
    private val worker = Executors.newSingleThreadExecutor()
    override fun onDataChanged(events: DataEventBuffer) {
        val items = mutableListOf<DataItem>()
        for (event in events) if (event.type == DataEvent.TYPE_CHANGED && event.dataItem.uri.path?.startsWith("/runback/runs/") == true) {
            items.add(event.dataItem.freeze())
        }
        worker.execute { items.forEach(::receive) }
    }

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WearProtocol.CONTROL_PATH -> worker.execute { handleWatchControl(event) }
            WearProtocol.LIVE_PATH -> worker.execute { receiveLive(event.data) }
            WearProtocol.ACK_PATH -> worker.execute { receiveAck(event.data) }
        }
    }

    override fun onPeerConnected(peer: Node) {
        WearController.retryPending(this)
    }

    private fun handleWatchControl(event: MessageEvent) {
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
            val routePlanId = command.optString("routePlanId").takeIf { it.isNotBlank() && it != "null" }
            val target = command.optString("target").takeIf { it.isNotBlank() && it != "null" }
            val store = RunStore(this)
            WearCommandGate.issuePermit(
                store, action, runId, commandId, sequence, purpose, sport, routePlanId, target, event.sourceNodeId,
            )
            var current = store.active()
            if (action == RecordingService.START && current == null) {
                val deadline = SystemClock.elapsedRealtime() + 2_000L
                while (current == null && SystemClock.elapsedRealtime() < deadline) {
                    SystemClock.sleep(50)
                    current = store.active()
                }
            }
            if (action == RecordingService.START) {
                if (current != null && current.optString("id") != runId) {
                    error("Auf dem Handy läuft bereits eine andere Aufzeichnung.")
                }
                if (!RecordingService.hasLiveService()) {
                    sendAck(event.sourceNodeId, action, runId, "retry", "Handy muss für den Start sichtbar geöffnet werden.", commandId, sequence)
                    return
                }
            } else if (current?.optString("id") == runId && !RecordingService.hasLiveService()) {
                sendAck(event.sourceNodeId, action, runId, "retry", "Handy muss für diesen Befehl sichtbar geöffnet werden.", commandId, sequence)
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
            if (action == RecordingService.START) {
                if (current?.optString("id") == runId && current?.optString("status") in listOf("recording", "paused")) {
                    WearCommandGate.markApplied(store, runId, commandId, sequence)
                    sendAck(event.sourceNodeId, action, runId, "accepted", "Aufzeichnung auf dem Handy bereits aktiv.", commandId, sequence)
                    return
                }
                if (current == null) {
                    RecordingService.send(
                        this,
                        action,
                        purpose,
                        WearProtocol.PHONE_SOURCE,
                        sport,
                        routePlanId = routePlanId,
                        target = target,
                        runId = runId,
                        remoteStart = true,
                        syncPeers = false,
                        commandId = commandId,
                        commandSequence = sequence,
                    )
                    executionStarted = true
                }
            } else {
                if (current?.optString("id") != runId) {
                    if (action == RecordingService.FINISH && store.runStatus(runId) == "completed") {
                        WearCommandGate.markApplied(store, runId, commandId, sequence)
                        sendAck(event.sourceNodeId, action, runId, "accepted", "Lauf auf dem Handy bereits beendet.", commandId, sequence)
                        return
                    }
                    error("Auf dem Handy läuft dieser Lauf nicht.")
                }
                val alreadyApplied = when (action) {
                    RecordingService.PAUSE -> current?.optString("status") == "paused"
                    RecordingService.RESUME -> current?.optString("status") == "recording"
                    else -> false
                }
                if (!alreadyApplied) {
                    RecordingService.send(
                        this,
                        action,
                        purpose,
                        WearProtocol.PHONE_SOURCE,
                        sport,
                        runId = runId,
                        remoteStart = true,
                        syncPeers = false,
                        commandId = commandId,
                        commandSequence = sequence,
                    )
                    executionStarted = true
                }
            }
            waitForState(runId, action)
            WearCommandGate.markApplied(store, runId, commandId, sequence)
            sendAck(event.sourceNodeId, action, runId, "accepted", "Aufzeichnung auf dem Handy synchronisiert.", commandId, sequence)
        } catch (error: Exception) {
            if (claimed && executionStarted) {
                sendAck(event.sourceNodeId, action, runId, "retry", error.message ?: "Befehl wird erneut versucht.", commandId, sequence)
                return
            }
            if (claimed && runId.isNotBlank()) {
                WearCommandGate.release(RunStore(this), runId, commandId, sequence)
            }
            sendAck(event.sourceNodeId, action, runId, "error", error.message ?: "Handy konnte nicht synchronisiert werden.", commandId, sequence)
        }
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
            check(SystemClock.elapsedRealtime() < deadline) { "Das Handy hat nicht rechtzeitig reagiert." }
            SystemClock.sleep(50)
        }
    }

    private fun sendAck(nodeId: String, action: String, runId: String, status: String, message: String, commandId: String? = null, sequence: Long = 0L) {
        if (nodeId.isBlank() || runId.isBlank()) return
        val sensors = JSONObject()
            .put("gps", packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS))
            .put("gpsPermission", checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)
        runCatching {
            Tasks.await(Wearable.getMessageClient(this).sendMessage(
                nodeId, WearProtocol.ACK_PATH, WearProtocol.ack(action, runId, status, message, sensors, commandId, sequence),
            ), 5, TimeUnit.SECONDS)
        }
    }

    private fun receiveLive(bytes: ByteArray) {
        try {
            val payload = WearProtocol.decode(bytes)
            val id = WearProtocol.requireRunId(payload)
            val samples = WearProtocol.samples(payload)
            if (samples.isEmpty()) return
            val sequence = payload.optLong("sequence", -1L)
            require(sequence >= 0) { "Ungültige Sensorpaket-Nummer" }
            val store = RunStore(this)
            val active = store.active()
            if (active?.optString("id") != id || active?.optString("status") != "recording") return
            val key = "wearLive_${id}_$sequence"
            if (store.getDocument(key) != null) return
            store.appendSamples(id, samples)
            store.putDocument(key, JSONObject().put("receivedAt", System.currentTimeMillis()).put("source", payload.optString("source")))
            store.putDocument("wearLinkStatus", JSONObject()
                .put("status", "live")
                .put("message", "Uhrdaten werden verwendet")
                .put("runId", id)
                .put("lastLiveAt", System.currentTimeMillis())
                .put("updatedAt", System.currentTimeMillis()))
        } catch (error: Exception) {
            RunStore(this).putDocument("wearSyncStatus", JSONObject()
                .put("status", "retry_needed")
                .put("message", error.message ?: "Uhrdaten konnten nicht übernommen werden")
                .put("updatedAt", System.currentTimeMillis()))
        }
    }

    private fun receiveAck(bytes: ByteArray) {
        runCatching {
            val payload = WearProtocol.decode(bytes)
            val store = RunStore(this)
            val id = WearProtocol.requireRunId(payload)
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
                if (removed) WearController.retryPending(this)
            }
        }.onFailure { error ->
            RunStore(this).putDocument("wearSyncStatus", JSONObject()
                .put("status", "retry_needed")
                .put("message", error.message ?: "Uhrbestätigung konnte nicht gelesen werden")
                .put("updatedAt", System.currentTimeMillis()))
        }
    }

    private fun receive(item: DataItem) {
        var temporary: File? = null
        try {
            val map = DataMapItem.fromDataItem(item).dataMap
            val id = map.getString("runId") ?: return
            val expected = map.getString("sha256")?.lowercase() ?: return
            require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Ungültige Laufkennung" }
            require(item.uri.path == "/runback/runs/$id") { "Laufkennung stimmt nicht überein" }
            require(expected.matches(Regex("[a-f0-9]{64}"))) { "Ungültige Prüfsumme" }
            require(map.getInt("schemaVersion") == 1) { "Unbekanntes Übertragungsformat" }
            val store = RunStore(this)
            val previous = store.getDocument("wearImport_$id")
            if (previous?.optString("sha256") != expected) {
                val asset = map.getAsset("bundle") ?: return
                temporary = File.createTempFile("wear-import-", ".zip", cacheDir)
                val response = Tasks.await(Wearable.getDataClient(this).getFdForAsset(asset), 60, TimeUnit.SECONDS)
                val digest = MessageDigest.getInstance("SHA-256")
                try {
                    response.inputStream.use { input -> temporary.outputStream().use { output ->
                        val buffer = ByteArray(32768)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count == -1) break
                            total += count
                            require(total <= 256L * 1024 * 1024) { "Übertragung größer als 256 MB" }
                            digest.update(buffer, 0, count); output.write(buffer, 0, count)
                        }
                    } }
                } finally { response.release() }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                require(actual == expected) { "Übertragung unvollständig" }
                val incomingRun = readIncomingRun(temporary)
                require(incomingRun.optString("id") == id) { "Die Übertragung enthält einen anderen Lauf" }
                finishLiveRunBeforeImport(store, id, incomingRun)
                val importedId = store.importSession(temporary)
                require(importedId == id) { "Die Übertragung enthält einen anderen Lauf" }
                store.putDocument("wearImport_$id", JSONObject().put("sha256", expected).put("importedAt", System.currentTimeMillis()))
            }
            val ack = PutDataMapRequest.create("/runback/acks/$id")
            ack.dataMap.putString("runId", id)
            ack.dataMap.putString("sha256", expected)
            ack.dataMap.putLong("acknowledgedAt", System.currentTimeMillis())
            Tasks.await(Wearable.getDataClient(this).putDataItem(ack.asPutDataRequest().setUrgent()), 30, TimeUnit.SECONDS)
        } catch (error: Exception) {
            RunStore(this).putDocument("wearSyncStatus", JSONObject().put("status", "retry_needed")
                .put("message", error.message ?: "Übertragung fehlgeschlagen").put("updatedAt", System.currentTimeMillis()))
        } finally { temporary?.delete() }
    }

    private fun readIncomingRun(file: File): JSONObject {
        ZipFile(file).use { archive ->
            val entry = archive.getEntry("session.json") ?: error("Übertragung enthält keine Sitzung")
            val bytes = ByteArrayOutputStream()
            archive.getInputStream(entry).use { input ->
                val buffer = ByteArray(32768)
                var total = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total <= 256L * 1024 * 1024) { "Sitzung überschreitet das Größenlimit" }
                    bytes.write(buffer, 0, count)
                }
            }
            val session = JSONObject(bytes.toByteArray().toString(Charsets.UTF_8))
            require(session.optInt("schemaVersion") == 1) { "Unbekannte Sitzungs-Version" }
            return session.getJSONObject("run")
        }
    }

    private fun finishLiveRunBeforeImport(store: RunStore, runId: String, incomingRun: JSONObject) {
        if (incomingRun.optString("status") != "completed") return
        val active = store.active() ?: return
        if (active.optString("id") != runId || active.optString("status") !in listOf("recording", "paused")) return
        check(RecordingService.hasLiveService()) { "Eine aktive Aufzeichnung muss vor der Übernahme sichtbar beendet werden." }
        RecordingService.send(
            this,
            RecordingService.FINISH,
            active.optString("purpose", "easy"),
            active.optString("source", WearProtocol.PHONE_SOURCE),
            active.optString("sport", "running"),
            runId = runId,
            syncPeers = false,
        )
        val deadline = SystemClock.elapsedRealtime() + 5_000L
        while (store.runStatus(runId) != "completed") {
            check(SystemClock.elapsedRealtime() < deadline) { "Lauf konnte vor der Übernahme nicht beendet werden" }
            SystemClock.sleep(50)
        }
    }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
}
