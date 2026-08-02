import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { PickedPhoto } from '@/types/models';

export type PickResult =
  | { ok: true; photo: PickedPhoto }
  | { ok: false; reason: 'cancelled' | 'denied' };

// Square crop + light compression give a tidy avatar. allowsEditing/aspect/quality
// are native-only; on web the picker ignores them (the API client re-crops there).
const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.7,
};

/** The upload's native counterpart to the web picker's `file`. A native bundle
 *  runs expo/fetch, whose multipart encoder builds a part from `bytes()` and
 *  cannot read a `file://` URI at all, so the picker's own file descriptor never
 *  uploaded anything. Built here rather than in the API client, which stays free
 *  of native imports so it keeps loading under the node test runner.
 *
 *  Web has no such file to open (`asset.uri` is a blob: URL there) and does not
 *  need one. `new File` validates the path and throws on one it cannot address,
 *  which inside the picker would abort the pick with nothing shown; undefined
 *  instead defers that to the save, which reports it as a photo problem (see
 *  `nativePicturePart`). */
function uploadFile(uri: string): PickedPhoto['nativeFile'] {
  if (Platform.OS === 'web') return undefined;
  try {
    return new File(uri);
  } catch {
    return undefined;
  }
}

function normalize(asset: ImagePicker.ImagePickerAsset): PickedPhoto {
  return {
    uri: asset.uri,
    name: asset.fileName ?? 'photo.jpg',
    type: asset.mimeType ?? 'image/jpeg',
    file: (asset as { file?: Blob }).file, // web only; undefined on native
    nativeFile: uploadFile(asset.uri),
  };
}

/** Request the matching permission, then launch the library or camera. Returns a
 *  normalized photo, or a reason when the user cancels / denies permission. On web
 *  the permission requests resolve as granted (no OS prompt). */
export async function pickChildPhoto(source: 'library' | 'camera'): Promise<PickResult> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied' };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(OPTIONS);
  if (result.canceled || !result.assets?.[0]) return { ok: false, reason: 'cancelled' };
  return { ok: true, photo: normalize(result.assets[0]) };
}
