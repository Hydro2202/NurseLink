import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Resize + recompress a captured/picked photo before it goes anywhere near
 * the network.
 *
 * The signup ID/selfie endpoints are anonymous and accept images up to the
 * backend's per-file ceiling (api/face_match.py MAX_IMAGE_BYTES) — a
 * same-generation phone's camera can comfortably produce a JPEG near that
 * ceiling on its own at full resolution. Capping the long side at 1600px
 * (plenty for OCR/face-detection, which work on much smaller crops anyway)
 * keeps a normal sign-up's uploads at a few hundred KB instead of several MB,
 * well clear of the limit without the nurse ever noticing a quality loss.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

export async function compressPhoto(uri: string): Promise<{ uri: string; base64: string }> {
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
  });

  const longSide = Math.max(width, height);
  const scale = longSide > MAX_DIMENSION ? MAX_DIMENSION / longSide : 1;
  const actions =
    scale < 1 ? [{ resize: { width: Math.round(width * scale), height: Math.round(height * scale) } }] : [];

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) {
    throw new Error('Could not process the photo. Please try again.');
  }
  // On web, base64 output can arrive already prefixed as a data URI — strip
  // it so every caller gets bare base64 regardless of platform, the same way
  // the backend and the rest of this app always expect it.
  const base64 = result.base64.replace(/^data:[^;]+;base64,/, '');
  return { uri: result.uri, base64 };
}
