/**
 * The document editor — spec §6.2, the most important screen in the app.
 *
 * Collapsible sections, everything editable inline, autosaving to SQLite on every change
 * with a 400 ms debounce (handled by the Zustand store), and a sticky footer carrying the
 * live grand total.
 *
 * The pricing behaviour of §7.3 lives here: `Add from catalogue` pre-fills a line and marks
 * it `auto`; editing that line's rate flips it to `custom`, shows an "edited" badge, and
 * offers a one-tap write-back to the catalogue that never happens on its own.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { CataloguePickerSheet } from '../../../src/components/CataloguePicker';
import { ClientPickerSheet } from '../../../src/components/ClientPicker';
import { LineItemEditor } from '../../../src/components/LineItemEditor';
import {
  Body,
  BottomSheet,
  Button,
  Caption,
  Card,
  ChipGroup,
  Collapsible,
  ConfirmDialog,
  ErrorNotice,
  Field,
  Loading,
  OptionList,
  Screen,
  Snackbar,
  StatusPill,
  SwitchRow,
  TextField,
} from '../../../src/components/ui';
import { formatIsoDate, isValidIsoDate, todayIso } from '../../../src/core/dates';
import { isGstEnabled, inferTaxMode } from '../../../src/core/gst';
import {
  formatBasisPoints,
  formatPaise,
  parseCurrencyToPaise,
  parsePercentToBasisPoints,
} from '../../../src/core/money';
import { isDuplicateNumber, previewNextNumber } from '../../../src/core/numbering';
import { deriveStatus, isEditable, statusLabel, statusTone } from '../../../src/core/status';
import type {
  DiscountMode,
  DocumentBlocks,
  DocumentStatus,
  PaymentMethod,
  TaxMode,
} from '../../../src/core/types';
import {
  convertQuotationToInvoice,
  createReceiptForInvoice,
  ensureDocumentNumber,
  getLinkedDocuments,
  listUsedNumbers,
  setDocumentNumberManually,
  setDocumentStatus,
  type LineItem,
} from '../../../src/db/documents';
import {
  getDefaultSeries,
  getSetting,
  listTaxPresets,
  listTermsBlocks,
  listCustomFieldDefs,
  readAllocationFacts,
  setSetting,
  SETTINGS_KEYS,
  updateCatalogueRate,
} from '../../../src/db/masters';
import { useDatabase, useQuery } from '../../../src/hooks/useDatabase';
import { useEditorStore } from '../../../src/state/editor';
import { t } from '../../../src/strings';
import { fontSize, fontWeight, palette, spacing } from '../../../src/theme';

const BLOCK_LABELS: Array<[keyof DocumentBlocks, string]> = [
  ['clientBlock', t('blockClient')],
  ['descriptions', t('blockDescriptions')],
  ['hsnColumn', t('blockHsn')],
  ['unitColumn', t('blockUnit')],
  ['taxColumns', t('blockTax')],
  ['taxSummary', t('blockTaxSummary')],
  ['discountRow', t('blockDiscountRow')],
  ['shippingRow', t('blockShippingRow')],
  ['roundOffRow', t('blockRoundOffRow')],
  ['amountInWords', t('blockAmountInWords')],
  ['bankDetails', t('blockBank')],
  ['upiQr', t('blockUpiQr')],
  ['signature', t('blockSignature')],
  ['terms', t('blockTerms')],
  ['notes', t('blockNotes')],
  ['footerLine', t('blockFooter')],
];

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: t('paymentMethodCash') },
  { value: 'upi', label: t('paymentMethodUpi') },
  { value: 'bank_transfer', label: t('paymentMethodBank') },
  { value: 'cheque', label: t('paymentMethodCheque') },
  { value: 'card', label: t('paymentMethodCard') },
  { value: 'other', label: t('paymentMethodOther') },
];

export default function DocumentEditorScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db } = useDatabase();

  const document = useEditorStore((state) => state.document);
  const lines = useEditorStore((state) => state.lines);
  const payments = useEditorStore((state) => state.payments);
  const calc = useEditorStore((state) => state.calc);
  const saveState = useEditorStore((state) => state.saveState);
  const saveError = useEditorStore((state) => state.saveError);
  const loading = useEditorStore((state) => state.loading);
  const store = useEditorStore.getState();

  const [cataloguePickerOpen, setCataloguePickerOpen] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [numberSheetOpen, setNumberSheetOpen] = useState(false);
  const [numberDraft, setNumberDraft] = useState('');
  const [receiptSheetOpen, setReceiptSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [undoLine, setUndoLine] = useState<{ line: LineItem; position: number } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [writeBackFor, setWriteBackFor] = useState<LineItem | null>(null);
  /**
   * §7.3: the per-document price-mode toggle decides which Add button is primary and how
   * new lines default. The last choice is persisted as an app setting, and both buttons
   * stay available whatever it is set to.
   */
  const [priceMode, setPriceMode] = useState<'catalogue' | 'manual'>('catalogue');

  useEffect(() => {
    if (!db) return;
    void getSetting(db, SETTINGS_KEYS.priceMode).then((stored) => {
      if (stored === 'manual' || stored === 'catalogue') setPriceMode(stored);
    });
  }, [db]);

  useEffect(() => {
    if (db && id) void useEditorStore.getState().load(db, id);
  }, [db, id]);

  // §6.3: flush on leaving the screen so the draft is intact even if the app is killed
  // immediately afterwards.
  useFocusEffect(
    useCallback(
      () => () => {
        void useEditorStore.getState().flush();
      },
      [],
    ),
  );

  const taxPresets = useQuery((database) => listTaxPresets(database), []);
  const termsBlocks = useQuery(
    (database) => (document ? listTermsBlocks(database, document.type) : Promise.resolve([])),
    [document?.type],
  );
  const customFieldDefs = useQuery(
    (database) => listCustomFieldDefs(database, 'document'),
    [],
  );
  const links = useQuery(
    (database) => (id ? getLinkedDocuments(database, id) : Promise.resolve({ from: null, to: [] })),
    [id],
  );
  const numberPreview = useQuery(
    async (database) => {
      if (!document || document.number) return null;
      const series = document.seriesId
        ? await getDefaultSeries(database, document.type)
        : await getDefaultSeries(database, document.type);
      if (!series) return null;
      const facts = await readAllocationFacts(database, series, document.issueDate);
      return previewNextNumber(series, facts, document.issueDate);
    },
    [document?.number, document?.issueDate, document?.type],
  );

  const gstEnabled = document ? isGstEnabled(document.businessSnapshot.gstin) : false;
  const editable = document ? isEditable(document.type, document.status) : false;

  const derived = useMemo(() => {
    if (!document) return null;
    return deriveStatus({
      type: document.type,
      storedStatus: document.status,
      today: todayIso(),
      validUntil: document.validUntil,
      dueDate: document.dueDate,
      grandTotal: document.grandTotal,
      payments: payments.map((payment) => payment.amount),
    });
  }, [document, payments]);

  if (loading || !document) {
    return (
      <Screen>
        <Loading label={t('editorHeader')} />
      </Screen>
    );
  }

  const currency = document.currency;

  return (
    <Screen
      footer={
        <StickyFooter
          total={calc?.grandTotal ?? 0}
          saveState={saveState}
          canExport={lines.length > 0}
          onPreview={async () => {
            await store.flush();
            router.push(`/doc/${document.id}/preview`);
          }}
          onExport={async () => {
            if (lines.length === 0) {
              setToast(t('exportNoItems'));
              return;
            }
            await store.flush();
            router.push(`/doc/${document.id}/export`);
          }}
        />
      }
    >
      {saveError ? <ErrorNotice message={t('errorGeneric')} detail={saveError} /> : null}

      {!editable ? (
        <Card style={styles.lockedCard}>
          <Body>{t('receiptLockedNotice')}</Body>
        </Card>
      ) : null}

      {/* 1. Header ------------------------------------------------------------ */}
      <Collapsible
        title={t('editorHeader')}
        subtitle={`${typeLabel(document.type)}${document.number ? ` · ${document.number}` : ''}`}
        badge={
          derived ? <StatusPill label={statusLabel(derived.status)} tone={statusTone(derived.status)} /> : null
        }
      >
        <Field label={t('documentNumber')} hint={document.number ? null : t('numberNotYetAssigned')}>
          <Pressable
            onPress={() => {
              setNumberDraft(document.number);
              setNumberSheetOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('numberOverride')}
            style={styles.numberRow}
          >
            <Body style={styles.numberText}>
              {document.number || `${t('numberNext')}: ${numberPreview.data ?? '—'}`}
            </Body>
            <Caption>{t('edit')}</Caption>
          </Pressable>
        </Field>

        {document.numberWarning ? (
          <ErrorNotice message={t('numberDuplicateWarning')} />
        ) : null}

        <TextField
          label={t('issueDate')}
          value={document.issueDate.slice(0, 10)}
          onChangeText={(value) => store.patchDocument({ issueDate: value })}
          placeholder="YYYY-MM-DD"
          keyboardType="numeric"
          required
          error={isValidIsoDate(document.issueDate) ? null : 'Use YYYY-MM-DD'}
          hint={isValidIsoDate(document.issueDate) ? formatIsoDate(document.issueDate) : null}
        />

        {document.type === 'quotation' ? (
          <TextField
            label={t('validUntil')}
            value={document.validUntil?.slice(0, 10) ?? ''}
            onChangeText={(value) => store.patchDocument({ validUntil: value || null })}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
          />
        ) : null}

        {document.type === 'invoice' ? (
          <TextField
            label={t('dueDate')}
            value={document.dueDate?.slice(0, 10) ?? ''}
            onChangeText={(value) => store.patchDocument({ dueDate: value || null })}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
          />
        ) : null}

        <StatusActions
          document={document}
          derivedStatus={derived?.status ?? document.status}
          onSetStatus={async (status) => {
            if (!db) return;
            // §8.3: leaving draft is one of the two moments a number is allocated.
            if (status !== 'draft') await ensureDocumentNumber(db, document.id);
            await setDocumentStatus(db, document.id, status);
            await useEditorStore.getState().reload(db, document.id);
            setToast(statusLabel(status));
          }}
          onCancelDocument={() => setConfirmCancel(true)}
        />

        {links.data?.from ? (
          <Pressable onPress={() => router.push(`/doc/${links.data?.from?.id}/edit`)}>
            <Caption style={styles.link}>
              {t('convertedFrom')}: {links.data.from.number || t('statusDraft')}
            </Caption>
          </Pressable>
        ) : null}
        {(links.data?.to ?? []).map((child) => (
          <Pressable key={child.id} onPress={() => router.push(`/doc/${child.id}/edit`)}>
            <Caption style={styles.link}>
              {t('convertedTo')}: {child.number || t('statusDraft')}
            </Caption>
          </Pressable>
        ))}
      </Collapsible>

      {/* 2. Client ----------------------------------------------------------- */}
      <Collapsible
        title={t('editorClient')}
        subtitle={document.clientSnapshot?.company || document.clientSnapshot?.name || t('clientNone')}
      >
        <Button
          label={document.clientSnapshot ? t('edit') : t('clientPick')}
          variant="secondary"
          onPress={() => setClientPickerOpen(true)}
        />
        {document.clientSnapshot ? (
          <View>
            <Body style={styles.strong}>
              {document.clientSnapshot.company || document.clientSnapshot.name}
            </Body>
            {[
              document.clientSnapshot.addressLine1,
              document.clientSnapshot.city,
              document.clientSnapshot.phone,
              gstEnabled && document.clientSnapshot.gstin ? `GSTIN ${document.clientSnapshot.gstin}` : '',
            ]
              .filter((part) => part && part.length > 0)
              .map((part) => (
                <Caption key={part}>{part}</Caption>
              ))}
          </View>
        ) : (
          <Caption>{t('clientNoneHint')}</Caption>
        )}
      </Collapsible>

      {/* 3. Items ------------------------------------------------------------ */}
      <Collapsible
        title={t('editorItems')}
        subtitle={`${lines.length} line${lines.length === 1 ? '' : 's'}`}
      >
        <Field label={t('itemsPriceMode')}>
          <ChipGroup
            options={[
              { value: 'catalogue' as const, label: t('itemsPriceModeCatalogue') },
              { value: 'manual' as const, label: t('itemsPriceModeManual') },
            ]}
            value={priceMode}
            onChange={(mode) => {
              setPriceMode(mode);
              if (db) void setSetting(db, SETTINGS_KEYS.priceMode, mode);
            }}
          />
        </Field>

        {/* Both buttons always remain available; the mode only decides which leads. */}
        <View style={styles.addRow}>
          <Button
            label={t('itemsAddFromCatalogue')}
            variant={priceMode === 'catalogue' ? 'primary' : 'secondary'}
            onPress={() => setCataloguePickerOpen(true)}
            style={styles.flex}
          />
          <Button
            label={t('itemsAddCustom')}
            variant={priceMode === 'manual' ? 'primary' : 'secondary'}
            onPress={() => store.addCustomLine()}
            style={styles.flex}
          />
        </View>

        {lines.length === 0 ? (
          <Caption>{t('itemsEmpty')}</Caption>
        ) : (
          lines.map((line, index) => (
            <LineItemEditor
              key={line.id}
              line={line}
              index={index}
              total={lines.length}
              currency={currency}
              calc={calc?.lines[index] ?? null}
              gstEnabled={gstEnabled}
              taxMode={document.taxMode}
              showHsn={document.blocks.hsnColumn}
              taxPresets={taxPresets.data ?? []}
              editable={editable}
              onPatch={(patch) => store.patchLine(line.id, patch)}
              onRemove={() => {
                const removed = store.removeLine(line.id);
                if (removed) {
                  setUndoLine({ line: removed, position: index });
                  setToast(t('itemDeleted'));
                }
              }}
              onMoveUp={index > 0 ? () => store.moveLine(index, index - 1) : undefined}
              onMoveDown={index < lines.length - 1 ? () => store.moveLine(index, index + 1) : undefined}
              onOfferCatalogueWriteBack={() => setWriteBackFor(line)}
            />
          ))
        )}
      </Collapsible>

      {/* 4. Charges ---------------------------------------------------------- */}
      <Collapsible title={t('editorCharges')} initiallyOpen={false}>
        <Field label={t('chargesDiscount')}>
          <ChipGroup
            options={[
              { value: 'none' as DiscountMode, label: t('chargesDiscountNone') },
              { value: 'percent' as DiscountMode, label: t('chargesDiscountPercent') },
              { value: 'amount' as DiscountMode, label: t('chargesDiscountAmount') },
            ]}
            value={document.discountMode}
            onChange={(mode) => store.patchDocument({ discountMode: mode, discountValue: 0 })}
          />
        </Field>

        {document.discountMode === 'percent' ? (
          <TextField
            label="Discount %"
            value={formatBasisPoints(document.discountValue)}
            onChangeText={(value) =>
              store.patchDocument({ discountValue: parsePercentToBasisPoints(value) ?? 0 })
            }
            keyboardType="decimal-pad"
            align="right"
          />
        ) : null}

        {document.discountMode === 'amount' ? (
          <TextField
            label={`Discount (${currency})`}
            value={formatPaise(document.discountValue)}
            onChangeText={(value) =>
              store.patchDocument({ discountValue: parseCurrencyToPaise(value) ?? 0 })
            }
            keyboardType="decimal-pad"
            align="right"
          />
        ) : null}

        <TextField
          label={t('chargesShipping')}
          value={formatPaise(document.shippingAmount)}
          onChangeText={(value) =>
            store.patchDocument({ shippingAmount: parseCurrencyToPaise(value) ?? 0 })
          }
          keyboardType="decimal-pad"
          align="right"
        />

        {/* §9.4: the whole GST section disappears for an unregistered business. */}
        {gstEnabled ? (
          <Field label={t('chargesTaxMode')}>
            <OptionList
              options={[
                { value: 'none' as TaxMode, label: t('chargesTaxNone') },
                { value: 'gst_intra' as TaxMode, label: t('chargesTaxIntra') },
                { value: 'gst_inter' as TaxMode, label: t('chargesTaxInter') },
                { value: 'flat' as TaxMode, label: t('chargesTaxFlat') },
              ]}
              value={document.taxMode}
              onChange={(mode) => store.patchDocument({ taxMode: mode })}
            />
          </Field>
        ) : (
          <Caption>{t('businessGstinHint')}</Caption>
        )}

        {gstEnabled && document.taxMode === 'flat' ? (
          <TextField
            label="Tax rate %"
            value={formatBasisPoints(document.flatTaxRateBp)}
            onChangeText={(value) =>
              store.patchDocument({ flatTaxRateBp: parsePercentToBasisPoints(value) ?? 0 })
            }
            keyboardType="decimal-pad"
            align="right"
          />
        ) : null}

        <SwitchRow
          label={t('chargesRoundOff')}
          value={document.roundOffEnabled}
          onValueChange={(value) => store.patchDocument({ roundOffEnabled: value })}
        />

        <TotalsSummary />
      </Collapsible>

      {/* 5. Payment (receipts only) ------------------------------------------ */}
      {document.type === 'receipt' ? (
        <Collapsible title={t('editorPayment')}>
          <Field label={t('paymentMethod')}>
            <ChipGroup
              options={PAYMENT_METHODS}
              value={document.paymentMethod ?? 'cash'}
              onChange={(method) => store.patchDocument({ paymentMethod: method })}
            />
          </Field>
          <TextField
            label={t('paymentReference')}
            value={document.paymentReference ?? ''}
            onChangeText={(value) => store.patchDocument({ paymentReference: value })}
            autoCapitalize="characters"
          />
        </Collapsible>
      ) : null}

      {/* Invoice payments + conversions -------------------------------------- */}
      {document.type === 'invoice' && payments.length > 0 ? (
        <Collapsible title={t('paymentsRecorded')} initiallyOpen={false}>
          {payments.map((payment) => (
            <View key={payment.id} style={styles.paymentRow}>
              <Body>
                ₹{formatPaise(payment.amount)} · {formatIsoDate(payment.paidOn)}
              </Body>
              <Caption>
                {PAYMENT_METHODS.find((method) => method.value === payment.method)?.label}
                {payment.reference ? ` · ${payment.reference}` : ''}
              </Caption>
            </View>
          ))}
          <Body style={styles.strong}>
            {t('totalsBalance')}: ₹{formatPaise(derived?.balance ?? 0)}
          </Body>
        </Collapsible>
      ) : null}

      {document.type === 'quotation' ? (
        <Button
          label={t('convertToInvoice')}
          variant="secondary"
          onPress={async () => {
            if (!db) return;
            await store.flush();
            const created = await convertQuotationToInvoice(db, document.id);
            router.replace(`/doc/${created.document.id}/edit`);
          }}
        />
      ) : null}

      {document.type === 'invoice' ? (
        <Button
          label={t('convertToReceipt')}
          variant="secondary"
          onPress={() => setReceiptSheetOpen(true)}
        />
      ) : null}

      {/* 6. Notes ------------------------------------------------------------ */}
      <Collapsible title={t('editorNotes')} initiallyOpen={false}>
        <TextField
          label={t('editorNotes')}
          value={document.notes}
          onChangeText={(value) => store.patchDocument({ notes: value })}
          multiline
        />
      </Collapsible>

      {/* 7. Terms ------------------------------------------------------------ */}
      <Collapsible title={t('editorTerms')} initiallyOpen={false}>
        {(termsBlocks.data ?? []).length > 0 ? (
          <Field label={t('termsPick')}>
            <ChipGroup
              options={(termsBlocks.data ?? []).map((block) => ({
                value: block.id,
                label: block.title,
              }))}
              onChange={(blockId) => {
                const block = (termsBlocks.data ?? []).find((entry) => entry.id === blockId);
                if (block) store.patchDocument({ terms: block.body });
              }}
            />
          </Field>
        ) : null}
        <TextField
          label={t('termsEditForThis')}
          value={document.terms}
          onChangeText={(value) => store.patchDocument({ terms: value })}
          multiline
          numberOfLines={8}
        />
      </Collapsible>

      {/* 8. Custom fields ---------------------------------------------------- */}
      <Collapsible title={t('editorCustomFields')} initiallyOpen={false}>
        {(customFieldDefs.data ?? []).length === 0 ? (
          <Caption>Define extra fields in Settings → {t('settingsCustomFields')}.</Caption>
        ) : (
          (customFieldDefs.data ?? []).map((def) => {
            const existing = document.customFields.find((field) => field.label === def.label);
            return (
              <TextField
                key={def.id}
                label={def.label}
                value={existing?.value ?? ''}
                keyboardType={def.fieldType === 'number' ? 'decimal-pad' : 'default'}
                onChangeText={(value) => {
                  const others = document.customFields.filter((field) => field.label !== def.label);
                  const next = value.trim().length > 0 ? [...others, { label: def.label, value }] : others;
                  store.patchDocument({ customFields: next });
                }}
              />
            );
          })
        )}
      </Collapsible>

      <Button label={t('editorBlocks')} variant="ghost" onPress={() => setBlocksOpen(true)} />

      {/* Sheets -------------------------------------------------------------- */}
      <BottomSheet visible={blocksOpen} onClose={() => setBlocksOpen(false)} title={t('editorBlocks')}>
        <Caption>
          Everything here is per document. A document with GST off and no client block still
          looks deliberate.
        </Caption>
        {BLOCK_LABELS.filter(([key]) => {
          // Hide the GST-only toggles when there is no GSTIN (§9.4), and the UPI QR when
          // there is no UPI ID to encode (§7.6).
          if ((key === 'taxColumns' || key === 'taxSummary' || key === 'hsnColumn') && !gstEnabled) {
            return false;
          }
          if (key === 'upiQr') {
            return document.type === 'invoice' && Boolean(document.businessSnapshot.upiId);
          }
          return true;
        }).map(([key, label]) => (
          <SwitchRow
            key={key}
            label={label}
            value={document.blocks[key]}
            onValueChange={(value) => store.setBlocks({ ...document.blocks, [key]: value })}
          />
        ))}
      </BottomSheet>

      <BottomSheet
        visible={numberSheetOpen}
        onClose={() => setNumberSheetOpen(false)}
        title={t('numberOverride')}
      >
        <TextField
          label={t('documentNumber')}
          value={numberDraft}
          onChangeText={setNumberDraft}
          autoCapitalize="characters"
          hint={`${t('numberNext')}: ${numberPreview.data ?? '—'}`}
        />
        <Button
          label={t('save')}
          onPress={async () => {
            if (!db) return;
            const used = await listUsedNumbers(db, document.type, document.id);
            const duplicate = isDuplicateNumber(
              numberDraft,
              used.map((entry) => entry.number),
            );
            await setDocumentNumberManually(db, document.id, numberDraft.trim(), duplicate);
            await useEditorStore.getState().reload(db, document.id);
            setNumberSheetOpen(false);
            // §8.4: warn but permit.
            if (duplicate) setToast(t('numberDuplicateWarning'));
          }}
        />
      </BottomSheet>

      <ClientPickerSheet
        visible={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        onPick={(snapshot, clientId) =>
          store.patchDocument({
            clientId,
            clientSnapshot: snapshot,
            // §9.4: re-infer the tax mode from the new client's state, still overridable.
            taxMode: snapshot
              ? inferTaxMode({
                  businessGstin: document.businessSnapshot.gstin,
                  clientGstin: snapshot.gstin,
                  businessState: document.businessSnapshot.state,
                  clientState: snapshot.state,
                }).mode
              : document.taxMode,
            blocks: { ...document.blocks, clientBlock: snapshot !== null },
          })
        }
      />

      <CataloguePickerSheet
        visible={cataloguePickerOpen}
        onClose={() => setCataloguePickerOpen(false)}
        onPick={(items) => store.addCatalogueLines(items)}
      />

      <ReceiptSheet
        visible={receiptSheetOpen}
        onClose={() => setReceiptSheetOpen(false)}
        balance={derived?.balance ?? document.grandTotal}
        onConfirm={async (amount, method, reference, paidOn) => {
          if (!db) return;
          await store.flush();
          await ensureDocumentNumber(db, document.id);
          // Pick the allocated number back up before leaving, so returning to this invoice
          // and editing it cannot overwrite the number with the stale blank one.
          await useEditorStore.getState().reload(db, document.id);
          const receipt = await createReceiptForInvoice(db, document.id, {
            amount,
            method,
            reference,
            paidOn,
          });
          setReceiptSheetOpen(false);
          router.push(`/doc/${receipt.document.id}/edit`);
        }}
      />

      <ConfirmDialog
        visible={writeBackFor !== null}
        title={t('itemUpdateCatalogue', {
          amount: `₹${formatPaise(writeBackFor?.rate ?? 0)}`,
        })}
        message="This changes the saved price for future documents. Existing documents are untouched."
        confirmLabel={t('save')}
        onCancel={() => setWriteBackFor(null)}
        onConfirm={async () => {
          if (db && writeBackFor?.catalogueItemId) {
            await updateCatalogueRate(db, writeBackFor.catalogueItemId, writeBackFor.rate);
            setToast(t('itemUpdateCatalogueDone'));
          }
          setWriteBackFor(null);
        }}
      />

      <ConfirmDialog
        visible={confirmCancel}
        title={document.type === 'receipt' ? t('confirmCancelReceipt') : t('cancelDocument')}
        destructive
        confirmLabel={t('cancelDocument')}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={async () => {
          if (!db) return;
          await setDocumentStatus(db, document.id, 'cancelled');
          await useEditorStore.getState().reload(db, document.id);
          setConfirmCancel(false);
        }}
      />

      {toast ? (
        <Snackbar
          message={toast}
          actionLabel={undoLine ? t('undo') : undefined}
          onAction={
            undoLine
              ? () => {
                  store.restoreLine(undoLine.line, undoLine.position);
                  setUndoLine(null);
                  setToast(null);
                }
              : undefined
          }
          onHide={() => {
            setToast(null);
            setUndoLine(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** The live totals block shown under the charges section. */
function TotalsSummary(): React.ReactElement | null {
  const calc = useEditorStore((state) => state.calc);
  const document = useEditorStore((state) => state.document);
  if (!calc || !document) return null;

  const rows: Array<[string, string]> = [[t('totalsSubtotal'), `₹${formatPaise(calc.subtotal)}`]];
  if (calc.discountTotal > 0) rows.push([t('totalsDiscount'), `− ₹${formatPaise(calc.discountTotal)}`]);
  if (document.taxMode === 'gst_intra') {
    rows.push([t('totalsCgst'), `₹${formatPaise(calc.cgstTotal)}`]);
    rows.push([t('totalsSgst'), `₹${formatPaise(calc.sgstTotal)}`]);
  } else if (document.taxMode === 'gst_inter') {
    rows.push([t('totalsIgst'), `₹${formatPaise(calc.igstTotal)}`]);
  } else if (document.taxMode === 'flat') {
    rows.push([t('totalsTax'), `₹${formatPaise(calc.taxTotal)}`]);
  }
  if (calc.shipping > 0) rows.push([t('totalsShipping'), `₹${formatPaise(calc.shipping)}`]);
  if (calc.roundOff !== 0) {
    rows.push([
      t('totalsRoundOff'),
      `${calc.roundOff > 0 ? '+ ' : '− '}₹${formatPaise(Math.abs(calc.roundOff))}`,
    ]);
  }

  return (
    <Card style={styles.totalsCard}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.totalsRow}>
          <Caption>{label}</Caption>
          <Body>{value}</Body>
        </View>
      ))}
      <View style={styles.totalsRow}>
        <Body style={styles.strong}>{t('totalsGrand')}</Body>
        <Body style={styles.grand}>₹{formatPaise(calc.grandTotal)}</Body>
      </View>
      <Caption>{document.amountInWords}</Caption>
    </Card>
  );
}

/** §6.2 item 9: the sticky footer with the always-visible total. */
function StickyFooter({
  total,
  saveState,
  canExport,
  onPreview,
  onExport,
}: {
  total: number;
  saveState: string;
  canExport: boolean;
  onPreview: () => void;
  onExport: () => void;
}): React.ReactElement {
  return (
    <View style={styles.footer}>
      <View style={styles.footerTotal}>
        <Caption>{t('totalsGrand')}</Caption>
        <Body style={styles.footerAmount}>₹{formatPaise(total)}</Body>
        <Caption>
          {saveState === 'saving' ? '…' : saveState === 'saved' || saveState === 'idle' ? t('saved') : ''}
        </Caption>
      </View>
      <View style={styles.footerButtons}>
        <Button label={t('preview')} variant="secondary" onPress={onPreview} />
        <Button label={t('export')} onPress={onExport} disabled={!canExport} />
      </View>
    </View>
  );
}

/** Status transitions the user may choose (§6.4). */
function StatusActions({
  document,
  derivedStatus,
  onSetStatus,
  onCancelDocument,
}: {
  document: { type: 'quotation' | 'invoice' | 'receipt'; status: DocumentStatus };
  derivedStatus: DocumentStatus;
  onSetStatus: (status: DocumentStatus) => Promise<void>;
  onCancelDocument: () => void;
}): React.ReactElement {
  const actions: Array<{ label: string; status: DocumentStatus }> = [];

  if (document.type === 'quotation') {
    if (document.status === 'draft') actions.push({ label: t('markAsSent'), status: 'sent' });
    if (derivedStatus === 'sent' || derivedStatus === 'expired') {
      actions.push({ label: t('markAsAccepted'), status: 'accepted' });
      actions.push({ label: t('markAsRejected'), status: 'rejected' });
    }
  } else if (document.type === 'invoice') {
    if (document.status === 'draft') actions.push({ label: t('markAsSent'), status: 'sent' });
  } else if (document.status === 'draft') {
    actions.push({ label: t('markAsIssued'), status: 'issued' });
  }

  return (
    <View style={styles.statusActions}>
      {actions.map((action) => (
        <Button
          key={action.status}
          label={action.label}
          variant="secondary"
          onPress={() => void onSetStatus(action.status)}
        />
      ))}
      {document.status !== 'cancelled' && document.status !== 'draft' ? (
        <Button label={t('cancelDocument')} variant="ghost" onPress={onCancelDocument} />
      ) : null}
    </View>
  );
}

/** §6.5: Invoice → Receipt prompts for amount, method, reference and date. */
function ReceiptSheet({
  visible,
  onClose,
  balance,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  balance: number;
  onConfirm: (
    amount: number,
    method: PaymentMethod,
    reference: string,
    paidOn: string,
  ) => Promise<void>;
}): React.ReactElement {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());

  // Default to the full balance, as §6.5 specifies.
  useEffect(() => {
    if (visible) setAmount(formatPaise(balance));
  }, [balance, visible]);

  const parsed = parseCurrencyToPaise(amount) ?? 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('convertToReceipt')}>
      <TextField
        label={t('paymentAmount')}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        align="right"
        required
        hint={`${t('totalsBalance')}: ₹${formatPaise(balance)}`}
      />
      <Field label={t('paymentMethod')}>
        <ChipGroup options={PAYMENT_METHODS} value={method} onChange={setMethod} />
      </Field>
      <TextField
        label={t('paymentReference')}
        value={reference}
        onChangeText={setReference}
        autoCapitalize="characters"
      />
      <TextField
        label={t('paymentDate')}
        value={paidOn}
        onChangeText={setPaidOn}
        keyboardType="numeric"
        placeholder="YYYY-MM-DD"
        error={isValidIsoDate(paidOn) ? null : 'Use YYYY-MM-DD'}
      />
      <Button
        label={t('markAsIssued')}
        disabled={parsed <= 0 || !isValidIsoDate(paidOn)}
        onPress={() => void onConfirm(parsed, method, reference, paidOn)}
      />
    </BottomSheet>
  );
}

function typeLabel(type: 'quotation' | 'invoice' | 'receipt'): string {
  return type === 'quotation' ? t('quotation') : type === 'invoice' ? t('invoice') : t('receipt');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: { fontWeight: fontWeight.semibold },
  link: { color: palette.navy, textDecorationLine: 'underline' },
  lockedCard: { backgroundColor: palette.warningBg, borderColor: palette.warning },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: palette.surface,
  },
  numberText: { fontWeight: fontWeight.semibold },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  statusActions: { gap: spacing.sm, marginTop: spacing.sm },
  paymentRow: { paddingVertical: spacing.xs },
  totalsCard: { backgroundColor: palette.surfaceAlt, gap: spacing.xs },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  grand: { fontSize: fontSize.bodyLarge, fontWeight: fontWeight.bold, color: palette.navy },
  footer: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  footerTotal: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  footerAmount: { flex: 1, fontSize: fontSize.title, fontWeight: fontWeight.bold, color: palette.navy },
  footerButtons: { flexDirection: 'row', gap: spacing.sm },
});
