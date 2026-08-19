/**
 * One editable line item — spec §7.3.
 *
 * The badges are the visible half of the auto/custom pricing rule: a line added from the
 * catalogue shows "Catalogue price", and the moment its rate is edited it shows "Edited"
 * and offers a one-tap write-back. That write-back is an explicit action and never happens
 * on its own, which §7.3 is emphatic about.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CalcLineResult } from '../core/calc';
import {
  formatBasisPoints,
  formatMilli,
  formatPaise,
  parseCurrencyToPaise,
  parsePercentToBasisPoints,
  parseQuantityToMilli,
} from '../core/money';
import type { TaxMode } from '../core/types';
import type { LineItem } from '../db/documents';
import type { TaxPreset } from '../db/masters';
import { t } from '../strings';
import { fontSize, fontWeight, palette, radius, spacing } from '../theme';
import { Badge, Body, Caption, ChipGroup, Field, IconButton, SwitchRow, TextField } from './ui';

export interface LineItemEditorProps {
  line: LineItem;
  index: number;
  total: number;
  currency: string;
  calc: CalcLineResult | null;
  gstEnabled: boolean;
  taxMode: TaxMode;
  showHsn: boolean;
  taxPresets: readonly TaxPreset[];
  editable: boolean;
  onPatch: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Called when an `auto` line's rate has just been overridden (§7.3). */
  onOfferCatalogueWriteBack: () => void;
}

