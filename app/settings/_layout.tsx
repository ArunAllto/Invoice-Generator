/**
 * Settings stack (§4).
 */

import React from 'react';
import { Stack } from 'expo-router';

import { t } from '../../src/strings';
import { palette } from '../../src/theme';

export default function SettingsLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.navy },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: palette.surfaceAlt },
      }}
    >
      <Stack.Screen name="business" options={{ title: t('settingsBusiness') }} />
      <Stack.Screen name="branding" options={{ title: t('settingsBranding') }} />
      <Stack.Screen name="catalogue" options={{ title: t('settingsCatalogue') }} />
      <Stack.Screen name="tax" options={{ title: t('settingsTax') }} />
      <Stack.Screen name="numbering" options={{ title: t('settingsNumbering') }} />
      <Stack.Screen name="terms" options={{ title: t('settingsTerms') }} />
      <Stack.Screen name="custom-fields" options={{ title: t('settingsCustomFields') }} />
      <Stack.Screen name="defaults" options={{ title: t('settingsDefaults') }} />
      <Stack.Screen name="backup" options={{ title: t('settingsBackup') }} />
      <Stack.Screen name="about" options={{ title: t('settingsAbout') }} />
    </Stack>
  );
}
