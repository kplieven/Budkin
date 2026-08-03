# Offline Child Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a photo set on a child while offline is uploaded when the connection comes back, instead of being dropped with an apology.

**Architecture:** the picker copies the picked file out of Android's evictable cache into the document directory at pick time, so every path downstream handles plain serializable data and `saveChild` stays synchronous. A new AsyncStorage map keyed by local child id records that a child owes the server a photo; the three deferred push paths (op replay, `uploadUnsynced`, `confirmBirth`) read it, and clear it only on a confirmed upload or a terminal 404.

**Tech Stack:** TypeScript, React Native / Expo SDK 56, zustand, AsyncStorage, `expo-file-system` 56 (`Paths`, `Directory`, `File`), vitest (node environment).

## Global Constraints

- Read the exact versioned Expo docs at https://docs.expo.dev/versions/v56.0.0/ before writing code against an Expo module. The `expo-file-system` API used here is the modern one: `Paths.document`, `new Directory(...)`, `new File(...)`, NOT the deprecated `FileSystem.documentDirectory` string API.
- **Native only.** Every function in `src/lib/photoFile.ts` returns the not-durable answer on web (`Platform.OS === 'web'`). Web keeps today's `Saved · photo not saved` warning.
- **No em-dashes** anywhere: prose, code comments, commit messages, UI copy. Use commas, colons, or separate sentences.
- `vitest` runs in the **node** environment and matches `src/**/*.test.ts` only, so no `.tsx` is testable. A native module cannot be loaded for real, but it CAN be mocked with `vi.mock` and the module under test then imported directly: `src/notifications/permission.android.test.ts` and `src/data/servers.test.ts` (for `expo-secure-store`) are the precedents. So "it imports a native module" is not a reason to leave a file untested. What genuinely stays out of reach is the native call doing real I/O on a device, which is why Task 8 exists.
- Never return a new object/array reference from a `useAppStore` selector (zustand v5 infinite loop). Not expected to come up here, but it is a standing rule.
- Local child ids are stable: a push stamps `serverId` and deliberately leaves `id` alone. The pending-photo map is keyed by `id` and relies on that.
- Run `npx tsc --noEmit` and `npx eslint .` before every commit. The suite is `npx vitest run`.

---

## File Structure

**Created:**
- `src/lib/photoName.ts` — the pure filename rule, extracted so the naming logic is testable without any mocking at all.
- `src/lib/photoName.test.ts`
- `src/lib/photoFile.ts` — the native file shell: copy, reopen, discard, sweep. Imports `expo-file-system` and `Platform`, nothing else.
- `src/lib/photoFile.test.ts` — mocks `expo-file-system` and `Platform` and imports the module directly, per `permission.android.test.ts`. Pins the web guards, the exists-checks, the swallow-and-continue paths, and above all `sweepPhotoFiles`'s keep-set filter, which is the only code in this feature that deletes user data.
- `src/data/pendingPhotos.ts` — the AsyncStorage map. Modelled on `src/data/pendingOps.ts`.
- `src/data/pendingPhotos.test.ts`

**Modified:**
- `src/types/models.ts` — `PickedPhoto` gains `durable: boolean`.
- `src/lib/photo.ts` — `normalize` copies through `persistPhotoFile` and reports `durable`.
- `src/data/sync.ts` — `UploadDeps.pushChild` returns `{ id, picture }`.
- `src/data/sync.test.ts` — 15 `pushChild` mock sites.
- `src/api/client.test.ts` — 2 `PickedPhoto` fixtures gain `durable`.
- `src/store/useAppStore.ts` — record on save, read on push, settle on success.
- `src/store/useAppStore.test.ts` — two existing describe blocks are rewritten (they assert the old drop-it behaviour), plus new coverage.

---

### Task 1: The pending-photo store

Pure persistence, no dependencies, fully testable. Nothing else can be built until the shape exists.

**Files:**
- Create: `src/data/pendingPhotos.ts`
- Test: `src/data/pendingPhotos.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PendingPhoto = { kind: 'set'; uri: string; name: string; type: string } | { kind: 'remove' }`
  - `loadPendingPhotos(): Promise<Record<string, PendingPhoto>>`
  - `setPendingPhoto(childId: string, photo: PendingPhoto): Promise<PendingPhoto | undefined>` returns the record it replaced
  - `clearPendingPhoto(childId: string): Promise<PendingPhoto | undefined>` returns the record it removed
  - `clearPendingPhotos(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/data/pendingPhotos.test.ts`. The AsyncStorage mock is copied from `src/data/pendingOps.test.ts:7-19` on purpose: same module, same stand-in.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPendingPhoto, clearPendingPhotos, loadPendingPhotos, setPendingPhoto } from '@/data/pendingPhotos';
import type { PendingPhoto } from '@/data/pendingPhotos';

// In-memory stand-in for the native AsyncStorage module.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      mem.store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      mem.store.delete(k);
    }),
  },
}));

const set = (uri: string): PendingPhoto => ({ kind: 'set', uri, name: 'pick.jpg', type: 'image/jpeg' });

beforeEach(() => {
  mem.store.clear();
});

