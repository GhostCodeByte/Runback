package com.runback

import android.Manifest
import android.content.Context
import android.content.Intent
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.runback.core.RunStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.HashSet
import java.util.Locale
import java.util.concurrent.Executors

/** Small bridge for route planning. GPS samples stay in the recording service. */
class RoutePlannerModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), TextToSpeech.OnInitListener {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val store = RunStore(context)
    private var textToSpeech: TextToSpeech? = null
    private var speechReady = false

    init {
        main.post {
            textToSpeech = TextToSpeech(context.applicationContext, this)
        }
    }

    override fun getName() = "RoutePlanner"

    private fun defaultRoutePlannerState() = JSONObject()
        .put("routes", JSONArray())
        .put(
            "voice",
            JSONObject()
                .put("enabled", true)
                .put("pace", true)
                .put("distance", true)
                .put("heartRate", false)
                .put("navigation", true)
                .put("intervalKm", 1.0),
        )
        .put("activeRoutePlanId", JSONObject.NULL)

    private fun routePlannerState(): JSONObject {
        val state = store.getDocument("route_planner") ?: return defaultRoutePlannerState()
        val activeRunId = store.active()?.optString("id").orEmpty()
        val routes = state.optJSONArray("routes") ?: return state
        var changed = false
        var activeRouteId = state.optString("activeRoutePlanId")
        for (index in 0 until routes.length()) {
            val route = routes.optJSONObject(index) ?: continue
            val routeRunId = route.optString("activeRunId")
            if (routeRunId.isNotBlank() && routeRunId != activeRunId) {
                route.remove("activeRunId")
                if (activeRouteId == route.optString("id")) activeRouteId = ""
                changed = true
            }
        }
        if (changed) {
            state.put("activeRoutePlanId", if (activeRouteId.isBlank()) JSONObject.NULL else activeRouteId)
            store.putDocument("route_planner", state)
        }
        return state
    }

    @ReactMethod
    fun getRoutePlannerState(promise: Promise) {
        worker.execute {
            try {
                promise.resolve(routePlannerState().toString())
            } catch (error: Exception) {
                promise.reject(
                    "ROUTE_STATE_ERROR",
                    error.message ?: "Routendaten konnten nicht geladen werden.",
                    error,
                )
            }
        }
    }

    @ReactMethod
    fun saveRoutePlannerState(json: String, promise: Promise) {
        worker.execute {
            try {
                val next = JSONObject(json)
                val routes = next.optJSONArray("routes") ?: JSONArray()
                require(routes.length() <= 10) { "Maximal zehn Routen können gespeichert werden." }
                val routeIds = HashSet<String>()
                val currentRunId = store.active()?.optString("id").orEmpty()
                val activeRouteId = next.optString("activeRoutePlanId")
                for (index in 0 until routes.length()) {
                    val route = routes.optJSONObject(index)
                        ?: error("Ungültige Route an Position ${index + 1}.")
                    val routeId = route.optString("id")
                    require(routeId.matches(Regex("[A-Za-z0-9_-]{1,100}")) && routeIds.add(routeId)) {
                        "Routen benötigen eindeutige, gültige Kennungen."
                    }
                    require(route.optString("source") == "brouter") {
                        "Nur verifizierte BRouter-Routen können gespeichert werden."
                    }
                    require(route.optString("mode") in setOf("loop", "out_and_back")) {
                        "Ungültiger Routentyp."
                    }
                    require(route.optString("preference") in setOf("flat", "quiet", "green", "balanced")) {
                        "Ungültige Routenpriorität."
                    }
                    require(route.optDouble("distanceKm", Double.NaN).isFinite() && route.optDouble("distanceKm") in 1.0..50.0) {
                        "Ungültige Routendistanz."
                    }
                    require(route.optDouble("distanceMeters", Double.NaN).isFinite() && route.optDouble("distanceMeters") > 0.0) {
                        "Ungültige Routengeometrie."
                    }
                    val start = route.optJSONObject("start")
                        ?: error("Eine Route benötigt einen Startpunkt.")
                    require(validCoordinate(start)) { "Ungültige Startkoordinaten." }
                    val routeRunId = route.optString("activeRunId")
                    require(routeRunId.isBlank() || routeRunId == currentRunId) {
                        "Die aktive Laufzuordnung ist nicht mehr gültig."
                    }
                    require(routeRunId.isBlank() || activeRouteId == routeId) {
                        "Die aktive Route und der aktive Lauf passen nicht zusammen."
                    }
                    val points = route.optJSONArray("points") ?: JSONArray()
                    require(points.length() in 2..512) {
                        "Eine Route muss zwischen zwei und 512 Punkten enthalten."
                    }
                    for (pointIndex in 0 until points.length()) {
                        val point = points.optJSONObject(pointIndex)
                            ?: error("Ungültiger Routenpunkt.")
                        require(validCoordinate(point)) { "Ungültige Koordinaten in der Route." }
                    }
                }
                if (activeRouteId.isNotBlank()) {
                    require((0 until routes.length()).any {
                        routes.optJSONObject(it)?.optString("id") == activeRouteId
                    }) { "Die aktive Route ist nicht gespeichert." }
                }
                val voice = next.optJSONObject("voice") ?: JSONObject()
                val intervalKm = voice.optDouble("intervalKm", 1.0)
                require(intervalKm.isFinite() && intervalKm in 0.25..10.0) {
                    "Das Ansageintervall muss zwischen 0,25 und 10 km liegen."
                }
                next.put("routes", routes).put("voice", voice.put("intervalKm", intervalKm))
                store.putDocument("route_planner", next)
                promise.resolve(next.toString())
            } catch (error: Exception) {
                promise.reject(
                    "ROUTE_STATE_ERROR",
                    error.message ?: "Routendaten konnten nicht gespeichert werden.",
                    error,
                )
            }
        }
    }

