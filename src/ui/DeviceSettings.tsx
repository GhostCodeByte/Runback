import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { nativeCall, type Capabilities, type Settings } from '../native';
import { Button, Copy, Notice, Row, Section, Title, color, space } from './components';

export function DeviceSettings({
  capabilities,
  settings,
  save,
  refresh,
}: {
  capabilities: Capabilities;
  settings: Settings;
  save: (patch: Partial<Settings>) => void;
  refresh: () => Promise<unknown>;
}) {
  const [ble, setBle] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [wear, setWear] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let mounted = true;
    const update = async () => {
      const results = await Promise.allSettled([
        nativeCall('bleStatus'),
        nativeCall('healthStatus'),
        nativeCall('getWearStatus'),
      ]);
      if (!mounted) {
        return;
      }
      if (results[0].status === 'fulfilled') {
        setBle(results[0].value);
      }
      if (results[1].status === 'fulfilled') {
        setHealth(results[1].value);
      }
      if (results[2].status === 'fulfilled') {
        setWear(results[2].value);
      }
    };
    void update();
    const timer = setInterval(update, 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Die Verbindung konnte nicht hergestellt werden.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Title>Geräte & Verbindungen</Title>
      {message ? (
        <View style={styles.message}>
          <Notice onDismiss={() => setMessage('')}>{message}</Notice>
        </View>
      ) : null}
      <Section title="Dieses Telefon">
        <Row
          title="GPS"
          subtitle={
            capabilities.gps
              ? capabilities.locationPermission
                ? 'Verfügbar und freigegeben'
                : 'Verfügbar · Freigabe beim Start'
              : 'Kein GPS-Sensor gemeldet'
          }
        />
        <Row
          title="Barometer"
          subtitle={
            capabilities.barometer
              ? 'Verfügbar'
              : 'Auf diesem Gerät nicht vorhanden'
          }
        />
        <Row
          title="Beschleunigung"
          subtitle={
            capabilities.accelerometer
              ? 'Verfügbar'
              : 'Auf diesem Gerät nicht vorhanden'
          }
        />
      </Section>
      <Section title="Wear OS">
        {wear ? (
          <Copy>
            {wear.message ||
              (wear.connected
                ? 'Uhr verbunden'
                : 'Derzeit keine Uhr verbunden')}
          </Copy>
        ) : (
          <Copy muted>Status wird geprüft …</Copy>
        )}
        <Copy muted>Die Uhr zeichnet auch ohne Telefon auf.</Copy>
      </Section>
      <Section title="Health Connect">
        <Copy muted>
          {health?.message ||
            (
              {
                connected: 'Lesen ist freigegeben.',
                permission_required: 'Lesefreigabe fehlt.',
                unavailable: 'Auf diesem Telefon nicht verfügbar.',
                provider_update_required:
                  'Health Connect muss installiert oder aktualisiert werden.',
              } as Record<string, string>
            )[health?.status] ||
            'Verfügbarkeit wird geprüft …'}
        </Copy>
        <Button
          secondary
          title="Leseberechtigungen verwalten"
          disabled={busy}
          onPress={() => {
            void act(async () =>
              setHealth(
                await nativeCall('healthRequestPermissions', false, false),
              ),
            );
          }}
        />
        <Button
          secondary
          title="Letzte 30 Tage importieren"
          disabled={busy || health?.status !== 'connected'}
          onPress={() => {
            void act(async () => {
              const result = await nativeCall<any>('healthImport', 30);
              setMessage(
                result.message ||
                  `${result.imported ?? result.runs ?? 0} Läufe eingelesen.`,
              );
              await refresh();
            });
          }}
        />
        <Copy muted>
          Verfügbar ist nur, was deine anderen Apps nach Health Connect
          schreiben.
        </Copy>
      </Section>
      <Section title="Bluetooth-Sensoren">
        <Copy muted>
          {ble?.error ||
            (ble?.scanning ? 'Suche läuft …' : 'Herzfrequenz, Kadenz, Akku.')}
        </Copy>
        <Button
          secondary
          title={ble?.scanning ? 'Suche stoppen' : 'Sensoren suchen'}
          disabled={busy}
          onPress={() => {
            void act(async () => {
              if (!ble?.scanning) {
                await nativeCall('requestBluetoothPermissions');
              }
              setBle(
                await nativeCall(
                  ble?.scanning ? 'bleStopScan' : 'bleStartScan',
                ),
              );
            });
          }}
        />
        {ble?.devices?.map((device: any) => (
          <View key={device.address}>
            <Row
              title={device.name || 'Unbenannter Sensor'}
              subtitle={`${
                (
                  {
                    connected: 'Verbunden',
                    connecting: 'Verbindet …',
                    disconnected: 'Getrennt',
                    reconnecting: 'Verbindet erneut …',
                  } as Record<string, string>
                )[device.state] || device.state
              }${device.error ? ` · ${device.error}` : ''}`}
            />
            {device.measurements?.heartRate ? (
              <Copy muted>
                Herzfrequenz: {device.measurements.heartRate.values.bpm} bpm
              </Copy>
            ) : null}
            {device.measurements?.cadence ? (
              <Copy muted>
                Kadenz: {device.measurements.cadence.values.rawCadence} /min
              </Copy>
            ) : null}
            {device.measurements?.battery ? (
              <Copy muted>
                Akku: {device.measurements.battery.values.percent} %
              </Copy>
            ) : null}
            <Button
              small
              secondary
              title={
                device.selected || device.connected
                  ? 'Sensor trennen'
                  : 'Verbinden'
              }
              disabled={busy}
              onPress={() => {
                void act(async () =>
                  setBle(
                    await nativeCall(
                      device.selected || device.connected
                        ? 'bleDisconnect'
                        : 'bleConnect',
                      device.address,
                    ),
                  ),
                );
              }}
            />
          </View>
        ))}
        {ble && !ble.scanning && !ble.devices?.length ? (
          <Copy muted>Keine Sensoren gefunden.</Copy>
        ) : null}
      </Section>
      <Section title="Wetterdaten">
        <Row
          title="Wetter ergänzen"
          subtitle="Sendet Position und Laufzeit an Open-Meteo."
          trailing={
            <Switch
              accessibilityLabel="Wetterdaten aktivieren"
              value={Boolean(settings.weatherEnabled)}
              onValueChange={value => save({ weatherEnabled: value })}
              trackColor={{ false: color.line, true: color.green }}
              thumbColor={settings.weatherEnabled ? color.ink : color.muted}
            />
          }
        />
      </Section>
    </>
  );
}
const styles = StyleSheet.create({
  message: { marginTop: space.sm },
});
