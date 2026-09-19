import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/native', () => {
  // Innerhalb der Factory, weil jest.mock vor die Importe gehoben wird.
  const { emptyStrengthState } = require('../src/domain/strength');
  const state = {
    runs: [],
    recording: null,
    settings: { onboardedAt: 1, purpose: 'free', minutes: 30 },
    capabilities: {},
  };
  return {
    nativeCall: jest.fn(() => Promise.resolve({})),
    native: {
      state: jest.fn(() => Promise.resolve(state)),
      run: jest.fn(() => Promise.resolve(null)),
      saveSettings: jest.fn(() => Promise.resolve()),
      feedback: jest.fn(() => Promise.resolve()),
      strength: jest.fn(() => Promise.resolve(emptyStrengthState())),
      strengthSessions: jest.fn(() => Promise.resolve([])),
      sorenessReports: jest.fn(() => Promise.resolve([])),
      saveStrengthSession: jest.fn(() => Promise.resolve()),
      finishStrengthSession: jest.fn(() =>
        Promise.resolve(emptyStrengthState()),
      ),
      strengthSession: jest.fn(() => Promise.resolve(null)),
    },
  };
});

import { RunbackApp } from '../src/ui/RunbackApp';
import { native } from '../src/native';
import { ChipGroup } from '../src/ui/components';
import { acceptRecommendation, analyzeRun } from '../src/domain';
import type { RunSummary } from '../src/domain';

const DAY = 86400000;
/** Zwei vergleichbare Vorläufe: erst der Median mehrerer Läufe trägt eine Empfehlung. */
const previousRuns = (base: RunSummary): RunSummary[] =>
  [1, 2].map(index => ({
    ...base,
    id: `${base.id}-prev-${index}`,
    startTime: base.startTime - index * 7 * DAY,
    endTime: base.startTime - index * 7 * DAY + (base.endTime - base.startTime),
  }));

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : textContent(child as TestRenderer.ReactTestInstance),
    )
    .join('');
}

const screenText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map(textContent).join(' ');

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<RunbackApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

/** Schalter (Switch) tragen keinen Titel; sie hängen an der Zeile davor. */
const flip = async (tree: TestRenderer.ReactTestRenderer, rowTitle: string) => {
  const row = tree.root
    .findAll(
      item =>
        item.props?.title === rowTitle &&
        typeof item.props?.trailing === 'object',
    )
    .at(0);
  if (!row) {
    throw new Error(`Keine Zeile „${rowTitle}“ mit Schalter gefunden.`);
  }
  const trailing = row.props.trailing;
  await act(async () => {
    trailing.props.onValueChange(!trailing.props.value);
  });
};
const tabLabels = (tree: TestRenderer.ReactTestRenderer) => [
  ...new Set(
    tree.root
      .findAll(item => item.props?.accessibilityRole === 'tab')
      .map(item => item.props.accessibilityLabel as string),
  ),
];

const tap = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> => {
  const node = tree.root.find(
    item =>
      typeof item.props?.onPress === 'function' &&
      (item.props?.accessibilityLabel === label ||
        item.props?.title === label ||
        (item.props?.accessibilityRole === 'tab' &&
          textContent(item).includes(label))),
  );
  await act(async () => {
    node.props.onPress();
  });
};

/** Zeilen tragen ihren Namen als Text, nicht als `accessibilityLabel`. */
const tapText = async (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): Promise<void> => {
  const node = tree.root
    .findAll(item => typeof item.props?.onPress === 'function')
    .find(item => textContent(item).includes(label));
  if (!node) {
    throw new Error(`Kein antippbares Element mit „${label}“ gefunden.`);
  }
  await act(async () => {
    node.props.onPress();
  });
};

