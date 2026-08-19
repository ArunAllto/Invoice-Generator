/**
 * Font embedding for the export HTML — spec §3's "Fonts in PDF" row.
 *
 * The spec is blunt about why this exists: with the platform's default font stack the
 * rupee sign (₹, U+20B9) and Malayalam text can render as blank boxes in the print
 * engine. So the fonts travel *inside* the HTML as base64 `@font-face` sources, and the
 * output is self-contained (§10.1) with no file or network reference to resolve.
 *
 * Two costs are managed deliberately:
 *
 *  - **Size.** Noto Sans Regular and SemiBold are ~1.2 MB of TTF, so ~1.7 MB once
 *    base64-encoded. They are read from the bundle once and cached in module state for
 *    the process lifetime, so the cost is paid on the first export, not on every one.
 *  - **Malayalam.** The Malayalam face is another ~113 KB and is only needed when the
 *    document actually contains Malayalam text, so it is loaded on demand. An
 *    English-only invoice never carries it.
 */

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

/** Base64 payloads, cached after first read. */
interface FontCache {
  regular?: string;
  semibold?: string;
  malayalam?: string;
}

const cache: FontCache = {};

/** In-flight loads, so two simultaneous exports do not each read the bundle. */
const pending = new Map<keyof FontCache, Promise<string>>();

const MODULES = {
  regular: require('../../assets/fonts/NotoSans-Regular.ttf') as number,
  semibold: require('../../assets/fonts/NotoSans-SemiBold.ttf') as number,
  malayalam: require('../../assets/fonts/NotoSansMalayalam-Regular.ttf') as number,
} as const;

async function loadFont(which: keyof FontCache): Promise<string> {
  const cached = cache[which];
  if (cached) return cached;

  const inFlight = pending.get(which);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const asset = Asset.fromModule(MODULES[which]);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    cache[which] = base64;
    return base64;
  })();

  pending.set(which, promise);
  try {
    return await promise;
  } finally {
    pending.delete(which);
  }
}

/** Malayalam block, plus the Malayalam-specific extras. */
const MALAYALAM_PATTERN = /[ഀ-ൿ]/;

/** Does this document need the Malayalam face? */
export function needsMalayalam(text: string): boolean {
  return MALAYALAM_PATTERN.test(text);
}

export interface EmbeddedFonts {
  /** Ready-to-inline `@font-face` rules. */
  css: string;
  /** The `font-family` stack the templates should use. */
  familyStack: string;
  includesMalayalam: boolean;
}

/**
 * Build the `@font-face` CSS for a document.
 *
 * `font-display: block` is deliberate: in a print context a swap would risk the engine
 * laying out with a fallback face and producing a PDF with the wrong metrics — or a
 * missing rupee glyph, which is the whole problem being solved.
 */
export async function loadEmbeddedFonts(documentText: string): Promise<EmbeddedFonts> {
  const wantMalayalam = needsMalayalam(documentText);

  const [regular, semibold, malayalam] = await Promise.all([
    loadFont('regular'),
    loadFont('semibold'),
    wantMalayalam ? loadFont('malayalam') : Promise.resolve(''),
  ]);

  const faces: string[] = [
    fontFace('CraftyDocsSans', 400, regular),
    fontFace('CraftyDocsSans', 600, semibold),
  ];
  if (malayalam) faces.push(fontFace('CraftyDocsMalayalam', 400, malayalam));

  const familyStack = malayalam
    ? "'CraftyDocsSans', 'CraftyDocsMalayalam', sans-serif"
    : "'CraftyDocsSans', sans-serif";

  return {
    css: faces.join('\n'),
    familyStack,
    includesMalayalam: Boolean(malayalam),
  };
}

function fontFace(family: string, weight: number, base64: string): string {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/ttf;base64,${base64}) format('truetype');}`;
}

/**
 * A fonts object with no embedded faces, for callers that explicitly do not want the
 * payload. Not used by the export path — the spec requires embedding there — but useful
 * for tests and for the DOCX builder, which supplies fonts through Word's own mechanism.
 */
export const SYSTEM_FONTS_ONLY: EmbeddedFonts = {
  css: '',
  familyStack: "'Noto Sans', 'Roboto', system-ui, sans-serif",
  includesMalayalam: false,
};

/** Drop the cached payloads. Only useful under memory pressure. */
export function clearFontCache(): void {
  delete cache.regular;
  delete cache.semibold;
  delete cache.malayalam;
}
