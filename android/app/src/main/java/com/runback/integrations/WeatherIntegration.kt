package com.runback.integrations

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Locale

/** Optional historical weather enrichment. No request is made while the integration is disabled. */
class WeatherIntegration(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("weather_cache", Context.MODE_PRIVATE)

    suspend fun enrich(run: JSONObject, raw: JSONArray, enabled: Boolean): JSONObject {
        if (!enabled) return result("disabled", "Wetteranreicherung ist deaktiviert.")
        return try {
            withContext(Dispatchers.IO) { enrichEnabled(run, raw) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            result("unavailable", e.message ?: "Historisches Wetter ist nicht verfügbar.")
        }
    }

    private fun enrichEnabled(run: JSONObject, raw: JSONArray): JSONObject {
        val runTime = run.optLong("startTime", Long.MIN_VALUE)
        if (runTime == Long.MIN_VALUE) return missing("run_time")
        val point = closestGps(raw, runTime) ?: return missing("location")
        val date = Instant.ofEpochMilli(runTime).atZone(ZoneOffset.UTC).toLocalDate()
        val url = requestUrl(point.first, point.second, date)
        val cacheKey = "${date}_" + digest("%.4f,%.4f".format(Locale.US, point.first, point.second))
        val body = prefs.getString(cacheKey, null) ?: fetch(url).also {
            // Cache only the provider response; coordinates are never written to logs.
            prefs.edit().putString(cacheKey, it).apply()
        }
        val response = JSONObject(body)
        val hourly = response.optJSONObject("hourly") ?: return missing("hourly")
        val times = hourly.optJSONArray("time") ?: return missing("time")
        val target = Instant.ofEpochMilli(runTime)
        var best = -1
        var bestDistance = Long.MAX_VALUE
        for (i in 0 until times.length()) {
            val parsed = runCatching { LocalDateTime.parse(times.getString(i)).toInstant(ZoneOffset.UTC) }.getOrNull() ?: continue
            val distance = kotlin.math.abs(parsed.toEpochMilli() - target.toEpochMilli())
            if (distance < bestDistance) { best = i; bestDistance = distance }
        }
        if (best < 0) return missing("hourly_point")
        val temperature = hourly.optJSONArray("temperature_2m")?.optDouble(best, Double.NaN)
        val wind = hourly.optJSONArray("wind_speed_10m")?.optDouble(best, Double.NaN)
        val missing = JSONArray()
        if (temperature == null || !temperature.isFinite()) missing.put("temperature")
        if (wind == null || !wind.isFinite()) missing.put("wind")
        return JSONObject().put("status", if (missing.length() == 0) "available" else "partial")
            .put("source", "open-meteo")
            .put("sourceUrl", url)
            .put("modelVersion", response.optString("model", "best_match"))
            .put("resolution", "1h")
            .put("time", times.optString(best))
            .put("temperatureC", temperature ?: JSONObject.NULL)
            .put("windMps", wind ?: JSONObject.NULL)
            .put("missing", missing)
    }

    private fun closestGps(raw: JSONArray, target: Long): Pair<Double, Double>? {
        var selected: Pair<Double, Double>? = null
        var distance = Long.MAX_VALUE
        for (i in 0 until raw.length()) {
            val sample = raw.optJSONObject(i) ?: continue
            if (sample.optString("kind") != "gps") continue
            val values = sample.optJSONObject("values") ?: continue
            val lat = values.optDouble("latitude", Double.NaN)
            val lon = values.optDouble("longitude", Double.NaN)
            if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) continue
            val d = kotlin.math.abs(sample.optLong("time", target) - target)
            if (d < distance) { distance = d; selected = lat to lon }
        }
        return selected
    }

    private fun requestUrl(lat: Double, lon: Double, date: LocalDate): String =
        "https://archive-api.open-meteo.com/v1/archive?latitude=${enc(lat)}&longitude=${enc(lon)}" +
            "&start_date=$date&end_date=$date&hourly=temperature_2m,wind_speed_10m" +
            "&wind_speed_unit=ms&timezone=UTC&models=best_match"

    private fun fetch(url: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        connection.requestMethod = "GET"
        return try {
            if (connection.responseCode !in 200..299) throw IllegalStateException("Open-Meteo HTTP ${connection.responseCode}")
            connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use { reader ->
                val result = StringBuilder(); val buffer = CharArray(8192)
                while (true) { val count = reader.read(buffer); if (count < 0) break
                    require(result.length + count <= 1024 * 1024) { "Wetterantwort ist zu groß" }; result.append(buffer, 0, count) }
                result.toString()
            }
        } finally { connection.disconnect() }
    }

    private fun enc(value: Any) = URLEncoder.encode(value.toString(), "UTF-8")
    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
    private fun missing(vararg fields: String) = JSONObject().put("status", "missing").put("missing", JSONArray(fields.toList()))
    private fun result(status: String, message: String) = JSONObject().put("status", status).put("message", message)
}
