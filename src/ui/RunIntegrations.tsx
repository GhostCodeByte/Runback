import React, { useState } from 'react';
import { Alert } from 'react-native';
import { nativeCall } from '../native';
import { Button, Copy, Section } from './components';
export function RunIntegrations({
  id,
  weatherEnabled,
}: {
  id: string;
  weatherEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [weather, setWeather] = useState<any>(null);
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
        error instanceof Error ? error.message : 'Aktion fehlgeschlagen.',
      );
    } finally {
      setBusy(false);
    }
  };
  const healthExport = (route: boolean) => {
    void act(async () => {
      await nativeCall('healthRequestPermissions', true, route);
      const result = await nativeCall<any>('healthExport', id, route);
      setMessage(
        result.message ||
          (result.status === 'exported' || result.status === 'success'
            ? 'Lauf an Health Connect übergeben.'
            : `Health Connect: ${result.status || 'Vorgang abgeschlossen'}`),
      );
    });
  };
  return (
    <>
      <Section title="Wetter zum Lauf">
        <Copy muted>
          {weatherEnabled
            ? 'Genaue Position und Laufzeit werden für diese Anfrage an Open-Meteo übermittelt.'
            : 'Wetter ist ausgeschaltet. Du kannst es unter Geräte & Verbindungen freigeben.'}
        </Copy>
        {weather ? (
          <>
            <Copy>
              {weather.message ||
                (weather.status === 'available' || weather.status === 'partial'
                  ? `${weather.temperatureC ?? '–'} °C · ${
                      weather.windMps ?? '–'
                    } m/s Wind`
                  : 'Für diesen Lauf sind keine passenden Wetterdaten verfügbar.')}
            </Copy>
            {weather.source ? (
              <Copy muted>
                Quelle: {weather.source} · {weather.resolution} · Modell{' '}
                {weather.modelVersion}. Regionaler Modellwind, keine Messung am
                Körper.
              </Copy>
            ) : null}
          </>
        ) : null}
        <Button
          secondary
          title="Wetter abrufen"
          disabled={!weatherEnabled || busy}
          onPress={() => {
            void act(async () =>
              setWeather(await nativeCall('enrichWeather', id)),
            );
          }}
        />
      </Section>
      <Section title="Health Connect">
        <Copy muted>
          Nur nach deiner Freigabe. Die Route kannst du getrennt mitgeben.
        </Copy>
        <Button
          secondary
          title="Lauf an Health Connect senden"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              'Route mitgeben?',
              'Andere Apps mit Health-Connect-Zugriff können diese Daten lesen.',
              [
                { text: 'Abbrechen', style: 'cancel' },
                { text: 'Ohne Route', onPress: () => healthExport(false) },
                { text: 'Mit Route', onPress: () => healthExport(true) },
              ],
            )
          }
        />
      </Section>
      {message ? <Copy>{message}</Copy> : null}
    </>
  );
}