describe('pendingPhotos persistence', () => {
  it('returns {} when nothing is saved', async () => {
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('round-trips a set record under its child id', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/a.jpg') });
  });

  it('keeps separate children apart', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await setPendingPhoto('c2', { kind: 'remove' });
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/a.jpg'), c2: { kind: 'remove' } });
  });

  it('overwrites a child rather than accumulating, and hands back what it replaced', async () => {
    // Re-picking a photo offline replaces the pending one. Returning the old
    // record is what lets the caller delete the file it pointed at instead of
    // leaving it for the sweep.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    const prev = await setPendingPhoto('c1', set('file:///doc/b.jpg'));
    expect(prev).toEqual(set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({ c1: set('file:///doc/b.jpg') });
  });

  it('returns undefined when there was nothing to replace', async () => {
    expect(await setPendingPhoto('c1', set('file:///doc/a.jpg'))).toBeUndefined();
  });

  it('clears one child and returns the record it removed', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await setPendingPhoto('c2', set('file:///doc/b.jpg'));
    expect(await clearPendingPhoto('c1')).toEqual(set('file:///doc/a.jpg'));
    expect(await loadPendingPhotos()).toEqual({ c2: set('file:///doc/b.jpg') });
  });

  it('clearing an absent child is a no-op returning undefined', async () => {
    expect(await clearPendingPhoto('nobody')).toBeUndefined();
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('clears every child at once', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await clearPendingPhotos();
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('reads corrupt stored JSON as empty rather than throwing', async () => {
    mem.store.set('budkin.pendingPhotos.v1', '{not json');
    expect(await loadPendingPhotos()).toEqual({});
  });

  it('serializes mutations, so one landing during another is not clobbered', async () => {
    // Both mutators are read-modify-write over one stored map, and both are
    // fired without being awaited. Two interleaving would each write back the
    // map they read, and the second to finish would drop the first one's
    // change. A re-read at the start of each call, which is all
    // `removePendingOp` does, cannot fix that: both callers re-read, and both
    // read the same map. Only ordering them does.
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([setPendingPhoto('c2', set('file:///doc/b.jpg')), clearPendingPhoto('c1')]);
    const map = await loadPendingPhotos();
    expect(map.c2).toEqual(set('file:///doc/b.jpg'));
  });

  it('a rejected mutation does not poison the ones queued behind it', async () => {
    await setPendingPhoto('c1', set('file:///doc/a.jpg'));
    await Promise.all([setPendingPhoto('c2', set('file:///doc/b.jpg')), setPendingPhoto('c3', set('file:///doc/c.jpg'))]);
    expect(await loadPendingPhotos()).toEqual({
      c1: set('file:///doc/a.jpg'),
      c2: set('file:///doc/b.jpg'),
      c3: set('file:///doc/c.jpg'),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/pendingPhotos.test.ts`
Expected: FAIL, cannot resolve `@/data/pendingPhotos`.

- [ ] **Step 3: Write minimal implementation**

Create `src/data/pendingPhotos.ts`:

```ts
/**
 * Which children owe the server a photo. A photo change made while the push is
 * deferred (offline, or a child the server has not seen yet) is recorded here
 * and applied by whichever push claims that child later. Backed by
 * AsyncStorage. Pure persistence only, exactly like `pendingOps`.
 *
 * Its OWN store rather than a field on `Child` or on `PendingOp`, for two
 * reasons that are not stylistic:
 *
 * - `reconcileChildren` replaces a child that has a `serverId` wholesale with
 *   the server's copy on every refresh, so a local-only field on that record
 *   survives only until the next one, which can easily land before the flush.
 * - The op log appends without dedup on purpose (two offline renames are two
 *   renames), so a photo recorded there would upload twice after two offline
 *   photo edits. Keyed by child id, a re-pick overwrites, which is what
 *   re-picking means.
 *
 * Keyed by LOCAL child id, which is safe because those ids do not mutate: a
 * push stamps `serverId` and deliberately leaves `id` alone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** A photo change waiting for a push. Persisted as JSON, so it carries the
 *  durable file path and the two descriptive fields, never the `Blob` or the
 *  `expo-file-system` `File` a `PickedPhoto` holds. */
export type PendingPhoto =
  | { kind: 'set'; uri: string; name: string; type: string }
  | { kind: 'remove' };

const KEY = 'budkin.pendingPhotos.v1';

export async function loadPendingPhotos(): Promise<Record<string, PendingPhoto>> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Record<string, PendingPhoto>) : {};
  } catch {
    return {};
  }
}

async function save(map: Record<string, PendingPhoto>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Mutations run one at a time. Both of them are read-modify-write over a
 * single stored map, and both are fired without being awaited: a save records
 * a photo with `void`, and a flush settles one while the loop continues. Two
 * of those interleaving would each write back the map they read, so the second
 * to finish silently drops the first one's change, and a dropped change here
 * is a lost photo.
 *
 * A re-read at the start of each call, which is all `removePendingOp` does,
 * cannot fix that: both callers re-read, and both read the same map. Only
 * ordering them does.
 */
let mutations: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = mutations.then(work, work);
  // Swallow on the CHAIN only, never on `run`: a caller still sees its own
  // rejection, while a failed mutation does not poison the ones queued behind it.
  mutations = run.catch(() => {});
  return run;
}

/**
 * Record what this child owes the server, replacing anything already recorded
 * for them, and return the replaced record so the caller can discard the file
 * it pointed at.
 */
export async function setPendingPhoto(childId: string, photo: PendingPhoto): Promise<PendingPhoto | undefined> {
  return serialize(async () => {
    const map = await loadPendingPhotos();
    const prev = map[childId];
    map[childId] = photo;
    await save(map);
    return prev;
  });
}

/** Drop one child's record, returning it so its file can be discarded. */
export async function clearPendingPhoto(childId: string): Promise<PendingPhoto | undefined> {
  return serialize(async () => {
    const map = await loadPendingPhotos();
    const prev = map[childId];
    if (prev === undefined) return undefined;
    delete map[childId];
    await save(map);
    return prev;
  });
}

export async function clearPendingPhotos(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/pendingPhotos.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npx eslint .
git add src/data/pendingPhotos.ts src/data/pendingPhotos.test.ts
git commit -m "feat(photos): record which children owe the server a photo"
```

---

### Task 2: The durable copy

The picked file is copied out of Android's evictable cache. The only logic here that vitest can reach is the filename rule, so that lives in its own module and is tested; the native shell around it is kept as thin as possible.

**Files:**
- Create: `src/lib/photoName.ts`, `src/lib/photoName.test.ts`, `src/lib/photoFile.ts`
- Modify: `src/types/models.ts` (the `PickedPhoto` interface, around line 89), `src/lib/photo.ts` (`normalize`, line 40), `src/api/client.test.ts:104` and `:187`

**Interfaces:**
- Consumes: `PendingPhoto` from Task 1 (`photoFile.reopenPhotoFile` takes its `set` shape).
- Produces:
  - `photoFileName(sourceName: string, now: number): string`
  - `persistPhotoFile(uri: string, sourceName: string): Promise<string | undefined>` returns the durable URI, or undefined on web / failure
  - `reopenPhotoFile(stored: { uri: string; name: string; type: string }): PickedPhoto | undefined`
  - `discardPhotoFile(uri: string): Promise<void>`
  - `sweepPhotoFiles(keep: string[]): Promise<void>`
  - `PickedPhoto.durable: boolean`

- [ ] **Step 1: Write the failing test for the filename rule**

Create `src/lib/photoName.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { photoFileName } from '@/lib/photoName';

describe('photoFileName', () => {
  it('names the copy after the moment it was taken, keeping the extension', () => {
    expect(photoFileName('cropped-42.jpg', 1754179200000)).toBe('photo-1754179200000.jpg');
  });

  it('lowercases the extension, so the same picture cannot land under two names', () => {
    expect(photoFileName('IMG_0042.JPEG', 1754179200000)).toBe('photo-1754179200000.jpeg');
  });

  it('falls back to jpg when the source name has no extension', () => {
    expect(photoFileName('image', 1754179200000)).toBe('photo-1754179200000.jpg');
  });

  it('falls back to jpg for a trailing dot, which yields an empty extension', () => {
    expect(photoFileName('image.', 1754179200000)).toBe('photo-1754179200000.jpg');
  });

  it('ignores dots in the name itself and takes only the last segment', () => {
    expect(photoFileName('my.holiday.photo.png', 1754179200000)).toBe('photo-1754179200000.png');
  });

  it('rejects an extension that is not plainly alphanumeric, rather than building a path from it', () => {
    // The source name comes from the picker, not from us. An extension is only
    // ever appended to a path we construct, so anything that is not a short
    // run of letters and digits is refused rather than sanitised.
    expect(photoFileName('evil.../../etc/passwd', 1754179200000)).toBe('photo-1754179200000.jpg');
    expect(photoFileName('x.jp g', 1754179200000)).toBe('photo-1754179200000.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/photoName.test.ts`
Expected: FAIL, cannot resolve `@/lib/photoName`.

- [ ] **Step 3: Write the filename rule**

Create `src/lib/photoName.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/photoName.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add `durable` to `PickedPhoto`**

In `src/types/models.ts`, inside the `PickedPhoto` interface (currently lines 89-95), add the field and extend the doc comment above it:

```ts
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
  file?: Blob;
  nativeFile?: UploadableFile;
  /** True when `uri` points at a copy in the document directory rather than at
   *  the picker's own cache file, so it will still be there after a reboot and
   *  can be uploaded on a later reconnect.
   *
   *  A recorded fact, never inferred from the URI's prefix. This codebase has
   *  been bitten before by deducing a state that should have been written down;
   *  see the note on `heldBack` below. False on web (no document directory, and
   *  the picked URI is a `blob:` that dies on reload) and whenever the copy
   *  failed, which is the one case that still warrants the "photo not saved"
   *  warning. */
  durable: boolean;
}
```

- [ ] **Step 6: Write the native file shell**

Create `src/lib/photoFile.ts`. Verify each API against https://docs.expo.dev/versions/v56.0.0/sdk/filesystem/ before writing it.

```ts
/**
 * The document-directory copy of a picked photo, and its lifecycle.
 *
 * The picker hands back a URI in Android's CACHE directory, which is exactly
 * the place the system reclaims under storage pressure. A photo that has to
 * wait for a reconnect cannot live there, so it is copied here at pick time.
 *
 * Split out of `src/lib/photo.ts` so the store can import the file half without
 * pulling in `expo-image-picker`. Nothing in here can be reached by the node
 * test runner: `expo-file-system`'s `File` and `Directory` are native modules.
 * The one piece of logic that CAN be tested lives in `./photoName`.
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
 * Copy a freshly picked file into the document directory and return the URI of
 * the copy, or undefined when there is no copy to be had (web) or the copy
 * failed. Undefined is a real answer, not an error: the caller reports it as a
 * photo that cannot outlive the moment, and an online save still works.
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
 * Rebuild an uploadable photo from a stored record. Undefined when the file is
 * gone, which the caller treats as "push the child without a photo" rather than
 * as a failure to retry: a document-directory file going missing has no
 * ordinary cause, and retrying cannot bring it back.
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
 * Delete every copy nothing points at any more. Collects the orphans no single
 * call site can: a sheet cancelled after picking, a crash between the copy and
 * the save, a record dropped because its child turned out to be gone
 * server-side.
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
```

- [ ] **Step 7: Copy at pick time**

In `src/lib/photo.ts`, add the import and make `normalize` async. Replace the existing `normalize` (lines 40-48) and its call site in `pickChildPhoto` (line 65):

```ts
import { persistPhotoFile } from '@/lib/photoFile';
```

```ts
/** Normalize the picker's asset, copying the file somewhere it will survive.
 *
 *  The copy happens HERE, at pick time, rather than at save time. It costs one
 *  extra write per pick and orphans a file when the sheet is then cancelled
 *  (which `sweepPhotoFiles` collects at launch), and it buys two things worth
 *  more than that: `saveChild` stays synchronous, in a store where several
 *  shipped bugs have been mid-flight write races, and every path downstream
 *  handles plain serializable data.
 *
 *  It also fixes a case nobody reported: in LOCAL mode the cache URI was the
 *  only copy a photo ever had, so it broke whenever Android reclaimed the file
 *  and there was no server copy to fall back on. */
async function normalize(asset: ImagePicker.ImagePickerAsset): Promise<PickedPhoto> {
  const name = asset.fileName ?? 'photo.jpg';
  const durableUri = await persistPhotoFile(asset.uri, name);
  const uri = durableUri ?? asset.uri;
  return {
    uri,
    name,
    type: asset.mimeType ?? 'image/jpeg',
    file: (asset as { file?: Blob }).file, // web only; undefined on native
    nativeFile: uploadFile(uri),
    durable: durableUri != null,
  };
}
```

And at line 65:

```ts
  return { ok: true, photo: await normalize(result.assets[0]) };
```

- [ ] **Step 8: Fix the two `PickedPhoto` fixtures the new field breaks**

`src/api/client.test.ts:104` gains `durable: true` in the returned object literal. `src/api/client.test.ts:187` becomes:

```ts
    const unreadable: PickedPhoto = { uri: 'file:///cache/gone.jpg', name: 'a.jpg', type: 'image/jpeg', durable: false };
```

- [ ] **Step 9: Run the full suite, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS. The store tests still pass because their photo fixtures are structural literals passed to `saveChild`, not typed as `PickedPhoto`; Task 4 gives them `durable` explicitly.

- [ ] **Step 10: Commit**

```bash
git add src/lib/photoName.ts src/lib/photoName.test.ts src/lib/photoFile.ts src/lib/photo.ts src/types/models.ts src/api/client.test.ts
git commit -m "feat(photos): copy a picked photo somewhere it survives a reboot"
```

---

### Task 3: `pushChild` reports the stored picture

`uploadUnsynced` stamps only `serverId` today, so a child pushed on reconnect keeps the local file path as its `picture` forever. Widening the dep's return is what lets the server's URL replace it. Independent of Tasks 1 and 2 and safe to do in any order before Task 6.

**Files:**
- Modify: `src/data/sync.ts:13-26` (the `UploadDeps` interface), `:38-48` (`tryPush`), `:81-87` (the child loop)
- Test: `src/data/sync.test.ts` (15 `pushChild` sites)

**Interfaces:**
- Consumes: nothing.
- Produces: `UploadDeps.pushChild: (child: Child) => Promise<{ id?: number; picture?: string | null } | undefined>`. `uploadUnsynced` stamps `child.picture` only when the push returned a non-null one.

- [ ] **Step 1: Write the failing test**

Add to `src/data/sync.test.ts`, inside the existing `describe('uploadUnsynced', ...)`:

```ts
  it('stamps the picture the server stored over the local file path', async () => {
    // A child created offline carries a document-directory URI as its picture.
    // The push uploads that file, and the server answers with its own URL,
    // which has to replace the local path or the avatar keeps pointing at a
    // file only this device can read.
    const state: UploadState = {
      children: [child({ id: 'c1', picture: 'file:///doc/childPhotos/photo-1.jpg' })],
      entries: [],
      measurements: [],
    };
    const deps = makeDeps({ pushChild: vi.fn(async () => ({ id: 42, picture: 'https://srv/media/c1.jpg' })) });

    const result = await uploadUnsynced(state, deps);

    expect(result.children[0].serverId).toBe(42);
    expect(result.children[0].picture).toBe('https://srv/media/c1.jpg');
  });

  it('leaves the local picture alone when the push carried no photo', async () => {
    // Only a push that actually uploaded a photo gets an answer about one. A
    // null must never clobber a local path: that is the avatar going blank.
    const state: UploadState = {
      children: [child({ id: 'c1', picture: 'file:///doc/childPhotos/photo-1.jpg' })],
      entries: [],
      measurements: [],
    };
    const deps = makeDeps({ pushChild: vi.fn(async () => ({ id: 42, picture: null })) });

    const result = await uploadUnsynced(state, deps);

    expect(result.children[0].serverId).toBe(42);
    expect(result.children[0].picture).toBe('file:///doc/childPhotos/photo-1.jpg');
  });

  it('leaves a child unsynced when the push returns no id', async () => {
    const state: UploadState = { children: [child({ id: 'c1' })], entries: [], measurements: [] };

    const result = await uploadUnsynced(state, makeDeps({ pushChild: vi.fn(async () => ({ id: undefined })) }));

    expect(result.children[0].serverId).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/sync.test.ts`
Expected: FAIL. Type errors on the new `pushChild` return, and the picture assertions fail because nothing stamps it.

- [ ] **Step 3: Widen the interface and the child loop**

In `src/data/sync.ts`, replace the `pushChild` member of `UploadDeps`:

```ts
  /** POST a child, returning its new server id and, when the push carried a
   *  photo, the picture URL the server stored. Undefined `id` means the push
   *  did not land. The picture is reported because a child pushed on reconnect
   *  still has a device-local file path as its `picture`, which only the server
   *  URL can replace. */
  pushChild: (child: Child) => Promise<{ id?: number; picture?: string | null } | undefined>;
```

Make `tryPush` generic in its return (it is shared with the other three pushers, which keep returning a number):

```ts
async function tryPush<R, T, A extends unknown[]>(
  push: (value: T, ...args: A) => Promise<R | undefined>,
  value: T,
  ...args: A
): Promise<R | undefined> {
  try {
    return await push(value, ...args);
  } catch {
    return undefined;
  }
}
```

Replace the body of the child loop (currently lines 81-87):

```ts
  for (const child of children) {
    if (child.serverId != null || child.expected) continue;
    const res = await tryPush(deps.pushChild, child);
    if (res?.id != null) {
      child.serverId = res.id;
      // `!= null`, so a push that carried no photo (which answers null) cannot
      // blank a local file path. Only a push that uploaded one has anything to
      // say about the picture.
      if (res.picture != null) child.picture = res.picture;
    }
    done++;
    onProgress?.(done, total);
  }
```

- [ ] **Step 4: Update the 15 `pushChild` mock sites**

Every `pushChild: vi.fn(async () => N)` in `src/data/sync.test.ts` becomes `pushChild: vi.fn(async () => ({ id: N }))`, and every `async () => undefined` becomes `async () => undefined` still (an absent result is still valid). The site at line 68 that logs and returns `10` becomes:

```ts
      pushChild: vi.fn(async (c) => {
        log.push(`child:${c.id}`);
        return { id: 10 };
      }),
```

The site at line 232 that throws keeps throwing. Work through the file until `npx tsc --noEmit` is clean; do not change any assertion other than these return shapes.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/sync.test.ts && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/sync.ts src/data/sync.test.ts
git commit -m "feat(sync): let a pushed child report the picture the server stored"
```

---

### Task 4: Record the photo on a deferred save

The recording half. After this task a deferred save writes the record and shows the photo; nothing reads it yet, so the acceptance test still fails. Both existing describe blocks in the store test assert the old drop-it behaviour and are rewritten here.

**Files:**
- Modify: `src/store/useAppStore.ts` (imports; a new `recordPendingPhoto` helper next to `buildUploadDeps` around line 1040; `saveChild`'s edit branch, lines 3051-3136; `saveChild`'s create branch, lines 3138-3207)
- Test: `src/store/useAppStore.test.ts` (new mocks near the existing ones around line 357; the two describe blocks at lines 9750-9844 and 9851-9888)

**Interfaces:**
- Consumes: `setPendingPhoto`, `clearPendingPhoto` (Task 1); `discardPhotoFile` (Task 2); `PickedPhoto.durable` (Task 2).
- Produces: `recordPendingPhoto(childId: string, change: PhotoChange, serverBacked: boolean): Promise<void>`, a module-level helper in `useAppStore.ts`.

- [ ] **Step 1: Add the test mocks**

In `src/store/useAppStore.test.ts`, add to the hoisted `h` object (after `pendingOps` on line 90):

```ts
  pendingPhotos: {} as Record<string, unknown>,
  discardedPhotos: [] as string[],
  sweptKeeps: [] as string[][],
  /** Makes `reopenPhotoFile` report the file as gone, which models the one
   *  failure the document directory can still have. */
  photoFileMissing: false,
```

Add these two mock factories next to the `@/data/pendingOps` one (after line 386):

```ts
vi.mock('@/data/pendingPhotos', () => ({
  loadPendingPhotos: vi.fn(async () => h.pendingPhotos),
  setPendingPhoto: vi.fn(async (childId: string, photo: unknown) => {
    const prev = h.pendingPhotos[childId];
    h.pendingPhotos[childId] = photo;
    return prev;
  }),
  clearPendingPhoto: vi.fn(async (childId: string) => {
    const prev = h.pendingPhotos[childId];
    delete h.pendingPhotos[childId];
    return prev;
  }),
  clearPendingPhotos: vi.fn(async () => {
    h.pendingPhotos = {};
  }),
}));

// The native file layer. Nothing in the node runner can reach the real one, so
// what these tests pin is the CONTRACT: that a deferred save records the
// durable URI, and that a push reopens exactly the URI that was recorded.
vi.mock('@/lib/photoFile', () => ({
  reopenPhotoFile: vi.fn((stored: { uri: string; name: string; type: string }) =>
    h.photoFileMissing
      ? undefined
      : {
          uri: stored.uri,
          name: stored.name,
          type: stored.type,
          durable: true,
          nativeFile: { name: stored.name, type: stored.type, bytes: async () => new Uint8Array() },
        },
  ),
  discardPhotoFile: vi.fn(async (uri: string) => {
    h.discardedPhotos.push(uri);
  }),
  sweepPhotoFiles: vi.fn(async (keep: string[]) => {
    h.sweptKeeps.push(keep);
  }),
}));
```

In the `beforeEach` that clears the other `h` fields (around line 456), add:

```ts
  h.pendingPhotos = {};
  h.discardedPhotos.length = 0;
  h.sweptKeeps.length = 0;
  h.photoFileMissing = false;
```

- [ ] **Step 2: Write the failing tests**

Replace the whole describe block at `src/store/useAppStore.test.ts:9741-9844` (its leading comment included) with:

```ts
// The offline half of the photo story: an edit saved while `offline` records
// `{op:'update', entity:'child'}`, and the photo it carries is recorded
// alongside it in `pendingPhotos` so the replay can upload it. What this suite
// pins is that the record is written, that the picture is applied immediately
// (the file is durable, so there is something real behind the optimistic
// write), and that a photo that could NOT be made durable still says so.
describe('a photo picked while offline is recorded for the replay', () => {
  const BIRTH = NOW - 90 * 86400000;
  const photo = { uri: 'file:///doc/childPhotos/photo-1.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: true };
  const cachePhoto = { uri: 'file:///cache/pick.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: false };
  const offlineChild = () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', slug: 'mira-o', picture: null }],
      selectedChildId: 'c1',
      toast: null,
    });
  };

  it('records the durable photo against the child', async () => {
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(h.pendingPhotos.c1).toEqual({ kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' });
  });

  it('reports a plain "Updated", because the photo is no longer being dropped', async () => {
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(s().toast).toBe('Updated');
  });

  it('shows the photo straight away', async () => {
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(s().children[0].picture).toBe(photo.uri);
  });

  it('still records the rest of the edit as a pending op', async () => {
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Renamed', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(h.pendingOps).toHaveLength(1);
  });

  it('records a removal too, and blanks the picture immediately', async () => {
    offlineChild();
    useAppStore.setState((st) => ({ children: [{ ...st.children[0], picture: 'https://srv/old.jpg' }] }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'remove' } });
    await flush();
    expect(h.pendingPhotos.c1).toEqual({ kind: 'remove' });
    expect(s().toast).toBe('Updated');
    expect(s().children[0].picture).toBeNull();
  });

  it('re-picking overwrites the record and discards the file it replaced', async () => {
    // Ten picks offline must not hold ten files until the next launch.
    const second = { ...photo, uri: 'file:///doc/childPhotos/photo-2.jpg' };
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo: second } });
    await flush();
    expect(h.pendingPhotos.c1).toEqual({ kind: 'set', uri: second.uri, name: 'pick.jpg', type: 'image/jpeg' });
    expect(h.discardedPhotos).toEqual([photo.uri]);
  });

  it('warns, and records nothing, when the photo could not be made durable', async () => {
    // Web, or a copy that failed. The cache URI would be persisted, drawn as
    // the avatar, and then point at nothing once Android reclaimed the file.
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo: cachePhoto } });
    await flush();
    expect(s().toast).toBe('Updated · photo not saved');
    expect(s().children[0].picture).toBeNull();
    expect(h.pendingPhotos).toEqual({});
  });

  it('reports a plain "Updated" when the offline edit carries no photo', async () => {
    offlineChild();
    s().openEditChild('c1');
    s().saveChild({ first: 'Renamed', last: 'O', birth: BIRTH });
    await flush();
    expect(s().toast).toBe('Updated');
    expect(h.pendingPhotos).toEqual({});
  });

  it('records nothing in LOCAL mode, where there is no server to owe a photo to', async () => {
    offlineChild();
    useAppStore.setState({ connection: { mode: 'local' } });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(s().toast).toBe('Updated');
    expect(s().children[0].picture).toBe(photo.uri);
    expect(h.pendingPhotos).toEqual({});
  });

  it('records for a child the server has never seen, even ONLINE', async () => {
    // `BabybuddyClient.updateChild` returns before doing anything when
    // `serverId == null`, so this edit is a server no-op with a full
    // connection. Its photo is deferred exactly like an offline one, and
    // gating the record on `serverId != null` would strand it.
    offlineChild();
    useAppStore.setState((st) => ({
      offline: false,
      children: [{ ...st.children[0], serverId: undefined, slug: undefined }],
    }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(h.pendingPhotos.c1).toEqual({ kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' });
    expect(s().children[0].picture).toBe(photo.uri);
    expect(h.pendingOps).toHaveLength(0); // no op: there is no server row to update
  });

  it('removing a photo from a never-pushed child CLEARS the pending set rather than queueing a removal', async () => {
    // The bug this prevents: pick offline, then remove offline, and a stale
    // `set` record would upload the photo the user just deleted. A create
    // carries no photo anyway, so there is nothing to tell the server.
    offlineChild();
    useAppStore.setState((st) => ({ children: [{ ...st.children[0], serverId: undefined, slug: undefined }] }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'remove' } });
    await flush();
    expect(h.pendingPhotos).toEqual({});
    expect(h.discardedPhotos).toEqual([photo.uri]);
    expect(s().children[0].picture).toBeNull();
  });

  it('records nothing for an online edit of a synced child, whose PATCH carries the photo itself', async () => {
    offlineChild();
    useAppStore.setState({ offline: false });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'set', photo } });
    await flush();
    expect(h.pendingPhotos).toEqual({});
    expect(h.childUpdateChange).toEqual([{ kind: 'set', photo }]);
  });
});
```

Replace the create-side describe block at `src/store/useAppStore.test.ts:9846-9888` with:

```ts
// The CREATE twin of the block above. An offline create is pushed later by
// `flushUnsynced` -> `uploadUnsynced`, and an EXPECTING child is held back even
// with a full connection, so both defer their photo and both record it.
describe('a photo picked while creating a child is recorded when the push is deferred', () => {
  const photo = { uri: 'file:///doc/childPhotos/photo-1.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: true };
  const cachePhoto = { uri: 'file:///cache/pick.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: false };
  const created = () => s().children[s().children.length - 1];

  it('records the photo, reports a plain "Saved", and shows it', async () => {
    useAppStore.setState({ offline: true, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });
    await flush();
    expect(s().toast).toBe('Saved');
    expect(created().picture).toBe(photo.uri);
    expect(h.pendingPhotos[created().id]).toEqual({ kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' });
  });

  it('records an EXPECTING child’s photo even when online, because that child is held back', async () => {
    useAppStore.setState({ offline: false, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, expected: true, photo: { kind: 'set', photo } });
    await flush();
    expect(s().toast).toBe('Saved');
    expect(created().picture).toBe(photo.uri);
    expect(h.pendingPhotos[created().id]).toEqual({ kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' });
    expect(h.childPushed).toHaveLength(0); // held back, as it always was
  });

  it('records nothing for an online create, whose POST carries the photo', () => {
    useAppStore.setState({ offline: false, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });
    expect(s().toast).toBe('Saved');
    expect(created().picture).toBe(photo.uri); // optimistic, until the POST answers
    expect(h.pendingPhotos).toEqual({});
  });

  it('warns, and records nothing, when the photo could not be made durable', async () => {
    useAppStore.setState({ offline: true, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo: cachePhoto } });
    await flush();
    expect(s().toast).toBe('Saved · photo not saved');
    expect(created().picture).toBeNull();
    expect(created().first).toBe('Nova'); // the child itself is still created
    expect(h.pendingPhotos).toEqual({});
  });

  it('records nothing for an offline create in LOCAL mode', async () => {
    useAppStore.setState({ offline: true, connection: { mode: 'local' }, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });
    await flush();
    expect(s().toast).toBe('Saved');
    expect(created().picture).toBe(photo.uri);
    expect(h.pendingPhotos).toEqual({});
  });
});
```

Also update the two remaining photo fixtures elsewhere in the file so they typecheck and keep meaning what they meant: `src/store/useAppStore.test.ts:9440` (`PHOTO`) gains `durable: true`, and the fixture used around line 4175 gains `durable: true`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: FAIL. `h.pendingPhotos` stays empty (nothing records), the toasts still carry the warning suffix, and the offline picture is still null.

- [ ] **Step 4: Add the helper**

In `src/store/useAppStore.ts`, add the imports:

```ts
import { clearPendingPhoto, clearPendingPhotos, loadPendingPhotos, setPendingPhoto } from '@/data/pendingPhotos';
import { discardPhotoFile, reopenPhotoFile, sweepPhotoFiles } from '@/lib/photoFile';
```

(`clearPendingPhotos`, `loadPendingPhotos`, `reopenPhotoFile` and `sweepPhotoFiles` are used by Tasks 5 to 7; add them all now so the import line is written once.)

Add the helper immediately after `buildUploadDeps` (line 1047):

```ts
/**
 * Record what a child owes the server, for a save that will not upload the
 * photo itself. Called only when the change is durable: a cache URI recorded
 * here would name a file Android can reclaim before the reconnect.
 *
 * A removal always REPLACES whatever was recorded, never adds to it. On a
 * server-backed child it becomes `{kind:'remove'}`, because the server has to
 * be told; on a child the server has never seen it clears the record instead,
 * because the create that eventually pushes that child carries no photo
 * anyway. Getting this wrong is a live bug rather than a tidiness point: pick a
 * photo offline, then remove it offline, and a stale `set` would upload the
 * photo the user just deleted.
 *
 * The file a record replaces is discarded here rather than left to the launch
 * sweep, so re-picking ten times offline does not hold ten files.
 */
async function recordPendingPhoto(childId: string, change: PhotoChange, serverBacked: boolean): Promise<void> {
  const prev =
    change.kind === 'set'
      ? await setPendingPhoto(childId, {
          kind: 'set',
          uri: change.photo.uri,
          name: change.photo.name,
          type: change.photo.type,
        })
      : serverBacked
        ? await setPendingPhoto(childId, { kind: 'remove' })
        : await clearPendingPhoto(childId);
  if (prev?.kind === 'set' && !(change.kind === 'set' && change.photo.uri === prev.uri)) {
    await discardPhotoFile(prev.uri);
  }
}
```

- [ ] **Step 5: Rewrite `saveChild`'s edit branch**

In `src/store/useAppStore.ts`, replace the comment block and `photoDropped` line (lines 3052-3074) with:

```ts
      // A photo change is uploaded by this save only when there is a server to
      // send it to, right now, AND a server row to send it to: `updateChild`
      // returns before doing anything when `serverId == null`, so editing a
      // child the server has never seen is a no-op even with a full
      // connection. Every other case defers to a later push, and every deferred
      // case records the photo so that push can carry it.
      //
      // `photoDropped` now means only that the photo could not be made durable
      // (web, or a copy that failed): a cache URI would be persisted, drawn as
      // the avatar, and then point at nothing once Android reclaimed the file.
      // That is the one case still worth warning about. Local mode has no
      // server to owe anything to.
      const conn = s.connection;
      const uploadsNow = conn?.mode === 'server' && !s.offline && existing.serverId != null;
      const deferred = conn?.mode === 'server' && change.kind !== 'none' && !uploadsNow;
      const durable = change.kind === 'remove' || (change.kind === 'set' && change.photo.durable);
      const photoDropped = deferred && !durable;
```

Then, immediately after the `get().showToast(...)` call (line 3091) and before the `if (conn && conn.mode === 'server' && !s.offline) {` block, add:

```ts
      if (deferred && durable) void recordPendingPhoto(child.id, change, existing.serverId != null);
```

Nothing else in the branch changes: the `picture` and toast expressions already read `photoDropped` and now mean the right thing.

- [ ] **Step 6: Rewrite `saveChild`'s create branch**

Replace the comment block and `photoDropped` line (lines 3144-3152) with:

```ts
    // The create twin of the edit branch. A create uploads its photo on its own
    // POST only when online AND not expecting: an expected child holds a DUE
    // date the server cannot accept as a birth_date, so it is held back until
    // `confirmBirth` and its photo has to wait with it. Everything deferred is
    // recorded below so the eventual push can carry it, and `photoDropped`
    // again means only "could not be made durable".
    const photoDropped = change.kind === 'set' && conn?.mode === 'server' && !change.photo.durable && (s.offline || !!fields.expected);
    const deferredPhoto =
      change.kind === 'set' && conn?.mode === 'server' && change.photo.durable && (s.offline || !!fields.expected);
```

Then, immediately after the `get().showToast(...)` call (line 3173), add:

```ts
    // `false`: this child has no server row yet, so a removal has nothing to
    // tell the server (see `recordPendingPhoto`). Only a set reaches here.
    if (deferredPhoto) void recordPendingPhoto(localId, change, false);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(photos): record a deferred photo instead of apologising for it"
```

---

### Task 5: The op replay uploads the recorded photo

**Files:**
- Modify: `src/store/useAppStore.ts` (two new helpers next to `recordPendingPhoto`; `flushPendingOps`'s child branch, lines 2732-2762; the op removal at line 2811)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `loadPendingPhotos`, `clearPendingPhoto` (Task 1); `reopenPhotoFile`, `discardPhotoFile` (Task 2).
- Produces: `pendingPhotoChange(childId: string): Promise<PhotoChange>` and `settlePendingPhoto(childId: string): Promise<void>`, module-level helpers in `useAppStore.ts`, both reused by Task 6.

- [ ] **Step 1: Write the failing tests**

Add a new describe block after the one Task 4 rewrote:

```ts
describe('the op replay uploads the photo recorded with it', () => {
  const BIRTH = NOW - 90 * 86400000;
  const photo = { uri: 'file:///doc/childPhotos/photo-1.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: true };
  const offlineEdit = (change: PhotoChange) => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', slug: 'mira-o', picture: null }],
      selectedChildId: 'c1',
      toast: null,
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: change });
  };

  it('sends the photo on the replayed PATCH', async () => {
    offlineEdit({ kind: 'set', photo });
    await flush();
    useAppStore.setState({ offline: false });

    await s().flushPendingOps();

    expect(h.childUpdateChange).toEqual([{ kind: 'set', photo: expect.objectContaining({ uri: photo.uri }) }]);
  });

  it('swaps the local file path for the URL the server stored', async () => {
    offlineEdit({ kind: 'set', photo });
    await flush();
    useAppStore.setState({ offline: false });

    await s().flushPendingOps();

    expect(s().children[0].picture).toBe(SERVER_PIC);
  });

  it('clears the record and discards the file once it has landed', async () => {
    offlineEdit({ kind: 'set', photo });
    await flush();
    useAppStore.setState({ offline: false });

    await s().flushPendingOps();

    expect(h.pendingPhotos).toEqual({});
    expect(h.discardedPhotos).toEqual([photo.uri]);
  });

  it('replays a recorded removal, and takes the server’s null', async () => {
    useAppStore.setState({
      offline: true,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', slug: 'mira-o', picture: 'https://srv/old.jpg' }],
      selectedChildId: 'c1',
    });
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: 'O', birth: BIRTH, photo: { kind: 'remove' } });
    await flush();
    useAppStore.setState({ offline: false });

    await s().flushPendingOps();

    expect(h.childUpdateChange).toEqual([{ kind: 'remove' }]);
    expect(s().children[0].picture).toBeNull();
    expect(h.pendingPhotos).toEqual({});
  });

  it('keeps the record when the replay fails, so the next flush retries it', async () => {
    offlineEdit({ kind: 'set', photo });
    await flush();
    useAppStore.setState({ offline: false });
    vi.mocked(updateChildOnServer).mockRejectedValueOnce(new Error('net'));

    await s().flushPendingOps();

    expect(h.pendingPhotos.c1).toEqual({ kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' });
    expect(h.discardedPhotos).toEqual([]);
    expect(h.pendingOps).toHaveLength(1); // the op is kept too
  });

  it('drops the record when the child is gone server-side (404)', async () => {
    // Terminal for the op, and terminal for the photo: nothing will ever accept
    // it. Leaving the record would keep the file forever.
    offlineEdit({ kind: 'set', photo });
    await flush();
    useAppStore.setState({ offline: false });
    vi.mocked(updateChildOnServer).mockRejectedValueOnce(new ApiError(404, 'gone'));

    await s().flushPendingOps();

    expect(h.pendingPhotos).toEqual({});
    expect(h.discardedPhotos).toEqual([photo.uri]);
    expect(h.pendingOps).toHaveLength(0);
  });

  it('sends the child without a photo when the file has gone missing, and stops asking', async () => {
    offlineEdit({ kind: 'set', photo });
    await flush();
    useAppStore.setState({ offline: false });
    h.photoFileMissing = true;

    await s().flushPendingOps();

    expect(h.childUpdateChange).toEqual([{ kind: 'none' }]);
    expect(h.childUpdated).toHaveLength(1); // the name and birthday still land
    expect(h.pendingPhotos).toEqual({});
  });
});
```

`ApiError` and `updateChildOnServer` are already imported by this test file; `PhotoChange` may need adding to the `@/types/models` type import at the top.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'the op replay uploads'`
Expected: FAIL. `h.childUpdateChange` is `[undefined]`: the replay sends no photo.

- [ ] **Step 3: Add the two helpers**

In `src/store/useAppStore.ts`, immediately after `recordPendingPhoto`:

```ts
/**
 * The PhotoChange a deferred push should carry for this child, reopened from
 * the recorded path. `{kind:'none'}` when nothing is owed.
 *
 * A recorded `set` whose file has gone missing also answers `{kind:'none'}`,
 * and drops the record on the way out: pushing the child without the photo at
 * least lands the name and birthday, and no retry can bring the file back. A
 * document-directory file going missing has no ordinary cause, which is why
 * this is silent rather than a toast.
 */
async function pendingPhotoChange(childId: string): Promise<PhotoChange> {
  const rec = (await loadPendingPhotos())[childId];
  if (rec == null) return { kind: 'none' };
  if (rec.kind === 'remove') return { kind: 'remove' };
  const photo = reopenPhotoFile(rec);
  if (!photo) {
    await settlePendingPhoto(childId);
    return { kind: 'none' };
  }
  return { kind: 'set', photo };
}

/** Finished with this child's pending photo: drop the record and the file.
 *  Called only where the answer is final, a confirmed upload or a target that
 *  is gone server-side, never on a retryable failure. */
async function settlePendingPhoto(childId: string): Promise<void> {
  const gone = await clearPendingPhoto(childId);
  if (gone?.kind === 'set') await discardPhotoFile(gone.uri);
}
```

- [ ] **Step 4: Carry the photo through the replay**

In `flushPendingOps`, replace lines 2744-2754 (from `const res = await updateChildOnServer` through the closing brace of the `if (slug)` block) with:

```ts
            // The photo recorded alongside this op, if any. Reopened from the
            // document directory, which is why it is still there: the file the
            // picker handed back lived in Android's evictable cache.
            const change = await pendingPhotoChange(op.payload.id);
            const res = await updateChildOnServer(conn, payload, change);
            // A replayed rename moves the slug server-side, and the child
            // endpoints are keyed by it, so re-stamp it here the same way
            // saveChild's online edit does. Otherwise the next delete goes out
            // with a stale slug, 404s, and the child comes back. The picture is
            // stamped in the same pass: until now this child's `picture` has
            // been a device-local file path that only this device can read.
            const slug = res?.slug;
            if (slug || change.kind !== 'none') {
              set((st) => ({
                children: st.children.map((c) => {
                  if (c.id !== op.payload.id) return c;
                  const next = slug ? { ...c, slug } : c;
                  if (change.kind === 'none') return next;
                  // On a remove, `null` IS the answer and must be kept; on a
                  // set it means the server stored nothing, and taking it would
                  // throw away the only copy the device still has. Same rule as
                  // saveChild's online edit.
                  const picture = change.kind === 'remove' ? (res?.picture ?? null) : (res?.picture ?? c.picture);
                  return { ...next, picture };
                }),
              }));
            }
```

- [ ] **Step 5: Settle the photo where the op is dropped**

Immediately before `await removePendingOp(op);` (line 2811), add:

```ts
        // Reached on success and on a terminal 404 alike, and never on a
        // retryable failure (which `continue`s above), which is exactly when
        // this child will never need its pending photo again. A no-op when
        // nothing was recorded.
        if (op.op === 'update' && op.entity === 'child') await settlePendingPhoto(op.payload.id);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(photos): let the op replay carry the photo it was queued with"
```

---

### Task 6: The push paths carry the recorded photo

The two remaining deferred paths: a child pushed by `uploadUnsynced` on reconnect, and an expecting child released by `confirmBirth`.

**Files:**
- Modify: `src/store/useAppStore.ts` (`buildUploadDeps`, lines 1040-1047; `flushUnsynced`'s children merge, lines 2872-2876; `confirmBirth`, lines 3234-3250)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `pendingPhotoChange`, `settlePendingPhoto` (Task 5); the widened `UploadDeps.pushChild` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add a new describe block after Task 5's:

```ts
describe('a deferred push carries the recorded photo', () => {
  const photo = { uri: 'file:///doc/childPhotos/photo-1.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: true };

  it('uploadUnsynced’s pushChild sends it, and settles the record', async () => {
    // `@/data/sync` is mocked in this file, so reach the real dep the store
    // handed it rather than the uploader's behaviour, which Task 3 covers.
    // `mockClear` first: `mock.calls` accumulates across tests in this file.
    useAppStore.setState({ offline: true, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });
    await flush();
    const created = s().children[s().children.length - 1];
    useAppStore.setState({ offline: false });
    vi.mocked(uploadUnsynced).mockClear();

    await s().flushUnsynced();
    const deps = vi.mocked(uploadUnsynced).mock.calls[0][1];
    const res = await deps.pushChild(created);

    expect(h.childPushChange).toEqual([{ kind: 'set', photo: expect.objectContaining({ uri: photo.uri }) }]);
    expect(res).toEqual({ id: 777, picture: SERVER_PIC });
    expect(h.pendingPhotos[created.id]).toBeUndefined();
    expect(h.discardedPhotos).toEqual([photo.uri]);
  });

  it('reports no picture when the child owed none, so a null cannot blank a local path', async () => {
    const plain = { id: 'plain', first: 'A', last: '', birth: NOW, color: '#fff' };
    useAppStore.setState({ offline: false, children: [plain], selectedChildId: 'plain' });
    vi.mocked(uploadUnsynced).mockClear();

    await s().flushUnsynced();
    const deps = vi.mocked(uploadUnsynced).mock.calls[0][1];
    const res = await deps.pushChild(plain);

    expect(h.childPushChange).toEqual([{ kind: 'none' }]);
    expect(res).toEqual({ id: 777, picture: undefined });
  });

  it('keeps the record when the push fails', async () => {
    useAppStore.setState({ offline: true, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });
    await flush();
    const created = s().children[s().children.length - 1];
    useAppStore.setState({ offline: false });
    vi.mocked(uploadUnsynced).mockClear();
    await s().flushUnsynced();
    const deps = vi.mocked(uploadUnsynced).mock.calls[0][1];
    vi.mocked(pushChildToServer).mockRejectedValueOnce(new Error('net'));

    await expect(deps.pushChild(created)).rejects.toThrow();

    expect(h.pendingPhotos[created.id]).toEqual({ kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' });
    expect(h.discardedPhotos).toEqual([]);
  });

  it('confirmBirth carries the photo the expecting child was created with', async () => {
    useAppStore.setState({ offline: false, toast: null });
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, expected: true, photo: { kind: 'set', photo } });
    await flush();
    const localId = s().children[s().children.length - 1].id;

    s().confirmBirth(localId, NOW);
    await flush();

    expect(h.childPushChange).toEqual([{ kind: 'set', photo: expect.objectContaining({ uri: photo.uri }) }]);
    expect(s().children.find((c) => c.id === localId)?.picture).toBe(SERVER_PIC);
    expect(h.pendingPhotos[localId]).toBeUndefined();
    expect(h.discardedPhotos).toEqual([photo.uri]);
  });

  it('flushUnsynced stamps the picture the push reported', async () => {
    useAppStore.setState({
      offline: false,
      children: [{ id: 'c1', first: 'Nova', last: 'O', birth: NOW, color: '#fff', picture: photo.uri }],
    });
    vi.mocked(uploadUnsynced).mockImplementationOnce(async (state) => ({
      children: state.children.map((c) => ({ ...c, serverId: 501, picture: SERVER_PIC })),
      entries: state.entries,
      measurements: state.measurements,
    }));

    await s().flushUnsynced();

    expect(s().children[0].serverId).toBe(501);
    expect(s().children[0].picture).toBe(SERVER_PIC);
  });
});
```

Delete the `buildDepsVia` line from the second test and inline the same two-step pattern the first test uses (call `flushUnsynced`, then read `vi.mocked(uploadUnsynced).mock.calls[0][1]`); it is written out here only once to keep the block readable. `pushChildToServer` and `uploadUnsynced` are already imported by this test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'a deferred push carries'`
Expected: FAIL. `h.childPushChange` is `[undefined]`.

- [ ] **Step 3: Teach `buildUploadDeps` about the record**

Replace `buildUploadDeps` (lines 1040-1047):

```ts
function buildUploadDeps(conn: Connection): UploadDeps {
  return {
    // A child pushed here may owe the server a photo: one picked while offline,
    // or picked for a child the server had never seen. The record is settled
    // only on a push that actually landed, so a failure retries with the photo
    // still attached. The picture is reported back only when one was uploaded,
    // so a `null` from a photoless POST can never blank a local file path.
    pushChild: async (c) => {
      const change = await pendingPhotoChange(c.id);
      const res = await pushChildToServer(conn, c, change);
      if (res?.id != null && change.kind !== 'none') await settlePendingPhoto(c.id);
      return { id: res?.id, picture: change.kind === 'set' ? (res?.picture ?? undefined) : undefined };
    },
    pushEntry: (e, childServerId) => pushEntryToServer(conn, e, childServerId),
    pushMeasurement: (m, childServerId) => pushMeasurementToServer(conn, m, childServerId),
    pushTreatment: (c, childServerId) => pushTreatmentToServer(conn, c, childServerId),
  };
}
```

- [ ] **Step 4: Carry the stamped picture through `flushUnsynced`'s merge**

In `flushUnsynced`, replace the `children:` mapper (lines 2873-2876) with:

```ts
          children: st.children.map((c) => {
            const u = result.children.find((r) => r.id === c.id);
            if (!u || u.serverId == null) return c;
            // The uploader stamps `picture` only for a child whose push
            // actually uploaded a photo, so diff against the PRE-upload
            // snapshot `s` to tell that apart from the copy it always returns.
            // Same technique `syncedCount` above uses.
            const before = s.children.find((r) => r.id === c.id);
            const changed = before != null && u.picture !== before.picture;
            return changed ? { ...c, serverId: u.serverId, picture: u.picture } : { ...c, serverId: u.serverId };
          }),
```

- [ ] **Step 5: Carry the photo through `confirmBirth`**

Replace the push block in `confirmBirth` (lines 3234-3250) with:

```ts
    if (conn && conn.mode === 'server' && !s.offline) {
      void (async () => {
        // An expecting child is held back from the server, so a photo picked
        // for it has been waiting in `pendingPhotos` since it was created, even
        // if the app was online the whole time. This push is its first chance.
        const change = await pendingPhotoChange(id);
        const res = await pushChildToServer(conn, bornChild, change);
        if (!res || res.id == null) return;
        if (change.kind !== 'none') await settlePendingPhoto(id);
        // Stamp the server id, the slug and the server's picture URL, exactly
        // as saveChild's create push does (see the note there on why the local
        // `id` is left alone and why the slug matters).
        set((st) => ({
          children: st.children.map((c) =>
            c.id === id ? { ...c, serverId: res.id, slug: res.slug ?? c.slug, picture: res.picture ?? c.picture } : c,
          ),
        }));
      })().catch(() => {});
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(photos): upload the recorded photo on reconnect and at confirmBirth"
```

---

### Task 7: Lifecycle, so nothing is kept forever

Deleting a child, disconnecting, and the launch sweep that collects what no single call site can.

**Files:**
- Modify: `src/store/useAppStore.ts` (`hydrate`'s three exits, lines 2078, 2095 and 2152; `disconnect`, line 2617; `deleteChild`'s success path)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `clearPendingPhotos`, `loadPendingPhotos` (Task 1); `sweepPhotoFiles` (Task 2); `settlePendingPhoto` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add a new describe block after Task 6's:

```ts
describe('pending photos do not outlive what they belong to', () => {
  const BIRTH = NOW - 90 * 86400000;
  const photo = { uri: 'file:///doc/childPhotos/photo-1.jpg', name: 'pick.jpg', type: 'image/jpeg', durable: true };

  it('deleting a child drops its pending photo and the file', async () => {
    useAppStore.setState({
      offline: false,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', slug: 'mira-o' }],
      selectedChildId: 'c1',
    });
    h.pendingPhotos.c1 = { kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' };

    await s().deleteChild('c1');

    expect(h.pendingPhotos).toEqual({});
    expect(h.discardedPhotos).toEqual([photo.uri]);
  });

  it('keeps the pending photo when the server delete fails and the child comes back', async () => {
    useAppStore.setState({
      offline: false,
      children: [{ id: 'c1', serverId: 501, first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', slug: 'mira-o' }],
      selectedChildId: 'c1',
    });
    h.pendingPhotos.c1 = { kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' };
    h.childDeleteFails = true;

    await s().deleteChild('c1');

    expect(s().children).toHaveLength(1); // restored
    expect(h.pendingPhotos.c1).toBeDefined();
    expect(h.discardedPhotos).toEqual([]);
  });

  it('disconnecting clears every record and sweeps every file', async () => {
    h.pendingPhotos.c1 = { kind: 'set', uri: photo.uri, name: 'pick.jpg', type: 'image/jpeg' };

    s().disconnect();
    await flush();

    expect(h.pendingPhotos).toEqual({});
    expect(h.sweptKeeps).toEqual([[]]);
  });

  it('hydrate sweeps files nothing points at, keeping pictures and pending records', async () => {
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', picture: 'file:///doc/childPhotos/shown.jpg' }],
      entries: [],
      measurements: [],
      selectedChildId: 'c1',
      lastFeed: {},
    });
    h.pendingPhotos.c2 = { kind: 'set', uri: 'file:///doc/childPhotos/waiting.jpg', name: 'p.jpg', type: 'image/jpeg' };

    await s().hydrate();
    await flush();

    expect(h.sweptKeeps).toHaveLength(1);
    expect([...h.sweptKeeps[0]].sort()).toEqual(['file:///doc/childPhotos/shown.jpg', 'file:///doc/childPhotos/waiting.jpg']);
  });

  it('the sweep ignores a picture that is a server URL', async () => {
    vi.mocked(loadConnection).mockResolvedValueOnce({ mode: 'local' });
    vi.mocked(loadEntities).mockResolvedValueOnce({
      children: [{ id: 'c1', first: 'Mira', last: 'O', birth: BIRTH, color: '#fff', picture: 'https://srv/media/c1.jpg' }],
      entries: [],
      measurements: [],
      selectedChildId: 'c1',
      lastFeed: {},
    });

    await s().hydrate();
    await flush();

    expect(h.sweptKeeps).toEqual([[]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts -t 'do not outlive'`
Expected: FAIL, `h.sweptKeeps` is empty and the records survive.

- [ ] **Step 3: Add the sweep helper**

In `src/store/useAppStore.ts`, after `settlePendingPhoto`:

```ts
/**
 * Delete every stored photo file nothing points at any more: neither a child's
 * `picture` nor a pending record. Collects the orphans no single call site can,
 * a sheet cancelled after picking, a crash between the copy and the save, a
 * record dropped because its child turned out to be gone server-side.
 *
 * Only a `file:` picture is a candidate to keep; a server URL names nothing on
 * this device.
 */
async function sweepChildPhotos(children: Child[]): Promise<void> {
  const keep: string[] = [];
  for (const c of children) {
    if (c.picture && c.picture.startsWith('file:')) keep.push(c.picture);
  }
  for (const rec of Object.values(await loadPendingPhotos())) {
    if (rec.kind === 'set') keep.push(rec.uri);
  }
  await sweepPhotoFiles(keep);
}
```

- [ ] **Step 4: Call the sweep at each of `hydrate`'s three exits**

`hydrate` returns from three places. Add the same line before each, so no branch is missed (the no-connection branch has no children but may still hold records, and keeping those files is the point):

Before `return;` at line 2079, before `return;` at line 2096, and before `void get().refresh();` at line 2152:

```ts
    // Collect the photo copies nothing points at any more. Off the critical
    // path: hydrate's contract is "the UI can render".
    void sweepChildPhotos(get().children);
```

- [ ] **Step 5: Clear on disconnect**

In `disconnect`, after `void clearPendingOps();` (line 2617):

```ts
    void clearPendingPhotos();
    void sweepPhotoFiles([]);
```

- [ ] **Step 6: Settle on a completed delete**

In `deleteChild`, the failure branch `return`s at line 3376, so line 3379 is reached only when the delete stuck (or was local-only and never went out). Add the call immediately before that `showToast`:

```ts
    // Only once the delete has stuck. The catch above restores the child and
    // returns, and a restored child still owes the server its photo.
    void settlePendingPhoto(id);
    get().showToast(`${child.first} deleted`);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(photos): stop a pending photo outliving its child or its server"
```

---

### Task 8: Verify on a real device

Nothing above can exercise the actual file copy: `expo-file-system`'s `File` is a native module and vitest runs in node. This is the same class of gap where 0.14.3's bug lived after being flagged and accepted at 0.14.1. **This task is not optional and cannot be completed from the test suite.**

**Files:** none.

- [ ] **Step 1: Confirm the suite is green**

Run: `npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS, with the new tests included.

- [ ] **Step 2: Ask the user to build and run the acceptance test**

The APK build (`eas build --profile preview`) and the on-device run are the user's to trigger. Report that the code is ready and hand them this script:

1. Airplane mode ON.
2. Edit a child, set a new photo, save. The avatar must change immediately and the toast must read `Updated`, with no "photo not saved".
3. Force-quit the app. Reopen it. The avatar must still show the new photo. **This step is the point of the test:** it is what distinguishes a document-directory file from a cache URI that merely has not been reclaimed yet.
4. Airplane mode OFF. Wait for the reconnect flush.
5. Confirm the photo is on the server (check Baby Buddy's own web UI, not just the app).
6. Repeat steps 1 to 5 for a child CREATED offline, and for an expecting child confirmed with `confirmBirth`.

- [ ] **Step 3: Record the outcome**

Do not describe this work as done until step 2 has actually been run and reported. If it passes, write the checkpoint at `docs/superpowers/checkpoints/2026-08-03-offline-photo.md` and tick the item in `docs/superpowers/plans/2026-08-02-multichild-server-data.md:246`.

---

## Notes for the implementer

- **The two rewritten describe blocks are the point, not collateral.** `src/store/useAppStore.test.ts:9741-9888` asserts that the photo IS dropped and that the toast says so. Those assertions are the old behaviour. Rewriting them is the change; do not try to keep them passing.
- **Do not "simplify" `pictureInit` in `src/api/client.ts`.** Native encodes the multipart itself and sends the bytes with its own boundary. The comment there explains that the obvious simplification is exactly the 0.14.3 bug. Nothing in this plan touches that file.
- **`photoDropped` changes meaning, not name.** After Task 4 it means "the photo could not be made durable", not "the photo will be dropped". The `picture` and toast expressions that read it are deliberately left alone.
