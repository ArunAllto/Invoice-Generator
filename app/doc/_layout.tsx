/**
 * Stack for the document screens (§4).
 */

import React from 'react';
import { Stack } from 'expo-router';

import { t } from '../../src/strings';
import { palette } from '../../src/theme';

export default function DocLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.navy },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: palette.surfaceAlt },
      }}
    >
      <Stack.Screen name="new" options={{ title: t('add') }} />
      <Stack.Screen name="[id]/edit" options={{ title: t('editorHeader') }} />
      <Stack.Screen name="[id]/preview" options={{ title: t('preview') }} />
      <Stack.Screen name="[id]/export" options={{ title: t('export'), presentation: 'modal' }} />
    </Stack>
  );
}
