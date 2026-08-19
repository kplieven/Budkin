/**
 * The document-directory copy of a picked photo, and its lifecycle.
 *
 * The picker hands back a URI in Android's CACHE directory, which is exactly the
 * place the system reclaims under storage pressure. A photo that has to wait for a
 * reconnect cannot live there, so it is copied here at pick time.
 *
 * Split out of `src/lib/photo.ts` so the store can import the file half without
 * pulling in `expo-image-picker`.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { photoFileName } from '@/lib/photoName';
import type { PickedPhoto } from '@/types/models';

const FOLDER = 'childPhotos';

function photoDir(): Directory {
  return new Directory(Paths.document, FOLDER);
}

/**
 * Undefined is a real answer, not an error: there is no copy to be had on web, and
 * the caller reports a failed copy as a photo that cannot outlive the moment. An
 * online save still works.
 */
export async function persistPhotoFile(uri: string, sourceName: string): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const dir = photoDir();
    dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, photoFileName(sourceName, Date.now()));
    await new File(uri).copy(target, { overwrite: true });
    return target.uri;
  } catch {
    return undefined;
  }
}

/**
 * Undefined when the file is gone, which the caller treats as "push the child without
 * a photo" rather than as a failure to retry: a document-directory file going missing
 * has no ordinary cause, and retrying cannot bring it back.
 */
export function reopenPhotoFile(stored: { uri: string; name: string; type: string }): PickedPhoto | undefined {
  if (Platform.OS === 'web') return undefined;
  try {
    const file = new File(stored.uri);
    if (!file.exists) return undefined;
    return { uri: stored.uri, name: stored.name, type: stored.type, nativeFile: file, durable: true };
  } catch {
    return undefined;
  }
}

/** Delete one copy. Missing is success: the goal is that it is not there. */
export async function discardPhotoFile(uri: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* ignore */
  }
}

/**
 * Delete every copy nothing points at any more. Collects the orphans no single call
 * site can: a sheet cancelled after picking, a crash between the copy and the save, a
 * record dropped because its child turned out to be gone server-side.
 */
export async function sweepPhotoFiles(keep: string[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const dir = photoDir();
    if (!dir.exists) return;
    const kept = new Set(keep);
    for (const item of dir.list()) {
      if (item instanceof File && !kept.has(item.uri)) item.delete();
    }
  } catch {
    /* ignore */
  }
}
