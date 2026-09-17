/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RunbackApp } from './src/ui/RunbackApp';
import { Button, color, space } from './src/ui/components';
import { RoutePlannerScreen } from './src/ui/RoutePlannerScreen';

function App() {
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#101210" />
      <View style={styles.root}>
        <RunbackApp />
        {!routePlannerOpen ? (
          <View pointerEvents="box-none" style={styles.launcher}>
            <Button
              small
              title="Route planen"
              onPress={() => setRoutePlannerOpen(true)}
              label="Routenplaner öffnen"
            />
          </View>
        ) : (
          <View style={styles.overlay}>
            <RoutePlannerScreen onClose={() => setRoutePlannerOpen(false)} />
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  launcher: {
    position: 'absolute',
    right: space.md,
    bottom: 86,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.bg,
  },
});

export default App;
