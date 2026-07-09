# Child photo — add, change & remove

**Date:** 2026-07-09
**Status:** Approved, ready for planning

## Problem

`Child.picture` already exists in the model (`src/types/models.ts`) and the
`Avatar` component (`src/components/Avatar.tsx`) already renders a real photo
when one is present, falling back to a tinted initial tile otherwise. Photos
also already flow *in* from a connected Baby Buddy server (`listChildren` reads
`c.picture`).

What's missing is any way for a parent to **set, change, or clear** a child's
photo. The Add/Edit child sheet (`src/features/childSwitcher/ChildSheet.tsx`)
only edits first name, last name, and birth date.

## Goal

Let a parent add, replace, or remove a child's photo from the Add/Edit child
sheet, from the **photo library or the camera**, with the photo **uploaded to
Baby Buddy** so it persists and syncs across devices.

## Constraints & context (verified)

- **Baby Buddy accepts `multipart/form-data`** on `/api/children/` (Django REST
  Framework's default parser). The `picture` field is an image file on write and
  a URL string on read. Clearing is done with a PATCH setting `picture: null`.
- **Children are re-fetched wholesale** from the server on every
  `hydrate()`/`refresh()` (`src/data/repository.ts`), and are *not* persisted
  locally. Therefore a photo set only in local state disappears on the next
  refresh when connected — uploading to the server is required for it to stick.
  In **demo/offline** mode the picked photo shows as a local preview only and is
  inherently ephemeral (accepted — demo is a throwaway sandbox).
- **New dependency: `expo-image-picker`** (the version bundled with Expo SDK 56;
  consult https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/ before coding).
  It provides `launchImageLibraryAsync` / `launchCameraAsync`, permission
  request helpers, and returns `{ canceled, assets: [{ uri, mimeType, fileName,
  width, height }] }`.
- Only `expo-image` is currently installed (display only). The API client's
  `request()` currently forces `Content-Type: application/json` on every call.
- There is **no ActionSheet/menu component** in the codebase; nesting a second
  sheet inside the ChildSheet (itself a `BottomSheet`) is awkward.

## Non-goals (YAGNI)

- No separate image-manipulator/resize dependency — the picker's built-in square
  crop + quality compression is sufficient for an avatar.
- No local persistence of demo-mode photos across reloads.
- No multi-photo / gallery; a child has exactly one avatar photo.

---

## Design

### 1. UI — a "Photo" section in `ChildSheet`

Add a new **first section** in the sheet's `ScrollView`, styled like the
existing "First name" / "Birth date" sections:

- A centered **preview** (~84px `Avatar`) showing the pending photo, or the
  tinted initial tile when none is set.
- Below it, a row of compact pill buttons:
  - **Library** (image icon) → pick from the photo library.
  - **Camera** (camera icon) → take a photo. (On web this falls back to the
    system file/capture chooser; acceptable.)
  - **Remove** (trash/x icon) — shown **only when a photo is currently set**.

No nested action sheet — inline buttons are cleaner and behave identically on
web and native. The existing 44px avatar in the header stays as-is for identity
and reflects the pending photo (both read the same local preview state).

### 2. State & data flow (`ChildSheet` `Inner`)

- New local state:
  - `photo: string | null` — the display URI, initialized from
    `editing?.picture ?? null`.
  - `change: PhotoChange` — a discriminated union:
    - `{ kind: 'none' }` (default — unchanged),
    - `{ kind: 'set', photo: PickedPhoto }`,
    - `{ kind: 'remove' }`.
- Library/Camera press → call the picker wrapper; on a non-cancelled result set
  `photo = asset.uri` and `change = { kind: 'set', photo }`.
- Remove press → `photo = null`, `change = { kind: 'remove' }`.
- `onSave` calls the extended
  `saveChild({ first, last, birth, photo: change })`.

`PickedPhoto` is a normalized `{ uri: string; name: string; type: string }`
(defined alongside the picker wrapper) so the store/repository/client never
import expo-image-picker asset types.

### 3. Store (`useAppStore.saveChild`)

Extend the signature to
`saveChild(fields: { first; last; birth; photo: PhotoChange })`.

- **Optimistic local write** of `child.picture`:
  - `set` → the local `photo.uri` (so every `Avatar` updates instantly),
  - `remove` → `null`,
  - `none` → keep `existing?.picture`.
- **Server sync** (only when `conn && !conn.demo && !offline`):
  - Editing an existing child → `updateChildOnServer(conn, child, change)`;
    on success replace the ephemeral local URI with the **durable server
    `picture` URL** returned by the API.
  - Creating a child → `pushChildToServer(conn, child, change)`; on success
    patch the local id → server id (existing behavior) **and** set the returned
    server `picture` URL.

### 4. API client (`src/api/client.ts`)

- Export a pure builder `childFormData(child, photo: PickedPhoto): FormData`
  with `first_name` / `last_name` / `birth_date` + `picture`. Platform-aware
  picture part:
  - native (`Platform.OS !== 'web'`): append `{ uri, name, type }`,
  - web: `fetch(photo.uri) → Blob`, append the blob with a filename (so the
    builder is `async` on web; keep a sync-testable native path).
- `request()` learns to send `FormData`: when the body is a `FormData`, do **not**
  set `Content-Type` (let `fetch` add the multipart boundary), keeping
  `Authorization`/`Accept`.
- `createChild(child, photo?)`: multipart POST when a photo is set, else the
  current JSON POST. Return `{ id, picture }`.
- `updateChild(child, change)`:
  - `set` → multipart PATCH (includes name/birth + picture); return the updated
    `picture` URL from the response,
  - `remove` → JSON PATCH `{ ...childBody, picture: null }`,
  - `none` → JSON PATCH `childBody` (current behavior).

### 5. Repository (`src/data/repository.ts`)

Thread the `PhotoChange` through the two helpers:

- `pushChildToServer(conn, child, change)` → `client.createChild` returning
  `{ id, picture }`.
- `updateChildOnServer(conn, child, change)` → `client.updateChild` returning
  the updated picture URL.

Demo short-circuits (return `undefined`) stay.

### 6. Picker wrapper (`src/lib/photo.ts`)

`pickChildPhoto(source: 'library' | 'camera'): Promise<PickedPhoto | null>`:

- Request the matching permission (media library / camera); on denial, return
  `null` (caller shows a toast). Web needs no runtime permission.
- Launch with `mediaTypes: 'images'`, `allowsEditing: true`, `aspect: [1, 1]`,
  `quality: 0.7`.
- On a non-cancelled result, normalize the first asset to `PickedPhoto`
  (`name` from `fileName` or a default; `type` from `mimeType` or
  `image/jpeg`).

### 7. Testing

- `src/api/client.test.ts`:
  - `childFormData` produces `first_name`/`last_name`/`birth_date` + a `picture`
    part (native branch, asserting the `{uri,name,type}` file object).
  - `updateChild`'s `remove` path serializes `picture: null` (test the pure
    body-building helper, mirroring the existing `bathToNoteBody` tests — no
    network mocking).
- `src/store/useAppStore.test.ts` (repository helpers already mocked there):
  - `saveChild` with `set` writes `child.picture = uri` optimistically and calls
    the create/update helper with the `PhotoChange`.
  - `remove` clears `child.picture` and passes `{ kind: 'remove' }`.
  - `none` leaves `child.picture` unchanged.
- The native-module picker wrapper (`photo.ts`) is not unit-tested (thin,
  side-effectful); logic worth testing lives in the pure `childFormData`.

## Edge cases

- **Editing a just-created child before its server id lands**: `updateChild`
  no-ops on a non-numeric id (current behavior); the photo stays local until the
  create round-trip patches the id. Rare and self-healing on next refresh.
- **Upload failure**: the optimistic local URI remains visible for the session;
  the next refresh reflects server truth. Errors are swallowed like the existing
  child sync (`.catch(() => {})`), consistent with current behavior.
- **Permission denied**: picker returns `null`; show a brief toast, no state
  change.
