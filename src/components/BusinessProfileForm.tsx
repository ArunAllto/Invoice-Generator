/**
 * The business profile form — shared by onboarding step 1 and Settings → Business.
 *
 * One implementation for both, so the two can never drift. Validation follows the spec's
 * posture throughout: warn, do not block. A GSTIN that fails its checksum is flagged and
 * still saved (§8.4 sets the same precedent for numbers), because the owner knows their own
 * registration better than a check digit does — and a hard block would strand them.
 */

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { validateGstin } from '../core/gst';
import {
  EMPTY_BUSINESS,
  getBusinessProfile,
  saveBusinessProfile,
  type BusinessProfile,
} from '../db/masters';
import { useDatabase } from '../hooks/useDatabase';
import { t } from '../strings';
import { Button, Caption, Collapsible, ErrorNotice, Loading, TextField } from './ui';

export interface BusinessProfileFormProps {
  onSaved?: (profile: BusinessProfile) => void;
  submitLabel?: string;
  footer?: React.ReactNode;
}

export function BusinessProfileForm({
  onSaved,
  submitLabel,
  footer,
}: BusinessProfileFormProps): React.ReactElement {
  const { db } = useDatabase();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedName, setTouchedName] = useState(false);

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

  if (!profile) return <Loading />;

  const patch = (changes: Partial<BusinessProfile>): void =>
    setProfile((current) => ({ ...(current ?? EMPTY_BUSINESS), ...changes }));

  const gstinProblem = profile.gstin ? validateGstin(profile.gstin) : null;
  const nameMissing = profile.name.trim().length === 0;

  const submit = async (): Promise<void> => {
    if (!db) return;
    setTouchedName(true);
    if (nameMissing) return;
    setSaving(true);
    setError(null);
    try {
      await saveBusinessProfile(db, profile);
      onSaved?.(profile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      {error ? <ErrorNotice message={t('errorGeneric')} detail={error} /> : null}

      <TextField
        label={t('businessName')}
        value={profile.name}
        onChangeText={(value) => patch({ name: value })}
        onBlur={() => setTouchedName(true)}
        required
        error={touchedName && nameMissing ? 'Your business needs a name.' : null}
      />
      <TextField
        label={t('businessTagline')}
        value={profile.tagline}
        onChangeText={(value) => patch({ tagline: value })}
      />

      <Collapsible title={t('businessAddress')} initiallyOpen={false}>
        <TextField
          label={t('businessAddressLine1')}
          value={profile.addressLine1}
          onChangeText={(value) => patch({ addressLine1: value })}
        />
        <TextField
          label={t('businessAddressLine2')}
          value={profile.addressLine2}
          onChangeText={(value) => patch({ addressLine2: value })}
        />
        <TextField
          label={t('businessCity')}
          value={profile.city}
          onChangeText={(value) => patch({ city: value })}
        />
        <TextField
          label={t('businessState')}
          value={profile.state}
          onChangeText={(value) => patch({ state: value })}
          hint="Used to decide CGST+SGST versus IGST when a client has no GSTIN."
        />
        <TextField
          label={t('businessPincode')}
          value={profile.pincode}
          onChangeText={(value) => patch({ pincode: value })}
          keyboardType="numeric"
        />
      </Collapsible>

      <Collapsible title="Contact" initiallyOpen={false}>
        <TextField
          label={t('businessPhone')}
          value={profile.phone}
          onChangeText={(value) => patch({ phone: value })}
          keyboardType="phone-pad"
        />
        <TextField
          label={t('businessEmail')}
          value={profile.email}
          onChangeText={(value) => patch({ email: value })}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextField
          label={t('businessWebsite')}
          value={profile.website}
          onChangeText={(value) => patch({ website: value })}
          keyboardType="url"
          autoCapitalize="none"
        />
      </Collapsible>

      <Collapsible title="Tax registration" initiallyOpen={false}>
        <TextField
          label={t('businessGstin')}
          value={profile.gstin ?? ''}
          onChangeText={(value) => patch({ gstin: value.trim().length > 0 ? value.toUpperCase() : null })}
          autoCapitalize="characters"
          hint={t('businessGstinHint')}
          error={
            gstinProblem === 'format' || gstinProblem === 'checksum' || gstinProblem === 'unknown_state'
              ? t('businessGstinInvalid')
              : null
          }
        />
        <TextField
          label={t('businessPan')}
          value={profile.pan ?? ''}
          onChangeText={(value) => patch({ pan: value.trim().length > 0 ? value.toUpperCase() : null })}
          autoCapitalize="characters"
        />
      </Collapsible>

      <Collapsible title={t('businessBank')} initiallyOpen={false}>
        <Caption>Only the fields you fill in are printed.</Caption>
        <TextField
          label={t('bankName')}
          value={profile.bankName ?? ''}
          onChangeText={(value) => patch({ bankName: value || null })}
        />
        <TextField
          label={t('bankAccountName')}
          value={profile.bankAccountName ?? ''}
          onChangeText={(value) => patch({ bankAccountName: value || null })}
        />
        <TextField
          label={t('bankAccountNo')}
          value={profile.bankAccountNo ?? ''}
          onChangeText={(value) => patch({ bankAccountNo: value || null })}
          keyboardType="numeric"
        />
        <TextField
          label={t('bankIfsc')}
          value={profile.bankIfsc ?? ''}
          onChangeText={(value) => patch({ bankIfsc: value ? value.toUpperCase() : null })}
          autoCapitalize="characters"
        />
        <TextField
          label={t('upiId')}
          value={profile.upiId ?? ''}
          onChangeText={(value) => patch({ upiId: value || null })}
          autoCapitalize="none"
          hint="Needed for the UPI payment QR on invoices."
        />
      </Collapsible>

      <Button label={submitLabel ?? t('save')} onPress={() => void submit()} loading={saving} />
      {footer}
    </View>
  );
}
