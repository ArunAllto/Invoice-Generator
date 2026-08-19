/**
 * Settings → Business profile. The same form as onboarding step 1 (§4).
 */

import React, { useState } from 'react';

import { BusinessProfileForm } from '../../src/components/BusinessProfileForm';
import { Caption, Screen, Snackbar } from '../../src/components/ui';
import { t } from '../../src/strings';

export default function SettingsBusinessScreen(): React.ReactElement {
  const [toast, setToast] = useState<string | null>(null);

  return (
    <Screen>
      <Caption>
        These details are copied onto each document as you create it, so changing them here
        never alters a document you have already issued.
      </Caption>
      <BusinessProfileForm onSaved={() => setToast(t('saved'))} />
      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}