describe('Heute', () => {
  it('shows one start action without a date, a fake plan or settings', async () => {
    const tree = await render();
    const text = screenText(tree);

    expect(text).toContain('Lauf starten');
    // Das Gerät zeigt das Datum bereits an (Design Language § 6).
    expect(text).not.toMatch(/\d{1,2}\.\s|Montag|Dienstag|Mittwoch/);
    expect(text).not.toContain('Starte einfach');
    expect(text).not.toContain('Minuten eingeplant');
    // Kein Pfeil, der ein Aufklappen verspricht (Design Language § 8).
    expect(text).not.toContain('⌄');
    // Fokus, Ziel und Vorlagen haben ihren Ort im Coach und im Plan.
    expect(text).not.toContain('Dein Fokus');
    expect(text).not.toContain('Dein Ziel');
    expect(text).not.toContain('Laufvorlagen');
    // Der Zweck wird erst im Moment des Startens gewählt.
    expect(text).not.toContain('Zweck');
    await tap(tree, 'Lauf starten');
    expect(screenText(tree)).toContain('Zweck');
    await act(async () => {
      tree.unmount();
    });
  });

  it('drops the pace-usability sentence', async () => {
    const tree = await render();
    expect(screenText(tree)).not.toContain(
      'Zeit und Distanz sind für eine einfache Tempoauswertung nutzbar',
    );
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Verlauf', () => {
  it('shows runs and strength side by side, without an import entry', async () => {
    const tree = await render();
    await tap(tree, 'Verlauf');
    const text = screenText(tree);

    expect(text).toContain('Einheiten');
    expect(text).toContain('Statistik');
    // Beide Trainingsarten sind aus derselben Liste erreichbar.
    expect(text).toContain('Laufen');
    expect(text).toContain('Krafttraining');
    // Importieren bleibt eine Einstellung, keine Zeile in der Historie.
    expect(text).not.toContain('Importieren');
    expect(text).not.toContain('Vorhandene Läufe importieren');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Fokus', () => {
  it.each(['active', 'paused'] as const)(
    'shows a read-only follow-up when %s, including missing comparison data and real alternatives',
    async status => {
      const baseline = {
        id: 'deleted',
        startTime: 30 * DAY,
        endTime: 30 * DAY + 1320000,
        durationSeconds: 1320,
        distanceMeters: 2000,
        purpose: 'easy' as const,
        source: 'test',
        status: 'complete',
        segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
          id: String(index),
          durationSeconds,
          distanceMeters: 500,
          gradePercent: 0,
        })),
      };
      const accepted = {
        ...acceptRecommendation(
          analyzeRun(baseline, undefined, previousRuns(baseline))
            .recommendation!,
          30 * DAY + 2000000,
        ),
        status,
      };
      const before = JSON.stringify(accepted);
      const later = {
        ...baseline,
        id: 'later',
        startTime: 60 * DAY,
        endTime: 60 * DAY + 1320000,
        purpose: 'long' as const,
      };
      jest.mocked(native.state).mockResolvedValueOnce({
        runs: [
          later,
          ...previousRuns(later),
          { ...later, id: 'incomplete', segments: [] },
        ],
        recording: null,
        settings: { onboardedAt: 1, minutes: 30, experiments: [accepted] },
        capabilities: {},
      });
      let tree!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        tree = TestRenderer.create(<RunbackApp />);
      });
      try {
        // Heute zeigt die Empfehlung kompakt mit Zustand; der Coach trägt den Rest.
        expect(screenText(tree)).toContain(accepted.recommendation.action);
        expect(screenText(tree)).toContain(
          status === 'paused' ? 'Pausiert' : 'Aktiv',
        );
        expect(screenText(tree)).not.toContain('Danach vorgesehen');
        await tapText(tree, accepted.recommendation.action);
        expect(screenText(tree)).toContain('Danach vorgesehen');
        expect(screenText(tree)).not.toContain('Empfehlung annehmen');
        expect(screenText(tree)).not.toContain('Empfehlung abschließen');
        await tap(tree, 'Details');
        expect(screenText(tree)).toContain(
          'Vergleichslauf nicht mehr vorhanden',
        );
        expect(screenText(tree)).toContain('Auswahl für danach');
        expect(screenText(tree)).toContain(
          'fehlen mindestens vier geeignete Abschnitte',
        );
        expect(JSON.stringify(accepted)).toBe(before);
        await tap(tree, 'Empfehlung verwalten');
        await tap(tree, 'Empfehlung abschließen');
        expect(screenText(tree)).toContain('Vorschlag');
        expect(screenText(tree)).toContain('Empfehlung annehmen');
        expect(screenText(tree)).not.toContain('Danach vorgesehen');
        const saved = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
        expect(saved.experiments).toHaveLength(1);
        expect(saved.experiments![0].status).toBe('completed');
        expect(saved.experiments![0].recommendation).toEqual(
          accepted.recommendation,
        );
      } finally {
        await act(async () => {
          tree.unmount();
        });
      }
    },
  );
  it('keeps focus and recommendation independent through editing, removal, pause and completion', async () => {
    const baseline = {
      id: 'baseline',
      startTime: 30 * DAY,
      endTime: 30 * DAY + 1320000,
      durationSeconds: 1320,
      distanceMeters: 2000,
      purpose: 'easy' as const,
      source: 'test',
      status: 'complete',
      segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
        id: String(index),
        distanceMeters: 500,
        durationSeconds,
        gradePercent: 0,
      })),
    };
    const accepted = acceptRecommendation(
      analyzeRun(baseline, undefined, previousRuns(baseline)).recommendation!,
      30 * DAY + 2000000,
    );
    const saved = JSON.stringify(accepted);
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [baseline, ...previousRuns(baseline)],
      recording: null,
      settings: {
        onboardedAt: 1,
        minutes: 30,
        goal: 'Halbmarathon im April',
        experiments: [accepted],
      },
      capabilities: {},
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<RunbackApp />);
    });
    try {
      await tap(tree, 'Coach');
      await tapText(tree, 'Noch kein Fokus');
      await act(async () => {
        tree.root.findByType(ChipGroup).props.onChange('injury_free');
      });
      await tap(tree, 'Fokus speichern');
      const settings = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
      expect(settings.trainingFocus?.kind).toBe('injury_free');
      expect(JSON.stringify(settings.experiments![0])).toBe(saved);
      await tap(tree, 'Fokus entfernen');
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0].trainingFocus,
      ).toBeNull();
      expect(
        JSON.stringify(
          jest.mocked(native.saveSettings).mock.calls.at(-1)![0]
            .experiments![0],
        ),
      ).toBe(saved);
      await act(async () => {
        tree.root.findByType(ChipGroup).props.onChange('habit');
      });
      await tap(tree, 'Fokus speichern');
      const focus = jest.mocked(native.saveSettings).mock.calls.at(-1)![0]
        .trainingFocus;
      await tap(tree, 'Zurück');
      await tapText(tree, 'Halbmarathon im April');
      await tap(tree, 'Ziel entfernen');
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0].trainingFocus,
      ).toEqual(focus);
      expect(
        JSON.stringify(
          jest.mocked(native.saveSettings).mock.calls.at(-1)![0]
            .experiments![0],
        ),
      ).toBe(saved);
      await tap(tree, 'Heute');
      await tapText(tree, accepted.recommendation.action);
      await tap(tree, 'Empfehlung verwalten');
      await tap(tree, 'Empfehlung pausieren');
      expect(screenText(tree)).toContain('Pausiert');
      expect(screenText(tree)).not.toContain('Probiere die Empfehlung aus.');
      expect(
        jest.mocked(native.saveSettings).mock.calls.at(-1)![0].trainingFocus,
      ).toEqual(focus);
      await tap(tree, 'Empfehlung fortsetzen');
      await tap(tree, 'Empfehlung abschließen');
      const completed = jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
      expect(completed.trainingFocus).toEqual(focus);
      expect(completed.experiments![0].status).toBe('completed');
      expect(completed.experiments![0].recommendation).toEqual(
        accepted.recommendation,
      );
      expect(screenText(tree)).toContain('Abgeschlossen');
      expect(screenText(tree)).not.toContain('Empfehlung annehmen');
      expect(screenText(tree)).not.toMatch(
        /Arbeitsthema|nächste Handlung|Intervention|Laufempfehlung|Baseline|inconclusive|Prüfbedingung/,
      );
    } finally {
      await act(async () => {
        tree.unmount();
      });
    }
  });
  it('is reachable from Coach and replaces the old wording', async () => {
    const tree = await render();
    // Der Fokus ist die Grundlage der Empfehlung und steht im Coach.
    expect(screenText(tree)).not.toContain('Noch kein Fokus');
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Noch kein Fokus');
    await tapText(tree, 'Noch kein Fokus');
    const text = screenText(tree);

    expect(text).toContain('Fokus-Art');
    expect(text).toContain('Eigene Bezeichnung');
    expect(text).not.toContain('Ergebnis bisher');
    expect(text).not.toContain('Empfehlung abschließen');
    expect(text).not.toContain('Eine Änderung. Eine nachvollziehbare Prüfung.');
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Funktionen', () => {
  const settingsSaved = () =>
    jest.mocked(native.saveSettings).mock.calls.at(-1)![0];
  const withFeatures = (features: unknown, extra: object = {}) =>
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [],
      recording: null,
      settings: { onboardedAt: 1, features, ...extra } as any,
      capabilities: {},
    });

  it('fragt nur nach Muskelkater, wenn die Einstellung es will', async () => {
    // Standard: nach Krafttraining. Ohne Krafteinheit keine Abfrage.
    const quiet = await render();
    expect(screenText(quiet)).not.toContain('Überspringen');
    expect(screenText(quiet)).toContain('Muskelkater melden');
    await act(async () => {
      quiet.unmount();
    });

    withFeatures({ soreness: { prompt: 'daily' } });
    const daily = await render();
    expect(screenText(daily)).toContain('Überspringen');
    await tap(daily, 'Überspringen');
    await act(async () => {
      daily.unmount();
    });
  });

  it('nimmt abgeschaltetem Muskelkater Zeile, Abfrage und Muskelkarte', async () => {
    withFeatures({ soreness: { enabled: false, prompt: 'daily' } });
    const tree = await render();
    const text = screenText(tree);
    expect(text).not.toContain('Überspringen');
    expect(text).not.toContain('Muskelkater melden');
    await tap(tree, 'Verlauf');
    expect(screenText(tree)).not.toContain('Muskelkarte');
    await act(async () => {
      tree.unmount();
    });
  });

  it('nimmt abgewähltem Krafttraining und abgewähltem Plan alle Einstiege', async () => {
    withFeatures({
      areas: { running: true, strength: false },
      planning: { enabled: false },
    });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('Lauf starten');
    expect(text).not.toContain('Krafttraining starten');
    expect(text).not.toContain('Diese Woche im Plan ansehen');
    expect(tabLabels(tree)).toEqual(['Heute', 'Verlauf', 'Coach']);
    await tap(tree, 'Coach');
    // Ohne Kraft kein Bereichswechsel und ohne Schlüssel kein Chat.
    expect(screenText(tree)).not.toContain('Trainingschat');
    expect(
      tree.root.findAll(item => item.props?.accessibilityLabel === 'Bereich'),
    ).toHaveLength(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it('zeigt ohne Laufen den Kraft-Coach und den Kraftstart allein', async () => {
    withFeatures({ areas: { running: false, strength: true } });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('Krafttraining starten');
    expect(text).not.toContain('Lauf starten');
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Erstes Training starten');
    expect(screenText(tree)).not.toContain('aufgezeichneter Lauf');
    await act(async () => {
      tree.unmount();
    });
  });

  it('schaltet Funktionen sofort und speichert sie in den Einstellungen', async () => {
    const tree = await render();
    await tap(tree, 'Einstellungen');
    await tapText(tree, 'Funktionen');
    expect(screenText(tree)).toContain('Aus heißt weg');
    await flip(tree, 'Planung als Tab');
    expect(settingsSaved().features?.planning.enabled).toBe(false);
    expect(tabLabels(tree)).not.toContain('Plan');
    await flip(tree, 'Muskelkater melden');
    expect(settingsSaved().features?.soreness.enabled).toBe(false);
    // Der letzte Bereich lässt sich nicht abwählen.
    await flip(tree, 'Krafttraining');
    expect(settingsSaved().features?.areas.strength).toBe(false);
    await flip(tree, 'Laufen');
    expect(settingsSaved().features?.areas.running).toBe(true);
    await tap(tree, 'Heute');
    const text = screenText(tree);
    expect(text).not.toContain('Diese Woche im Plan ansehen');
    expect(text).not.toContain('Muskelkater melden');
    expect(text).not.toContain('Krafttraining starten');
    await act(async () => {
      tree.unmount();
    });
  });

  it('zeigt Empfehlungen auf Nachfrage nur im Coach', async () => {
    const baseline = {
      id: 'base',
      startTime: 30 * DAY,
      endTime: 30 * DAY + 1320000,
      durationSeconds: 1320,
      distanceMeters: 2000,
      purpose: 'easy' as const,
      source: 'test',
      status: 'complete',
      segments: [300, 300, 360, 360].map((durationSeconds, index) => ({
        id: String(index),
        durationSeconds,
        distanceMeters: 500,
        gradePercent: 0,
      })),
    };
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [baseline, ...previousRuns(baseline)],
      recording: null,
      settings: {
        onboardedAt: 1,
        features: { recommendations: { running: 'on_request' } },
      } as any,
      capabilities: {},
    });
    const tree = await render();
    expect(screenText(tree)).not.toContain('Vorschlag');
    await tap(tree, 'Coach');
    expect(screenText(tree)).toContain('Empfehlung annehmen');
    await act(async () => {
      tree.unmount();
    });
  });

  it('bietet bestehenden Nutzern die Funktionen einmalig auf Heute an', async () => {
    const tree = await render();
    expect(screenText(tree)).toContain('Neu: Wähle, was Runback zeigt');
    await tapText(tree, 'Neu: Wähle, was Runback zeigt');
    expect(screenText(tree)).toContain('Funktionen');
    expect(settingsSaved().features?.version).toBe(1);
    await tap(tree, 'Heute');
    expect(screenText(tree)).not.toContain('Neu: Wähle, was Runback zeigt');
    await act(async () => {
      tree.unmount();
    });
  });
});
