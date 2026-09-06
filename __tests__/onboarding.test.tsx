import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Button, Copy } from '../src/ui/components';
import { Onboarding, type OnboardingProps } from '../src/ui/Onboarding';
import { nativeCall } from '../src/native';

jest.mock('../src/native', () => ({ nativeCall: jest.fn() }));

const mockedNativeCall = nativeCall as jest.MockedFunction<typeof nativeCall>;
const base = {
  settings: {},
  onDone: jest.fn(),
  onImport: jest.fn(),
  importStatus: {},
  busy: false,
};

function render(overrides: Partial<OnboardingProps> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <Onboarding
        persist={jest.fn().mockResolvedValue(undefined)}
        {...base}
        {...overrides}
      />,
    );
  });
  return tree;
}

function button(tree: ReactTestRenderer.ReactTestRenderer, title: string) {
  return tree.root
    .findAllByType(Button)
    .find(item => item.props.title === title)!;
}

function textValue(node: ReactTestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string'
        ? child
        : textValue(child as ReactTestRenderer.ReactTestInstance),
    )
    .join('');
}

describe('onboarding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks advancing with an invalid time budget', async () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const tree = render({ persist });
    await ReactTestRenderer.act(() =>
      button(tree, 'Einrichten').props.onPress(),
    );
    const input = tree.root.findByProps({
      accessibilityLabel: 'Zeitbudget in Minuten',
    });
    await ReactTestRenderer.act(() => input.props.onChangeText('4'));
    expect(button(tree, 'Weiter').props.disabled).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('skips with a completion marker and calls onDone', async () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const onDone = jest.fn();
    const tree = render({ persist, onDone });
    const skip = tree.root.findAll(
      node => node.props.accessibilityRole === 'button',
    )[0];
    await ReactTestRenderer.act(async () => {
      await skip.props.onPress();
    });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardedAt: expect.any(Number),
        onboardingStep: 'welcome',
        onboardingSkipped: true,
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('disables starting a running import but keeps cancellation available', () => {
    const onCancelImport = jest.fn();
    const tree = render({
      settings: { onboardingStep: 'import' },
      importStatus: { state: 'running' },
      onCancelImport,
    });
    const importButton = button(tree, 'Import läuft …');
    expect(importButton.props.disabled).toBe(true);
    expect(button(tree, 'Import abbrechen').props.disabled).not.toBe(true);
    ReactTestRenderer.act(() =>
      button(tree, 'Import abbrechen').props.onPress(),
    );
    expect(onCancelImport).toHaveBeenCalled();
  });

  it('shows denied permission status and native permission errors', async () => {
    mockedNativeCall.mockResolvedValueOnce({
      locationPermission: false,
      notificationPermission: false,
    });
    const tree = render({ settings: { onboardingStep: 'ready' } });
    await ReactTestRenderer.act(() =>
      button(tree, 'Aufzeichnungsberechtigungen anfragen').props.onPress(),
    );
    expect(
      tree.root
        .findAllByType(Copy)
        .some(item => textValue(item).includes('noch nicht freigegeben')),
    ).toBe(true);

    mockedNativeCall.mockRejectedValueOnce(new Error('permission failed'));
    await ReactTestRenderer.act(() =>
      button(tree, 'Aufzeichnungsberechtigungen anfragen').props.onPress(),
    );
    expect(
      tree.root
        .findAllByProps({ accessibilityRole: 'alert' })
        .some(item => textValue(item).includes('permission failed')),
    ).toBe(true);
  });
});
