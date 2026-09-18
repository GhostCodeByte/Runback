package com.runback.wear

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.runback.core.RecordingService
import com.runback.core.RunStore
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : Activity() {
    private val bg = Color.rgb(9, 13, 11)
    private val ink = Color.rgb(238, 244, 236)
    private val muted = Color.rgb(155, 169, 158)
    private val green = Color.rgb(161, 234, 139)
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: RunStore
    private lateinit var content: LinearLayout
    private lateinit var scroll: ScrollView
    private var page = "home"
    private var purpose = "easy"
    private var target = JSONObject().put("kind", "none").put("version", 1)
    private var lastState = ""
    private var timer: TextView? = null
    private var distance: TextView? = null
    private var heart: TextView? = null
    private var sync: TextView? = null
    private var pendingStart = false
    private val tick = object : Runnable {
        override fun run() {
            val active = store.active()
            val state = active?.optString("status") ?: "idle"
            if (state != lastState && page != "history" && page != "detail") render()
            else updateMetrics(active)
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = RunStore(this)
        val settings = store.settings()
        purpose = settings.optString("wearPurpose", "easy")
        target = settings.optJSONObject("wearTarget") ?: target
        window.statusBarColor = bg
        window.navigationBarColor = bg
        WearSync.schedule(this)
        render()
    }

    override fun onResume() {
        super.onResume()
        handler.post(tick)
        WearSync.retry(this)
    }
    override fun onPause() { handler.removeCallbacks(tick); super.onPause() }

    private fun render() {
        timer = null; distance = null; heart = null; sync = null
        val active = store.active()
        lastState = active?.optString("status") ?: "idle"
        scroll = ScrollView(this).apply {
            setBackgroundColor(bg)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            isFocusable = true
            setOnGenericMotionListener { _, event ->
                if (event.action == MotionEvent.ACTION_SCROLL) {
                    smoothScrollBy(0, (-event.getAxisValue(MotionEvent.AXIS_SCROLL) * ViewConfiguration.get(this@MainActivity).scaledVerticalScrollFactor).toInt())
                    true
                } else false
            }
        }
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), dp(36))
        }
        scroll.addView(content)
        setContentView(scroll)
        scroll.requestFocus()
        when (page) {
            "history" -> history()
            else -> if (active != null) recording(active) else home()
        }
    }

    private fun home() {
        text("RUNBACK", 13, green, bold = true)
        text("Dein nächster Lauf.", 21, ink, bold = true, margin = 6)
        text("Ohne Handy aufzeichnen", 12, muted, margin = 3)
        button("Lauf starten", true, 12) { requestStart() }
        button("Zweck · ${purposeLabel(purpose)}", false, 6) { choosePurpose() }
        button("Ziel · ${targetLabel()}", false, 6) { chooseTarget() }
        button("Läufe", false, 6) { page = "history"; render() }
        sync = text(WearSync.status, 11, muted, margin = 12)
        button("Übertragen", false, 8) {
            sync?.text = "Verbindung wird geprüft …"
            WearSync.retry(this) { runOnUiThread { sync?.text = WearSync.status } }
        }
        text("GPS und verfügbare Sensoren werden lokal gespeichert. Fehlende Werte bleiben offen.", 11, muted, margin = 12)
    }

    private fun recording(active: JSONObject) {
        val state = active.optString("status")
        text(if (state == "recording") "AUFZEICHNUNG" else if (state == "paused") "PAUSIERT" else "UNTERBROCHEN", 12, green, true)
        timer = text("00:00", 36, ink, true, 5)
        distance = text("0,00 km", 21, ink, true, 0)
        heart = text("Puls —", 12, muted, margin = 4)
        if (state == "recording") {
            button("Pause", true, 12) { command(RecordingService.PAUSE) }
        } else {
            if (state == "interrupted") text("Bisherige Daten gesichert. Die Unterbrechung bleibt als Lücke erhalten.", 11, muted, margin = 8)
            button("Fortsetzen", true, 12) { command(RecordingService.RESUME) }
            button("Lauf beenden", false, 6) { confirmFinish() }
        }
        text(purposeLabel(active.optString("purpose")), 11, muted, margin = 10)
        text("GPS: Distanz erst bei gültigen Positionen. Aufzeichnung läuft auch bei geschlossenem Display.", 11, muted, margin = 8)
        updateMetrics(active)
    }

    private fun updateMetrics(active: JSONObject?) {
        if (active != null) {
            timer?.text = formatDuration(active.optDouble("durationSeconds", active.optDouble("durationSec")).toLong())
            distance?.text = String.format(Locale.GERMANY, "%.2f km", active.optDouble("distanceMeters", active.optDouble("distanceM")) / 1000)
            val hr = active.optDouble("avgHeartRate", Double.NaN)
            heart?.text = if (hr.isFinite() && hr > 0) "Ø Puls ${hr.toInt()} /min" else "Puls — · keine Messung"
        }
        sync?.text = WearSync.status
    }

    private fun history() {
        text("DEINE LÄUFE", 13, green, true)
        val runs = store.listRuns(100)
        var count = 0
        for (index in 0 until runs.length()) {
            val run = runs.getJSONObject(index)
            if (run.optString("status") != "completed") continue
            count++
            val date = SimpleDateFormat("dd. MMM · HH:mm", Locale.GERMANY).format(Date(run.optLong("startedAt")))
            val km = String.format(Locale.GERMANY, "%.2f km", run.optDouble("distanceMeters", run.optDouble("distanceM")) / 1000)
            button("$date\n$km · ${formatDuration(run.optDouble("durationSeconds", run.optDouble("durationSec")).toLong())}", false, 10) { details(run) }
        }
        if (count == 0) text("Hier erscheinen deine\nauf der Uhr gespeicherten Läufe.", 14, muted, margin = 18)
        button("Zurück", false, 12) { page = "home"; render() }
    }

    private fun details(run: JSONObject) {
        page = "detail"
        content.removeAllViews()
        scroll.scrollTo(0, 0)
        text("GESPEICHERT", 13, green, true)
        text(String.format(Locale.GERMANY, "%.2f km", run.optDouble("distanceMeters", run.optDouble("distanceM")) / 1000), 29, ink, true, 10)
        text(formatDuration(run.optDouble("durationSeconds", run.optDouble("durationSec")).toLong()), 22, ink, margin = 4)
        text(purposeLabel(run.optString("purpose")), 13, muted, margin = 8)
        val record = store.getDocument("sync_${run.getString("id")}")
        text(if (record?.optString("status") == "acknowledged") "Auf dem Handy bestätigt. Original bleibt auf der Uhr." else "Original auf Uhr gesichert. Übertragung zum Handy steht aus.", 12, muted, margin = 12)
        button("Übertragen", true, 12) { WearSync.retry(this); page = "home"; render() }
        button("Alle Läufe", false, 6) { page = "history"; render() }
    }

    private fun requestStart() {
        AlertDialog.Builder(this).setTitle("Lokal aufzeichnen")
            .setMessage("Standort für die Strecke, Körpersensoren für den Puls. Ohne Freigabe bleiben diese Messwerte leer.")
            .setPositiveButton("Weiter") { _, _ ->
                val permissions = mutableListOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS,
                    Manifest.permission.ACTIVITY_RECOGNITION
                )
                if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
                val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                if (missing.isEmpty()) startRun() else { pendingStart = true; requestPermissions(missing.toTypedArray(), 42) }
            }.setNegativeButton("Zurück", null).show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 42 && pendingStart) {
            pendingStart = false
            val locationGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (locationGranted) {
                startRun()
            } else {
                AlertDialog.Builder(this)
                    .setTitle("Standortfreigabe erforderlich")
                    .setMessage("Runback kann ohne Standortfreigabe keine Strecke aufzeichnen. Erlaube den Standortzugriff und starte den Lauf erneut.")
                    .setPositiveButton("OK", null)
                    .show()
            }
        }
    }

    private fun startRun() {
        page = "home"
        val selected = JSONObject(target.toString())
        if (selected.optString("kind") == "pace") {
            selected.put("mode", if (purpose in listOf("easy", "long")) "ceiling" else "range")
        }
        command(RecordingService.START, selected.toString())
    }
    private fun command(action: String, targetJson: String? = null) {
        try {
            RecordingService.send(this, action, purpose, "wear_os", target = targetJson)
            getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
            handler.postDelayed({ render() }, 250)
        } catch (e: Exception) {
            AlertDialog.Builder(this).setTitle("Nicht gestartet").setMessage(e.message ?: "Berechtigungen und verfügbaren Speicher prüfen.").setPositiveButton("OK", null).show()
        }
    }
    private fun confirmFinish() {
        AlertDialog.Builder(this).setTitle("Lauf beenden?")
            .setMessage("Der Lauf wird auf der Uhr gespeichert und später zum Handy übertragen.")
            .setNegativeButton("Zurück", null)
            .setPositiveButton("Speichern") { _, _ ->
                command(RecordingService.FINISH)
                page = "home"
                handler.postDelayed({ WearSync.retry(this); render() }, 600)
            }.show()
    }
    private fun choosePurpose() {
        val values = arrayOf("easy", "long", "quality", "race", "free", "unknown")
        AlertDialog.Builder(this).setTitle("Trainingszweck")
            .setItems(values.map(::purposeLabel).toTypedArray()) { _, index ->
                purpose = values[index]
                store.saveSettings(store.settings().put("wearPurpose", purpose))
                render()
            }.show()
    }
    private fun chooseTarget() {
        val labels = arrayOf("Ohne Ziel", "Tempo", "Pulsbereich")
        AlertDialog.Builder(this).setTitle("Laufen nach")
            .setItems(labels) { _, index ->
                when (index) {
                    0 -> saveTarget(JSONObject().put("kind", "none").put("version", 1))
                    1 -> editPaceTarget()
                    2 -> editHeartTarget()
                }
            }.show()
    }
    private fun editPaceTarget() {
        val seconds = target.optDouble("secondsPerKm", 330.0).toInt()
        val input = EditText(this).apply {
            setText("${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}")
            setSelectAllOnFocus(true)
            hint = "5:30"
        }
        AlertDialog.Builder(this).setTitle("Tempo in min/km").setView(input)
            .setNegativeButton("Zurück", null)
            .setPositiveButton("Übernehmen") { _, _ ->
                val match = Regex("^(\\d{1,2}):([0-5]\\d)$").matchEntire(input.text.toString().trim())
                val value = match?.let { it.groupValues[1].toInt() * 60 + it.groupValues[2].toInt() }
                if (value != null && value in 120..1200) {
                    saveTarget(JSONObject().put("kind", "pace").put("version", 1)
                        .put("secondsPerKm", value).put("mode", "range").put("output", "both"))
                } else invalidTarget("Gib das Tempo zum Beispiel als 5:30 ein.")
            }.show()
    }
    private fun editHeartTarget() {
        val input = EditText(this).apply {
            setText("${target.optInt("minBpm", 130)}–${target.optInt("maxBpm", 150)}")
            setSelectAllOnFocus(true)
            hint = "130–150"
        }
        AlertDialog.Builder(this).setTitle("Pulsbereich in bpm").setView(input)
            .setNegativeButton("Zurück", null)
            .setPositiveButton("Übernehmen") { _, _ ->
                val values = input.text.toString().trim().split(Regex("[–—-]")).mapNotNull { it.trim().toIntOrNull() }
                if (values.size == 2 && values[0] >= 40 && values[1] <= 240 && values[1] - values[0] >= 5) {
                    saveTarget(JSONObject().put("kind", "heart_rate").put("version", 1)
                        .put("minBpm", values[0]).put("maxBpm", values[1]).put("output", "both"))
                } else invalidTarget("Gib den Bereich zum Beispiel als 130–150 ein.")
            }.show()
    }
    private fun saveTarget(next: JSONObject) {
        target = next
        store.saveSettings(store.settings().put("wearTarget", next))
        render()
    }
    private fun invalidTarget(message: String) {
        AlertDialog.Builder(this).setTitle("Nicht gespeichert").setMessage(message).setPositiveButton("OK", null).show()
    }
    private fun targetLabel() = when (target.optString("kind")) {
        "pace" -> {
            val seconds = target.optDouble("secondsPerKm", 330.0).toInt()
            val prefix = if (purpose in listOf("easy", "long")) "max " else ""
            "$prefix${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')} /km"
        }
        "heart_rate" -> "${target.optInt("minBpm")}–${target.optInt("maxBpm")} bpm"
        else -> "Ohne Ziel"
    }
    private fun purposeLabel(value: String) = when (value) {
        "easy" -> "Locker"; "long" -> "Langer Lauf"; "quality", "interval" -> "Intervalle"; "race" -> "Wettkampf"; "free" -> "Freier Lauf"; else -> "Offen"
    }
    private fun formatDuration(seconds: Long): String = if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60) else "%02d:%02d".format(seconds / 60, seconds % 60)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Int, color: Int, bold: Boolean = false, margin: Int = 0): TextView {
        return TextView(this).apply {
            text = value; textSize = size.toFloat(); setTextColor(color); gravity = Gravity.CENTER
            if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            content.addView(this)
        }
    }
    private fun button(value: String, primary: Boolean, margin: Int, onClick: () -> Unit) {
        content.addView(Button(this).apply {
            text = value; textSize = 14f; isAllCaps = false
            setTextColor(if (primary) bg else ink)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            background = GradientDrawable().apply { setColor(if (primary) green else Color.rgb(27, 36, 30)); cornerRadius = dp(24).toFloat() }
            minHeight = dp(48); minimumHeight = dp(48)
            setPadding(dp(10), dp(9), dp(10), dp(9))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            setOnClickListener { onClick() }
        })
    }
    override fun onBackPressed() {
        if (page != "home") { page = "home"; render() } else super.onBackPressed()
    }
}
