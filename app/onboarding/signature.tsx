/**
 * Onboarding step 3 — the signature (§7.2), and the end of the flow.
 *
 * The signature is optional: §7.2 requires documents without one to print a blank ruled
 * line, so finishing without it is a supported outcome rather than an incomplete setup.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { SignatureCapture } from '../../src/components/SignatureCapture';
import { Body, Button, Loading, Screen, Title } from '../../src/components/ui';
import {
  getBusinessProfile,
  saveBusinessProfile,
  setSetting,
  SETTINGS_KEYS,
  type BusinessProfile,
} from '../../src/db/masters';
import { useDatabase } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

export default function OnboardingSignatureScreen(): React.ReactElement {
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

  const finish = async (): Promise<void> => {
    if (!db) return;
    setSaving(true);
    try {
      await saveBusinessProfile(db, profile);
      await setSetting(db, SETTINGS_KEYS.onboardingComplete, 'true');
      router.replace('/(tabs)');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Title>{t('signature')}</Title>
      <Body muted>
        Draw your signature or upload a photo of it. This is optional — without one,
        documents print a blank signing line instead.
      </Body>
      <SignatureCapture
        signatureUri={profile.signatureUri}
        signatureLabel={profile.signatureLabel}
        onChange={(uri) => setProfile({ ...profile, signatureUri: uri })}
        onChangeLabel={(label) => setProfile({ ...profile, signatureLabel: label })}
      />
      <Button label="Finish setup" onPress={() => void finish()} loading={saving} />
      <Button label={t('onboardingSkip')} variant="ghost" onPress={() => void finish()} />
    </Screen>
  );
}
