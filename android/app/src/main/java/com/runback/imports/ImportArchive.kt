package com.runback.imports

import java.io.File
import java.io.InputStream
import java.util.Locale
import java.util.zip.ZipInputStream

/**
 * Bounded archive traversal for imports. Archive names are labels only; every
 * extracted entry is placed in a caller supplied temporary directory.
 */
class ImportArchive(
    private val tempRoot: File,
    private val maxEntries: Int = 2_000,
    private val maxDepth: Int = 2,
    private val copyBounded: (InputStream, File) -> Unit,
    private val drainBounded: (InputStream) -> Unit,
    private val supported: (String) -> Boolean,
    private val checkCancelled: () -> Unit,
    private val process: (File, String, String) -> Unit,
    private val onError: (String, Exception) -> Unit,
    private val onSkipped: () -> Unit,
) {
    private data class Pending(val name: String, val path: String, val file: File)

    private var entries = 0
    private val pending = ArrayList<Pending>()

    fun import(file: File) {
        require(tempRoot.isDirectory) { "Temporärer Importordner fehlt" }
        entries = 0
        pending.clear()
        try {
            collect(file, 0)
            pending.sortBy { priority(it.name) }
            for (item in pending) {
                checkCancelled()
                try {
                    process(item.file, item.name, item.path)
                } catch (e: Exception) {
                    if (e is java.util.concurrent.CancellationException) throw e
                    onError(item.name, e)
                }
            }
        } finally {
            pending.forEach { it.file.delete() }
            pending.clear()
        }
    }

    private fun collect(file: File, depth: Int, parentPath: String = "") {
        ZipInputStream(file.inputStream().buffered()).use { zip ->
            while (true) {
                checkCancelled()
                val entry = zip.nextEntry ?: break
                if (++entries > maxEntries) throw IllegalArgumentException("ZIP enthält zu viele Dateien")
                if (entry.isDirectory) {
                    drainBounded(zip)
                    onSkipped()
                    zip.closeEntry()
                    continue
                }
                val path = if (parentPath.isEmpty()) entry.name else "$parentPath/${entry.name}"
                val name = entry.name.substringAfterLast('/').substringAfterLast('\\')
                if (!supported(name) && !isNestedArchive(name)) {
                    drainBounded(zip)
                    onSkipped()
                    zip.closeEntry()
                    continue
                }
                val extracted = File.createTempFile("runback-entry-", ".tmp", tempRoot)
                try {
                    copyBounded(zip, extracted)
                    if (isNestedArchive(name)) {
                        if (depth >= maxDepth) {
                            onError(name, IllegalArgumentException("Verschachtelte Archive sind zu tief"))
                        } else {
                            collect(extracted, depth + 1, path)
                        }
                        extracted.delete()
                    } else {
                        pending.add(Pending(name, path, extracted))
                    }
                } catch (e: Exception) {
                    extracted.delete()
                    throw e
                }
                // Do not drain an entry after a size-limit or cancellation failure.
                zip.closeEntry()
            }
        }
    }

    private fun isNestedArchive(name: String): Boolean =
        name.lowercase(Locale.ROOT).endsWith(".zip")

    private fun priority(name: String): Int {
        val lower = name.lowercase(Locale.ROOT).removeSuffix(".gz")
        return when {
            lower.endsWith(".fit") || lower.endsWith(".gpx") || lower.endsWith(".tcx") -> 0
            lower.endsWith(".xml") -> 1
            else -> 2
        }
    }
}
