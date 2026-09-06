package com.runback.core

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.UUID

/** Standard GATT payloads. Cadence retains the sensor's 1/min unit without inventing steps. */
object BlePacketParser {
    data class HeartRate(val bpm: Int, val contact: Boolean?, val energyKj: Int?, val rrSeconds: List<Double>)
    data class Running(val speedMps: Double, val cadencePerMinute: Int, val strideMeters: Double?,
                       val totalMeters: Double?, val running: Boolean)
    private fun u8(data: ByteArray, at: Int) = data[at].toInt() and 255
    private fun u16(data: ByteArray, at: Int) = u8(data, at) or (u8(data, at + 1) shl 8)
    fun heartRate(data: ByteArray): HeartRate? {
        if (data.size < 2) return null
        val flags = u8(data, 0)
        var at = if (flags and 1 != 0) 3 else 2
        if (data.size < at) return null
        val bpm = if (flags and 1 != 0) u16(data, 1) else u8(data, 1)
        val contact = if (flags and 4 != 0) flags and 2 != 0 else null
        var energy: Int? = null
        if (flags and 8 != 0) {
            if (data.size < at + 2) return null
            energy = u16(data, at); at += 2
        }
        val rr = mutableListOf<Double>()
        if (flags and 16 != 0) {
            if (data.size == at || (data.size - at) % 2 != 0) return null
            while (at < data.size) { rr.add(u16(data, at) / 1024.0); at += 2 }
        }
        return HeartRate(bpm, contact, energy, rr)
    }
    fun running(data: ByteArray): Running? {
        if (data.size < 4) return null
        val flags = u8(data, 0)
        var at = 4
        var stride: Double? = null
        var distance: Double? = null
        if (flags and 1 != 0) {
            if (data.size < at + 2) return null
            stride = u16(data, at) / 100.0; at += 2
        }
        if (flags and 2 != 0) {
            if (data.size < at + 4) return null
            val raw = (0..3).fold(0L) { total, i -> total or (u8(data, at + i).toLong() shl (8 * i)) }
            distance = raw / 10.0
        }
        return Running(u16(data, 1) / 256.0, u8(data, 3), stride, distance, flags and 4 != 0)
    }
    fun battery(data: ByteArray): Int? = data.firstOrNull()?.toInt()?.and(255)?.takeIf { it <= 100 }
}

