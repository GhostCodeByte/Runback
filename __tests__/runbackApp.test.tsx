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
  await tap(tree, 'Überspringen');
  return tree;
}

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
  it('shows the start action without a date or a fake plan', async () => {
    const tree = await render();
    const text = screenText(tree);

    expect(text).toContain('Lauf starten');
    // Das Gerät zeigt das Datum bereits an (Design Language § 6).
    expect(text).not.toMatch(/\d{1,2}\.\s|Montag|Dienstag|Mittwoch/);
    expect(text).not.toContain('Starte einfach');
    expect(text).not.toContain('Minuten eingeplant');
    // Kein Pfeil, der ein Aufklappen verspricht (Design Language § 8).
    expect(text).not.toContain('⌄');
    // Der Zweck ist eine sichtbare Auswahl statt eines Dialogs.
    expect(text).toContain('Zweck');
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

describe('Einheiten', () => {
  it('shows runs and strength side by side, without an import entry', async () => {
    const tree = await render();
    await tap(tree, 'Einheiten');
    const text = screenText(tree);

    expect(text).toContain('Einheiten');
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
        startTime: 0,
        endTime: 1320000,
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
        ...acceptRecommendation(analyzeRun(baseline).recommendation!, 2000000),
        status,
      };
      const before = JSON.stringify(accepted);
      const later = {
        ...baseline,
        id: 'later',
        startTime: 3000000,
        endTime: 4320000,
        purpose: 'long' as const,
      };
      jest.mocked(native.state).mockResolvedValueOnce({
        runs: [later, { ...later, id: 'incomplete', segments: [] }],
        recording: null,
        settings: { onboardedAt: 1, minutes: 30, experiments: [accepted] },
        capabilities: {},
      });
      let tree!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        tree = TestRenderer.create(<RunbackApp />);
      });
      try {
        await tap(tree, 'Überspringen');
        expect(screenText(tree)).toContain('Danach vorgesehen');
        await tapText(tree, 'Danach vorgesehen');
        expect(screenText(tree)).toContain('Danach vorgesehen');
        expect(screenText(tree)).not.toContain('Empfehlung annehmen');
        await tap(tree, 'Details ansehen');
        expect(screenText(tree)).toContain(
          'Vergleichslauf nicht mehr vorhanden',
        );
        expect(screenText(tree)).toContain('Auswahl für danach');
        expect(screenText(tree)).toContain(
          'fehlen mindestens vier geeignete Abschnitte',
        );
        expect(JSON.stringify(accepted)).toBe(before);
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
      startTime: 0,
      endTime: 1320000,
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
      analyzeRun(baseline).recommendation!,
      2000000,
    );
    const saved = JSON.stringify(accepted);
    jest.mocked(native.state).mockResolvedValueOnce({
      runs: [baseline],
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
      await tap(tree, 'Überspringen');
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
      await tap(tree, 'Mehr');
      await tapText(tree, 'Ziel & Alltag');
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
  it('is reachable from Heute and replaces the old wording', async () => {
    const tree = await render();
    // Der Fokus ist keine eigene Wurzel mehr, sondern eine Zeile auf Heute.
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
