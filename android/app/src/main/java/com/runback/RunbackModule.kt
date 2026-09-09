package com.runback

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.runback.core.RunStore
import com.runback.core.RecordingService
import com.runback.core.BleSensors
import com.runback.imports.ActivityImporter
import com.runback.integrations.HealthConnectIntegration
import com.runback.integrations.TrainingChat
import com.runback.integrations.OpenRouterProse
import com.runback.integrations.WeatherIntegration
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** All raw sensor and archive processing stays on native worker threads. */
class RunbackModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val store = RunStore(context)
    private val worker = Executors.newSingleThreadExecutor()
    private val aiWorker = Executors.newSingleThreadExecutor()
    private val importWorker = Executors.newSingleThreadExecutor()
    private val importer = ActivityImporter(context, store)
    private val health = HealthConnectIntegration(context)
    private val prose = OpenRouterProse(context)
    private val chat = TrainingChat(store, prose)
    private var pending: Pair<Promise, (Int, Intent?) -> Unit>? = null

    init {
        context.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != DOCUMENT_REQUEST) return
                val operation = pending ?: return
                pending = null
                try { operation.second(resultCode, data) } catch (error: Exception) { operation.first.reject("DOCUMENT_ERROR", error.message, error) }
            }
        })
    }

    override fun getName() = "Runback"

    private fun task(promise: Promise, block: () -> Any?) {
        worker.execute {
            try { promise.resolve((block() ?: JSONObject.NULL).toString()) }
            catch (error: Exception) { promise.reject("RUNBACK_ERROR", error.message ?: "Vorgang fehlgeschlagen", error) }
        }
    }

    private fun capabilities(): JSONObject {
        val sensors = context.getSystemService(SensorManager::class.java)
        return JSONObject()
            .put("gps", context.packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS))
            .put("barometer", sensors.getDefaultSensor(Sensor.TYPE_PRESSURE) != null)
            .put("accelerometer", sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
            .put("locationPermission", granted(Manifest.permission.ACCESS_FINE_LOCATION))
            .put("notificationPermission", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
            .put("bluetoothPermission", Build.VERSION.SDK_INT < 31 || (granted(Manifest.permission.BLUETOOTH_SCAN) && granted(Manifest.permission.BLUETOOTH_CONNECT)))
            .put("healthConnect", "not_connected")
    }

    private fun granted(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun state() = JSONObject().put("runs", store.listRuns()).put("recording", store.active() ?: JSONObject.NULL)
        .put("settings", store.settings()).put("capabilities", capabilities()).put("import", importer.status())

    @ReactMethod fun getState(promise: Promise) = task(promise) { state() }
    @ReactMethod fun listRuns(promise: Promise) = task(promise) { store.listRuns() }
    @ReactMethod fun getCapabilities(promise: Promise) = task(promise) { capabilities() }
    @ReactMethod fun getSettings(promise: Promise) = task(promise) { store.settings() }
    @ReactMethod fun saveSettings(json: String, promise: Promise) = task(promise) { store.saveSettings(JSONObject(json)); store.settings() }
    @ReactMethod fun getRun(id: String, promise: Promise) = task(promise) {
        store.detail(id).apply {
            put("route", optJSONArray("geometry") ?: JSONArray())
            val feedback = optJSONObject("feedback") ?: JSONObject()
            if (feedback.has("rpe")) put("rpe", feedback.get("rpe"))
            if (feedback.has("note")) put("note", feedback.get("note"))
        }
    }
    @ReactMethod fun getRoute(id: String, maxPoints: Int, promise: Promise) = task(promise) {
        val source = store.detail(id).optJSONArray("geometry") ?: JSONArray()
        val limit = maxPoints.coerceIn(2, 512)
        if (source.length() <= limit) source else JSONArray().apply {
            repeat(limit) { put(source.getJSONObject((it.toLong() * (source.length() - 1) / (limit - 1)).toInt())) }
        }
    }
    @ReactMethod fun updateRunFeedback(id: String, json: String, promise: Promise) = task(promise) { store.saveFeedback(id, JSONObject(json)); store.detail(id) }
    @ReactMethod fun saveRunContext(id: String, json: String, promise: Promise) = updateRunFeedback(id, json, promise)
    @ReactMethod fun deleteRun(id: String, promise: Promise) = task(promise) { store.deleteRun(id); state() }
    @ReactMethod fun clearAllData(promise: Promise) = task(promise) {
        check(store.active() == null) { "Beende zuerst die laufende Aufzeichnung." }
        importer.cancel(); chat.resetData { store.clearAllData() }; state()
    }
    @ReactMethod fun deleteAllData(promise: Promise) = clearAllData(promise)

    // Krafttraining. Liegt im vorhandenen Dokumentspeicher und ist damit vom
    // Backup abgedeckt. Die laufende Einheit hat ein eigenes Dokument, damit ein
    // bestätigter Satz nicht die gesamte Historie neu schreibt.
    private fun strengthIndex() = store.getDocument("strength_index") ?: JSONObject().put("sessions", JSONArray())
    private fun strengthState() = JSONObject()
        .put("templates", (store.getDocument("strength_templates") ?: JSONObject()).optJSONArray("templates") ?: JSONArray())
        .put("active", store.getDocument("strength_active") ?: JSONObject.NULL)
        .put("history", strengthIndex().optJSONArray("sessions") ?: JSONArray())

    @ReactMethod fun getStrengthState(promise: Promise) = task(promise) { strengthState() }
    @ReactMethod fun saveStrengthTemplates(json: String, promise: Promise) = task(promise) {
        store.putDocument("strength_templates", JSONObject().put("templates", JSONArray(json))); strengthState()
    }
    @ReactMethod fun saveStrengthSession(json: String, promise: Promise) = task(promise) {
        store.putDocument("strength_active", JSONObject(json)); strengthState()
    }
    @ReactMethod fun discardStrengthSession(promise: Promise) = task(promise) {
        store.deleteDocument("strength_active"); strengthState()
    }
    @ReactMethod fun finishStrengthSession(json: String, summaryJson: String, promise: Promise) = task(promise) {
        val session = JSONObject(json)
        val id = session.optString("id").ifBlank { error("Einheit ohne Kennung kann nicht gespeichert werden.") }
        store.putDocument("strength_session_$id", session)
        val index = strengthIndex()
        val sessions = index.optJSONArray("sessions") ?: JSONArray()
        val kept = JSONArray()
        for (i in 0 until sessions.length()) {
            val entry = sessions.optJSONObject(i) ?: continue
            if (entry.optString("id") != id) kept.put(entry)
        }
        kept.put(JSONObject(summaryJson))
        store.putDocument("strength_index", index.put("sessions", kept))
        store.deleteDocument("strength_active")
        strengthState()
    }
    @ReactMethod fun getStrengthSession(id: String, promise: Promise) = task(promise) {
        store.getDocument("strength_session_$id") ?: error("Einheit nicht gefunden")
    }
    @ReactMethod fun deleteStrengthSession(id: String, promise: Promise) = task(promise) {
        store.deleteDocument("strength_session_$id")
        val index = strengthIndex()
        val sessions = index.optJSONArray("sessions") ?: JSONArray()
        val kept = JSONArray()
        for (i in 0 until sessions.length()) {
            val entry = sessions.optJSONObject(i) ?: continue
            if (entry.optString("id") != id) kept.put(entry)
        }
        store.putDocument("strength_index", index.put("sessions", kept))
        strengthState()
    }

    @ReactMethod fun getProseSettings(promise: Promise) = task(promise) { prose.settings() }
    @ReactMethod fun configureProse(enabled: Boolean, model: String, apiKey: String?, promise: Promise) = task(promise) {
        prose.configure(enabled, model, apiKey)
    }
    @ReactMethod fun clearProseKey(promise: Promise) = task(promise) { prose.clearKey() }
    @ReactMethod fun clearProseCache(promise: Promise) = task(promise) { prose.clearCache() }
    @ReactMethod fun requestProse(engineJson: String, promise: Promise) = aiTask(promise) {
        runBlocking { prose.request(JSONObject(engineJson)) }
    }

    private fun aiTask(promise: Promise, block: () -> Any?) {
        aiWorker.execute {
            try { promise.resolve((block() ?: JSONObject.NULL).toString()) }
            catch (error: Exception) { promise.reject("CHAT_ERROR", error.message ?: "KI-Anfrage fehlgeschlagen", error) }
        }
    }
    @ReactMethod fun getChatHistory(promise: Promise) = aiTask(promise) { chat.history() }
    @ReactMethod fun clearChatHistory(promise: Promise) = aiTask(promise) { chat.clear() }
    @ReactMethod fun setChatTrainingAccess(includeTraining: Boolean, promise: Promise) = aiTask(promise) { chat.clear(includeTraining) }
    @ReactMethod fun sendChat(text: String, includeTraining: Boolean, promise: Promise) = aiTask(promise) { chat.send(text, includeTraining) }

    private fun recording(action: String, purpose: String, promise: Promise) {
        if (action == RecordingService.START && !granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            promise.reject("LOCATION_PERMISSION", "Für die Aufzeichnung bitte den genauen Standort erlauben."); return
        }
        context.runOnUiQueueThread {
            try {
                RecordingService.send(context, action, purpose, "phone")
                worker.execute {
                    try {
                        val deadline = android.os.SystemClock.elapsedRealtime() + 5000
                        val expected = when(action) { RecordingService.PAUSE -> "paused"; RecordingService.FINISH -> "completed"; else -> "recording" }
                        while (true) {
                            val current = store.active()
                            if ((expected == "completed" && current == null) || current?.optString("status") == expected) break
                            check(android.os.SystemClock.elapsedRealtime() < deadline) { "Aufzeichnung reagiert nicht. Berechtigungen und Status prüfen." }
                            android.os.SystemClock.sleep(50)
                        }
                        promise.resolve(state().toString())
                    } catch(error:Exception) { promise.reject("RECORDING_ERROR",error.message,error) }
                }
            } catch (error: Exception) { promise.reject("RECORDING_ERROR", error.message, error) }
        }
    }
    @ReactMethod fun startRun(purpose: String, promise: Promise) = recording(RecordingService.START, purpose, promise)
    @ReactMethod fun pauseRun(promise: Promise) = recording(RecordingService.PAUSE, "easy", promise)
    @ReactMethod fun resumeRun(promise: Promise) = recording(RecordingService.RESUME, "easy", promise)
    @ReactMethod fun finishRun(promise: Promise) = recording(RecordingService.FINISH, "easy", promise)
    @ReactMethod fun startRecording(purpose: String, promise: Promise) = startRun(purpose, promise)
    @ReactMethod fun pauseRecording(promise: Promise) = pauseRun(promise)
    @ReactMethod fun resumeRecording(promise: Promise) = resumeRun(promise)
    @ReactMethod fun stopRecording(promise: Promise) = finishRun(promise)

    private fun permissions(names: Array<String>, promise: Promise) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity as? PermissionAwareActivity
            if (activity == null) { promise.reject("NO_ACTIVITY", "Öffne die App, um Berechtigungen zu erlauben."); return@runOnUiQueueThread }
            val missing = names.filterNot(::granted).toTypedArray()
            if (missing.isEmpty()) { promise.resolve(capabilities().toString()); return@runOnUiQueueThread }
            activity.requestPermissions(missing, PERMISSION_REQUEST, PermissionListener { code, _, _ ->
                if (code == PERMISSION_REQUEST) { promise.resolve(capabilities().toString()); true } else false
            })
        }
    }
    @ReactMethod fun requestRecordingPermissions(promise: Promise) = permissions(
        (listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION) +
            if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()).toTypedArray(), promise)
    @ReactMethod fun requestBluetoothPermissions(promise: Promise) = permissions(
        if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), promise)

    private fun launch(intent: Intent, promise: Promise, result: (Int, Intent?) -> Unit) {
        context.runOnUiQueueThread {
            val activity = context.currentActivity
            if (activity == null) { promise.reject("NO_ACTIVITY", "Öffne die App für die Dateiauswahl."); return@runOnUiQueueThread }
            if (pending != null) { promise.reject("PICKER_BUSY", "Eine Auswahl ist bereits geöffnet."); return@runOnUiQueueThread }
            pending = promise to result
            try { activity.startActivityForResult(intent, DOCUMENT_REQUEST) }
            catch (error: Exception) { pending = null; promise.reject("PICKER_ERROR", error.message, error) }
        }
    }

    @ReactMethod fun importFiles(promise: Promise) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        launch(intent, promise) { code, data ->
            if (code != Activity.RESULT_OK || data == null) { promise.resolve("{\"cancelled\":true}") }
            else {
                val uris = mutableListOf<Uri>()
                data.clipData?.let { clips -> repeat(clips.itemCount) { uris.add(clips.getItemAt(it).uri) } }
                if (uris.isEmpty()) data.data?.let(uris::add)
                importWorker.execute {
                    try { promise.resolve(importer.importUris(uris).toString()) }
                    catch (error: Exception) { promise.reject("IMPORT_ERROR", error.message, error) }
                }
            }
        }
    }
    @ReactMethod fun getImportStatus(promise: Promise) { promise.resolve(importer.status().toString()) }
    @ReactMethod fun cancelImport(promise: Promise) { importer.cancel(); promise.resolve(importer.status().toString()) }
    @ReactMethod fun getVendorSummary(promise: Promise) = task(promise) {
        JSONObject().put("wellness", store.wellnessSummary(3)).put("strength", store.strengthSummary(5))
            .put("import", importer.status())
    }

    @ReactMethod fun exportBackup(promise: Promise) {
        launch(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip")
            .putExtra(Intent.EXTRA_TITLE, "runback-backup-${System.currentTimeMillis()}.zip"), promise) { code, data ->
            val uri = data?.data
            if (code != Activity.RESULT_OK || uri == null) promise.resolve("{\"cancelled\":true}")
            else task(promise) {
                context.contentResolver.openOutputStream(uri, "wt")!!.use(store::backup)
                JSONObject().put("exported", true).put("format", "runback-backup")
            }
        }
    }
    @ReactMethod fun restoreBackup(promise: Promise) {
        launch(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), promise) { code, data ->
            val uri = data?.data
            if (code != Activity.RESULT_OK || uri == null) promise.resolve("{\"cancelled\":true}")
            else task(promise) {
                check(store.active() == null) { "Beende zuerst die Aufzeichnung." }
                chat.resetData { context.contentResolver.openInputStream(uri)!!.use(store::restore) }
            }
        }
    }
    @ReactMethod fun exportRun(id: String, format: String, promise: Promise) {
        val extension = format.lowercase()
        if (extension !in listOf("gpx", "json", "fit")) { promise.reject("FORMAT", "Unterstützt: GPX, JSON, FIT"); return }
        launch(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (extension == "gpx") "application/gpx+xml" else if (extension == "json") "application/json" else "application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, "runback-$id.$extension"), promise) { code, data ->
            val uri = data?.data
            if (code != Activity.RESULT_OK || uri == null) promise.resolve("{\"cancelled\":true}")
            else task(promise) {
                context.contentResolver.openOutputStream(uri, "wt")!!.use { importer.exportRun(id, extension, it) }
                JSONObject().put("exported", true).put("format", extension)
                    .put("limitation", "Austauschformat; für den vollständigen App-Zustand ein Backup erstellen.")
            }
        }
    }

    @ReactMethod fun bleStatus(promise: Promise) = task(promise) { BleSensors.get(context).status() }
    @ReactMethod fun bleStartScan(promise: Promise) = task(promise) { BleSensors.get(context).startScan(); BleSensors.get(context).status() }
    @ReactMethod fun bleStopScan(promise: Promise) = task(promise) { BleSensors.get(context).stopScan(); BleSensors.get(context).status() }
    @ReactMethod fun bleConnect(address: String, promise: Promise) = task(promise) { BleSensors.get(context).connect(address); BleSensors.get(context).status() }
    @ReactMethod fun bleDisconnect(address: String, promise: Promise) = task(promise) { BleSensors.get(context).disconnect(address); BleSensors.get(context).status() }

    @ReactMethod fun getWearStatus(promise: Promise) = task(promise) {
        try {
            val nodes = Tasks.await(Wearable.getNodeClient(context).connectedNodes, 5, java.util.concurrent.TimeUnit.SECONDS)
            JSONObject().put("status", if (nodes.isEmpty()) "disconnected" else "connected")
                .put("connected", nodes.isNotEmpty())
                .put("nodes", JSONArray().apply {
                    nodes.forEach { node -> put(JSONObject().put("id", node.id).put("name", node.displayName).put("nearby", node.isNearby)) }
                })
        } catch (error: Exception) {
            val status = JSONObject().put("status", "unavailable").put("connected", false)
                .put("nodes", JSONArray()).put("message", "Wear OS-Dienst ist auf diesem Telefon nicht verfügbar.")
                .put("error", error.message ?: error.javaClass.simpleName).put("updatedAt", System.currentTimeMillis())
            runCatching { store.putDocument("wearSyncStatus", status) }
            status
        }
    }

    @ReactMethod fun healthStatus(promise: Promise) = task(promise) { runBlocking { health.status() } }
    @ReactMethod fun healthRequestPermissions(write: Boolean, route: Boolean, promise: Promise) {
        try { launch(health.permissionIntent(write, route), promise) { _, _ -> healthStatus(promise) } }
        catch (error: Exception) { promise.reject("HEALTH_PERMISSION", error.message, error) }
    }
    @ReactMethod fun healthImport(days: Int, promise: Promise) = task(promise) {
        runBlocking {
            health.importRecent(days.coerceIn(1, 3650)) { summary, samples ->
                val sourceId = summary.optString("healthConnectId", summary.optString("id"))
                store.addImportedRun(summary, samples, "healthconnect:$sourceId")
            }.also { store.putDocument("healthConnectStatus", it) }
        }
    }
    @ReactMethod fun healthExport(id: String, includeRoute: Boolean, promise: Promise) = task(promise) {
        runBlocking { health.exportRun(store.detail(id), store.rawSamples(id), includeRoute) }
    }
    @ReactMethod fun healthRequestRoute(sessionId: String, promise: Promise) {
        try {
            launch(health.routeIntent(sessionId), promise) { code, data -> task(promise) {
                val route = health.parseRouteResult(code, data)
                if (route != null) store.putDocument("healthRoute_$sessionId", JSONObject().put("samples", route))
                JSONObject().put("granted", route != null).put("points", route?.length() ?: 0)
            } }
        } catch (error: Exception) { promise.reject("HEALTH_ROUTE", error.message, error) }
    }
    @ReactMethod fun enrichWeather(id: String, promise: Promise) = task(promise) {
        runBlocking { WeatherIntegration(context).enrich(store.detail(id), store.rawSamples(id), store.settings().optBoolean("weatherEnabled", false)) }
            .also { store.putDocument("weather_$id", it) }
    }

    override fun invalidate() {
        importer.cancel()
        pending?.first?.reject("APP_CLOSED", "Die App wurde geschlossen.")
        pending = null
        chat.resetData {}
        aiWorker.shutdown()
        worker.shutdown()
        importWorker.shutdown()
        super.invalidate()
    }
    companion object { private const val DOCUMENT_REQUEST = 8241; private const val PERMISSION_REQUEST = 8242 }
}
