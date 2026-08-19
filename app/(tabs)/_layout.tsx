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
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        // §11: tab labels must survive 200% font scaling, so the bar grows rather than clips.
        tabBarLabelStyle: { fontSize: fontSize.caption },
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
