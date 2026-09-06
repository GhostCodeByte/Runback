package com.runback.core

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject

/** All storage and sensor callbacks run on one thread; an interrupted run never resumes itself. */
class RecordingService : Service(), SensorEventListener, LocationListener {
    private lateinit var workerThread: HandlerThread
    private lateinit var worker: Handler
    private lateinit var store: RunStore
    private lateinit var sensors: SensorManager
    private lateinit var locations: LocationManager
    private var wakeLock: PowerManager.WakeLock? = null
    private var activeId: String? = null
    private var recording = false
    private var listening = false
    private var foreground = false
    private var lastCheckpoint = 0L
    private var lastWakeRenewal = 0L
    private var lastAcceleration = 0L
    private val pending = ArrayList<RawSample>()
    private val warned = HashSet<String>()

    override fun onCreate() {
        super.onCreate()
        store = RunStore(this)
        sensors = getSystemService(SENSOR_SERVICE) as SensorManager
        locations = getSystemService(LOCATION_SERVICE) as LocationManager
        workerThread = HandlerThread("RunbackRecording").also { it.start() }
        worker = Handler(workerThread.looper)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            NotificationChannel(CHANNEL, "Laufaufzeichnung", NotificationManager.IMPORTANCE_LOW).apply {
                description = "GPS- und Sensoraufzeichnung während eines Laufs"
                setShowBadge(false)
            }
        )
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Runback:Recording").apply {
                setReferenceCounted(false)
            }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Meet the foreground-service deadline before any disk or sensor work is queued.
        try {
            val notification = notification("Aufzeichnung wird vorbereitet", false)
            if (Build.VERSION.SDK_INT >= 29) {
                val serviceTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
                    if (Build.VERSION.SDK_INT >= 34 && hasHeartPermission()) ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH else 0
                startForeground(NOTIFICATION_ID, notification, serviceTypes)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            foreground = true
        } catch (error: RuntimeException) {
            Log.e(TAG, "Foreground recording could not start", error)
            worker.post {
                runCatching { store.markInterrupted("Aufzeichnung konnte nicht starten: Standortberechtigung prüfen.") }
                broadcastWarning("foreground", "Aufzeichnung konnte nicht starten. Standortberechtigung prüfen.")
                stopSelf(startId)
            }
            return START_NOT_STICKY
        }
        worker.post {
            try {
                if (intent == null) {
                    store.markInterrupted("Aufzeichnung wurde vom System unterbrochen. Bitte bewusst fortsetzen.")
                    shutdown()
                    return@post
                }
                when (intent.action) {
                    START -> {
                        val session = store.start(
                            intent.getStringExtra("purpose") ?: "easy",
                            intent.getStringExtra("source") ?: "phone"
                        )
                        activeId = session.getString("id")
                        recording = session.optString("status") == "recording"
                        if (recording) beginListening()
                        updateNotification()
                    }
                    PAUSE -> {
                        flush()
                        recording = false
                        endListening()
                        store.pause()
                        activeId?.let { store.checkpoint(it) }
                        updateNotification()
                    }
                    RESUME -> {
                        val session = store.resume()
                        if (session == null) {
                            shutdown()
                        } else {
                            activeId = session.getString("id")
                            recording = session.optString("status") == "recording"
                            if (recording) beginListening()
                            updateNotification()
                        }
                    }
                    FINISH -> {
                        flush()
                        recording = false
                        endListening()
                        store.finish()
                        shutdown()
                    }
                    else -> shutdown()
                }
            } catch (error: Exception) {
                failRecording(error)
            }
        }
        return START_STICKY
    }

    private fun beginListening() {
        if (listening) return
        listening = true
        warned.clear()
        lastAcceleration = 0L
        lastCheckpoint = SystemClock.elapsedRealtime()
        renewWakeLock()
        activeId?.let { runId ->
            runCatching { BleSensors.get(this).startRecording(runId) }
                .onFailure { warn("ble_unavailable", "Bluetooth-Sensoren konnten nicht starten: ${it.message.orEmpty()}") }
        }
        registerSensor(Sensor.TYPE_ACCELEROMETER, "Beschleunigungssensor")
        registerSensor(Sensor.TYPE_PRESSURE, "Barometer")
        if (hasHeartPermission()) {
            registerSensor(Sensor.TYPE_HEART_RATE, "Pulssensor")
        }
        val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            throw SecurityException("Standortberechtigung fehlt")
        }
        var providerCount = 0
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (provider == LocationManager.GPS_PROVIDER && !fine) continue
            try {
                if (locations.isProviderEnabled(provider)) {
                    locations.requestLocationUpdates(provider, 1_000L, 0f, this, workerThread.looper)
                    providerCount++
                }
            } catch (error: RuntimeException) {
                warn("location_$provider", "Standortquelle $provider nicht verfügbar: ${error.message.orEmpty()}")
            }
        }
        if (providerCount == 0) warn("gps_disabled", "Standort ist ausgeschaltet. Der Lauf wird ohne GPS-Punkte aufgezeichnet.")
        worker.removeCallbacks(tick)
        worker.postDelayed(tick, FLUSH_INTERVAL_MS)
    }

    private fun registerSensor(type: Int, label: String) {
        val sensor = sensors.getDefaultSensor(type)
        if (sensor == null) {
            if (type != Sensor.TYPE_HEART_RATE) warn("sensor_$type", "$label ist auf diesem Gerät nicht verfügbar.")
            return
        }
        try {
            if (!sensors.registerListener(this, sensor, 100_000, worker)) {
                warn("sensor_$type", "$label konnte nicht gestartet werden.")
            }
        } catch (error: RuntimeException) {
            warn("sensor_$type", "$label ist nicht verfügbar: ${error.message.orEmpty()}")
        }
    }

    private fun hasHeartPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 36) {
            "android.permission.health.READ_HEART_RATE"
        } else {
            Manifest.permission.BODY_SENSORS
        }
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!recording) return
            try {
                flush()
                val now = SystemClock.elapsedRealtime()
                if (now - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) {
                    activeId?.let { store.checkpoint(it) }
                    lastCheckpoint = now
                    updateNotification()
                }
                if (now - lastWakeRenewal >= WAKE_RENEW_INTERVAL_MS) renewWakeLock()
                worker.postDelayed(this, FLUSH_INTERVAL_MS)
            } catch (error: Exception) {
                failRecording(error)
            }
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!recording || activeId == null) return
        if (event.values.any { !it.isFinite() }) return
        val kind: String
        val values = JSONObject()
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                // Small scheduling jitter must not halve the requested 10 Hz sample rate.
                if (event.timestamp - lastAcceleration < 95_000_000L) return
                lastAcceleration = event.timestamp
                kind = "accelerometer"
                values.put("x", event.values[0].toDouble())
                    .put("y", event.values[1].toDouble()).put("z", event.values[2].toDouble())
            }
            Sensor.TYPE_PRESSURE -> {
                kind = "pressure"
                values.put("hPa", event.values[0].toDouble())
            }
            Sensor.TYPE_HEART_RATE -> {
                if (event.values[0] <= 0 || event.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) return
                kind = "heartRate"
                values.put("bpm", event.values[0].toDouble())
            }
            else -> return
        }
        values.put("accuracy", event.accuracy)
        // Sensor timestamps are monotonic nanoseconds, not Unix timestamps.
        val sampleTime = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000L
        pending.add(RawSample(sampleTime, kind, values))
        if (pending.size >= 128) {
            try { flush() } catch (error: Exception) { failRecording(error) }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onLocationChanged(location: Location) {
        val runId = activeId ?: return
        if (!recording) return
        val values = JSONObject().put("latitude", location.latitude).put("longitude", location.longitude)
            .put("accuracyM", location.accuracy.toDouble()).put("provider", location.provider ?: "unknown")
            .put("elapsedRealtimeNanos", location.elapsedRealtimeNanos)
        if (location.hasAltitude()) values.put("altitudeM", location.altitude)
        if (location.hasSpeed()) values.put("speedMps", location.speed.toDouble())
        if (location.hasBearing()) values.put("bearingDeg", location.bearing.toDouble())
        try {
            // GPS is appended immediately; a killed process loses at most the current sensor batch.
            store.appendSamples(runId, listOf(RawSample(location.time, "gps", values)))
        } catch (error: Exception) {
            failRecording(error)
        }
    }

    override fun onProviderDisabled(provider: String) {
        if (recording) warn("provider_disabled_$provider", "Standortquelle $provider wurde ausgeschaltet.")
    }

    override fun onProviderEnabled(provider: String) = Unit
    @Deprecated("Required on older Android versions")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    private fun flush() {
        val runId = activeId ?: return
        if (pending.isEmpty()) return
        store.appendSamples(runId, pending.toList())
        pending.clear()
    }

    private fun renewWakeLock() {
        wakeLock?.acquire(WAKE_TIMEOUT_MS)
        lastWakeRenewal = SystemClock.elapsedRealtime()
    }

    private fun endListening() {
        listening = false
        worker.removeCallbacks(tick)
        runCatching { BleSensors.get(this).stopRecording() }
        sensors.unregisterListener(this)
        runCatching { locations.removeUpdates(this) }
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    private fun failRecording(error: Exception) {
        Log.e(TAG, "Recording interrupted", error)
        recording = false
        endListening()
        val message = "Aufzeichnung unterbrochen: ${error.message ?: "Speicher oder Berechtigungen prüfen"}"
        runCatching { store.markInterrupted(message) }
        broadcastWarning("recording_interrupted", message)
        shutdown()
    }

    private fun warn(code: String, message: String) {
        if (!warned.add(code)) return
        Log.w(TAG, message)
        activeId?.let { runCatching { store.addEvent(it, "warning", JSONObject().put("code", code).put("message", message)) } }
        broadcastWarning(code, message)
    }

    private fun broadcastWarning(code: String, message: String) {
        sendBroadcast(Intent("com.runback.RECORDING_WARNING").setPackage(packageName)
            .putExtra("code", code).putExtra("message", message))
    }

    private fun updateNotification() {
        val session = store.active()
        if (session == null) {
            shutdown()
            return
        }
        val paused = session.optString("status") != "recording"
        val distance = String.format(java.util.Locale.GERMANY, "%.2f km", session.optDouble("distanceM", 0.0) / 1000.0)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(
            NOTIFICATION_ID,
            notification(if (paused) "Pausiert · $distance" else "Lauf aktiv · $distance", paused, session.optLong("elapsedMs"))
        )
    }

    private fun notification(text: String, paused: Boolean, elapsedMs: Long = 0L): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Runback")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(0xff7ee2a8.toInt())
        if (openIntent != null) builder.setContentIntent(PendingIntent.getActivity(
            this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ))
        if (!paused && elapsedMs > 0) builder.setWhen(System.currentTimeMillis() - elapsedMs).setUsesChronometer(true)
        builder.addAction(Notification.Action.Builder(
            null, if (paused) "Fortsetzen" else "Pause", actionIntent(if (paused) RESUME else PAUSE, 1)
        ).build())
        builder.addAction(Notification.Action.Builder(null, "Beenden", actionIntent(FINISH, 2)).build())
        return builder.build()
    }

    private fun actionIntent(action: String, requestCode: Int): PendingIntent = PendingIntent.getForegroundService(
        this, requestCode, Intent(this, RecordingService::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun shutdown() {
        recording = false
        endListening()
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
        stopSelf()
    }

    override fun onDestroy() {
        // FIFO posting drains callbacks already received before closing the worker.
        worker.post {
            try {
                flush()
                if (recording) store.markInterrupted("Aufzeichnung wurde beendet. Gespeicherte Daten bleiben erhalten.")
            } catch (error: Exception) {
                Log.e(TAG, "Could not persist final recording checkpoint", error)
            } finally {
                recording = false
                endListening()
                runCatching { BleSensors.get(this).stopAll() }
                workerThread.quitSafely()
            }
        }
        super.onDestroy()
    }

    companion object {
        const val START = "com.runback.recording.START"
        const val PAUSE = "com.runback.recording.PAUSE"
        const val RESUME = "com.runback.recording.RESUME"
        const val FINISH = "com.runback.recording.FINISH"
        private const val TAG = "RunbackRecording"
        private const val CHANNEL = "runback_recording"
        private const val NOTIFICATION_ID = 731
        private const val FLUSH_INTERVAL_MS = 1_000L
        private const val CHECKPOINT_INTERVAL_MS = 2_000L
        private const val WAKE_RENEW_INTERVAL_MS = 5 * 60_000L
        private const val WAKE_TIMEOUT_MS = 10 * 60_000L

        fun send(context: Context, action: String, purpose: String = "easy", source: String = "phone") {
            require(action in setOf(START, PAUSE, RESUME, FINISH)) { "Unknown recording action: $action" }
            context.startForegroundService(Intent(context, RecordingService::class.java)
                .setAction(action).putExtra("purpose", purpose).putExtra("source", source))
        }
    }
}
