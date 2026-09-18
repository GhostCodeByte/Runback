package com.runback

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.runback.core.RecordingControlSink
import com.runback.core.RecordingSampleSink
import com.runback.core.RecordingService
import com.runback.core.RunStore

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(RunbackPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    RecordingService.sampleSink = RecordingSampleSink { runId, sequence, samples ->
      WearController.publishPhoneSamples(this, runId, sequence, samples)
    }
    RecordingService.controlSink = RecordingControlSink { action, runId, commandId ->
      val session = RunStore(this).active()
      WearController.publishControl(
        this,
        action,
        runId,
        purpose = session?.optString("purpose").takeUnless { it.isNullOrBlank() } ?: "easy",
        sport = session?.optString("sport").takeUnless { it.isNullOrBlank() } ?: "running",
        commandId = commandId,
        target = session?.optJSONObject("target")?.toString(),
      )
    }
    WearController.retryPending(this)
    loadReactNative(this)
  }
}
