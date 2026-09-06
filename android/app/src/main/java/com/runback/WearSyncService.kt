package com.runback

import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.*
import com.runback.core.RunStore
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
}
