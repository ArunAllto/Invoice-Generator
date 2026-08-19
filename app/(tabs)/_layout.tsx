/**
 * The four tabs of §4: Home, Documents, Clients, More.
 */

import React from 'react';
import { Tabs } from 'expo-router';
import { FileText, Home, MoreHorizontal, Users } from 'lucide-react-native';

import { t } from '../../src/strings';
import { fontSize, palette, TOUCH_TARGET } from '../../src/theme';

export default function TabsLayout(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.navy },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '600' },
        tabBarActiveTintColor: palette.navy,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          /**
           * The default bar is 48dp, which leaves a 28dp icon only ~10dp for its label — the
           * navigator then clips the text with `overflow: hidden`, cutting the descender in
           * "Documents". 64dp fits the icon and a full 16dp line box.
           *
           * This is the one bounded-height surface in the app: every content screen grows with
           * the system font size (§11), but a bottom tab bar cannot, so at very large font
           * scales the platform truncates these four labels. The icons and their accessibility
           * labels still identify each tab.
           */
          height: 64,
        },
        // §11: tab labels must survive 200% font scaling, so the bar grows rather than clips.
        // An explicit lineHeight is the fix for clipped descenders: with only a fontSize the
        // label's line box came out shorter than the glyphs, cutting the 'p' in "Documents".
        // Padding is deliberately NOT added here — the tab bar has a fixed height, so padding
        // steals space from the icon and label rather than making the bar taller.
        tabBarLabelStyle: { fontSize: fontSize.caption, lineHeight: fontSize.caption + 4 },
        tabBarItemStyle: { minHeight: TOUCH_TARGET },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('appName'),
          tabBarLabel: t('tabHome'),
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: t('tabDocuments'),
          tabBarLabel: t('tabDocuments'),
          tabBarIcon: ({ color, size }) => <FileText color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: t('tabClients'),
          tabBarLabel: t('tabClients'),
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabMore'),
          tabBarLabel: t('tabMore'),
          tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