/** Process-wide collector shared by the recorder and settings. No scan starts without an explicit request. */
@SuppressLint("MissingPermission")
class BleSensors private constructor(context: Context) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val preferences = app.getSharedPreferences("runback_ble", Context.MODE_PRIVATE)
    private val adapter get() = app.getSystemService(BluetoothManager::class.java)?.adapter
    private val devices = linkedMapOf<String, DeviceState>()
    private val desired = preferences.getStringSet("devices", emptySet())!!.toMutableSet()
    private var recordingId: String? = null
    private var scanning = false
    private var error: String? = null
    private var scanDeadline: Runnable? = null
    private var store: RunStore? = null

    init { desired.forEach { devices[it] = DeviceState(it, "BLE-Sensor") } }

    private class DeviceState(val address: String, var name: String) {
        var state = "disconnected"
        var rssi: Int? = null
        var lastSeen: Long? = null
        var error: String? = null
        var gatt: BluetoothGatt? = null
        var retries = 0
        var timer: Runnable? = null
        var operationTimer: Runnable? = null
        val queue = ArrayDeque<() -> Boolean>()
        val services = mutableSetOf<String>()
        val measurements = JSONObject()
    }

    private fun permitted(permission: String) = app.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun connectAllowed() = Build.VERSION.SDK_INT < 31 || permitted(Manifest.permission.BLUETOOTH_CONNECT)
    private fun scanAllowed() = if (Build.VERSION.SDK_INT >= 31) permitted(Manifest.permission.BLUETOOTH_SCAN) && connectAllowed()
                               else permitted(Manifest.permission.ACCESS_FINE_LOCATION)
    private fun availability(): String? = when {
        !app.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) -> "Bluetooth LE ist auf diesem Gerät nicht verfügbar."
        !connectAllowed() -> "Bluetooth-Berechtigung fehlt."
        adapter == null -> "Kein Bluetooth-Adapter verfügbar."
        !runCatching { adapter?.isEnabled == true }.getOrDefault(false) -> "Bluetooth ist ausgeschaltet."
        else -> null
    }

    @Synchronized fun status(): JSONObject {
        val list = JSONArray()
        for (device in devices.values) {
            list.put(JSONObject().put("id", device.address).put("address", device.address).put("name", device.name)
                .put("state", device.state).put("connected", device.state == "connected")
                .put("selected", desired.contains(device.address)).put("rssi", device.rssi ?: JSONObject.NULL)
                .put("lastSeen", device.lastSeen ?: JSONObject.NULL).put("error", device.error ?: JSONObject.NULL)
                .put("services", JSONArray(device.services.toList())).put("measurements", JSONObject(device.measurements.toString())))
        }
        return JSONObject().put("available", availability() == null).put("scanning", scanning)
            .put("permissionGranted", scanAllowed()).put("error", availability() ?: error ?: JSONObject.NULL)
            .put("devices", list)
    }

    @Synchronized fun startScan(): JSONObject {
        error = availability()
        if (error == null && !scanAllowed()) error = "Zum Suchen fehlt die Bluetooth- oder Standortberechtigung."
        if (error != null || scanning) return status()
        try {
            val scanner = adapter?.bluetoothLeScanner ?: run { error = "Bluetooth-Suche nicht verfügbar."; return status() }
            // Unfiltered discovery also finds sensors whose advertisements omit the service UUID.
            scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
            scanning = true
            scanDeadline = Runnable { stopScan() }.also { handler.postDelayed(it, 15_000) }
        } catch (failure: RuntimeException) { error = "Bluetooth-Suche fehlgeschlagen: ${failure.message.orEmpty()}" }
        return status()
    }

    @Synchronized fun stopScan(): JSONObject {
        scanDeadline?.let(handler::removeCallbacks); scanDeadline = null
        if (scanning) runCatching { adapter?.bluetoothLeScanner?.stopScan(scanCallback) }
        scanning = false
        return status()
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) { synchronized(this@BleSensors) {
            val address = result.device.address
            val name = result.scanRecord?.deviceName ?: runCatching { result.device.name }.getOrNull() ?: "BLE-Sensor"
            val device = devices.getOrPut(address) { DeviceState(address, name) }
            device.name = name; device.rssi = result.rssi; device.lastSeen = System.currentTimeMillis()
            result.scanRecord?.serviceUuids?.forEach { device.services.add(it.uuid.toString()) }
        } }
        override fun onBatchScanResults(results: MutableList<ScanResult>) { results.forEach { onScanResult(0, it) } }
        override fun onScanFailed(errorCode: Int) = synchronized(this@BleSensors) {
            scanning = false; error = "Bluetooth-Suche fehlgeschlagen (Code $errorCode)."
        }
    }

    @Synchronized fun connect(address: String): JSONObject {
        if (!BluetoothAdapter.checkBluetoothAddress(address)) { error = "Ungültige Sensoradresse."; return status() }
        error = availability()
        if (error != null) return status()
        desired.add(address); saveSelected()
        val device = devices.getOrPut(address) { DeviceState(address, "BLE-Sensor") }
        device.retries = 0
        open(device)
        return status()
    }

    private fun open(device: DeviceState) {
        if (device.gatt != null) return
        device.timer?.let(handler::removeCallbacks); device.timer = null
        availability()?.let { device.error = it; device.state = "disconnected"; return }
        device.state = "connecting"; device.error = null
        try {
            val remote = adapter!!.getRemoteDevice(device.address)
            remote.name?.let { device.name = it }
            device.gatt = remote.connectGatt(app, false, callback, BluetoothDevice.TRANSPORT_LE)
            device.timer = Runnable { synchronized(this) {
                if (device.state == "connecting") failed(device, "Sensor antwortet nicht.")
            } }.also { handler.postDelayed(it, 20_000) }
        } catch (failure: RuntimeException) { failed(device, "Verbindung fehlgeschlagen: ${failure.message.orEmpty()}") }
    }

    @Synchronized fun disconnect(address: String): JSONObject {
        desired.remove(address); saveSelected()
        devices[address]?.let { close(it); it.state = "disconnected"; it.error = null }
        return status()
    }
    private fun saveSelected() { preferences.edit().putStringSet("devices", desired.toSet()).apply() }
    @Synchronized fun reconnectSaved() {
        for (address in desired.toList()) {
            val device = devices.getOrPut(address) { DeviceState(address, "BLE-Sensor") }
            device.retries = 0; open(device)
        }
    }
    @Synchronized fun startRecording(runId: String) { recordingId = runId; reconnectSaved() }
    @Synchronized fun stopRecording() { recordingId = null }
    @Synchronized fun stopAll() {
        stopRecording(); stopScan()
        devices.values.forEach { close(it); it.state = "disconnected" }
    }
    private fun close(device: DeviceState) {
        device.timer?.let(handler::removeCallbacks); device.timer = null
        device.operationTimer?.let(handler::removeCallbacks); device.operationTimer = null
        device.queue.clear()
        val gatt = device.gatt; device.gatt = null
        runCatching { gatt?.disconnect() }; runCatching { gatt?.close() }
    }
    private fun failed(device: DeviceState, reason: String) {
        close(device); device.error = reason
        if (device.address in desired && device.retries < 5 && availability() == null) {
            device.state = "reconnecting"
            val delay = (2_000L shl device.retries++).coerceAtMost(30_000L)
            device.timer = Runnable { synchronized(this) { open(device) } }.also { handler.postDelayed(it, delay) }
        } else device.state = "disconnected"
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) = synchronized(this@BleSensors) {
            val device = current(gatt) ?: return@synchronized
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                device.timer?.let(handler::removeCallbacks); device.timer = null
                device.state = "discovering"
                if (!runCatching { gatt.discoverServices() }.getOrDefault(false)) failed(device, "Sensordienste konnten nicht gelesen werden.")
                else device.timer = Runnable { synchronized(this@BleSensors) { failed(device, "Sensordienste antworten nicht.") } }
                    .also { handler.postDelayed(it, 15_000) }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                failed(device, "Sensor getrennt (Code $status).")
            }
        }
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) = synchronized(this@BleSensors) {
            val device = current(gatt) ?: return@synchronized
            device.timer?.let(handler::removeCallbacks); device.timer = null
            if (status != BluetoothGatt.GATT_SUCCESS) { failed(device, "Sensordienste konnten nicht gelesen werden."); return@synchronized }
            device.services.clear(); gatt.services.forEach { device.services.add(it.uuid.toString()) }
            val heart = gatt.getService(HR_SERVICE)?.getCharacteristic(HR_MEASUREMENT)
            val running = gatt.getService(RSC_SERVICE)?.getCharacteristic(RSC_MEASUREMENT)
            if (heart == null && running == null) {
                close(device); device.state = "unsupported"; device.error = "Kein Standard-Puls- oder Laufsensor (HR/RSC)."; return@synchronized
            }
            for (characteristic in listOfNotNull(heart, running)) subscribe(device, gatt, characteristic)
            gatt.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let { battery ->
                if (battery.properties and BluetoothGattCharacteristic.PROPERTY_READ != 0) device.queue.add { gatt.readCharacteristic(battery) }
                if (battery.properties and (BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)
                    subscribe(device, gatt, battery)
            }
            device.state = "connected"
            next(device)
        }
        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = synchronized(this@BleSensors) {
            val device = current(gatt) ?: return@synchronized
            if (status != BluetoothGatt.GATT_SUCCESS) device.error = "Sensorbenachrichtigung konnte nicht aktiviert werden (Code $status)."
            next(device)
        }
        @Deprecated("Used on Android 12 and earlier")
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (Build.VERSION.SDK_INT < 33) read(gatt, characteristic.uuid, characteristic.value ?: byteArrayOf(), status)
        }
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            read(gatt, characteristic.uuid, value, status)
        }
        @Deprecated("Used on Android 12 and earlier")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) changed(gatt, characteristic.uuid, characteristic.value ?: byteArrayOf())
        }
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            changed(gatt, characteristic.uuid, value)
        }
    }
    private fun current(gatt: BluetoothGatt) = devices.values.firstOrNull { it.gatt === gatt }
    @Suppress("DEPRECATION")
    private fun subscribe(device: DeviceState, gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
        val descriptor = characteristic.getDescriptor(CCCD)
        if (descriptor == null) { device.error = "Sensor unterstützt keine Standard-Benachrichtigungen."; return }
        device.queue.add {
            if (!gatt.setCharacteristicNotification(characteristic, true)) false
            else {
                val value = if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0)
                    BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                if (Build.VERSION.SDK_INT >= 33) gatt.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS
                else { descriptor.value = value; gatt.writeDescriptor(descriptor) }
            }
        }
    }
    private fun next(device: DeviceState) {
        device.operationTimer?.let(handler::removeCallbacks); device.operationTimer = null
        while (device.queue.isNotEmpty()) {
            if (runCatching { device.queue.removeFirst().invoke() }.getOrDefault(false)) {
                device.operationTimer = Runnable { synchronized(this) { failed(device, "Sensorabfrage hat nicht geantwortet.") } }
                    .also { handler.postDelayed(it, 10_000) }
                return
            }
            device.error = "Eine Sensorabfrage konnte nicht gestartet werden."
        }
    }
    @Synchronized private fun read(gatt: BluetoothGatt, uuid: UUID, value: ByteArray, result: Int) {
        val device = current(gatt) ?: return
        if (result == BluetoothGatt.GATT_SUCCESS) receive(device, uuid, value)
        else device.error = "Sensorwert konnte nicht gelesen werden (Code $result)."
        next(device)
    }
    @Synchronized private fun changed(gatt: BluetoothGatt, uuid: UUID, value: ByteArray) {
        current(gatt)?.let { receive(it, uuid, value) }
    }
    private fun receive(device: DeviceState, uuid: UUID, bytes: ByteArray) {
        val time = System.currentTimeMillis()
        val values = JSONObject().put("source", "ble").put("deviceId", device.address).put("deviceName", device.name)
            .put("characteristic", uuid.toString()).put("timestampOrigin", "received")
            .put("rawHex", bytes.joinToString("") { "%02x".format(it.toInt() and 255) })
        val kind: String
        when (uuid) {
            HR_MEASUREMENT -> {
                val measurement = BlePacketParser.heartRate(bytes) ?: return
                kind = "heartRate"
                values.put("bpm", measurement.bpm).put("unit", "bpm")
                    .put("contact", measurement.contact ?: JSONObject.NULL).put("energyKj", measurement.energyKj ?: JSONObject.NULL)
                    .put("rrSeconds", JSONArray(measurement.rrSeconds))
            }
            RSC_MEASUREMENT -> {
                val measurement = BlePacketParser.running(bytes) ?: return
                kind = "cadence"
                values.put("rawCadence", measurement.cadencePerMinute).put("cadenceUnit", "1/min")
                    .put("normalization", "sensor_native_unverified").put("speedMps", measurement.speedMps)
                    .put("strideMeters", measurement.strideMeters ?: JSONObject.NULL)
                    .put("totalMeters", measurement.totalMeters ?: JSONObject.NULL).put("running", measurement.running)
            }
            BATTERY_LEVEL -> { kind = "battery"; values.put("percent", BlePacketParser.battery(bytes) ?: return).put("unit", "%") }
            else -> return
        }
        device.lastSeen = time
        if (uuid != BATTERY_LEVEL) device.retries = 0
        device.measurements.put(kind, JSONObject().put("time", time).put("values", values))
        recordingId?.let { runId ->
            try {
                val repository = store ?: RunStore(app).also { store = it }
                repository.appendSamples(runId, listOf(RawSample(time, kind, values)))
            } catch (failure: Exception) { device.error = "Sensorwert konnte nicht gespeichert werden: ${failure.message.orEmpty()}" }
        }
    }

    companion object {
        private fun uuid(value: String) = UUID.fromString("0000$value-0000-1000-8000-00805f9b34fb")
        private val HR_SERVICE = uuid("180d")
        private val HR_MEASUREMENT = uuid("2a37")
        private val RSC_SERVICE = uuid("1814")
        private val RSC_MEASUREMENT = uuid("2a53")
        private val BATTERY_SERVICE = uuid("180f")
        private val BATTERY_LEVEL = uuid("2a19")
        private val CCCD = uuid("2902")
        @Volatile private var instance: BleSensors? = null
        fun get(context: Context): BleSensors = instance ?: synchronized(this) {
            instance ?: BleSensors(context).also { instance = it }
        }
    }
}
