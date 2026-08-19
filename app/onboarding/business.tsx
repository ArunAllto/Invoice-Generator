/**
 * Onboarding step 1 — the business profile (§4, Phase 2).
 *
 * Only the name is genuinely required. §9.4 is the reason the GSTIN field carries its own
 * explanation: leaving it blank is a legitimate, supported choice that switches GST off
 * everywhere in the app, and the user should know that rather than feel they are skipping
 * something.
 */

import React from 'react';
import { useRouter } from 'expo-router';

import { BusinessProfileForm } from '../../src/components/BusinessProfileForm';
import { Body, Button, Screen, Title } from '../../src/components/ui';
import { t } from '../../src/strings';

export default function OnboardingBusinessScreen(): React.ReactElement {
  const router = useRouter();

  return (
    <Screen>
      <Title>{t('onboardingWelcome')}</Title>
      <Body muted>{t('onboardingIntro')}</Body>
      <BusinessProfileForm
        onSaved={() => router.push('/onboarding/logo')}
        submitLabel="Next: your logo"
        footer={
          <Button
            label={t('onboardingSkip')}
            variant="ghost"
            onPress={() => router.push('/onboarding/logo')}
          />
        }
      />
    </Screen>
  );
}
