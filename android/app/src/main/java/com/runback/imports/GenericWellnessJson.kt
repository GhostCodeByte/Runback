package com.runback.imports

import com.runback.core.WellnessRow
import org.json.JSONArray
import java.util.Locale

/** Only explicitly labelled weight records are supported in generic JSON. */
internal object GenericWellnessJson {
    fun parse(text: String, checkCancelled: () -> Unit = {}): List<WellnessRow> {
        if (!text.trimStart().startsWith("[")) return emptyList()
        val array = JSONArray(text)
        val rows = ArrayList<WellnessRow>()
        for (i in 0 until minOf(array.length(), 5000)) {
            checkCancelled()
            val obj = array.optJSONObject(i) ?: continue
            if (obj.optString("kind").lowercase(Locale.ROOT) != "weight") continue
            val unit = obj.optString("unit").trim()
            if (unit.isEmpty()) continue
            val time = VendorImports.parseTimeFlexible(obj.optString("time", obj.optString("date"))) ?: continue
            if (time <= 0) continue
            val kg = VendorImports.toKilograms(obj.optDouble("value", Double.NaN), unit) ?: continue
            if (!kg.isFinite() || kg <= 0) continue
            rows.add(WellnessRow(VendorImports.wellnessId("weight", time, "generic", kg),
                "weight", time, 0L, kg, "kg", "generic", "{}"))
        }
        return rows
    }
}
