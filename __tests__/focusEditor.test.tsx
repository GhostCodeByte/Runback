import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FocusEditor } from '../src/ui/FocusEditor';
import { Button, ChipGroup, Input } from '../src/ui/components';
import { suggestedFocus } from '../src/domain/focus';
import { relevance } from '../src/domain/prioritization';

describe('Dauerhafter Fokus', () => {
  it('starts without a suggested or selected focus when there is no goal', async () => {
    const persist = jest.fn(async () => {});
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<FocusEditor goal="" persist={persist} />);
    });
    expect(tree.root.findByType(ChipGroup).props.value).toBe('');
    expect(
      tree.root.findAllByType(Button).map(button => button.props.title),
    ).toEqual(['Fokus speichern']);
    expect(persist).not.toHaveBeenCalled();
    expect(suggestedFocus('')).toBeUndefined();
    await act(async () => {
      tree.unmount();
    });
  });

  it('saves type and literal personal label separately, without an end date or review', async () => {
    const persist = jest.fn(async () => {});
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FocusEditor goal="10 km unter 50 Minuten" persist={persist} />,
      );
    });
    // A goal permits a suggestion, never an automatic save or selection.
    expect(tree.root.findByType(ChipGroup).props.value).toBe('');
    expect(persist).not.toHaveBeenCalled();
    await act(async () => {
      tree.root.findByType(ChipGroup).props.onChange('habit');
      tree.root
        .findByType(Input)
        .props.onChangeText('  Schneller? Erst mal regelmäßig!  ');
    });
    await act(async () => {
      tree.root
        .findAllByType(Button)
        .find(button => button.props.title === 'Fokus speichern')!
        .props.onPress();
    });
    expect(persist).toHaveBeenCalledWith({
      version: 'focus-v1',
      kind: 'habit',
      label: 'Schneller? Erst mal regelmäßig!',
    });
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('Feste Auswahlregeln', () => {
  it('blocks volume rather than merely downranking it for injury-free focus', () => {
    expect(relevance('volume', 'injury_free').blocked).toBeTruthy();
    expect(relevance('calmer_start', 'injury_free')).toEqual({ weight: 3 });
    expect(relevance('calmer_start', 'fitness')).toEqual(
      relevance('calmer_start'),
    );
  });
  it('applies calendar boundaries without an outcome judgment about the focus', () => {
    expect(
      relevance('technique', 'speed', '2026-10-01', '2026-09-10').blocked,
    ).toBeTruthy();
    expect(
      relevance('technique', 'speed', '2026-10-01', '2026-09-09').blocked,
    ).toBeUndefined();
    expect(
      relevance('taper', 'speed', '2026-10-01', '2026-07-01').blocked,
    ).toBeTruthy();
    expect(
      relevance('taper', 'speed', '2026-10-01', '2026-09-01').blocked,
    ).toBeUndefined();
  });
});
