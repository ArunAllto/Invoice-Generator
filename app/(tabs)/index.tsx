/**
 * Home / Dashboard — spec §4.1.
 *
 * Three large primary buttons, the summary strip, the last five documents, and the
 * profile-completion banner.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Banner,
  BigActionButton,
  Body,
  Caption,
  Card,
  EmptyState,
  ErrorNotice,
  Loading,
  ListRow,
  SectionTitle,
  Screen,
  StatusPill,
} from '../../src/components/ui';
import { formatIsoDate } from '../../src/core/dates';
import { formatPaise } from '../../src/core/money';
import { statusLabel, statusTone } from '../../src/core/status';
import type { DocumentType } from '../../src/core/types';
import { createDocument, getDashboardSummary } from '../../src/db/documents';
import { getBusinessProfile, isBusinessProfileComplete } from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { fontSize, fontWeight, palette, spacing } from '../../src/theme';

const TYPE_LABELS: Record<DocumentType, string> = {
  quotation: t('quotation'),
  invoice: t('invoice'),
  receipt: t('receipt'),
};

export default function DashboardScreen(): React.ReactElement {
  const router = useRouter();
  const { db } = useDatabase();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [creating, setCreating] = useState(false);

  const summary = useQuery((database) => getDashboardSummary(database), []);
  const profile = useQuery((database) => getBusinessProfile(database), []);

  const accent = profile.data?.accentColor ?? palette.navy;

  /**
   * §6.1: create the draft and go straight to the editor. No intermediate form, and no
   * number is reserved yet (§8.3).
   */
  const startDocument = useCallback(
    async (type: DocumentType) => {
      if (!db || creating) return;
      setCreating(true);
      try {
        const created = await createDocument(db, { type });
        router.push(`/doc/${created.document.id}/edit`);
      } finally {
        setCreating(false);
      }
    },
    [creating, db, router],
  );

  if (summary.error) {
    return (
      <Screen>
        <ErrorNotice
          message={t('errorGeneric')}
          detail={summary.error.message}
          onRetry={summary.refresh}
        />
      </Screen>
    );
  }

  const showBanner =
    !bannerDismissed && profile.data !== null && !isBusinessProfileComplete(profile.data);

  return (
    <Screen>
      {showBanner ? (
        <Banner
          message={t('homeCompleteProfile')}
          actionLabel={t('homeCompleteProfileAction')}
          onAction={() => router.push('/settings/business')}
          onDismiss={() => setBannerDismissed(true)}
        />
      ) : null}

      <View style={styles.actions}>
        <BigActionButton
          label={t('homeNewQuotation')}
          caption="Estimate — no payment implied"
          accentColor={accent}
          onPress={() => void startDocument('quotation')}
        />
        <BigActionButton
          label={t('homeNewInvoice')}
          caption="Bill — payment due"
          accentColor={accent}
          onPress={() => void startDocument('invoice')}
        />
        <BigActionButton
          label={t('homeNewReceipt')}
          caption="Acknowledge a payment received"
          accentColor={accent}
          onPress={() => void startDocument('receipt')}
        />
      </View>

      <Card>
        <View style={styles.summaryRow}>
          <SummaryCell
            label={t('homeQuotationsPending')}
            value={String(summary.data?.quotationsPending ?? 0)}
          />
          <SummaryCell
            label={t('homeInvoicesUnpaid')}
            value={String(summary.data?.invoicesUnpaid ?? 0)}
          />
          <SummaryCell
            label={t('homeOutstanding')}
            value={`₹${formatPaise(summary.data?.totalOutstanding ?? 0, { decimals: false })}`}
            emphasis
          />
        </View>
      </Card>

      <SectionTitle>{t('homeRecent')}</SectionTitle>
      <Card padded={false}>
        {summary.loading ? (
          <Loading />
        ) : (summary.data?.recent.length ?? 0) === 0 ? (
          <EmptyState title={t('homeNoRecent')} />
        ) : (
          (summary.data?.recent ?? []).map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <View style={styles.rowDivider} /> : null}
              <ListRow
                title={`${TYPE_LABELS[item.type]} ${item.number || t('statusDraft')}`}
                subtitle={`${item.clientName || t('clientNone')} · ${formatIsoDate(item.issueDate)}`}
                onPress={() => router.push(`/doc/${item.id}/edit`)}
                right={
                  <View style={styles.rowRight}>
                    <Body style={styles.amount}>₹{formatPaise(item.grandTotal, { decimals: false })}</Body>
                    <StatusPill
                      label={statusLabel(item.derivedStatus)}
                      tone={statusTone(item.derivedStatus)}
                    />
                  </View>
                }
              />
            </View>
          ))
        )}
      </Card>

      <Caption style={styles.privacyNote}>{t('aboutPrivacy')}</Caption>
    </Screen>
  );
}

function SummaryCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.summaryCell}>
      <Body style={[styles.summaryValue, emphasis && styles.summaryValueEmphasis]}>{value}</Body>
      <Caption style={styles.summaryLabel}>{label}</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  summaryRow: { flexDirection: 'row', gap: spacing.md },
  summaryCell: { flex: 1, gap: 2 },
  summaryValue: { fontSize: fontSize.title, fontWeight: fontWeight.semibold, color: palette.ink },
  summaryValueEmphasis: { color: palette.navy },
  summaryLabel: { fontSize: fontSize.caption },
  rowDivider: { height: 1, backgroundColor: palette.border, marginHorizontal: spacing.lg },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  amount: { fontWeight: fontWeight.semibold },
  privacyNote: { marginTop: spacing.sm },
});
