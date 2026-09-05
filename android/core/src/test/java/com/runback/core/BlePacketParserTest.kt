package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class BlePacketParserTest {
    private fun packet(vararg bytes: Int) = bytes.map { it.toByte() }.toByteArray()
    @Test fun heartRateDecodesUnsignedFormatsAndContact() {
        assertEquals(180, BlePacketParser.heartRate(packet(0, 180))!!.bpm)
        val wide = BlePacketParser.heartRate(packet(7, 44, 1))!!
        assertEquals(300, wide.bpm)
        assertEquals(true, wide.contact)
        assertEquals(false, BlePacketParser.heartRate(packet(4, 70))!!.contact)
        assertNull(BlePacketParser.heartRate(packet(0, 70))!!.contact)
    }
    @Test fun heartRateRetainsEnergyAndAllRrIntervals() {
        val hr = BlePacketParser.heartRate(packet(24, 72, 42, 0, 0, 4, 0, 3))!!
        assertEquals(42, hr.energyKj)
        assertEquals(listOf(1.0, 0.75), hr.rrSeconds)
    }
    @Test fun malformedHeartPacketsNeverBecomeMeasurements() {
        for (p in listOf(packet(), packet(0), packet(1, 9), packet(8, 70, 1), packet(16, 70), packet(16, 70, 1)))
            assertNull(BlePacketParser.heartRate(p))
    }
    @Test fun runningConvertsWireUnitsAndKeepsNativeCadence() {
        val rsc = BlePacketParser.running(packet(7, 0, 3, 89, 123, 0, 210, 4, 0, 0))!!
        assertEquals(3.0, rsc.speedMps, 0.0)
        assertEquals(89, rsc.cadencePerMinute)
        assertEquals(1.23, rsc.strideMeters!!, 0.0)
        assertEquals(123.4, rsc.totalMeters!!, 0.0)
        assertTrue(rsc.running)
    }
    @Test fun runningHandlesUnsignedDistanceAndOptionalFieldOffsets() {
        val rsc = BlePacketParser.running(packet(2, 255, 255, 255, 255, 255, 255, 255))!!
        assertEquals(429496729.5, rsc.totalMeters!!, 0.0)
        assertEquals(255.99609375, rsc.speedMps, 0.0)
        assertEquals(255, rsc.cadencePerMinute)
        assertNull(rsc.strideMeters)
        assertFalse(rsc.running)
    }
    @Test fun truncatedOptionalRunningFieldsAreRejected() {
        assertNull(BlePacketParser.running(packet(0, 0, 0)))
        assertNull(BlePacketParser.running(packet(1, 0, 0, 90, 1)))
        assertNull(BlePacketParser.running(packet(2, 0, 0, 90, 1, 2, 3)))
        assertNull(BlePacketParser.running(packet(3, 0, 0, 90, 1, 2, 3, 4)))
        assertEquals(0, BlePacketParser.running(packet(0, 0, 0, 0))!!.cadencePerMinute)
    }
    @Test fun batteryAcceptsOnlyPercentValues() {
        assertEquals(0, BlePacketParser.battery(packet(0)))
        assertEquals(100, BlePacketParser.battery(packet(100)))
        assertNull(BlePacketParser.battery(packet(101)))
        assertNull(BlePacketParser.battery(packet(255)))
        assertNull(BlePacketParser.battery(packet()))
    }
}
