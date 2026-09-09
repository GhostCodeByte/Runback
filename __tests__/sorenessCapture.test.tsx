import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { regionSpeech } from '../src/ui/BodyMap';
import { SorenessCapture } from '../src/ui/SorenessCapture';

const byLabel = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root.findAll(
    node =>
      node.props?.accessibilityLabel === label &&
      typeof node.props?.onPress === 'function',
  )[0];

const render = (onSave: jest.Mock) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SorenessCapture
        now={1_700_000_000_000}
        onSave={onSave}
        onSkip={jest.fn()}
        voiceAvailable={false}
      />,
    );
  });
  return tree;
};

describe('Muskelkater-Abfrage', () => {
  it('speichert „Heute nichts“ als eigenständige Meldung', () => {
    const onSave = jest.fn();
    const tree = render(onSave);
    ReactTestRenderer.act(() => {
      byLabel(tree, 'Heute nichts').props.onPress();
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        at: 1_700_000_000_000,
        nothingToday: true,
        entries: [],
      }),
    );
  });

  it('überträgt eine Figurenauswahl unmittelbar nach Bestätigung', () => {
    const onSave = jest.fn();
    const tree = render(onSave);
    const regionLabel = regionSpeech('soreness', 'quad_l', null);
    ReactTestRenderer.act(() => {
      byLabel(tree, regionLabel).props.onPress();
    });
    ReactTestRenderer.act(() => {
      byLabel(tree, 'stark · 8').props.onPress();
    });
    expect(byLabel(tree, 'Übernehmen und speichern').props.disabled).toBe(false);
    ReactTestRenderer.act(() => {
      byLabel(tree, 'Übernehmen und speichern').props.onPress();
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        nothingToday: false,
        entries: [{ regionId: 'quad_l', value: 8 }],
      }),
    );
  });
});
