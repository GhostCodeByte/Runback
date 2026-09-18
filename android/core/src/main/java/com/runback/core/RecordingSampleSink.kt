package com.runback.core

/** Native-only hook for forwarding durable recording batches to a paired device. */
fun interface RecordingSampleSink {
    fun publish(runId: String, sequence: Long, samples: List<RawSample>)
}
