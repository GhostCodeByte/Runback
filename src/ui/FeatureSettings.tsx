import React from 'react';
import { Switch } from 'react-native';
import {
  AFTER_RUN_LABELS,
  AFTER_RUN_OPTIONS,
  HOME_SECTION_LABELS,
  RECOMMENDATION_MODES,
  RECOMMENDATION_MODE_LABELS,
  RECORDING_PRIMARIES,
  RECORDING_PRIMARY_LABELS,
  REST_SECONDS_OPTIONS,
  SORENESS_PROMPTS,
  SORENESS_PROMPT_LABELS,
  STATS_MODULES,
  STATS_MODULE_LABELS,
  availableHomeSections,
  visibleHomeSections,
  withArea,
  type Area,
  type FeatureSettings as Features,
  type RecordingMetric,
  type StatsModule,
} from '../domain/features';
import {
  ChipGroup,
  Copy,
  Field,
  Row,
  Section,
  Title,
  color,
} from './components';

/**
 * Eine Seite, ein Satz je Zeile: Was Runback zeigt und wann es fragt.
 * Abschalten wirkt sofort und versteckt nur; Daten bleiben. Die Zeile nennt
 * die Funktion, der Untertitel den aktuellen Wert — keine Erklärtexte.
 */
export function FeatureSettings({
  features,
  screen = 'main',
  disabled = false,
  onChange,
  onOpenHomeSections,
  onOpenDevices,
}: {
  features: Features;
  screen?: 'main' | 'home';
  disabled?: boolean;
  onChange: (next: Features) => void;
  onOpenHomeSections: () => void;
  onOpenDevices: () => void;
}) {
  const toggle = (value: boolean, change: (value: boolean) => void) => (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={change}
      trackColor={{ false: color.line, true: color.green }}
      thumbColor={value ? color.ink : color.muted}
    />
  );
  const setArea = (area: Area, enabled: boolean) =>
    onChange(withArea(features, area, enabled));
  const patch = <K extends Exclude<keyof Features, 'version'>>(
    key: K,
    value: Partial<Features[K]>,
  ) =>
    onChange({
      ...features,
      [key]: { ...(features[key] as object), ...value },
    });
  const toggleIn = <T extends string>(list: T[], item: T, on: boolean) =>
    on ? [...list, item] : list.filter(entry => entry !== item);
  const hasMetric = (metric: RecordingMetric) =>
    features.recording.metrics.includes(metric);
  const setMetric = (metric: RecordingMetric, on: boolean) =>
    patch('recording', {
      metrics: toggleIn(features.recording.metrics, metric, on),
    });
  const hasModule = (module: StatsModule) =>
    features.statistics.modules.includes(module);
  const setModule = (module: StatsModule, on: boolean) =>
    patch('statistics', {
      modules: toggleIn(features.statistics.modules, module, on),
    });
  const running = features.areas.running;
  const strength = features.areas.strength;
  const recordsSomething = running || features.sports.cycling;

  if (screen === 'home') {
    const available = availableHomeSections(features);
    return (
      <>
        <Title>Blöcke auf Heute</Title>
        <Copy muted>
          Die Startkarte bleibt immer. Was du hier abwählst, bleibt im Plan, im
          Coach und im Verlauf erreichbar.
        </Copy>
        <Section title="Sichtbar">
          {available.map(section => (
            <Row
              key={section}
              title={HOME_SECTION_LABELS[section]}
              trailing={toggle(
                features.home.sections.includes(section),
                value =>
                  patch('home', {
                    sections: toggleIn(features.home.sections, section, value),
                  }),
              )}
            />
          ))}
        </Section>
      </>
    );
  }

  const homeCount = visibleHomeSections(features).length;
  const homeTotal = availableHomeSections(features).length;
  return (
    <>
      <Title>Funktionen</Title>
      <Copy muted>
        Aus heißt weg: Abgeschaltetes verschwindet aus der App. Deine Daten
        bleiben und kommen mit dem Einschalten zurück.
      </Copy>
      <Section title="Bereiche">
        <Row
          title="Laufen"
          subtitle="Startkarte, Empfehlung, Vorlagen, Statistik"
          trailing={toggle(running, value => setArea('running', value))}
        />
        <Row
          title="Krafttraining"
          subtitle="Training, Pläne, Empfehlung, Statistik"
          trailing={toggle(strength, value => setArea('strength', value))}
        />
        <Row
          title="Radfahren in der Auswahl"
          subtitle="Sportart vor der Aufzeichnung"
          trailing={toggle(features.sports.cycling, value =>
            patch('sports', { cycling: value }),
          )}
        />
        {running !== strength ? (
          <Copy muted>Ein Bereich bleibt immer an.</Copy>
        ) : null}
      </Section>
      <Section title="Muskelkater">
        <Row
          title="Muskelkater melden"
          subtitle="Block auf Heute, Abfrage, Muskelkarte"
          trailing={toggle(features.soreness.enabled, value =>
            patch('soreness', { enabled: value }),
          )}
        />
        {features.soreness.enabled ? (
          <>
            <Field label="Wann Runback fragt">
              <ChipGroup
                label="Wann Runback nach Muskelkater fragt"
                options={SORENESS_PROMPTS.map(value => ({
                  value,
                  label: SORENESS_PROMPT_LABELS[value],
                }))}
                value={features.soreness.prompt}
                onChange={prompt => patch('soreness', { prompt })}
                disabled={disabled}
              />
            </Field>
            <Row
              title="Muskelkarte"
              subtitle="Gemeldeter Muskelkater und Frische je Region"
              trailing={toggle(features.soreness.map, value =>
                patch('soreness', { map: value }),
              )}
            />
            <Row
              title="Spracheingabe beim Melden"
              subtitle="Mikrofon in der Muskelkater-Erfassung"
              trailing={toggle(features.soreness.voice, value =>
                patch('soreness', { voice: value }),
              )}
            />
          </>
        ) : null}
      </Section>
      <Section title="Heute">
        <Row
          title="Blöcke auf Heute"
          subtitle={`${homeCount} von ${homeTotal} sichtbar`}
          onPress={onOpenHomeSections}
        />
      </Section>
      <Section title="Planung">
        <Row
          title="Planung als Tab"
          subtitle="Woche, Monat, Zeit & Rhythmus, Wochenvorschlag"
          trailing={toggle(features.planning.enabled, value =>
            patch('planning', { enabled: value }),
          )}
        />
        {features.planning.enabled ? (
          <>
            <Row
              title="Woche vorschlagen"
              trailing={toggle(features.planning.suggest, value =>
                patch('planning', { suggest: value }),
              )}
            />
            <Row
              title="Monatsansicht"
              trailing={toggle(features.planning.month, value =>
                patch('planning', { month: value }),
              )}
            />
          </>
        ) : null}
      </Section>
      <Section title="Empfehlungen">
        {running ? (
          <Field label="Laufen">
            <ChipGroup
              label="Empfehlungen fürs Laufen"
              options={RECOMMENDATION_MODES.map(value => ({
                value,
                label: RECOMMENDATION_MODE_LABELS[value],
              }))}
              value={features.recommendations.running}
              onChange={mode => patch('recommendations', { running: mode })}
              disabled={disabled}
            />
          </Field>
        ) : null}
        {strength ? (
          <Field label="Krafttraining">
            <ChipGroup
              label="Empfehlungen fürs Krafttraining"
              options={RECOMMENDATION_MODES.map(value => ({
                value,
                label: RECOMMENDATION_MODE_LABELS[value],
              }))}
              value={features.recommendations.strength}
              onChange={mode => patch('recommendations', { strength: mode })}
              disabled={disabled}
            />
          </Field>
        ) : null}
        <Row
          title="„Danach vorgesehen“ anzeigen"
          subtitle="Die wartende nächste Empfehlung"
          trailing={toggle(features.recommendations.showQueued, value =>
            patch('recommendations', { showQueued: value }),
          )}
        />
        <Copy muted>
          Nur auf Nachfrage: Die Empfehlung steht im Coach, nicht auf Heute.
          Aus: Eine laufende Empfehlung wird pausiert, nicht abgebrochen.
        </Copy>
      </Section>
      {recordsSomething ? (
        <Section title="Aufzeichnung">
          <Field label="Groß angezeigt">
            <ChipGroup
              label="Große Kennzahl während der Aufzeichnung"
              options={RECORDING_PRIMARIES.map(value => ({
                value,
                label: RECORDING_PRIMARY_LABELS[value],
              }))}
              value={features.recording.primary}
              onChange={primary => patch('recording', { primary })}
              disabled={disabled}
            />
          </Field>
          <Row
            title="Kilometer"
            trailing={toggle(hasMetric('distance'), value =>
              setMetric('distance', value),
            )}
          />
          <Row
            title="Tempo"
            trailing={toggle(hasMetric('pace'), value =>
              setMetric('pace', value),
            )}
          />
          <Row
            title="Herzfrequenz"
            subtitle="Nur mit vorhandenen Messdaten"
            trailing={toggle(hasMetric('heartRate'), value =>
              setMetric('heartRate', value),
            )}
          />
          {running ? (
            <>
              <Row
                title="Laufen nach Tempo oder Puls"
                subtitle="Zielvorgabe vor dem Start anbieten"
                trailing={toggle(features.recording.targets, value =>
                  patch('recording', { targets: value }),
                )}
              />
              <Row
                title="Routenplaner"
                subtitle="Routen anlegen und mit Ansagen laufen"
                trailing={toggle(features.recording.routes, value =>
                  patch('recording', { routes: value }),
                )}
              />
            </>
          ) : null}
          <Field label="Nach dem Beenden">
            <ChipGroup
              label="Was nach dem Beenden einer Aufzeichnung passiert"
              options={AFTER_RUN_OPTIONS.map(value => ({
                value,
                label: AFTER_RUN_LABELS[value],
              }))}
              value={features.recording.afterRun}
              onChange={afterRun => patch('recording', { afterRun })}
              disabled={disabled}
            />
          </Field>
        </Section>
      ) : null}
      {strength ? (
        <Section title="Krafttraining">
          <Row
            title="Pausentimer"
            subtitle="Balken nach jedem bestätigten Satz"
            trailing={toggle(features.strength.restTimer, value =>
              patch('strength', { restTimer: value }),
            )}
          />
          <Field label="Standardpause für neue Sätze">
            <ChipGroup
              label="Standardpause für neue Sätze"
              options={REST_SECONDS_OPTIONS.map(value => ({
                value: String(value),
                label: `${value} s`,
              }))}
              value={String(features.strength.defaultRestSeconds)}
              onChange={value =>
                patch('strength', { defaultRestSeconds: Number(value) })
              }
              disabled={disabled}
            />
          </Field>
          <Row
            title="Wiederholungen im Tank"
            subtitle="Feld je Satz, freiwillig"
            trailing={toggle(features.strength.rir, value =>
              patch('strength', { rir: value }),
            )}
          />
          <Row
            title="Tagesvorlage auf Heute"
            subtitle="Vorlage nach Wochentag vorschlagen"
            trailing={toggle(features.strength.templateOfDay, value =>
              patch('strength', { templateOfDay: value }),
            )}
          />
        </Section>
      ) : null}
      {running ? (
        <Section title="Statistik · Tiefer schauen">
          {STATS_MODULES.map(module => (
            <Row
              key={module}
              title={STATS_MODULE_LABELS[module]}
              trailing={toggle(hasModule(module), value =>
                setModule(module, value),
              )}
            />
          ))}
        </Section>
      ) : null}
      <Section title="Verbindungen">
        <Row
          title="Geräte & Verbindungen"
          subtitle="Uhr, Sensoren, Health Connect, Wetter, OpenRouter"
          onPress={onOpenDevices}
        />
      </Section>
    </>
  );
}
