/**
 * The export sheet — spec §10.5.
 *
 * Format selector, template selector, a collapsible "what's included" listing the §7.4
 * toggles, and the three actions: Share, Save to Downloads, Print. Generation reports
 * progress, and §11's error rule applies — a readable message plus copyable detail.
 *
 * Exporting is also one of the two moments a document number is allocated (§8.3).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import {
  Body,
  Button,
  Caption,
  Card,
  ChipGroup,
  Collapsible,
  ErrorNotice,
  Field,
  Loading,
  Screen,
  SectionTitle,
  Snackbar,
  SwitchRow,
} from '../../../src/components/ui';
import type { DocumentBlocks, TemplateId } from '../../../src/core/types';
import { TEMPLATE_IDS } from '../../../src/core/types';
import { ensureDocumentNumber, getDocument, type FullDocument } from '../../../src/db/documents';
import { getSetting, setSetting, SETTINGS_KEYS } from '../../../src/db/masters';
import {
  ExportError,
  printExport,
  saveExportToDownloads,
  shareExport,
  type ExportFormat,
} from '../../../src/export';
import { isImageCaptureSupported, type ImageFormat } from '../../../src/export/image';
import { countPages, type RenderInput } from '../../../src/render/html';
import { prepareRender } from '../../../src/render/prepare';
import { useDatabase } from '../../../src/hooks/useDatabase';
import { useEditorStore } from '../../../src/state/editor';
import { t } from '../../../src/strings';
import { fontWeight, palette, spacing } from '../../../src/theme';

const TEMPLATE_LABELS: Record<TemplateId, string> = {
  classic: 'Classic',
  minimal: 'Minimal',
  bold: 'Bold',
  compact: 'Compact',
};

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

export default function ExportScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useDatabase();

  const [loaded, setLoaded] = useState<FullDocument | null>(null);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png');
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [blocks, setBlocks] = useState<DocumentBlocks | null>(null);
  const [input, setInput] = useState<RenderInput | null>(null);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Load the document, allocating its number first — §8.3 makes export the other moment a
  // number is assigned, so the number that appears on the file is the real one.
  useEffect(() => {
    if (!db || !id) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureDocumentNumber(db, id);
        // The editor may still be mounted behind this screen holding the pre-allocation
        // copy, whose number is empty. Without this reload its next autosave would write
        // that empty number straight back over the one just allocated.
        await useEditorStore.getState().reload(db, id);
        const record = await getDocument(db, id);
        if (!record || cancelled) return;
        setLoaded(record);
        setTemplate(record.document.templateId);
        setBlocks(record.document.blocks);

        const storedFormat = await getSetting(db, SETTINGS_KEYS.defaultExportFormat);
        if (!cancelled && (storedFormat === 'pdf' || storedFormat === 'docx' || storedFormat === 'image')) {
          setFormat(storedFormat);
        }
      } catch (cause) {
        if (!cancelled) {
          setError({
            message: t('errorLoadDocument'),
            detail: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  // Rebuild the render input whenever the template or the toggles change, so the page count
  // and the generated file always reflect what is on screen.
  useEffect(() => {
    if (!loaded || !blocks) return;
    let cancelled = false;
    (async () => {
      const prepared = await prepareRender(
        { document: loaded.document, lines: loaded.lines, payments: loaded.payments },
        { templateId: template, blocks },
      );
      if (!cancelled) setInput(prepared);
    })();
    return () => {
      cancelled = true;
    };
  }, [blocks, loaded, template]);

  const run = useCallback(
    async (action: 'share' | 'save' | 'print') => {
      if (!input || !loaded) return;
      setError(null);
      setProgress({ stage: t('exportWorking'), fraction: 0.05 });

      const request = {
        input,
        filenameParts: {
          type: loaded.document.type,
          number: loaded.document.number,
          clientName: loaded.document.clientSnapshot?.company || loaded.document.clientSnapshot?.name || null,
          businessName: loaded.document.businessSnapshot.name,
        },
        format,
        imageFormat,
        onProgress: (stage: string, fraction: number) => setProgress({ stage, fraction }),
      };

      try {
        if (action === 'print') {
          await printExport(input);
        } else if (action === 'share') {
          await shareExport(request);
        } else {
          const result = await saveExportToDownloads(request);
          setToast(
            result.location === 'media-library'
              ? 'Saved to your gallery.'
              : t('exportSavedTo'),
          );
        }
        if (db) await setSetting(db, SETTINGS_KEYS.defaultExportFormat, format);
      } catch (cause) {
        if (cause instanceof ExportError) {
          setError({ message: cause.message, detail: cause.detail });
        } else {
          setError({
            message: t('exportFailed'),
            detail: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause),
          });
        }
      } finally {
        setProgress(null);
      }
    },
    [db, format, imageFormat, input, loaded],
  );

  if (!loaded || !blocks) {
    return (
      <Screen>
        {error ? <ErrorNotice message={error.message} detail={error.detail} /> : <Loading />}
      </Screen>
    );
  }

  const pageCount = input ? countPages(input) : 1;
  // Image capture needs a native module absent from Expo Go, so the option is hidden there
  // rather than offered and then failing at the point of use.
  const imageSupported = isImageCaptureSupported();

  return (
    <Screen>
      <Card>
        <Body style={styles.strong}>
          {loaded.document.number || t('statusDraft')}
        </Body>
        <Caption>
          {loaded.document.clientSnapshot?.company || loaded.document.clientSnapshot?.name || t('clientNone')}
          {` · ${pageCount} page${pageCount === 1 ? '' : 's'} · A4`}
        </Caption>
      </Card>

      <Field label={t('exportFormat')}>
        <ChipGroup
          options={[
            { value: 'pdf' as ExportFormat, label: t('exportPdf') },
            ...(imageSupported ? [{ value: 'image' as ExportFormat, label: t('exportImage') }] : []),
            { value: 'docx' as ExportFormat, label: t('exportDocx') },
          ]}
          value={format}
          onChange={setFormat}
        />
      </Field>

      {!imageSupported ? (
        <Caption>Image export needs a development or preview build; it is unavailable here.</Caption>
      ) : null}

      {format === 'image' ? (
        <SwitchRow
          label={t('exportImageJpg')}
          value={imageFormat === 'jpg'}
          onValueChange={(value) => setImageFormat(value ? 'jpg' : 'png')}
        />
      ) : null}

      <Field label={t('exportTemplate')}>
        <ChipGroup
          options={TEMPLATE_IDS.map((templateId) => ({
            value: templateId,
            label: TEMPLATE_LABELS[templateId],
          }))}
          value={template}
          onChange={setTemplate}
        />
      </Field>

      <Collapsible title={t('editorBlocks')} initiallyOpen={false}>
        {BLOCK_LABELS.map(([key, label]) => (
          <SwitchRow
            key={key}
            label={label}
            value={blocks[key]}
            onValueChange={(value) => setBlocks({ ...blocks, [key]: value })}
          />
        ))}
      </Collapsible>

      {progress ? (
        <Card>
          <Caption>{progress.stage}</Caption>
          {/* A determinate bar, as §10.5 asks — generation must not look stalled. */}
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${Math.round(progress.fraction * 100)}%` }]}
            />
          </View>
        </Card>
      ) : null}

      {error ? <ErrorNotice message={error.message} detail={error.detail} /> : null}

      <SectionTitle>{t('export')}</SectionTitle>
      <Button
        label={t('exportShare')}
        onPress={() => void run('share')}
        loading={progress !== null}
        disabled={!input}
      />
      <Button
        label={t('exportSave')}
        variant="secondary"
        onPress={() => void run('save')}
        disabled={!input || progress !== null}
        accessibilityHint={t('permissionMediaExplain')}
      />
      <Button
        label={t('exportPrint')}
        variant="secondary"
        onPress={() => void run('print')}
        disabled={!input || progress !== null}
      />
      <Caption>{t('permissionMediaExplain')}</Caption>

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  strong: { fontWeight: fontWeight.semibold },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.surfaceSunken,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: palette.navy },
});