export function LineItemEditor({
  line,
  index,
  total,
  currency,
  calc,
  gstEnabled,
  taxMode,
  showHsn,
  taxPresets,
  editable,
  onPatch,
  onRemove,
  onMoveUp,
  onMoveDown,
  onOfferCatalogueWriteBack,
}: LineItemEditorProps): React.ReactElement {
  /**
   * Currency and quantity inputs keep their own draft text while focused.
   *
   * §6.3 requires "7500", "7,500" and "7500.50" all to be accepted and normalised on blur.
   * That is only possible if the field can hold a partially typed value — reformatting on
   * every keystroke would fight the user, turning "7500." into "7500.00" mid-typing and
   * moving the caret.
   */
  const [rateDraft, setRateDraft] = useState(() => formatPaise(line.rate));
  const [qtyDraft, setQtyDraft] = useState(() => formatMilli(line.qtyMilli));
  const [rateFocused, setRateFocused] = useState(false);
  const [qtyFocused, setQtyFocused] = useState(false);

  // Adopt external changes (undo, reorder, a fresh load) but never while typing.
  useEffect(() => {
    if (!rateFocused) setRateDraft(formatPaise(line.rate));
  }, [line.rate, rateFocused]);

  useEffect(() => {
    if (!qtyFocused) setQtyDraft(formatMilli(line.qtyMilli));
  }, [line.qtyMilli, qtyFocused]);

  const isCatalogueLine = line.catalogueItemId !== null;
  const wasOverridden = isCatalogueLine && line.priceSource === 'custom';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Caption style={styles.index}>{index + 1}</Caption>
        <View style={styles.badges}>
          {line.priceSource === 'auto' ? <Badge label={t('itemBadgeAuto')} tone="info" /> : null}
          {wasOverridden ? <Badge label={t('itemBadgeEdited')} tone="warning" /> : null}
          {!isCatalogueLine ? <Badge label={t('itemBadgeCustom')} tone="neutral" /> : null}
          {line.isFree ? <Badge label={t('itemFreeLabel')} tone="positive" /> : null}
        </View>
        <View style={styles.headerActions}>
          {onMoveUp ? <IconButton label="Move up" glyph="↑" onPress={onMoveUp} /> : null}
          {onMoveDown ? <IconButton label="Move down" glyph="↓" onPress={onMoveDown} /> : null}
          {editable ? (
            <IconButton label={t('delete')} glyph="✕" onPress={onRemove} tone="danger" />
          ) : null}
        </View>
      </View>

      <TextField
        label={t('itemName')}
        value={line.name}
        onChangeText={(value) => onPatch({ name: value })}
        placeholder="What are you charging for?"
        required
      />

      <TextField
        label="Details"
        value={line.description}
        onChangeText={(value) => onPatch({ description: value })}
        multiline
      />

      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label={t('itemQty')}
            value={qtyDraft}
            onChangeText={setQtyDraft}
            onBlur={() => {
              setQtyFocused(false);
              const parsed = parseQuantityToMilli(qtyDraft);
              // An unreadable entry reverts rather than silently becoming zero.
              if (parsed === null || parsed < 0) setQtyDraft(formatMilli(line.qtyMilli));
              else onPatch({ qtyMilli: parsed });
            }}
            keyboardType="decimal-pad"
            align="right"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label={t('itemUnit')}
            value={line.unit}
            onChangeText={(value) => onPatch({ unit: value })}
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label={`${t('itemRate')} (${currency})`}
            value={rateDraft}
            onChangeText={setRateDraft}
            onBlur={() => {
              setRateFocused(false);
              const parsed = parseCurrencyToPaise(rateDraft);
              if (parsed === null) {
                setRateDraft(formatPaise(line.rate));
                return;
              }
              if (parsed === line.rate) {
                setRateDraft(formatPaise(parsed));
                return;
              }
              onPatch({ rate: parsed });
              // §7.3: overriding a catalogue price offers the write-back, once, here.
              if (isCatalogueLine && line.priceSource === 'auto') onOfferCatalogueWriteBack();
            }}
            keyboardType="decimal-pad"
            align="right"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label={t('itemDiscount')}
            value={formatBasisPoints(line.discountBp)}
            onChangeText={(value) => onPatch({ discountBp: parsePercentToBasisPoints(value) ?? 0 })}
            keyboardType="decimal-pad"
            align="right"
            hint="%"
          />
        </View>
      </View>

      {showHsn ? (
        <TextField
          label={t('itemHsn')}
          value={line.hsnSac}
          onChangeText={(value) => onPatch({ hsnSac: value })}
          autoCapitalize="characters"
        />
      ) : null}

      {/* §9.4: no tax control at all for an unregistered business. */}
      {gstEnabled && taxMode !== 'none' && taxMode !== 'flat' ? (
        <Field label={t('itemTax')}>
          <ChipGroup
            options={taxPresets.map((preset) => ({
              value: String(preset.rateBp),
              label: `${formatBasisPoints(preset.rateBp)}%`,
            }))}
            value={String(line.taxRateBp)}
            onChange={(value) => onPatch({ taxRateBp: Number(value) })}
          />
        </Field>
      ) : null}

      {/* §7.3: complimentary lines are a first-class feature, not a zero-rupee hack. */}
      <SwitchRow
        label={t('itemFree')}
        description="Prints FREE, keeps the description, adds nothing to the total."
        value={line.isFree}
        onValueChange={(value) => onPatch({ isFree: value })}
      />

      <View style={styles.amountRow}>
        <Caption>{t('itemAmount')}</Caption>
        <Body style={styles.amount}>
          {line.isFree ? t('itemFreeLabel') : `₹${formatPaise(calc?.lineTotal ?? 0)}`}
        </Body>
      </View>

      {calc && calc.lineTax > 0 ? (
        <Caption>
          {t('itemTax')} ₹{formatPaise(calc.lineTax)} on ₹{formatPaise(calc.lineBase)}
        </Caption>
      ) : null}

      {total > 1 ? <Caption style={styles.position}>{index + 1} of {total}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  index: { fontWeight: fontWeight.bold, minWidth: 16 },
  badges: { flex: 1, flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  headerActions: { flexDirection: 'row' },
  row: { flexDirection: 'row', gap: spacing.sm },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.sm,
  },
  amount: { fontSize: fontSize.bodyLarge, fontWeight: fontWeight.bold, color: palette.ink },
  position: { textAlign: 'right' },
});
