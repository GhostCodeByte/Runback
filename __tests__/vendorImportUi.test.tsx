import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { VendorImport } from '../src/ui/VendorImport';
import { nativeCall } from '../src/native';

jest.mock('../src/native', () => ({
  nativeCall: jest.fn(() => Promise.resolve({ wellness: {}, strength: { workouts: 0 } })),
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

describe('VendorImport status', () => {
  it('shows progress, aggregate failures/skips, and the failed filename', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <VendorImport
          onImport={jest.fn()}
          onCancelImport={jest.fn()}
          busy={false}
          importStatus={{
            state: 'running',
            processed: 2,
            totalFiles: 4,
            currentFile: 'strong.csv',
            imported: 3,
            duplicates: 1,
            skipped: 2,
            failed: 1,
            errors: [{ file: 'broken.json', message: 'Ungültiges JSON' }],
          }}
        />,
      );
      await Promise.resolve();
    });

    const rendered = tree.root.findAllByType(Text).map(textContent).join(' ');
    expect(rendered).toContain('2 Dateien verarbeitet');
    expect(rendered).toContain('2 übersprungen');
    expect(rendered).toContain('1 fehlgeschlagen');
    expect(rendered).toContain('broken.json: Ungültiges JSON');
  });

  it('refreshes stored context after a wellness-only import', async () => {
    const props = { onImport: jest.fn(), onCancelImport: jest.fn(), busy: false };
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<VendorImport {...props} importStatus={{ state: 'running', imported: 0, wellness: 0 }} />);
    });
    (nativeCall as jest.Mock).mockResolvedValueOnce({ wellness: { weight: { count: 1 } }, strength: { workouts: 0 } });
    await act(async () => {
      tree.update(<VendorImport {...props} importStatus={{ state: 'completed', imported: 0, wellness: 1 }} />);
    });
    expect(tree.root.findAllByType(Text).map(textContent).join(' ')).toContain('weight (1)');
  });
});
