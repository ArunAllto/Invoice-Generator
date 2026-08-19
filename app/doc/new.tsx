/**
 * Type picker → creates a draft → routes to the editor (§4, §6.1).
 *
 * Reached from the Documents tab's + button. Home creates documents directly, so this
 * screen exists for the path where the type has not been chosen yet.
 */

import React, { useState } from 'react';
import { useRouter } from 'expo-router';

import { BigActionButton, Caption, Screen, SectionTitle } from '../../src/components/ui';
import type { DocumentType } from '../../src/core/types';
import { createDocument } from '../../src/db/documents';
import { useDatabase } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

export default function NewDocumentScreen(): React.ReactElement {
  const router = useRouter();
  const { db } = useDatabase();
  const [busy, setBusy] = useState(false);

  const create = async (type: DocumentType): Promise<void> => {
    if (!db || busy) return;
    setBusy(true);
    try {
      const created = await createDocument(db, { type });
      // `replace` so the back button returns to the list rather than to this picker.
      router.replace(`/doc/${created.document.id}/edit`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle>What are you making?</SectionTitle>
      <BigActionButton
        label={t('homeNewQuotation')}
        caption="Estimate — no payment implied"
        onPress={() => void create('quotation')}
      />
      <BigActionButton
        label={t('homeNewInvoice')}
        caption="Bill — payment due"
        onPress={() => void create('invoice')}
      />
      <BigActionButton
        label={t('homeNewReceipt')}
        caption="Acknowledge a payment received"
        onPress={() => void create('receipt')}
      />
      <Caption>{t('numberNotYetAssigned')}</Caption>
    </Screen>
  );
}
