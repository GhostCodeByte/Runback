import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Image as SvgImage, Path } from 'react-native-svg';
import type { RoutePoint } from '../src/native';
import { Route } from '../src/ui/components';

const points: RoutePoint[] = [
  { latitude: 48.001, longitude: 7.801 },
  { latitude: 48.004, longitude: 7.805 },
  { latitude: 48.002, longitude: 7.81 },
];

describe('GPS-Strecke', () => {
  it('zeigt Kartenkacheln, kontrastreiche Linien und Start/Ziel an', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Route points={points} />);
    });
    const map = tree.root.findByProps({ accessibilityRole: 'image' });
    const images = tree.root.findAllByType(SvgImage);
    const paths = tree.root.findAllByType(Path);

    expect(map.props.accessibilityLabel).toContain('OpenStreetMap');
    expect(images.length).toBeGreaterThan(0);
    expect(images[0].props.href.uri).toMatch(
      /^https:\/\/tile\.openstreetmap\.org\//,
    );
    expect(paths).toHaveLength(2);
    expect(paths[0].props.strokeWidth).toBe(9);
    expect(paths[1].props.strokeWidth).toBe(5);
    expect(paths[1].props.d).toMatch(/^M/);
    expect(paths[1].props.d).toMatch(/L/);
  });

  it('zeigt auch ohne Route eine erkennbare leere Kartenfläche', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Route points={[]} />);
    });

    expect(
      tree.root.findByProps({
        accessibilityLabel: 'Keine GPS-Strecke aufgezeichnet',
      }),
    ).toBeDefined();
    expect(
      tree.root.findAllByType(Text).map(node => node.props.children),
    ).toContain('Keine GPS-Strecke');
  });
});
