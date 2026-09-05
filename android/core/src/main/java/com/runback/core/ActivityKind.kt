package com.runback.core

import org.json.JSONObject

/**
 * Erkennt die Aktivitätsart beim Import. Läufe werden trainiert, alles andere
 * wird nur erkannt und zählt zur Gesamtbelastung (Ermüdungskontext).
 *
 * Arten: run, hike, walk, ride, swim, other, unknown. Reine Funktionen ohne
 * Android-Abhängigkeiten, damit sie per Unit-Test prüfbar bleiben.
 */
object ActivityKind {
    const val RUN = "run"
    const val HIKE = "hike"
    const val WALK = "walk"
    const val RIDE = "ride"
    const val SWIM = "swim"
    const val OTHER = "other"
    const val UNKNOWN = "unknown"

    /** FIT-Sport-Enum-Name (z. B. Session-Sport), defensiv per Name gemappt. */
    fun fromFitSport(name: String?): String {
        if (name.isNullOrBlank() || name == "GENERIC" || name == "INVALID") return UNKNOWN
        return when (name.uppercase()) {
            "RUNNING", "TRAIL_RUNNING", "ULTRA_RUNNING", "TREADMILL_RUNNING", "INDOOR_RUNNING", "OBSTACLE_RUN" -> RUN
            "HIKING", "MOUNTAINEERING", "SNOWSHOEING" -> HIKE
            "WALKING", "INDOOR_WALKING" -> WALK
            "CYCLING", "E_BIKING", "INDOOR_CYCLING", "MOUNTAIN_BIKING", "ROAD_CYCLING", "GRAVEL_CYCLING", "CYCLOCROSS" -> RIDE
            "SWIMMING", "OPEN_WATER_SWIMMING", "POOL_SWIMMING" -> SWIM
            else -> OTHER
        }
    }

    /** TCX-Attribut Activity Sport ("Running", "Biking", "Other"). */
    fun fromTcxSport(value: String?): String {
        if (value.isNullOrBlank()) return UNKNOWN
        return when (value.trim().lowercase()) {
            "running" -> RUN
            "biking" -> RIDE
            else -> OTHER
        }
    }

    /** GPX-Element trk/type, Schreibweisen sind je nach Quelle verschieden. */
    fun fromGpxType(value: String?): String {
        if (value.isNullOrBlank()) return UNKNOWN
        val text = value.trim().lowercase()
        return when {
            "run" in text || "jog" in text -> RUN
            "hik" in text || "trek" in text || "mountaineer" in text -> HIKE
            "walk" in text || "spazier" in text -> WALK
            "bik" in text || "cycl" in text || "rid" in text || "mtb" in text -> RIDE
            "swim" in text -> SWIM
            else -> OTHER
        }
    }

    /** Strava-Aktivitätstyp aus activities.csv ("Run", "Hike", "Walk", ...). */
    fun fromStravaType(value: String?): String {
        if (value.isNullOrBlank()) return UNKNOWN
        return when (value.trim().lowercase()) {
            "run", "trailrun", "trail run", "virtualrun", "virtual run", "treadmill" -> RUN
            "hike", "snowshoe" -> HIKE
            "walk", "nordic ski", "nordicski" -> WALK
            "ride", "ebikeride", "e-bike", "mountainbikeride", "gravelride", "virtualride" -> RIDE
            "swim" -> SWIM
            else -> OTHER
        }
    }

    data class CsvEntry(val name: String, val type: String)

    /**
     * Liest einen Strava-activities.csv-Export. Schlüssel sind kleingeschriebene
     * Dateinamen (mit/ohne Endung) und Aktivitäts-IDs, damit sowohl exakte
     * Dateinamen als auch ID-benannte Dateien zugeordnet werden können.
     * Unbekannte Kopfzeilen ergeben eine leere Zuordnung statt zu raten.
     */
    fun parseActivitiesCsv(text: String, maxRows: Int = 5000): Map<String, CsvEntry> {
        val lines = text.lineSequence().take(maxRows + 1).toList()
        if (lines.isEmpty()) return emptyMap()
        val header = splitCsvLine(lines.first())
        fun column(vararg names: String): Int {
            val lower = header.map { it.trim().lowercase() }
            for (name in names) {
                val index = lower.indexOf(name)
                if (index >= 0) return index
            }
            return -1
        }
        val idCol = column("activity id", "id")
        val nameCol = column("activity name", "name")
        val typeCol = column("activity type", "type", "sport")
        val fileCol = column("filename", "file name", "file")
        if (typeCol < 0) return emptyMap()
        val result = LinkedHashMap<String, CsvEntry>()
        for (line in lines.drop(1)) {
            if (line.isBlank()) continue
            val cells = splitCsvLine(line)
            fun cell(index: Int): String =
                if (index in cells.indices) cells[index].trim() else ""
            val type = cell(typeCol)
            if (type.isBlank()) continue
            val entry = CsvEntry(
                name = (if (nameCol >= 0) cell(nameCol) else "").take(120),
                type = type.take(60),
            )
            if (fileCol >= 0) {
                val file = cell(fileCol).substringAfterLast('/').substringAfterLast('\\')
                if (file.isNotBlank()) {
                    val lower = file.lowercase()
                    result[lower] = entry
                    result[lower.substringBeforeLast('.')] = entry
                }
            }
            if (idCol >= 0) {
                val id = cell(idCol)
                if (id.isNotBlank()) result[id.lowercase()] = entry
            }
        }
        return result
    }

    /** Sucht einen Eintrag zu einem Dateinamen (mit/ohne .gz und Endung). */
    fun lookupCsv(index: Map<String, CsvEntry>, fileName: String): CsvEntry? {
        var name = fileName.substringAfterLast('/').substringAfterLast('\\').lowercase()
        index[name]?.let { return it }
        if (name.endsWith(".gz")) {
            name = name.removeSuffix(".gz")
            index[name]?.let { return it }
        }
        val base = name.substringBeforeLast('.')
        if (base != name) index[base]?.let { return it }
        return null
    }

    /** CSV-Zeile mit Anführungszeichen und Kommas in Namen zerlegen. */
    internal fun splitCsvLine(line: String): List<String> {
        val cells = ArrayList<String>()
        val current = StringBuilder()
        var quoted = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            when {
                c == '"' -> {
                    if (quoted && i + 1 < line.length && line[i + 1] == '"') {
                        current.append('"'); i++
                    } else quoted = !quoted
                }
                c == ',' && !quoted -> {
                    cells.add(current.toString()); current.setLength(0)
                }
                else -> current.append(c)
            }
            i++
        }
        cells.add(current.toString())
        return cells
    }

    /** Wandelt einen CSV-Index in ein speicherbares JSON-Objekt um und zurück. */
    fun toJson(index: Map<String, CsvEntry>): JSONObject {
        val json = JSONObject()
        for ((key, entry) in index) {
            json.put(key, JSONObject().put("name", entry.name).put("type", entry.type))
        }
        return json
    }

    fun fromJson(json: JSONObject?): Map<String, CsvEntry> {
        if (json == null) return emptyMap()
        val result = LinkedHashMap<String, CsvEntry>()
        for (key in json.keys()) {
            val item = json.optJSONObject(key) ?: continue
            result[key] = CsvEntry(
                name = item.optString("name", "").take(120),
                type = item.optString("type", "").take(60),
            )
        }
        return result
    }
}
