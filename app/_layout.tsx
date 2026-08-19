/**
 * Root layout.
 *
 * Three things have to happen here and nowhere else:
 *
 *  1. **The `buffer` polyfill**, before anything can import `docx`. §10.3 warns this fails
 *     obscurely if forgotten, and the README repeats the warning. It is the very first
 *     statement in the file so no module-level `docx` import can run ahead of it.
 *  2. **The image export host** is mounted once, so `captureRef` always has a laid-out view
 *     to read (see `src/export/image.tsx`).
 *  3. **The database** is opened, migrated and seeded before any screen queries it, and the
 *     editor is flushed when the app goes to the background so §6.3's "autosave must survive
 *     the app being killed" holds.
 */

import { Buffer } from 'buffer';

// Assigned before any other import can reach for it. `docx` looks for a global `Buffer`
// that React Native does not provide.
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorNotice, Loading } from '../src/components/ui';
import { openDatabase } from '../src/db';
import { getSetting, SETTINGS_KEYS } from '../src/db/masters';
import { ImageExportHost } from '../src/export/image';
import { useEditorStore } from '../src/state/editor';
import { t } from '../src/strings';
import { palette } from '../src/theme';

export default function RootLayout(): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDatabase();
        const done = await getSetting(db, SETTINGS_KEYS.onboardingComplete);
        if (cancelled) return;
        setNeedsOnboarding(done !== 'true');
        setReady(true);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // §6.3 / §11: flush pending edits when the app leaves the foreground, so a kill from the
  // recents screen cannot lose the last few hundred milliseconds of typing.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        void useEditorStore.getState().flush();
      }
    });
    return () => subscription.remove();
  }, []);

  if (error) {
    return (
      <SafeAreaProvider>
        <View style={styles.centre}>
          <ErrorNotice
            message="CraftyDocs could not open its database."
            detail={`${error.message}\n${error.stack ?? ''}`}
            onRetry={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.centre}>
          <Loading label={t('appName')} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.navy },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: palette.surfaceAlt },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="onboarding"
            options={{ headerShown: false, gestureEnabled: false }}
            redirect={!needsOnboarding}
          />
          <Stack.Screen name="doc" options={{ headerShown: false }} />
          <Stack.Screen name="client/[id]" options={{ title: t('editorClient') }} />
          <Stack.Screen name="item/[id]" options={{ title: t('catalogue') }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
        </Stack>
        {/* §10.4: mounted once, invisible, so image capture always has a host. */}
        <ImageExportHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: palette.surfaceAlt,
  },
});
