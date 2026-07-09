# Child Photo Add & Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a parent add, replace, or remove a child's photo from the Add/Edit child sheet — from the photo library or camera — with the image uploaded to Baby Buddy so it persists and syncs.

**Architecture:** A thin `expo-image-picker` wrapper (`src/lib/photo.ts`) returns a normalized `PickedPhoto`. The child sheet holds a `PhotoChange` (`none`/`set`/`remove`) and passes it into `saveChild`, which optimistically updates `child.picture` and syncs via the repository → API client. The client uploads `multipart/form-data` (native: RN file descriptor; web: a canvas-resized JPEG blob) and clears with a JSON `PATCH { picture: null }`, then the store swaps the ephemeral local URI for the durable server URL.

**Tech Stack:** Expo SDK 56, React Native 0.85, TypeScript, Zustand store, Baby Buddy REST API (Django REST Framework), Vitest.

## Global Constraints

- **Expo SDK 56** — install native deps with `npx expo install <pkg>` (never hand-pin); consult https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/ before coding the picker.
- **Tested modules must not statically import `react-native`** — vitest runs in a `node` environment with no RN shim (`vitest.config.ts`). `src/api/client.ts`, `src/store/useAppStore.ts`, and `src/data/repository.ts` are imported by tests, so detect web with `typeof document !== 'undefined'`, not `Platform`.
- **Follow existing sheet patterns** — theme tokens from `useTheme()`, `Txt`/`Icon`/`Avatar` components, `isHovered(s)` for hover, `hexA()` for tints. The destructive-action accent is the literal `#E2725B` (matches `LogSheet`/`SwipeableRow`).
- **Verification gates per code task:** `npm test` (vitest), `npm run lint` (`expo lint`), and `npx tsc --noEmit` must all pass before committing.
- **Error handling matches existing child sync** — server failures are swallowed with `.catch(() => {})`; the optimistic local state stands until the next refresh.

## File Structure

- `src/types/models.ts` — **modify**: add `PickedPhoto` and `PhotoChange` types (pure types, no runtime import; shared by client/store/repository/sheet).
- `src/api/client.ts` — **modify**: `childBody` → exported pure fn with `clearPicture`; add `nativePicturePart`, `buildChildForm`, web canvas helper; `request()` FormData support; `createChild`/`updateChild` picture handling.
- `src/data/repository.ts` — **modify**: thread `PhotoChange` through `pushChildToServer`/`updateChildOnServer`.
- `src/store/useAppStore.ts` — **modify**: `saveChild` accepts `photo`, updates `child.picture` optimistically, swaps in server URL.
- `src/lib/photo.ts` — **create**: `pickChildPhoto(source)` picker wrapper + `PickResult`.
- `src/components/Icon.tsx` — **modify**: add `image`, `camera`, `trash` glyphs.
- `src/features/childSwitcher/ChildSheet.tsx` — **modify**: Photo section (preview + Library/Camera/Remove pills) and state.
- `app.json` — **modify**: register `expo-image-picker` plugin with permission strings.
- `package.json` / `package-lock.json` — **modify**: add `expo-image-picker` (via `expo install`).

---

### Task 1: Dependency, permission config, and shared types

**Files:**
- Modify: `package.json`, `package-lock.json` (via `expo install`)
- Modify: `app.json:30-86` (plugins array)
- Modify: `src/types/models.ts:27` (after the `Child` interface)

**Interfaces:**
- Produces:
  - `PickedPhoto = { uri: string; name: string; type: string; file?: Blob }`
  - `PhotoChange = { kind: 'none' } | { kind: 'set'; photo: PickedPhoto } | { kind: 'remove' }`

- [ ] **Step 1: Install the picker (resolves the SDK-56-compatible version)**

Run: `npx expo install expo-image-picker`
Expected: `package.json` gains `"expo-image-picker": "~56.x.x"` and the lockfile updates.

- [ ] **Step 2: Register the plugin with permission strings**

In `app.json`, add this entry to the `expo.plugins` array (e.g. after the `expo-secure-store` line at `app.json:42`):

