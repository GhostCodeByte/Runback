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
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale
import org.json.JSONObject

/** All storage and sensor callbacks run on one thread; an interrupted run never resumes itself. */
class RecordingService : Service(), SensorEventListener, LocationListener, TextToSpeech.OnInitListener {
    private lateinit var workerThread: HandlerThread
    private lateinit var worker: Handler
    private val mainHandler = Handler(Looper.getMainLooper())
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
    private var routeSpeech: TextToSpeech? = null
    private var routeSpeechReady = false
    private var routePlan: JSONObject? = null
    private var routeVoice = JSONObject()
    private var routeCursor = 0
    private var nextRouteCueDistance = 1_000.0

    override fun onCreate() {
        super.onCreate()
        store = RunStore(this)
        routeSpeech = TextToSpeech(this, this)
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
                            intent.getStringExtra("source") ?: "phone",
                            intent.getStringExtra("sport") ?: "running"
                        )
                        activeId = session.getString("id")
                        recording = session.optString("status") == "recording"
                        loadRouteGuidance(intent.getStringExtra("routePlanId"), activeId)
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
                            loadRouteGuidance(null, activeId)
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
        if (providerCount == 0) warn("gps_disabled", "Standort ist ausgeschaltet. Die Aufzeichnung läuft ohne GPS-Punkte.")
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
            maybeSpeakRoute(location)
        } catch (error: Exception) {
            failRecording(error)
        }
    }

    override fun onInit(status: Int) {
        routeSpeechReady = status == TextToSpeech.SUCCESS
        if (routeSpeechReady) {
            routeSpeech?.language = Locale.GERMANY
        }
    }

    private fun loadRouteGuidance(explicitRouteId: String?, runId: String?) {
        routePlan = null
        routeCursor = 0
        routeVoice = JSONObject()
        nextRouteCueDistance = 1_000.0
        val state = store.getDocument("route_planner") ?: return
        routeVoice = state.optJSONObject("voice") ?: JSONObject()
        val activeId = (explicitRouteId ?: state.optString("activeRoutePlanId"))
            .takeIf { it.isNotBlank() }
            ?: return
        if (explicitRouteId == null && state.optString("activeRunId") != runId) return
        val routes = state.optJSONArray("routes") ?: return
        for (index in 0 until routes.length()) {
            val candidate = routes.optJSONObject(index) ?: continue
            if (candidate.optString("id") == activeId && candidate.optString("source") == "brouter") {
                routePlan = candidate
                val intervalKm = routeVoice.optDouble("intervalKm", 1.0)
                nextRouteCueDistance = intervalKm.coerceIn(0.25, 10.0) * 1_000.0
                return
            }
        }
    }

    private data class RouteProgress(
        val nearestIndex: Int,
        val distanceFromRoute: Double,
        val remainingMeters: Double,
    )

    private fun routeProgress(location: Location): RouteProgress? {
        val points = routePlan?.optJSONArray("points") ?: return null
        if (points.length() < 2) return null
        val firstIndex = routeCursor.coerceIn(0, points.length() - 1)
        var nearestIndex = firstIndex
        var nearestDistance = Double.MAX_VALUE
        for (index in firstIndex until points.length()) {
            val point = points.optJSONObject(index) ?: continue
            val distance = distanceMeters(
                location.latitude,
                location.longitude,
                point.optDouble("latitude"),
                point.optDouble("longitude"),
            )
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestIndex = index
            }
        }
        routeCursor = nearestIndex
        var remaining = 0.0
        for (index in nearestIndex + 1 until points.length()) {
            val before = points.optJSONObject(index - 1) ?: continue
            val after = points.optJSONObject(index) ?: continue
            remaining += distanceMeters(
                before.optDouble("latitude"),
                before.optDouble("longitude"),
                after.optDouble("latitude"),
                after.optDouble("longitude"),
            )
        }
        return RouteProgress(nearestIndex, nearestDistance, remaining)
    }

    private fun nextTurnCue(progress: RouteProgress): String? {
        val points = routePlan?.optJSONArray("points") ?: return null
        if (progress.nearestIndex >= points.length() - 3) return null
        val currentIndex = (progress.nearestIndex + 2).coerceAtMost(points.length() - 2)
        val current = points.optJSONObject(progress.nearestIndex) ?: return null
        val lookAhead = points.optJSONObject(currentIndex) ?: return null
        val currentBearing = bearingDegrees(current, lookAhead)
        var distance = 0.0
        for (index in currentIndex + 1 until points.length() - 2) {
            val before = points.optJSONObject(index) ?: continue
            val after = points.optJSONObject(index + 2) ?: continue
            val delta = bearingDelta(currentBearing, bearingDegrees(before, after))
            if (kotlin.math.abs(delta) >= 45.0 && distance >= 35.0) {
                val direction = if (delta > 0) "rechts" else "links"
                return "Nächste Richtungsänderung in ungefähr ${formatDistanceSpeech(distance)} $direction."
            }
            val next = points.optJSONObject(index + 1) ?: continue
            distance += distanceMeters(
                before.optDouble("latitude"),
                before.optDouble("longitude"),
                next.optDouble("latitude"),
                next.optDouble("longitude"),
            )
        }
        return null
    }

    private fun maybeSpeakRoute(location: Location) {
        if (!routeSpeechReady || routePlan == null) return
        val session = store.active() ?: return
        val distance = session.optDouble("distanceM", 0.0)
        refreshRouteVoice(distance)
        if (!routeVoice.optBoolean("enabled", true)) return
        if (!distance.isFinite() || distance < nextRouteCueDistance) return
        val intervalMeters = routeVoice.optDouble("intervalKm", 1.0).coerceIn(0.25, 10.0) * 1_000.0
        while (nextRouteCueDistance <= distance) nextRouteCueDistance += intervalMeters
        val parts = ArrayList<String>()
        if (routeVoice.optBoolean("pace", true)) {
            val elapsedSeconds = session.optDouble("elapsedMs", 0.0) / 1_000.0
            val pace = if (distance >= 20.0 && elapsedSeconds > 0.0) elapsedSeconds / (distance / 1_000.0) else Double.NaN
            parts.add(if (pace.isFinite()) "Dein Pace ist ${formatPaceSpeech(pace) } pro Kilometer." else "Dein Pace ist noch nicht verfügbar.")
        }
        if (routeVoice.optBoolean("distance", true)) {
            parts.add("Du bist ${formatDistanceSpeech(distance)} gelaufen.")
        }
        val progress = routeProgress(location)
        if (routeVoice.optBoolean("navigation", true) && progress != null) {
            parts.add("Noch ungefähr ${formatDistanceSpeech(progress.remainingMeters)} auf der geplanten Route.")
            nextTurnCue(progress)?.let(parts::add)
        }
        if (routeVoice.optBoolean("heartRate", false)) {
            val heartRate = session.optDouble("lastHeartRate", Double.NaN)
            if (heartRate.isFinite()) parts.add("Dein Puls liegt bei ${heartRate.toInt()} Schlägen pro Minute.")
        }
        if (parts.isNotEmpty()) speakRoute(parts.joinToString(" "))
    }

    private fun refreshRouteVoice(distance: Double) {
        val activeId = routePlan?.optString("id") ?: return
        val state = store.getDocument("route_planner") ?: return
        if (state.optString("activeRoutePlanId") != activeId) return
        val nextVoice = state.optJSONObject("voice") ?: return
        val previousInterval = routeVoice.optDouble("intervalKm", 1.0).coerceIn(0.25, 10.0)
        val nextInterval = nextVoice.optDouble("intervalKm", 1.0).coerceIn(0.25, 10.0)
        routeVoice = nextVoice
        if (previousInterval != nextInterval && distance.isFinite()) {
            val intervalMeters = nextInterval * 1_000.0
            nextRouteCueDistance = (kotlin.math.floor(distance / intervalMeters) + 1.0) * intervalMeters
        }
    }

    private fun speakRoute(text: String) {
        if (!routeSpeechReady || text.isBlank()) return
        mainHandler.post {
            routeSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "runback-route-service")
        }
    }

    private fun formatDistanceSpeech(meters: Double): String =
        if (!meters.isFinite()) "unbekannter Entfernung" else String.format(Locale.GERMANY, "%.1f Kilometer", meters / 1_000.0)

    private fun formatPaceSpeech(seconds: Double): String {
        val rounded = seconds.coerceAtLeast(0.0).toLong()
        return "${rounded / 60}:${(rounded % 60).toString().padStart(2, '0')} Minuten"
    }

    private fun distanceMeters(firstLat: Double, firstLon: Double, secondLat: Double, secondLon: Double): Double {
        val results = FloatArray(1)
        Location.distanceBetween(firstLat, firstLon, secondLat, secondLon, results)
        return results[0].toDouble()
    }

    private fun bearingDegrees(first: JSONObject, second: JSONObject): Double {
        val firstLatitude = Math.toRadians(first.optDouble("latitude"))
        val secondLatitude = Math.toRadians(second.optDouble("latitude"))
        val longitude = Math.toRadians(second.optDouble("longitude") - first.optDouble("longitude"))
        val y = kotlin.math.sin(longitude) * kotlin.math.cos(secondLatitude)
        val x = kotlin.math.cos(firstLatitude) * kotlin.math.sin(secondLatitude) -
            kotlin.math.sin(firstLatitude) * kotlin.math.cos(secondLatitude) * kotlin.math.cos(longitude)
        return Math.toDegrees(kotlin.math.atan2(y, x))
    }

    private fun bearingDelta(first: Double, second: Double): Double = (second - first + 540.0) % 360.0 - 180.0

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
            notification(if (paused) "Pausiert · $distance" else "${sportNoun(session.optString("sport"))} aktiv · $distance", paused, session.optLong("elapsedMs"))
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
        routeSpeech?.stop()
        routeSpeech?.shutdown()
        routeSpeech = null
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

        /** Anzeigename je Sportart; unbekannte Werte gelten als Lauf (siehe src/domain/sport.ts). */
        fun sportNoun(sport: String?): String = if (sport == "cycling") "Radfahrt" else "Lauf"
        fun send(context: Context, action: String, purpose: String = "easy", source: String = "phone", sport: String = "running", routePlanId: String? = null) {
            require(action in setOf(START, PAUSE, RESUME, FINISH)) { "Unknown recording action: $action" }
            context.startForegroundService(Intent(context, RecordingService::class.java)
                .setAction(action).putExtra("purpose", purpose).putExtra("source", source).putExtra("sport", sport)
                .putExtra("routePlanId", routePlanId))
        }
    }
}
