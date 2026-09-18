package com.runback.core

/** Forwards user-visible recording controls to the paired device without coupling core to Wear OS. */
fun interface RecordingControlSink {
    fun publish(action: String, runId: String, commandId: String)
}
