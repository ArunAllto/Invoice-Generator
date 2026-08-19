/**
 * Settings → About (§11: privacy stated plainly).
 */

import React from 'react';
import Constants from 'expo-constants';

import { Body, Caption, Card, Screen, SectionTitle, Title } from '../../src/components/ui';
import { getInitResult } from '../../src/db';
import { BACKUP_FORMAT_VERSION } from '../../src/db/backup';
import { t } from '../../src/strings';

export default function AboutScreen(): React.ReactElement {
  const init = getInitResult();

  return (
    <Screen>
      <Title>{t('appName')}</Title>
      <Caption>{t('aboutOwner')}</Caption>

      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <Body>{t('aboutPrivacy')}</Body>
      </Card>

      <SectionTitle>Build</SectionTitle>
      <Card>
        <Body>
          {t('aboutVersion')} {Constants.expoConfig?.version ?? '1.0.0'}
        </Body>
        <Caption>Database schema v{init?.schemaVersion ?? '—'}</Caption>
        <Caption>Backup format v{BACKUP_FORMAT_VERSION}</Caption>
      </Card>

      <SectionTitle>Fonts</SectionTitle>
      <Card>
        <Caption>
          Documents embed Noto Sans and, where Malayalam text is present, Noto Sans Malayalam,
          so the rupee sign and Malayalam script render correctly in PDF and image exports.
        </Caption>
      </Card>
    </Screen>
  );
}
