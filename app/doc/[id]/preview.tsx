/**
 * Live preview — spec §4 and §10.1.
 *
 * A WebView showing the *export* HTML. Not a re-implementation of the layout in React
 * Native: §10.1 defines divergence between preview and export as a bug, so the preview
 * renders the same string the PDF is made from, with only the screen-styling flag flipped.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';

import {
  Button,
  Caption,
  ErrorNotice,
  Loading,
  Screen,
} from '../../../src/components/ui';
import { getDocument } from '../../../src/db/documents';
import { useDatabase } from '../../../src/hooks/useDatabase';
import { countPages, renderDocumentHtml } from '../../../src/render/html';
import { prepareRender } from '../../../src/render/prepare';
import { t } from '../../../src/strings';
import { palette, spacing } from '../../../src/theme';

export default function PreviewScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db } = useDatabase();

  const [html, setHtml] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!db || !id) return;
    let cancelled = false;

    (async () => {
      try {
        const loaded = await getDocument(db, id);
        if (!loaded) throw new Error('Document not found');

        const input = await prepareRender(
          { document: loaded.document, lines: loaded.lines, payments: loaded.payments },
          { forScreen: true },
        );
        if (cancelled) return;
        setHtml(renderDocumentHtml(input));
        setPageCount(countPages(input));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, id]);

  if (error) {
    return (
      <Screen>
        <ErrorNotice message={t('errorLoadDocument')} detail={`${error.message}\n${error.stack ?? ''}`} />
      </Screen>
    );
  }

  if (!html) {
    return (
      <Screen>
        <Loading label={t('preview')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.container}>
      <View style={styles.webviewWrapper}>
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.webview}
          // §11 privacy: nothing in a document should ever need script or the network.
          javaScriptEnabled={false}
          // The HTML lays itself out at A4; let the WebView scale it to the phone's width.
          scalesPageToFit
          setBuiltInZoomControls
          showsHorizontalScrollIndicator={false}
        />
      </View>
      <View style={styles.footer}>
        <Caption>
          {t('preview')} · {pageCount > 1 ? `${pageCount} pages` : 'A4'}
        </Caption>
        <Button label={t('export')} onPress={() => router.push(`/doc/${id}/export`)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: palette.surfaceSunken },
  webviewWrapper: { flex: 1, backgroundColor: palette.surfaceSunken },
  webview: { flex: 1, backgroundColor: palette.surfaceSunken },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
  },
});
