import * as ImagePicker from 'expo-image-picker';

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

function normalize(asset: ImagePicker.ImagePickerAsset): PickedPhoto {
  return {
    uri: asset.uri,
    name: asset.fileName ?? 'photo.jpg',
    type: asset.mimeType ?? 'image/jpeg',
    file: (asset as { file?: Blob }).file, // web only; undefined on native
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
