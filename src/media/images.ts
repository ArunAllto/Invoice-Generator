/**
 * Logo and signature image handling — spec §7.1 and §7.2.
 *
 * Everything is stored in the app's document directory (not the cache, which the OS may
 * clear) and referenced by URI, so a logo survives restarts and app updates.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { uuid } from '../core/ids';

/** §7.1: reject anything over 8 MB with a clear message. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** §7.1: downscale the stored copy to 800px on the long edge. */
export const LOGO_MAX_EDGE = 800;

/** Signatures are line art; 1200px keeps the strokes crisp without bloating the PDF. */
export const SIGNATURE_MAX_EDGE = 1200;

export type ImageProblem = 'too_large' | 'unsupported' | 'cancelled' | 'permission' | null;

export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
}

export interface PickResult {
  image: ProcessedImage | null;
  problem: ImageProblem;
}

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

function extensionOf(uri: string): string {
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(uri);
  return (match?.[1] ?? '').toLowerCase();
}

/** Where processed images live. Created on demand. */
async function assetsDirectory(): Promise<string> {
  const directory = `${FileSystem.documentDirectory ?? ''}assets/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

export interface PickOptions {
  source: 'gallery' | 'camera';
  /** §7.1 offers a crop step. `false` gives free-form framing by skipping the editor. */
  allowCrop?: boolean;
  /** Square crop for a logo; free-form otherwise. */
  square?: boolean;
}

/**
 * Pick an image and normalise it for use as a logo (§7.1).
 *
 * Order of operations matters: the size check happens on the *picked* file, before any
 * processing, so an 80 MB camera capture is rejected rather than being decoded first.
 */
export async function pickLogo(options: PickOptions): Promise<PickResult> {
  const permission =
    options.source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { image: null, problem: 'permission' };

  const pickerOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: options.allowCrop ?? true,
    aspect: options.square ? [1, 1] : undefined,
    quality: 1,
    exif: false,
  };

  const result =
    options.source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

  if (result.canceled || !result.assets[0]) return { image: null, problem: 'cancelled' };
  const asset = result.assets[0];

  const extension = extensionOf(asset.uri) || (asset.mimeType?.split('/')[1] ?? '');
  if (extension && !SUPPORTED_EXTENSIONS.includes(extension)) {
    return { image: null, problem: 'unsupported' };
  }

  const info = await FileSystem.getInfoAsync(asset.uri);
  const size = info.exists ? (info.size ?? 0) : 0;
  if (size > MAX_IMAGE_BYTES) return { image: null, problem: 'too_large' };

  const processed = await downscaleAndStore(asset.uri, LOGO_MAX_EDGE, 'logo');
  return { image: processed, problem: null };
}

/**
 * Downscale to `maxEdge` on the long side and store a permanent copy.
 *
 * PNG is always the output format: §7.1 requires transparency to survive, and re-encoding a
 * transparent logo as JPEG would flatten it onto black.
 */
export async function downscaleAndStore(
  sourceUri: string,
  maxEdge: number,
  prefix: string,
): Promise<ProcessedImage> {
  const context = ImageManipulator.ImageManipulator.manipulate(sourceUri);
  const original = await context.renderAsync();

  const longEdge = Math.max(original.width, original.height);
  if (longEdge > maxEdge) {
    const scale = maxEdge / longEdge;
    context.resize({
      width: Math.round(original.width * scale),
      height: Math.round(original.height * scale),
    });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: ImageManipulator.SaveFormat.PNG,
    compress: 1,
  });

  const directory = await assetsDirectory();
  const target = `${directory}${prefix}-${uuid()}.png`;
  await FileSystem.moveAsync({ from: saved.uri, to: target });

  return { uri: target, width: saved.width, height: saved.height };
}

/** Persist a base64 PNG (the drawn signature, or a processed upload) to the assets folder. */
export async function storeBase64Png(base64: string, prefix: string): Promise<string> {
  const directory = await assetsDirectory();
  const target = `${directory}${prefix}-${uuid()}.png`;
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  await FileSystem.writeAsStringAsync(target, payload, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return target;
}

/**
 * Delete a stored asset, ignoring a file that has already gone.
 *
 * Called when the user replaces a logo, so the document directory does not accumulate
 * every logo they have ever tried.
 */
export async function deleteStoredImage(uri: string | null | undefined): Promise<void> {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // A missing file is the desired end state anyway.
  }
}

export function describeImageProblem(problem: ImageProblem): string | null {
  switch (problem) {
    case 'too_large':
      return 'That image is larger than 8 MB. Please choose a smaller one.';
    case 'unsupported':
      return 'Please choose a PNG, JPG or WebP image.';
    case 'permission':
      return 'Permission was not granted, so the image could not be opened.';
    case 'cancelled':
    case null:
    default:
      return null;
  }
}
