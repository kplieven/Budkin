/** The name a picked photo is copied to in the document directory.
 *
 *  Its own module because `src/lib/photoFile.ts` imports `expo-file-system` and
 *  so cannot be loaded by the node test runner at all. Same precedent as
 *  `src/lib/appVersion.ts`.
 *
 *  The extension is taken from the source name so the stored file is still
 *  recognisable as an image, and because the native multipart part is named
 *  after the FILE (see `buildChildForm`, which passes no filename on native),
 *  which means this name is what Baby Buddy stores the picture under.
 *
 *  Anything that is not a short run of letters and digits is refused rather
 *  than cleaned up: the source name comes from the picker, and the result is
 *  appended to a path we build. */
export function photoFileName(sourceName: string, now: number): string {
  const dot = sourceName.lastIndexOf('.');
  const raw = dot === -1 ? '' : sourceName.slice(dot + 1).toLowerCase();
  const ext = /^[a-z0-9]{1,5}$/.test(raw) ? raw : 'jpg';
  return `photo-${now}.${ext}`;
}
