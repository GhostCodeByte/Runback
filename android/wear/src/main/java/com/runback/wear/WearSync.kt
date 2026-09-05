package com.runback.wear

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.runback.core.RunStore
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** DataItems persist across disconnections; a phone ACK means the archive was committed locally. */
object WearSync {
    private val executor = Executors.newSingleThreadExecutor()
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
    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED || event.dataItem.uri.path?.startsWith("/runback/acks/") != true) continue
            val data = DataMapItem.fromDataItem(event.dataItem).dataMap
            WearSync.acceptAck(this, data.getString("runId") ?: "", data.getString("sha256") ?: "")
        }
    }
    override fun onPeerConnected(peer: Node) { WearSync.retry(this) }
}

class SyncJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        WearSync.retry(this) { jobFinished(params, false) }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean = true
}
