/**
 * First-run onboarding stack (§4).
 *
 * Gestures are disabled between steps so the flow is driven by its own buttons; the user can
 * still skip from any step, because §7.2 makes the signature optional and an owner in a
 * hurry should be able to reach the editor.
 */

import React from 'react';
import { Stack } from 'expo-router';

import { t } from '../../src/strings';
import { palette } from '../../src/theme';

export default function OnboardingLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.navy },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: palette.surfaceAlt },
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="business" options={{ title: t('onboardingWelcome') }} />
      <Stack.Screen name="logo" options={{ title: t('logo') }} />
      <Stack.Screen name="signature" options={{ title: t('signature') }} />
    </Stack>
  );
}
