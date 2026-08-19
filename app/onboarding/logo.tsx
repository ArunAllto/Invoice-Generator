/**
 * Onboarding step 2 — the logo (§7.1).
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { LogoPicker } from '../../src/components/LogoPicker';
import { Body, Button, Loading, Screen, Title } from '../../src/components/ui';
import { getBusinessProfile, saveBusinessProfile, type BusinessProfile } from '../../src/db/masters';
import { useDatabase } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

export default function OnboardingLogoScreen(): React.ReactElement {
  const router = useRouter();
  const { db } = useDatabase();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    void getBusinessProfile(db).then((loaded) => {
      if (!cancelled) setProfile(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  if (!profile) return <Screen><Loading /></Screen>;

  const next = async (): Promise<void> => {
    if (!db) return;
    setSaving(true);
    try {
      await saveBusinessProfile(db, profile);
      router.push('/onboarding/signature');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Title>{t('logo')}</Title>
      <Body muted>
        Your logo appears at the top of every document. You can add or change it later in
        Settings.
      </Body>
      <LogoPicker
        logoUri={profile.logoUri}
        onChange={(uri) => setProfile({ ...profile, logoUri: uri })}
      />
      <Button label="Next: your signature" onPress={() => void next()} loading={saving} />
      <Button
        label={t('onboardingSkip')}
        variant="ghost"
        onPress={() => router.push('/onboarding/signature')}
      />
    </Screen>
  );
}
