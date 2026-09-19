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
import { color } from './src/ui/components';
import { RoutePlannerScreen } from './src/ui/RoutePlannerScreen';

function App() {
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#101210" />
      <View style={styles.root}>
        {/* Den Einstieg zeichnet RunbackApp, weil nur sie weiß, ob der
            Routenplaner eingeschaltet ist. */}
        <RunbackApp onOpenRoutePlanner={() => setRoutePlannerOpen(true)} />
        {routePlannerOpen ? (
          <View style={styles.overlay}>
            <RoutePlannerScreen onClose={() => setRoutePlannerOpen(false)} />
          </View>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.bg,
  },
});

export default App;