    private fun validCoordinate(point: JSONObject): Boolean {
        val latitude = point.optDouble("latitude", Double.NaN)
        val longitude = point.optDouble("longitude", Double.NaN)
        return latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
    }

    @ReactMethod
    fun openRouteFile(pointsJson: String, target: String, promise: Promise) {
        worker.execute {
            try {
                val points = JSONArray(pointsJson)
                require(points.length() in 2..512) {
                    "Eine Route muss zwischen zwei und 512 Punkten enthalten."
                }
                val routeDirectory = File(context.cacheDir, "routes").apply { mkdirs() }
                val routeFile = File(
                    routeDirectory,
                    "runback-route-${System.currentTimeMillis()}.gpx",
                )
                routeFile.writeText(routeGpx(points), Charsets.UTF_8)
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    routeFile,
                )
                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/gpx+xml")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                require(viewIntent.resolveActivity(context.packageManager) != null) {
                    "Keine App zum Öffnen von GPX-Dateien gefunden."
                }
                val externalIntent = if (target == "comaps") {
                    val comapsPackage = listOf(
                        "app.comaps.google",
                        "app.comaps",
                        "app.organicmaps",
                    ).firstOrNull { packageName ->
                        viewIntent.setPackage(packageName)
                        viewIntent.resolveActivity(context.packageManager) != null
                    }
                    viewIntent.setPackage(comapsPackage)
                    if (comapsPackage == null) {
                        Intent.createChooser(viewIntent, "Route öffnen")
                    } else {
                        viewIntent
                    }
                } else {
                    Intent.createChooser(viewIntent, "Route öffnen")
                }
                main.post {
                    try {
                        val activity = context.currentActivity
                            ?: error("Öffne die App, um die Route zu teilen.")
                        activity.startActivity(externalIntent)
                        promise.resolve(
                            JSONObject()
                                .put("opened", true)
                                .put("target", target)
                                .toString(),
                        )
                    } catch (error: Exception) {
                        promise.reject(
                            "ROUTE_OPEN_ERROR",
                            error.message ?: "Route konnte nicht geöffnet werden.",
                            error,
                        )
                    }
                }
            } catch (error: Exception) {
                promise.reject(
                    "ROUTE_FILE_ERROR",
                    error.message ?: "Route konnte nicht vorbereitet werden.",
                    error,
                )
            }
        }
    }

    private fun routeGpx(points: JSONArray): String {
        val result = StringBuilder(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                "<gpx version=\"1.1\" creator=\"Runback\" " +
                "xmlns=\"http://www.topografix.com/GPX/1/1\"><trk>" +
                "<name>Runback Route</name><trkseg>",
        )
        for (index in 0 until points.length()) {
            val point = points.optJSONObject(index) ?: error("Ungültiger Routenpunkt.")
            require(validCoordinate(point)) { "Ungültige Koordinaten in der Route." }
            val latitude = point.optDouble("latitude")
            val longitude = point.optDouble("longitude")
            result.append("<trkpt lat=\"")
                .append(latitude)
                .append("\" lon=\"")
                .append(longitude)
                .append("\">")
            if (point.has("elevationMeters") && !point.isNull("elevationMeters")) {
                val elevation = point.optDouble("elevationMeters", Double.NaN)
                if (elevation.isFinite()) result.append("<ele>").append(elevation).append("</ele>")
            }
            result.append("</trkpt>")
        }
        return result.append("</trkseg></trk></gpx>").toString()
    }

    override fun onInit(status: Int) {
        speechReady = status == TextToSpeech.SUCCESS
        if (speechReady) {
            textToSpeech?.language = Locale.GERMANY
        }
    }

    private fun locationManager() =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private fun enabledProviders(manager: LocationManager, fine: Boolean, coarse: Boolean) =
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { provider ->
                if (provider == LocationManager.GPS_PROVIDER) fine else fine || coarse
            }
            .filter { provider -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }

    private fun currentLocation(manager: LocationManager, fine: Boolean, coarse: Boolean): Location? {
        val providers = enabledProviders(manager, fine, coarse)
        val known = providers
            .mapNotNull { provider ->
                if (provider == LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@mapNotNull null
                if (provider != LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@mapNotNull null
                runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
            }
            .maxByOrNull { it.time }
        val knownAge = known?.let { (System.currentTimeMillis() - it.time).coerceAtLeast(0L) }
        if (known != null && knownAge != null && knownAge <= 120_000L && known.accuracy <= 100f) return known

        val latch = java.util.concurrent.CountDownLatch(1)
        var fresh: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (fresh == null || location.time > (fresh?.time ?: 0L)) fresh = location
                latch.countDown()
            }

            override fun onProviderDisabled(provider: String) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            @Deprecated("Required on older Android versions")
            override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
        }
        main.post {
            providers.forEach { provider ->
                if (provider == LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@forEach
                if (provider != LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@forEach
                runCatching {
                    manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
                }
            }
        }
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
        main.post { runCatching { manager.removeUpdates(listener) } }
        return fresh ?: known?.takeIf { (System.currentTimeMillis() - it.time).coerceAtLeast(0L) <= 600_000L }
    }

    @ReactMethod
    fun getCurrentLocation(promise: Promise) {
        worker.execute {
            try {
                val fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                val coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!fine && !coarse) {
                    promise.reject("LOCATION_PERMISSION", "Für den Startpunkt fehlt die Standortfreigabe.")
                    return@execute
                }
                val manager = locationManager()
                val location = currentLocation(manager, fine, coarse)
                if (location == null) {
                    promise.reject("LOCATION_UNAVAILABLE", "Keine frische Position verfügbar. Geh kurz nach draußen und versuche es erneut.")
                    return@execute
                }
                promise.resolve(
                    JSONObject()
                        .put("latitude", location.latitude)
                        .put("longitude", location.longitude)
                        .put("accuracyM", location.accuracy.toDouble())
                        .toString(),
                )
            } catch (error: Exception) {
                promise.reject("LOCATION_ERROR", error.message ?: "Position konnte nicht gelesen werden.", error)
            }
        }
    }

    @ReactMethod
    fun searchLocation(query: String, promise: Promise) {
        worker.execute {
            try {
                val cleanQuery = query.trim()
                if (cleanQuery.length < 3) {
                    promise.reject("LOCATION_QUERY", "Gib mindestens drei Zeichen für den Startort ein.")
                    return@execute
                }
                val geocoder = Geocoder(context, Locale.GERMANY)
                val addresses = if (Build.VERSION.SDK_INT >= 33) {
                    val latch = java.util.concurrent.CountDownLatch(1)
                    var result: List<android.location.Address> = emptyList()
                    geocoder.getFromLocationName(cleanQuery, 5, object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<android.location.Address>) {
                            result = addresses
                            latch.countDown()
                        }

                        override fun onError(errorMessage: String?) {
                            latch.countDown()
                        }
                    })
                    latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
                    result
                } else {
                    @Suppress("DEPRECATION")
                    geocoder.getFromLocationName(cleanQuery, 5).orEmpty()
                }
                val result = JSONArray()
                addresses.forEach { address ->
                    result.put(
                        JSONObject()
                            .put("label", address.getAddressLine(0) ?: cleanQuery)
                            .put("latitude", address.latitude)
                            .put("longitude", address.longitude),
                    )
                }
                promise.resolve(result.toString())
            } catch (error: Exception) {
                promise.reject("LOCATION_SEARCH", error.message ?: "Startort konnte nicht gesucht werden.", error)
            }
        }
    }

    @ReactMethod
    fun routeSpeak(text: String, promise: Promise) {
        main.post {
            if (!speechReady || textToSpeech == null) {
                promise.reject("TTS_UNAVAILABLE", "Sprachausgabe ist auf diesem Gerät nicht verfügbar.")
                return@post
            }
            val result = textToSpeech?.speak(text.trim(), TextToSpeech.QUEUE_FLUSH, null, "runback-route")
            if (result == TextToSpeech.ERROR) {
                promise.reject("TTS_ERROR", "Die Sprachausgabe konnte nicht gestartet werden.")
            } else {
                promise.resolve(null)
            }
        }
    }

    @ReactMethod
    fun routeStopSpeaking(promise: Promise) {
        main.post {
            textToSpeech?.stop()
            promise.resolve(null)
        }
    }

    override fun onCatalystInstanceDestroy() {
        main.post {
            textToSpeech?.stop()
            textToSpeech?.shutdown()
            textToSpeech = null
        }
        worker.shutdownNow()
        super.onCatalystInstanceDestroy()
    }
}
