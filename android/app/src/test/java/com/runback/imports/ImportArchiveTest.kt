package com.runback.imports

import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.util.zip.ZipOutputStream
import java.util.zip.ZipEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ImportArchiveTest {
    @Test fun nestedEntriesAreCollectedAndTracksComeFirst() {
        val root = Files.createTempDirectory("archive-test").toFile()
        try {
            val nested = File(root, "nested.zip")
            zip(nested, mapOf("summary.csv" to "summary", "track.gpx" to "track"))
            val outer = File(root, "outer.zip")
            zip(outer, mapOf("outer.csv" to "summary", "nested.zip" to nested.readBytes(), "other.bin" to "ignored"))
            val seen = ArrayList<String>()
            val paths = ArrayList<String>()
            var drained = 0
            ImportArchive(root, copyBounded = ::copy, drainBounded = { drained += it.readBytes().size },
                supported = { it.endsWith(".gpx") || it.endsWith(".csv") }, checkCancelled = {},
                process = { _, name, path -> seen.add(name); paths.add(path) }, onError = { _, _ -> error("unexpected") },
                onSkipped = {}).import(outer)
            assertEquals(listOf("track.gpx", "outer.csv", "summary.csv"), seen)
            assertEquals(listOf("nested.zip/track.gpx", "outer.csv", "nested.zip/summary.csv"), paths)
            assertEquals(7, drained)
            assertTrue(root.listFiles()!!.none { it.name.startsWith("runback-entry-") })
        } finally { root.deleteRecursively() }
    }

    @Test fun entryBudgetIsGlobalAndIgnoredEntriesAreDrained() {
        val root = Files.createTempDirectory("archive-test").toFile()
        try {
            val nested = File(root, "nested.zip")
            zip(nested, mapOf("ignored.bin" to "ignored"))
            val outer = File(root, "outer.zip")
            zip(outer, mapOf("nested.zip" to nested.readBytes(), "ok.gpx" to "ok"))
            val seen = ArrayList<String>()
            ImportArchive(root, maxEntries = 2, copyBounded = ::copy,
                drainBounded = { it.readBytes() }, supported = { it.endsWith(".gpx") },
                checkCancelled = {}, process = { _, name, _ -> seen.add(name) }, onError = { _, _ -> }, onSkipped = {})
                .let { archive -> assertThrows(IllegalArgumentException::class.java) { archive.import(outer) } }
            assertTrue(seen.isEmpty())
            assertTrue(root.listFiles()!!.none { it.name.startsWith("runback-entry-") })
        } finally { root.deleteRecursively() }
    }

    @Test fun cancellationCleansPendingEntries() {
        val root = Files.createTempDirectory("archive-test").toFile()
        try {
            val outer = File(root, "outer.zip")
            zip(outer, mapOf("one.gpx" to "one", "two.gpx" to "two"))
            var checks = 0
            assertThrows(java.util.concurrent.CancellationException::class.java) {
                ImportArchive(root, copyBounded = ::copy, drainBounded = { it.readBytes() }, supported = { true },
                checkCancelled = { if (++checks > 3) throw java.util.concurrent.CancellationException() },
                process = { _, _, _ -> }, onError = { _, _ -> }, onSkipped = {}).import(outer)
            }
            assertTrue(root.listFiles()!!.none { it.name.startsWith("runback-entry-") })
        } finally { root.deleteRecursively() }
    }

    @Test fun processingCancellationPropagatesAndCleansFiles() {
        val root = Files.createTempDirectory("archive-test").toFile()
        try {
            val outer = File(root, "outer.zip")
            zip(outer, mapOf("one.gpx" to "one", "two.gpx" to "two"))
            assertThrows(java.util.concurrent.CancellationException::class.java) {
                ImportArchive(root, copyBounded = ::copy, drainBounded = { it.readBytes() }, supported = { true },
                    checkCancelled = {}, process = { _, _, _ -> throw java.util.concurrent.CancellationException() },
                    onError = { _, _ -> error("cancellation must not be reported as a file error") }, onSkipped = {}).import(outer)
            }
            assertTrue(root.listFiles()!!.none { it.name.startsWith("runback-entry-") })
        } finally { root.deleteRecursively() }
    }

    @Test fun deeperArchivesAreReportedWithoutProcessingTheirContents() {
        val root = Files.createTempDirectory("archive-test").toFile()
        try {
            val inner = File(root, "inner.zip")
            zip(inner, mapOf("too-deep.gpx" to "track"))
            val middle = File(root, "middle.zip")
            zip(middle, mapOf("inner.zip" to inner.readBytes()))
            val outer = File(root, "outer.zip")
            zip(outer, mapOf("middle.zip" to middle.readBytes(), "ok.gpx" to "track"))
            val errors = ArrayList<String>()
            val seen = ArrayList<String>()
            ImportArchive(root, maxDepth = 1, copyBounded = ::copy, drainBounded = { it.readBytes() },
                supported = { it.endsWith(".gpx") }, checkCancelled = {},
                process = { _, name, _ -> seen.add(name) }, onError = { name, _ -> errors.add(name) },
                onSkipped = {}).import(outer)
            assertEquals(listOf("inner.zip"), errors)
            assertEquals(listOf("ok.gpx"), seen)
            assertTrue(root.listFiles()!!.none { it.name.startsWith("runback-entry-") })
        } finally { root.deleteRecursively() }
    }

    private fun copy(input: InputStream, output: File) {
        output.outputStream().use { input.copyTo(it) }
    }

    private fun zip(file: File, entries: Map<String, Any>) {
        ZipOutputStream(file.outputStream()).use { out ->
            entries.forEach { (name, value) ->
                out.putNextEntry(ZipEntry(name))
                when (value) {
                    is String -> out.write(value.toByteArray())
                    is ByteArray -> out.write(value)
                }
                out.closeEntry()
            }
        }
    }
}
