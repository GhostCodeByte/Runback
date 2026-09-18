package com.runback

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.google.android.gms.wearable.Wearable
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.runback.core.RecordingService
import com.runback.core.RunStore
import com.runback.core.WearCommandGate
import com.runback.core.WearProtocol
import org.json.JSONObject

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    handleRemoteRecordingIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    if (intent != null) {
      setIntent(intent)
      handleRemoteRecordingIntent(intent)
    }
  }

  override fun onResume() {
    super.onResume()
    // A visible app is a user-initiated retry point; only here may the remote Activity fallback run.
    WearController.retryPending(this, allowRemoteActivity = true)
  }

  private fun handleRemoteRecordingIntent(intent: Intent?, permitAttempt: Int = 0) {
    val uri = intent?.data ?: return
    if (uri.scheme != "runback" || uri.host != "recording") return
    val action = uri.getQueryParameter("action") ?: return
    if (action !in setOf(RecordingService.START, RecordingService.PAUSE, RecordingService.RESUME, RecordingService.FINISH)) return
    val runId = uri.getQueryParameter("runId") ?: return
    val commandId = uri.getQueryParameter("commandId").takeIf { !it.isNullOrBlank() }
    val commandSequence = uri.getQueryParameter("sequence")?.toLongOrNull() ?: 0L
    val purpose = uri.getQueryParameter("purpose").cleanRemoteValue() ?: "easy"
    val sport = uri.getQueryParameter("sport").cleanRemoteValue() ?: "running"
    val routePlanId = uri.getQueryParameter("routePlanId").cleanRemoteValue()
    val target = uri.getQueryParameter("target").cleanRemoteValue()
    val sourceNodeId = uri.getQueryParameter("sourceNodeId").cleanRemoteValue()
    val store = RunStore(this)
    if (!WearCommandGate.hasPermit(store, action, runId, commandId, commandSequence, purpose, sport, routePlanId, target, sourceNodeId)) {
      if (permitAttempt < 20) {
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
          { handleRemoteRecordingIntent(intent, permitAttempt + 1) },
          100L,
        )
      }
      return
    }
    val current = store.active()
    if (action == RecordingService.START) {
      if (current != null && current.optString("id") != runId) return
      if (current?.optString("id") == runId && current.optString("status") in listOf("recording", "paused") &&
        !RecordingService.hasLiveService()
      ) return
    } else {
      if (current?.optString("id") != runId || current?.optString("status") !in listOf("recording", "paused")) return
      if (!RecordingService.hasLiveService()) return
    }
    if (WearCommandGate.claim(store, runId, commandId, commandSequence) != WearCommandGate.Decision.ACCEPT) return
    val alreadyApplied = when (action) {
      RecordingService.START -> current?.optString("id") == runId && current.optString("status") in listOf("recording", "paused")
      RecordingService.PAUSE -> current?.optString("id") == runId && current.optString("status") == "paused"
      RecordingService.RESUME -> current?.optString("id") == runId && current.optString("status") == "recording"
      else -> false
    }
    if (alreadyApplied) {
      WearCommandGate.markApplied(store, runId, commandId, commandSequence)
      sendRemoteAck(uri, action, runId, commandId, commandSequence, "accepted", "Aufzeichnungsbefehl bereits angewendet.")
      return
    }
    runCatching {
      RecordingService.send(
        this,
        action,
        purpose,
        "phone",
        sport,
        routePlanId,
        target,
        runId,
        syncPeers = false,
        commandId = commandId,
        commandSequence = commandSequence,
      )
    }.onSuccess {
      confirmRemoteCommand(uri, runId, action, commandId, commandSequence)
    }.onFailure { error ->
      WearCommandGate.release(store, runId, commandId, commandSequence)
      sendRemoteAck(uri, action, runId, commandId, commandSequence, "error", error.message ?: "Aufzeichnung konnte nicht synchronisiert werden.")
    }
  }

  private fun confirmRemoteCommand(uri: Uri, runId: String, action: String, commandId: String?, sequence: Long, attempt: Int = 0) {
    val current = RunStore(this).active()
    val applied = when (action) {
      RecordingService.PAUSE -> current?.optString("id") == runId && current.optString("status") == "paused"
      RecordingService.FINISH -> current == null && RunStore(this).runStatus(runId) == "completed"
      else -> current?.optString("id") == runId && current.optString("status") == "recording"
    }
    if (applied) {
      WearCommandGate.markApplied(RunStore(this), runId, commandId, sequence)
      sendRemoteAck(uri, action, runId, commandId, sequence, "accepted", "Aufzeichnung auf dem Handy synchronisiert.")
    } else if (attempt < 100) {
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
        { confirmRemoteCommand(uri, runId, action, commandId, sequence, attempt + 1) },
        100L,
      )
    } else {
      WearCommandGate.release(RunStore(this), runId, commandId, sequence)
      sendRemoteAck(uri, action, runId, commandId, sequence, "error", "Das Handy hat nicht rechtzeitig reagiert.")
    }
  }

  private fun sendRemoteAck(uri: Uri, action: String, runId: String, commandId: String?, sequence: Long, status: String, message: String) {
    val nodeId = uri.getQueryParameter("sourceNodeId")?.cleanRemoteValue() ?: return
    val sensors = JSONObject()
      .put("gps", packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS))
      .put("gpsPermission", checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)
    Wearable.getMessageClient(this).sendMessage(
      nodeId,
      WearProtocol.ACK_PATH,
      WearProtocol.ack(action, runId, status, message, sensors, commandId, sequence),
    ).addOnFailureListener { }
  }

  private fun String?.cleanRemoteValue(): String? = this?.takeIf { it.isNotBlank() && it != "null" }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Runback"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
