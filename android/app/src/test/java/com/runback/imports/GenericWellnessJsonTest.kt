package com.runback.imports

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CancellationException

class GenericWellnessJsonTest {
    @Test fun unknownMetricsAndMissingUnitsAreNotWeight() {
        val text = """[
            {"date":"2024-11-02","value":8000},
            {"kind":"steps","date":"2024-11-02","value":8000,"unit":"count"},
            {"kind":"weight","date":"2024-11-02","value":70},
            {"kind":"weight","date":"2024-11-02","value":70,"unit":"unknown"},
            {"kind":"weight","date":"2024-11-02","value":-70,"unit":"kg"}
        ]"""
        assertTrue(GenericWellnessJson.parse(text).isEmpty())
    }

    @Test fun labelledWeightsAreConvertedWithStableIds() {
        val text = """[{"kind":"weight","date":"2024-11-02","value":150,"unit":"lb"}]"""
        val row = GenericWellnessJson.parse(text).single()
        assertEquals("weight", row.kind)
        assertEquals("kg", row.unit)
        assertEquals(68.0388555, row.value, 0.000001)
        assertEquals(row.id, GenericWellnessJson.parse(text).single().id)
    }

    @Test(expected = CancellationException::class) fun cancellationPropagates() {
        GenericWellnessJson.parse("[{}]") { throw CancellationException() }
    }
}
