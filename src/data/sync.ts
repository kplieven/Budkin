/**
 * Pure uploader: pushes locally-created records in dependency order, children before
 * their entries and measurements, stamping `serverId` as each push succeeds and remapping
 * child references from local ids to server ids on the wire. Push functions are injected
 * via `deps`, so both the reconnect-flush and adopt-a-server flows reuse it.
 */

import type { Child, Treatment, Entry, Measurement, ServerChild } from '@/types/models';

export interface UploadDeps {
  /** Undefined `id` means the push did not land. The picture is reported because a child
   *  pushed on reconnect still carries a device-local file path. */
  pushChild: (child: Child) => Promise<{ id?: number; picture?: string | null } | undefined>;
  /** The entry's own `childId` stays local; the server id is passed alongside,
   *  never written into the record. */
  pushEntry: (entry: Entry, childServerId: number) => Promise<number | undefined>;
  pushMeasurement: (m: Measurement, childServerId: number) => Promise<number | undefined>;
  /** A treatment is POSTed as a `treatment`-tagged note. */
  pushTreatment: (treatment: Treatment, childServerId: number) => Promise<number | undefined>;
}

export interface UploadState {
  children: Child[];
  entries: Entry[];
  measurements: Measurement[];
  /** Callers pass only the slice they want uploaded, so an absent `treatments`
   *  means "none to push here", not "this state has none". */
  treatments?: Treatment[];
}

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

/**
 * Idempotent and resumable: records that already have a serverId are skipped, and a push
 * that returns undefined or throws leaves that record at serverId==null without aborting
 * the rest. `childId` in the returned state stays LOCAL: the remap applies only to the
 * payload sent to pushEntry/pushMeasurement, never written back.
 */
export async function uploadUnsynced(
  state: UploadState,
  deps: UploadDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadState> {
  // Copies throughout: never mutate the caller's arrays/objects.
  const children = state.children.map((c) => ({ ...c }));
  const entries = state.entries.map((e) => ({ ...e }));
  const measurements = state.measurements.map((m) => ({ ...m }));
  const treatments = (state.treatments ?? []).map((c) => ({ ...c }));

  const total =
    children.filter((c) => c.serverId == null && !c.expected).length +
    entries.filter((e) => e.serverId == null).length +
    measurements.filter((m) => m.serverId == null).length +
    treatments.filter((c) => c.serverId == null).length;
  let done = 0;

  // 1. Children first. An expected child holds a DUE date in `birth`, not a valid
  // birth_date for the server, so it stays local until confirmBirth.
  for (const child of children) {
    if (child.serverId != null || child.expected) continue;
    const res = await tryPush(deps.pushChild, child);
    if (res?.id != null) {
      child.serverId = res.id;
      // `!= null`, so a push that carried no photo cannot blank a local file path.
      if (res.picture != null) child.picture = res.picture;
    }
    done++;
    onProgress?.(done, total);
  }

  // 2. Local id to server id, covering freshly-uploaded and already-synced children.
  const childIdMap = new Map<string, number>();
  for (const child of children) {
    if (child.serverId != null) childIdMap.set(child.id, child.serverId);
  }

  // 3. Entries: remap childId before pushing, and skip but still count entries whose
  // parent is not synced.
  for (const entry of entries) {
    if (entry.serverId != null) continue;
    const serverChildId = childIdMap.get(entry.childId);
    if (serverChildId == null) {
      done++;
      onProgress?.(done, total);
      continue;
    }
    const id = await tryPush(deps.pushEntry, entry, serverChildId);
    if (id != null) entry.serverId = id;
    done++;
    onProgress?.(done, total);
  }

  // 4. Measurements: same as entries.
  for (const m of measurements) {
    if (m.serverId != null) continue;
    const serverChildId = childIdMap.get(m.childId);
    if (serverChildId == null) {
      done++;
      onProgress?.(done, total);
      continue;
    }
    const id = await tryPush(deps.pushMeasurement, m, serverChildId);
    if (id != null) m.serverId = id;
    done++;
    onProgress?.(done, total);
  }

  // 5. Treatments: same as entries.
  for (const c of treatments) {
    if (c.serverId != null) continue;
    const serverChildId = childIdMap.get(c.childId);
    if (serverChildId == null) {
      done++;
      onProgress?.(done, total);
      continue;
    }
    const id = await tryPush(deps.pushTreatment, c, serverChildId);
    if (id != null) c.serverId = id;
    done++;
    onProgress?.(done, total);
  }

  return { children, entries, measurements, treatments };
}

/** First name and birth date must both match. Used by the "upload anyway" override so a
 *  local child attaches to an existing server child instead of duplicating it. */
export function matchServerChild(local: Child, serverChildren: ServerChild[]): number | null {
  // An expected child must not adopt a server row: its `birth` is a due date,
  // so a name-and-birthday match would be a coincidence, not the same child.
  if (local.expected) return null;

  const norm = (s: string) => s.trim().toLowerCase();
  const sameDay = (a: number, b: number) => {
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear()
      && da.getMonth() === db.getMonth()
      && da.getDate() === db.getDate();
  };
  const match = serverChildren.find(
    (c) => norm(c.first) === norm(local.first) && sameDay(c.birth, local.birth),
  );
  return match?.serverId ?? null;
}
