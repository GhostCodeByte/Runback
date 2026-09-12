package com.runback.integrations

import android.content.Context
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Shared encrypted OpenRouter configuration and transport. request() only selects a
 * layout for unchanged engine text. complete() powers the separate, read-only chat.
 */
class OpenRouterProse(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("openrouter_private", Context.MODE_PRIVATE)
    private val requestMutex = Mutex()
    private val lock = Any()
    private var revision = 0L

    fun settings(): JSONObject = synchronized(lock) {
        JSONObject().put("enabled", prefs.getBoolean("enabled", false))
            .put("hasKey", prefs.contains("key_ciphertext"))
            .put("model", prefs.getString("model", DEFAULT_MODEL))
            .put("maxOutputTokens", prefs.getInt("max_tokens", 40))
            .put("freeModelsOnly", false)
            .put("formulationVersion", FORMULATION_VERSION)
    }

    /** No app-level daily budget. Provider quotas still apply. */
    fun configure(enabled: Boolean, model: String, apiKey: String? = null): JSONObject = synchronized(lock) {
        require(model.length in 1..120 && model.matches(Regex("[A-Za-z0-9._:/-]+"))) { "Ungültige Modellkennung." }
        val edit = prefs.edit()
        if (apiKey != null && apiKey.isNotBlank()) {
            require(apiKey.length in 8..512 && apiKey.all { it.code in 33..126 }) { "Ungültiger API-Key." }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            edit.putString("key_ciphertext", Base64.encodeToString(cipher.doFinal(apiKey.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
            edit.putString("key_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        }
        edit.putBoolean("enabled", enabled).putString("model", model)
            .remove("daily_limit").remove("usage_day").remove("usage_count").putInt("max_tokens", 40).commit()
        revision++
        settings()
    }

    fun clearKey(): JSONObject = synchronized(lock) {
        prefs.edit().remove("key_ciphertext").remove("key_iv").putBoolean("enabled", false).remove("cache").commit()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS) }
        revision++
        settings()
    }

    fun clearCache(): JSONObject = synchronized(lock) {
        prefs.edit().remove("cache").commit()
        revision++
        settings()
    }

    /** Call after rendering the ordinary template. Match inputHash before replacing UI. */
    suspend fun request(engine: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        requestMutex.withLock {
            val inputHash = digest(canonical(engine))
            fun fallback(reason: String) = render(engine, inputHash, "observation_first", "template", reason)
            if (engine.optString("state") !in STATES || engine.optString("model_version").isBlank() ||
                listOf("classification", "focus", "nextAction").any { engine.optString(it).length !in 1..4000 }) {
                return@withLock fallback("invalid_engine")
            }
            val snapshot = synchronized(lock) {
                if (!prefs.getBoolean("enabled", false)) return@withLock fallback("disabled")
                val key = runCatching { decryptKey() }.getOrNull() ?: return@withLock fallback("no_key")
                Snapshot(key, prefs.getString("model", DEFAULT_MODEL) ?: DEFAULT_MODEL,
                    40, revision)
            }
            val cacheKey = digest("$inputHash|${snapshot.model}|$FORMULATION_VERSION")
            synchronized(lock) {
                val cache = readCache()
                val cached = cache.optString(cacheKey)
                if (cached in VARIANTS) return@withLock render(engine, inputHash, cached, "cache", null)

            }
            val variant = runCatching { fetchVariant(snapshot, boundedPayload(engine)) }.getOrNull()
                ?: return@withLock fallback("unavailable_or_invalid")
            synchronized(lock) {
                if (revision != snapshot.revision || !prefs.getBoolean("enabled", false)) return@withLock fallback("settings_changed")
                val cache = readCache()
                if (cache.length() >= 50) cache.keys().asSequence().firstOrNull()?.let { cache.remove(it) }
                cache.put(cacheKey, variant)
                prefs.edit().putString("cache", cache.toString()).apply()
            }
            render(engine, inputHash, variant, "controlled", null)
        }
    }

    private fun boundedPayload(engine: JSONObject): JSONObject {
        val payload = JSONObject().put("state", engine.getString("state"))
            .put("formulation_version", FORMULATION_VERSION)
        val pacing = engine.optJSONObject("pacing")
        val numbers = JSONObject()
        listOf("fadePercent" to (-100.0..500.0), "coefficientOfVariation" to (0.0..5.0)).forEach { (key, range) ->
            val value = pacing?.optDouble(key, Double.NaN) ?: Double.NaN
            if (value.isFinite() && value in range) numbers.put(key, kotlin.math.round(value * 100) / 100)
        }
        return payload.put("aggregates", numbers)
    }

    private fun fetchVariant(snapshot: Snapshot, payload: JSONObject): String? {
        val connection = URL("https://openrouter.ai/api/v1/chat/completions").openConnection() as HttpURLConnection
        val deadline = SystemClock.elapsedRealtime() + 12_000
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${snapshot.key}")
            val schema = JSONObject().put("name", "approved_wording_layout").put("strict", true)
                .put("schema", JSONObject().put("type", "object").put("additionalProperties", false)
                    .put("properties", JSONObject().put("variant", JSONObject().put("type", "string").put("enum", JSONArray(VARIANTS))))
                    .put("required", JSONArray(listOf("variant"))))
            val body = JSONObject().put("model", snapshot.model).put("max_completion_tokens", snapshot.tokens)
                .put("temperature", 0).put("stream", false)
                // Free routes retain zero-price caps; explicitly selected paid models are allowed.
                .put("provider", provider(snapshot.model))
                .put("response_format", JSONObject().put("type", "json_schema").put("json_schema", schema))
                .put("messages", JSONArray().put(JSONObject().put("role", "system").put("content",
                    "Choose an approved display layout for a running analysis. Return only JSON with variant observation_first or action_first. " +
                        "Use action_first for an active task, observation_first otherwise. Do not write any claims or advice."))
                    .put(JSONObject().put("role", "user").put("content", payload.toString())))
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode != 200) return null
            val output = java.io.ByteArrayOutputStream()
            connection.inputStream.use { stream ->
                val buffer = ByteArray(2048)
                while (true) {
                    if (SystemClock.elapsedRealtime() > deadline) return null
                    val count = stream.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > 16_384) return null
                    output.write(buffer, 0, count)
                }
            }
            val response = JSONObject(output.toString("UTF-8"))
            val choices = response.optJSONArray("choices") ?: return null
            if (choices.length() != 1) return null
            val choice = choices.getJSONObject(0)
            if (choice.optString("finish_reason") != "stop") return null
            val content = choice.getJSONObject("message").optString("content")
            if (content.length > 100 || !content.trim().startsWith("{")) return null
            val parsed = JSONObject(content)
            if (parsed.length() != 1) return null
            return parsed.optString("variant").takeIf { it in VARIANTS }
        } finally {
            connection.disconnect()
        }
    }

    private fun provider(model: String) = JSONObject().put("require_parameters", true).put("data_collection", "deny").apply {
        if (model == DEFAULT_MODEL || model.endsWith(":free")) {
            put("max_price", JSONObject().put("prompt", 0).put("completion", 0))
        }
    }

    /** A single completion, on the dedicated AI worker. Never log request bodies or keys. */
    fun complete(messages: JSONArray, tools: JSONArray?, finalAnswer: Boolean = false): JSONObject {
        val snapshot = synchronized(lock) {
            check(prefs.getBoolean("enabled", false)) { "Aktiviere OpenRouter unter Auswertung & Modelle." }
            val key = decryptKey() ?: error("Bitte hinterlege deinen OpenRouter API-Schlüssel.")
            Snapshot(key, prefs.getString("model", DEFAULT_MODEL) ?: DEFAULT_MODEL, 4096, revision)
        }
        val body = JSONObject().put("model", snapshot.model).put("messages", messages)
            .put("stream", false).put("max_completion_tokens", snapshot.tokens).put("provider", provider(snapshot.model))
        if (tools != null) body.put("tools", tools).put("tool_choice", if (finalAnswer) "none" else "auto")
        val connection = URL("https://openrouter.ai/api/v1/chat/completions").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 45_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${snapshot.key}")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            check(code == 200) {
                when(code) {
                    401, 403 -> "OpenRouter hat den Zugriff abgelehnt. Schlüssel und Berechtigungen prüfen."
                    402 -> "Das OpenRouter-Guthaben reicht für dieses Modell nicht aus."
                    429 -> "OpenRouter begrenzt gerade Anfragen. Bitte später erneut versuchen."
                    else -> "OpenRouter ist nicht verfügbar (HTTP $code). Modell und Anbieter-Einstellungen prüfen."
                }
            }
            val output = java.io.ByteArrayOutputStream()
            val deadline = SystemClock.elapsedRealtime() + 60_000
            connection.inputStream.use { stream ->
                val buffer = ByteArray(4096)
                while (true) {
                    check(SystemClock.elapsedRealtime() < deadline) { "OpenRouter antwortet zu langsam. Bitte erneut versuchen." }
                    val count = stream.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 262144) { "Die Modellantwort ist zu groß." }
                    output.write(buffer, 0, count)
                }
            }
            val response = JSONObject(output.toString("UTF-8"))
            val choice = response.optJSONArray("choices")?.optJSONObject(0)
                ?: error("OpenRouter hat keine Antwort geliefert.")
            check(choice.optString("finish_reason") !in listOf("length", "error", "content_filter")) {
                "Das Modell hat keine vollständige Antwort geliefert. Bitte die Frage eingrenzen."
            }
            synchronized(lock) { check(revision == snapshot.revision) { "KI-Einstellungen wurden geändert. Bitte erneut senden." } }
            return choice.getJSONObject("message")
        } finally { connection.disconnect() }
    }

    private fun render(engine: JSONObject, hash: String, variant: String, source: String, reason: String?): JSONObject {
        val fields = if (variant == "action_first") listOf("nextAction", "classification", "focus") else listOf("classification", "focus", "nextAction")
        val labels = mapOf("classification" to "Einordnung", "focus" to "Stand der Empfehlung", "nextAction" to "Nächster Schritt")
        return JSONObject().put("inputHash", hash).put("modelVersion", engine.optString("model_version"))
            .put("formulationVersion", FORMULATION_VERSION).put("source", source).put("variant", variant)
            .put("classification", engine.optString("classification")).put("focus", engine.optString("focus"))
            .put("nextAction", engine.optString("nextAction"))
            .put("text", fields.joinToString("\n\n") { "${labels[it]}: ${engine.optString(it)}" })
            .put("reason", reason ?: JSONObject.NULL)
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }

    private fun decryptKey(): String? {
        val encrypted = prefs.getString("key_ciphertext", null) ?: return null
        val iv = prefs.getString("key_iv", null) ?: return null
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey(KEY_ALIAS, null) as? SecretKey ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
    }

    private fun readCache() = runCatching { JSONObject(prefs.getString("cache", "{}") ?: "{}") }.getOrElse { JSONObject() }
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun canonical(value: Any?): String = when (value) {
        is JSONObject -> value.keys().asSequence().sorted().joinToString(",", "{", "}") { "${JSONObject.quote(it)}:${canonical(value.opt(it))}" }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.opt(it)) }
        null, JSONObject.NULL -> "null"
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }

    private data class Snapshot(val key: String, val model: String, val tokens: Int, val revision: Long)
    companion object {
        private const val KEY_ALIAS = "runback.openrouter.aes.v1"
        private const val DEFAULT_MODEL = "openrouter/free"
        private const val FORMULATION_VERSION = "controlled-layout-1"
        private val STATES = setOf("recommendation", "maintain", "insufficient", "active")
        private val VARIANTS = listOf("observation_first", "action_first")
    }
}