```json
      [
        "expo-image-picker",
        {
          "photosPermission": "Allow Budkin to access your photos so you can set a child's picture.",
          "cameraPermission": "Allow Budkin to use the camera so you can take a child's picture."
        }
      ],
```

- [ ] **Step 3: Add the shared types**

In `src/types/models.ts`, immediately after the closing `}` of the `Child` interface (line 27), add:

```ts
/** A photo the user picked in the child sheet, normalized off the image-picker
 *  asset so the store / API layer never import expo-image-picker types.
 *  `file` is only populated on web (the raw File the picker exposes) and lets
 *  the upload builder skip a redundant fetch. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
  file?: Blob;
}

/** What to do with a child's photo on save. */
export type PhotoChange =
  | { kind: 'none' }
  | { kind: 'set'; photo: PickedPhoto }
  | { kind: 'remove' };
```

- [ ] **Step 4: Verify nothing broke**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass (new types are unused so far; the picker isn't imported yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json src/types/models.ts
git commit -m "feat(children): add expo-image-picker + PickedPhoto/PhotoChange types"
```

---

### Task 2: API client — picture serialization & multipart upload

**Files:**
- Modify: `src/api/client.ts` (imports at `:12`; `request` at `:199`; `childBody`/`createChild`/`updateChild` at `:250-271`)
- Test: `src/api/client.test.ts`

**Interfaces:**
- Consumes: `PickedPhoto`, `PhotoChange`, `Child` from `@/types/models`; existing `toDateStr`.
- Produces:
  - `childBody(child: Child, clearPicture = false): Record<string, unknown>`
  - `nativePicturePart(photo: PickedPhoto): { uri: string; name: string; type: string }`
  - `BabybuddyClient.createChild(child: Child, photo?: PickedPhoto): Promise<{ id?: number; picture?: string | null }>`
  - `BabybuddyClient.updateChild(child: Child, change?: PhotoChange): Promise<string | null | undefined>` (returns the stored picture URL)

- [ ] **Step 1: Write the failing tests**

Add to `src/api/client.test.ts` (extend the existing imports and add a new `describe`):

```ts
import { bathToNoteBody, childBody, mapProfile, nativePicturePart, noteToBathEntry } from '@/api/client';
import type { BathEntry, Child, PickedPhoto } from '@/types/models';

// birth built via a local Date so toDateStr (local-time) is timezone-stable
const CHILD: Child = { id: '5', first: 'Mira', last: 'Doe', birth: new Date(2025, 0, 15).getTime(), color: '#EC9A66' };

describe('child serialization', () => {
  it('childBody serializes name + birth date, no picture key by default', () => {
    expect(childBody(CHILD)).toEqual({ first_name: 'Mira', last_name: 'Doe', birth_date: '2025-01-15' });
  });

  it('childBody sets picture: null when clearing the photo', () => {
    expect(childBody(CHILD, true)).toEqual({
      first_name: 'Mira',
      last_name: 'Doe',
      birth_date: '2025-01-15',
      picture: null,
    });
  });

  it('nativePicturePart maps a picked photo to the RN file descriptor', () => {
    const photo: PickedPhoto = { uri: 'file:///tmp/a.jpg', name: 'a.jpg', type: 'image/png' };
    expect(nativePicturePart(photo)).toEqual({ uri: 'file:///tmp/a.jpg', name: 'a.jpg', type: 'image/png' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — `childBody`/`nativePicturePart` are not exported.

- [ ] **Step 3: Add the imports and pure helpers**

In `src/api/client.ts`, add `PickedPhoto` and `PhotoChange` to the `import type { … } from '@/types/models'` block (`:12`).

Delete the private method `childBody` (`:250-252`) and add these module-level functions near the other serializers (e.g. just above `export class BabybuddyClient`, `:190`):

```ts
/** JSON body for a child create / PATCH. Pass `clearPicture` to remove the photo. */
export function childBody(child: Child, clearPicture = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: child.first,
    last_name: child.last,
    birth_date: toDateStr(child.birth),
  };
  if (clearPicture) body.picture = null;
  return body;
}

/** The React Native FormData file descriptor for an uploaded picture. */
export function nativePicturePart(photo: PickedPhoto): { uri: string; name: string; type: string } {
  return { uri: photo.uri, name: photo.name, type: photo.type };
}

/** Web only: cover-crop the picked image onto a 512px square canvas and return a
 *  compressed JPEG blob — the web picker has no crop/quality step of its own. */
async function squarePictureBlob(photo: PickedPhoto): Promise<Blob> {
  const srcBlob = photo.file ?? (await fetch(photo.uri).then((r) => r.blob()));
  const bitmap = await createImageBitmap(srcBlob);
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.7),
  );
}

/** Multipart child body including a picture upload. Native appends the picker's
 *  file descriptor; web appends the square-cropped JPEG blob. Web is detected by
 *  the presence of `document` (no `react-native` import — keeps this file
 *  loadable under the node test runner). */
async function buildChildForm(child: Child, photo: PickedPhoto): Promise<FormData> {
  const form = new FormData();
  form.append('first_name', child.first);
  form.append('last_name', child.last);
  form.append('birth_date', toDateStr(child.birth));
  if (typeof document !== 'undefined') {
    form.append('picture', await squarePictureBlob(photo), photo.name);
  } else {
    form.append('picture', nativePicturePart(photo) as unknown as Blob);
  }
  return form;
}
```

- [ ] **Step 4: Teach `request()` to send FormData**

In `request()` (`:199`), replace the `fetch` headers block so a `FormData` body keeps its auto-generated `multipart/form-data; boundary=…` header:

```ts
      const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
      res = await fetch(`${this.apiBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Token ${this.token}`,
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
          ...(init?.headers ?? {}),
        },
      });
```

- [ ] **Step 5: Update `createChild` and `updateChild`**

Replace the `createChild`/`updateChild` methods (`:254-271`) with:

```ts
  /** Create a child on the server; uploads a picture when provided. Returns the
   *  new server id and the stored picture URL. */
  async createChild(child: Child, photo?: PickedPhoto): Promise<{ id?: number; picture?: string | null }> {
    const init: RequestInit = photo
      ? { method: 'POST', body: await buildChildForm(child, photo) }
      : { method: 'POST', body: JSON.stringify(childBody(child)) };
    const res = await this.request<{ id?: number; picture?: string | null }>('/children/', init);
    return { id: res?.id, picture: res?.picture ?? null };
  }

  /** Update a child (requires a numeric id). Applies the photo change and returns
   *  the stored picture URL (null when cleared/absent, undefined when skipped). */
  async updateChild(child: Child, change: PhotoChange = { kind: 'none' }): Promise<string | null | undefined> {
    const id = Number(child.id);
    if (!Number.isFinite(id)) return undefined;
    const init: RequestInit =
      change.kind === 'set'
        ? { method: 'PATCH', body: await buildChildForm(child, change.photo) }
        : { method: 'PATCH', body: JSON.stringify(childBody(child, change.kind === 'remove')) };
    const res = await this.request<{ picture?: string | null }>(`/children/${id}/`, init);
    return res?.picture ?? null;
  }
```

- [ ] **Step 6: Run tests + gates**

Run: `npm test -- src/api/client.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS (new child-serialization tests green; repository still compiles because its call sites change in Task 3 — if `tsc` flags `pushChildToServer`/`updateChildOnServer` here, that's expected and fixed in Task 3; run the full gate at the end of Task 3).

Note: `createChild` now returns an object, so `src/data/repository.ts:153` will type-error until Task 3. Commit this task together with Task 3's repository change if you want a green `tsc` at every commit; otherwise proceed directly to Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(api): child picture serialization + multipart upload/clear"
```

---

### Task 3: Repository passthrough + store `saveChild(photo)`

**Files:**
- Modify: `src/data/repository.ts:150-160`
- Modify: `src/store/useAppStore.ts` (`saveChild` type at `:145`; import at `:46-56`; body at `:571-625`)
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `childBody`-based `createChild`/`updateChild` from Task 2; `PhotoChange` from `@/types/models`.
- Produces:
  - `pushChildToServer(conn, child, change?): Promise<{ id?: number; picture?: string | null } | undefined>`
  - `updateChildOnServer(conn, child, change?): Promise<string | null | undefined>`
  - `saveChild(fields: { first; last; birth; photo?: PhotoChange }): void`

- [ ] **Step 1: Update the repository helpers**

In `src/data/repository.ts`, add `PhotoChange` to the `@/types/models` import block, then replace `pushChildToServer`/`updateChildOnServer` (`:150-160`):

```ts
/** Push a newly created child (with an optional photo); returns the new server
 *  id and stored picture URL. */
export async function pushChildToServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<{ id?: number; picture?: string | null } | undefined> {
  if (conn.demo) return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.createChild(child, change.kind === 'set' ? change.photo : undefined);
}

/** Update a child (name/birth and photo change); returns the stored picture URL. */
export async function updateChildOnServer(
  conn: Connection,
  child: Child,
  change: PhotoChange = { kind: 'none' },
): Promise<string | null | undefined> {
  if (conn.demo) return undefined;
  const client = new BabybuddyClient(conn.serverUrl, conn.token);
  return client.updateChild(child, change);
}
```

- [ ] **Step 2: Write the failing store tests**

In `src/store/useAppStore.test.ts`:

(a) Add two capture arrays to the `h` object (after `childUpdated` at `:25`):

```ts
  childPushChange: [] as unknown[],
  childUpdateChange: [] as unknown[],
```

(b) Reset them in `beforeEach` (next to `h.childPushed = []` at `:141-142`):

```ts
  h.childPushChange = [];
  h.childUpdateChange = [];
```

(c) Replace the `pushChildToServer`/`updateChildOnServer` mocks (`:113-119`) with change-aware versions that return realistic shapes:

```ts
  pushChildToServer: vi.fn(async (_c: unknown, child: unknown, change: any) => {
    h.childPushed.push(child);
    h.childPushChange.push(change);
    return { id: 777, picture: change?.kind === 'set' ? SERVER_PIC : null };
  }),
  updateChildOnServer: vi.fn(async (_c: unknown, child: unknown, change: any) => {
    h.childUpdated.push(child);
    h.childUpdateChange.push(change);
    return change?.kind === 'set' ? SERVER_PIC : null;
  }),
```

(d) Add the constant near `NOW` (`:137`):

```ts
const SERVER_PIC = 'https://srv.example/media/child/xyz.jpg';
```

(e) Add these tests inside the `describe('children', …)` block:

```ts
  it('saveChild create with a photo sets picture optimistically, then swaps in the server URL', async () => {
    const photo = { uri: 'file:///tmp/pick.jpg', name: 'pick.jpg', type: 'image/jpeg' };
    s().openAddChild();
    s().saveChild({ first: 'Nova', last: 'O', birth: NOW, photo: { kind: 'set', photo } });

    expect(s().children[1].picture).toBe('file:///tmp/pick.jpg'); // optimistic local URI
    await flush();
    expect(h.childPushChange[0]).toEqual({ kind: 'set', photo });
    expect(s().children[1].picture).toBe(SERVER_PIC); // swapped to durable URL
  });

  it('saveChild edit with a photo swaps the local URI for the server URL', async () => {
    const photo = { uri: 'file:///tmp/e.jpg', name: 'e.jpg', type: 'image/jpeg' };
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW, photo: { kind: 'set', photo } });

    expect(s().children[0].picture).toBe('file:///tmp/e.jpg');
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'set', photo });
    expect(s().children[0].picture).toBe(SERVER_PIC);
  });

  it('saveChild edit with remove clears the picture and passes a remove change', async () => {
    useAppStore.setState((st) => ({ children: st.children.map((c) => ({ ...c, picture: 'file:///old.jpg' })) }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW, photo: { kind: 'remove' } });

    expect(s().children[0].picture).toBeNull();
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'remove' });
  });

  it('saveChild edit with no photo change leaves the existing picture untouched', async () => {
    useAppStore.setState((st) => ({ children: st.children.map((c) => ({ ...c, picture: 'file:///keep.jpg' })) }));
    s().openEditChild('c1');
    s().saveChild({ first: 'Mira', last: '', birth: NOW });

    expect(s().children[0].picture).toBe('file:///keep.jpg');
    await flush();
    expect(h.childUpdateChange[0]).toEqual({ kind: 'none' });
  });
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npm test -- src/store/useAppStore.test.ts`
Expected: FAIL — `saveChild` ignores `photo`; `children[…].picture` is `undefined`.

- [ ] **Step 4: Update the store `saveChild` type and body**

In `src/store/useAppStore.ts`: add `PhotoChange` to the `@/types/models` import block (`:46-56`). Change the action signature (`:145`):

```ts
  saveChild: (fields: { first: string; last: string; birth: number; photo?: PhotoChange }) => void;
```

Replace the `saveChild` implementation (`:571-625`) with:

```ts
  saveChild: (fields) => {
    const s = get();
    const change: PhotoChange = fields.photo ?? { kind: 'none' };
    // Optimistic picture: the local URI on set, null on remove, unchanged on none.
    const pending = change.kind === 'set' ? change.photo.uri : change.kind === 'remove' ? null : undefined;
    const existing = s.editingChildId ? s.children.find((c) => c.id === s.editingChildId) : null;
    if (existing) {
      const child: Child = {
        ...existing,
        first: fields.first,
        last: fields.last,
        birth: fields.birth,
        picture: change.kind === 'none' ? existing.picture : pending,
      };
      set({
        children: s.children.map((c) => (c.id === child.id ? child : c)),
        childSheet: false,
        editingChildId: null,
      });
      get().showToast('Updated');
      const conn = s.connection;
      if (conn && !conn.demo && !s.offline) {
        void updateChildOnServer(conn, child, change)
          .then((url) => {
            // Swap the ephemeral local file URI for the durable server URL.
            if (change.kind === 'none' || url === undefined) return;
            set((st) => ({
              children: st.children.map((c) => (c.id === child.id ? { ...c, picture: url } : c)),
            }));
          })
          .catch(() => {});
      }
      return;
    }
    // Creating: assign a local id + the next tint, optimistically add + auto-select.
    const localId = 'child' + Date.now();
    const child: Child = {
      id: localId,
      first: fields.first,
      last: fields.last,
      birth: fields.birth,
      color: childColor(s.children.length),
      picture: change.kind === 'set' ? change.photo.uri : null,
    };
    set({
      children: [...s.children, child],
      selectedChildId: localId,
      childSheet: false,
      editingChildId: null,
      showChildSwitcher: false,
      insightsLoaded: false,
      insightsEntries: [],
      insightsError: false,
    });
    get().showToast('Saved');
    const conn = s.connection;
    if (conn && !conn.demo && !s.offline) {
      void pushChildToServer(conn, child, change)
        .then((res) => {
          if (!res || res.id == null) return;
          // Patch local id -> server id (kept selected across refresh) and adopt
          // the server picture URL in place of the local file URI.
          set((st) => ({
            children: st.children.map((c) =>
              c.id === localId ? { ...c, id: String(res.id), picture: res.picture ?? c.picture } : c,
            ),
            selectedChildId: st.selectedChildId === localId ? String(res.id) : st.selectedChildId,
          }));
        })
        .catch(() => {});
    }
  },
```

- [ ] **Step 5: Run tests + full gates**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS — new store tests green, all existing child tests still green (they pass no `photo`, so `change` defaults to `{ kind: 'none' }` and `picture` stays `null`/unchanged), and Task 2's client changes now type-check against the updated repository.

- [ ] **Step 6: Commit**

```bash
git add src/data/repository.ts src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(children): thread photo change through saveChild + server sync"
```

---

### Task 4: Photo picker wrapper (`src/lib/photo.ts`)

**Files:**
- Create: `src/lib/photo.ts`

**Interfaces:**
- Consumes: `expo-image-picker`; `PickedPhoto` from `@/types/models`.
- Produces:
  - `PickResult = { ok: true; photo: PickedPhoto } | { ok: false; reason: 'cancelled' | 'denied' }`
  - `pickChildPhoto(source: 'library' | 'camera'): Promise<PickResult>`

- [ ] **Step 1: Create the wrapper**

Create `src/lib/photo.ts`:

```ts
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
```

- [ ] **Step 2: Verify types + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. If `tsc` rejects `mediaTypes: ['images']`, check the v56 `ImagePickerOptions.mediaTypes` type in the docs and adjust to the accepted form (string vs array) — do not import the deprecated `MediaTypeOptions` enum.

- [ ] **Step 3: Commit**

```bash
git add src/lib/photo.ts
git commit -m "feat(children): expo-image-picker wrapper for child photos"
```

---

### Task 5: Icon glyphs + ChildSheet Photo section

**Files:**
- Modify: `src/components/Icon.tsx:10-36` (type union) and the `switch` (before `:271`)
- Modify: `src/features/childSwitcher/ChildSheet.tsx` (full replacement below)

**Interfaces:**
- Consumes: `pickChildPhoto` (Task 4); `PhotoChange` (Task 1); `saveChild` with `photo` (Task 3).
- Produces: user-facing add/change/remove photo UI.

- [ ] **Step 1: Add three UI icons**

In `src/components/Icon.tsx`, extend the `IconName` union (`:36`, after `| 'edit'`):

```ts
  | 'image'
  | 'camera'
  | 'trash';
```

Add these three cases inside the `switch` (before the closing `}` at `:271`):

```tsx
    case 'image':
      return (
        <Svg {...common}>
          <Rect x={3.5} y={5} width={17} height={14} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
          <Circle cx={9} cy={10} r={1.7} stroke={color} strokeWidth={strokeWidth} />
          <Path d="M4.5 17l4.5-4.5L13 16l2.5-2.5L20 18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'camera':
      return (
        <Svg {...common}>
          <Path
            d="M4 8.6A1.6 1.6 0 0 1 5.6 7h2L8.8 5.2A1 1 0 0 1 9.6 4.7h4.8a1 1 0 0 1 .8.5L16.4 7h2A1.6 1.6 0 0 1 20 8.6v8.8A1.6 1.6 0 0 1 18.4 19H5.6A1.6 1.6 0 0 1 4 17.4z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          <Circle cx={12} cy={13} r={3.3} stroke={color} strokeWidth={strokeWidth} />
        </Svg>
      );
    case 'trash':
      return (
        <Svg {...common}>
          <Path
            d="M5 7h14M10 7V5.6A1.1 1.1 0 0 1 11.1 4.5h1.8A1.1 1.1 0 0 1 14 5.6V7M6.6 7l.8 11a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.4 7"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M10 11v5M14 11v5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );
```

- [ ] **Step 2: Replace `ChildSheet.tsx` with the photo-enabled version**

Replace the entire contents of `src/features/childSwitcher/ChildSheet.tsx` with:

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { pickChildPhoto } from '@/lib/photo';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { Child, PhotoChange } from '@/types/models';

const REMOVE_COLOR = '#E2725B'; // destructive accent, matches LogSheet/SwipeableRow

function midnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid, non-future local date and convert
 *  to epoch ms (local midnight) — no date-picker dependency, just numeric
 *  TextInputs validated on save. */
function clampBirth(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const y = Math.min(now.getFullYear(), Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), midnight());
}

/** A compact icon+label action pill for the photo controls. */
function PhotoPill({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  const t = useTheme();
  const color = tone === 'danger' ? REMOVE_COLOR : t.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 13,
          backgroundColor: t.chip,
          borderWidth: 1.5,
          borderColor: t.line,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: t.line2 },
      ]}
    >
      <Icon name={icon} color={color} size={17} />
      <Txt unselectable weight={700} size={14} color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ChildSheet() {
  const open = useAppStore((s) => s.childSheet);
  const editingId = useAppStore((s) => s.editingChildId);
  if (!open) return null;
  return <Inner key={editingId ?? 'new'} editingId={editingId} />;
}

function Inner({ editingId }: { editingId: string | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const children = useAppStore((s) => s.children);
  const saveChild = useAppStore((s) => s.saveChild);
  const showToast = useAppStore((s) => s.showToast);
  const close = useAppStore((s) => s.closeChildSheet);

  const editing: Child | null = editingId ? (children.find((c) => c.id === editingId) ?? null) : null;
  const editingDate = editing ? new Date(editing.birth) : new Date();

  const [first, setFirst] = useState(editing?.first ?? '');
  const [last, setLast] = useState(editing?.last ?? '');
  const [year, setYear] = useState(String(editingDate.getFullYear()));
  const [month, setMonth] = useState(String(editingDate.getMonth() + 1));
  const [day, setDay] = useState(String(editingDate.getDate()));
  const [photo, setPhoto] = useState<string | null>(editing?.picture ?? null);
  const [photoChange, setPhotoChange] = useState<PhotoChange>({ kind: 'none' });
  const [picking, setPicking] = useState(false);

  const canSave = first.trim().length > 0;
  const previewChild = { first: first.trim() || editing?.first || '?', color: editing?.color ?? t.primary };

  const onPick = async (source: 'library' | 'camera') => {
    if (picking) return;
    setPicking(true);
    try {
      const res = await pickChildPhoto(source);
      if (res.ok) {
        setPhoto(res.photo.uri);
        setPhotoChange({ kind: 'set', photo: res.photo });
      } else if (res.reason === 'denied') {
        showToast(source === 'camera' ? 'Camera permission needed' : 'Photo permission needed');
      }
    } finally {
      setPicking(false);
    }
  };

  const onRemovePhoto = () => {
    setPhoto(null);
    setPhotoChange({ kind: 'remove' });
  };

  const onSave = () => {
    if (!canSave) return;
    const birth = clampBirth(year, month, day);
    saveChild({ first: first.trim(), last: last.trim(), birth, photo: photoChange });
  };

  const inputStyle = {
    height: 52,
    borderRadius: 14,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fontFamily(600),
    color: t.text,
    marginBottom: 16,
  } as const;

  return (
    <BottomSheet onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        {photo || editing ? (
          <Avatar child={{ ...previewChild, picture: photo }} size={44} radius={14} fontSize={18} />
        ) : (
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(t.primary, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" color={t.primary} size={22} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {editingId ? 'Edit child' : 'Add a child'}
          </Txt>
        </View>
        <IconButton name="close" onPress={close} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Photo
        </Txt>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View style={{ marginBottom: 12 }}>
            {photo || first.trim() || editing ? (
              <Avatar child={{ ...previewChild, picture: photo }} size={88} radius={28} fontSize={34} />
            ) : (
              <View style={{ width: 88, height: 88, borderRadius: 28, backgroundColor: hexA(t.primary, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="image" color={t.primary} size={32} />
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <PhotoPill icon="image" label="Library" onPress={() => onPick('library')} />
            <PhotoPill icon="camera" label="Camera" onPress={() => onPick('camera')} />
            {photo ? <PhotoPill icon="trash" label="Remove" tone="danger" onPress={onRemovePhoto} /> : null}
          </View>
        </View>

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          First name
        </Txt>
        <TextInput
          value={first}
          onChangeText={setFirst}
          placeholder="First name"
          placeholderTextColor={t.faint}
          autoFocus={!editing}
          style={inputStyle}
        />

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Last name (optional)
        </Txt>
        <TextInput
          value={last}
          onChangeText={setLast}
          placeholder="Last name"
          placeholderTextColor={t.faint}
          style={inputStyle}
        />

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Birth date
        </Txt>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
          <View style={{ flex: 1.3 }}>
            <Txt weight={600} size={11} color={t.faint} style={{ marginBottom: 5 }}>
              YEAR
            </Txt>
            <TextInput
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="YYYY"
              placeholderTextColor={t.faint}
              style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, fontSize: 16, fontFamily: fontFamily(700), color: t.text, textAlign: 'center' }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight={600} size={11} color={t.faint} style={{ marginBottom: 5 }}>
              MONTH
            </Txt>
            <TextInput
              value={month}
              onChangeText={setMonth}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="MM"
              placeholderTextColor={t.faint}
              style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, fontSize: 16, fontFamily: fontFamily(700), color: t.text, textAlign: 'center' }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight={600} size={11} color={t.faint} style={{ marginBottom: 5 }}>
              DAY
            </Txt>
            <TextInput
              value={day}
              onChangeText={setDay}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="DD"
              placeholderTextColor={t.faint}
              style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, fontSize: 16, fontFamily: fontFamily(700), color: t.text, textAlign: 'center' }}
            />
          </View>
        </View>
        <Txt weight={500} size={12} color={t.faint} style={{ marginBottom: 8 }}>
          Can&apos;t be in the future — out-of-range values are clamped when you save.
        </Txt>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={(s) => [
            {
              flex: 1,
              height: 58,
              borderRadius: 18,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSave ? 1 : 0.5,
              boxShadow: canSave ? `0px 8px 22px ${hexA(t.primary, 0.35)}` : undefined,
              cursor: canSave ? 'pointer' : 'auto',
            },
            canSave && isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(t.primary, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17.5} color={t.onPrimary}>
            {editingId ? 'Save changes' : 'Add child'}
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
```

- [ ] **Step 3: Run gates**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. (`expo lint` enforces the escaped apostrophe already present in the birth-date hint.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Icon.tsx src/features/childSwitcher/ChildSheet.tsx
git commit -m "feat(children): photo section (library/camera/remove) in ChildSheet"
```

---

### Task 6: End-to-end verification

**Files:** none (manual/driven verification).

- [ ] **Step 1: Full test + type + lint sweep**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 2: Drive the web build and exercise the feature**

Use the `verify` skill (or `run` skill) to launch the web app, then:
- Open **Add a child** → the Photo section shows the image placeholder tile and Library/Camera pills.
- Click **Library**, pick an image → the preview and header avatar update immediately; **Remove** appears.
- Fill first name, **Add child** → the new child's avatar shows the photo in the switcher/top bar.
- Open **Edit child** → **Remove** clears back to the initial-letter tile; **Library** replaces it.
- With a real Baby Buddy connection: confirm the upload lands (child's picture persists after a refresh); in demo mode confirm the preview shows without errors.

- [ ] **Step 3: Confirm no uncommitted changes**

Run: `git status`
Expected: clean tree (all work committed in Tasks 1-5).

---

## Self-Review

**Spec coverage:**
- Photo section UI (preview + Library/Camera/Remove) → Task 5. ✅
- Upload to Baby Buddy (multipart) + clear via `picture: null` → Task 2. ✅
- Web canvas resize/crop + web behavior → Task 2 (`squarePictureBlob`, `document`-guarded). ✅
- `PickedPhoto`/`PhotoChange` types → Task 1. ✅
- Optimistic local write + swap to durable server URL → Task 3. ✅
- Library + Camera source, permission handling → Task 4. ✅
- Tests: `childBody`/`nativePicturePart` + `saveChild` set/remove/none → Tasks 2, 3. ✅
- `expo-image-picker` dependency + permission strings → Task 1. ✅

**Type consistency:** `PickedPhoto`/`PhotoChange` (Task 1) are consumed unchanged in Tasks 2-5. `createChild` returns `{ id, picture }` and `updateChild` returns the picture URL (Task 2), matched by `pushChildToServer`/`updateChildOnServer` (Task 3) and by the store's `res.id`/`res.picture`/`url` handling (Task 3). `pickChildPhoto` returns `PickResult` (Task 4), consumed by `onPick` (Task 5). Icon names `image`/`camera`/`trash` added in Task 5 before use. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅
