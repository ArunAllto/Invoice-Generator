/**
 * More / Settings hub — the entry point for everything in §4's settings stack.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Constants from 'expo-constants';

import {
  Caption,
  Card,
  ListRow,
  Screen,
  SectionTitle,
} from '../../src/components/ui';
import { getInitResult } from '../../src/db';
import { t } from '../../src/strings';
import { palette, spacing } from '../../src/theme';

interface Entry {
  title: string;
  subtitle: string;
  /** Typed so a renamed or deleted screen is a compile error, not a dead tap. */
  route: Href;
}

const DOCUMENT_ENTRIES: Entry[] = [
  {
    title: t('settingsBusiness'),
    subtitle: 'Name, address, GSTIN, bank details',
    route: '/settings/business',
  },
  {
    title: t('settingsBranding'),
    subtitle: 'Logo, signature, template, accent colour',
    route: '/settings/branding',
  },
  {
    title: t('settingsCatalogue'),
    subtitle: 'Items and services with saved prices',
    route: '/settings/catalogue',
  },
];

const CONFIG_ENTRIES: Entry[] = [
  { title: t('settingsTax'), subtitle: 'GST rate presets', route: '/settings/tax' },
  {
    title: t('settingsNumbering'),
    subtitle: 'Prefixes, financial year, next number',
    route: '/settings/numbering',
  },
  {
    title: t('settingsTerms'),
    subtitle: 'Saved terms & conditions blocks',
    route: '/settings/terms',
  },
  {
    title: t('settingsCustomFields'),
    subtitle: 'Your own extra fields',
    route: '/settings/custom-fields',
  },
  {
    title: t('settingsDefaults'),
    subtitle: 'What appears on new documents',
    route: '/settings/defaults',
  },
];

const DATA_ENTRIES: Entry[] = [
  {
    title: t('settingsBackup'),
    subtitle: 'Export or restore everything as one file',
    route: '/settings/backup',
  },
  { title: t('settingsAbout'), subtitle: 'Version and privacy', route: '/settings/about' },
];

export default function MoreScreen(): React.ReactElement {
  const router = useRouter();
  const init = getInitResult();

  return (
    <Screen>
      <SectionTitle>Your documents</SectionTitle>
      <Group entries={DOCUMENT_ENTRIES} onPress={(route) => router.push(route)} />

      <SectionTitle>Configuration</SectionTitle>
      <Group entries={CONFIG_ENTRIES} onPress={(route) => router.push(route)} />

      <SectionTitle>Data</SectionTitle>
      <Group entries={DATA_ENTRIES} onPress={(route) => router.push(route)} />

      <Caption style={styles.footer}>
        {t('aboutVersion')} {Constants.expoConfig?.version ?? '1.0.0'}
        {init ? ` · database v${init.schemaVersion}` : ''}
      </Caption>
    </Screen>
  );
}

function Group({
  entries,
  onPress,
}: {
  entries: Entry[];
  onPress: (route: Href) => void;
}): React.ReactElement {
  return (
    <Card padded={false}>
      {entries.map((entry, index) => (
        <View key={String(entry.route)}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <ListRow
            title={entry.title}
            subtitle={entry.subtitle}
            onPress={() => onPress(entry.route)}
            right={<Caption>›</Caption>}
          />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: palette.border, marginHorizontal: spacing.lg },
  footer: { marginTop: spacing.md, textAlign: 'center' },
});
