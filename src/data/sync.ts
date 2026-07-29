/**
 * Pure uploader: pushes locally-created (`serverId == null`) records up to a
 * server in dependency order (children, then their entries/measurements),
 * stamping `serverId` as each push succeeds and remapping child references
 * from local ids to server ids on the wire. No store/network/repository
 * imports — push functions are injected via `deps` so this is fully
 * unit-testable and reusable by both the reconnect-flush and adopt-a-server
 * flows.
 */

import type { Child, Treatment, Entry, Measurement } from '@/types/models';

export interface UploadDeps {
  /** POST a child, return its new server id (or undefined on failure). */
  pushChild: (child: Child) => Promise<number | undefined>;
  /** POST an entry, given the server id of its owning child, return its new
   *  server id (or undefined). The entry's own `childId` stays local; the
   *  server id is passed alongside, never written into the record. */
  pushEntry: (entry: Entry, childServerId: number) => Promise<number | undefined>;
  /** POST a measurement, given the server id of its owning child, return its
   *  new server id. */
  pushMeasurement: (m: Measurement, childServerId: number) => Promise<number | undefined>;
  /** POST a treatment (as a `treatment`-tagged note), given the server id of its owning
   *  child, return its new server id. */
  pushTreatment: (treatment: Treatment, childServerId: number) => Promise<number | undefined>;
}

export interface UploadState {
  children: Child[];
  entries: Entry[];
  measurements: Measurement[];
  /** Optional: callers pass only the slice they want uploaded (`flushUnsynced`
   *  hands over just the held-back entries, for instance), so an absent `treatments`
   *  means "no treatments to push here", not "this state has none". */
  treatments?: Treatment[];
}

async function tryPush<T, A extends unknown[]>(
  push: (value: T, ...args: A) => Promise<number | undefined>,
  value: T,
  ...args: A
): Promise<number | undefined> {
  try {
    return await push(value, ...args);
  } catch {
    return undefined;
  }
}

/**
 * Upload every serverId==null record in dependency order (children first, then
 * their entries/measurements/treatments), stamping serverId on each success. Idempotent &
 * resumable: records that already have a serverId are skipped; a push that
 * returns undefined / throws leaves that record serverId==null and does not
 * abort the rest. onProgress(done,total) is called after each attempted push.
 * Returns a new UploadState with serverId stamped on succeeded records (childId
 * in the returned state stays LOCAL — the remap is applied only to the payload
 * sent to pushEntry/pushMeasurement, never written back).
 */
export async function uploadUnsynced(
  state: UploadState,
  deps: UploadDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadState> {
  // Work on copies throughout — never mutate the caller's arrays/objects.
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

  // 1. Children first.
  // An expected child holds a DUE date in `birth`, which is not a valid
  // birth_date for the server. It stays local until confirmBirth releases it.
  for (const child of children) {
    if (child.serverId != null || child.expected) continue;
    const id = await tryPush(deps.pushChild, child);
    if (id != null) child.serverId = id;
    done++;
    onProgress?.(done, total);
  }

  // 2. Local id -> server id map, covering both freshly-uploaded children and
  // already-synced ones (whose id/serverId were already aligned on load).
  const childIdMap = new Map<string, number>();
  for (const child of children) {
    if (child.serverId != null) childIdMap.set(child.id, child.serverId);
  }

  // 3. Entries: remap childId to the server id before pushing; skip (but still
  // count) entries whose parent isn't synced.
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

  // 5. Treatments: same as entries. A treatment belonging to an unsynced child (an
  //    expected one, say) stays local until that child reaches the server.
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

/** Find a server child that matches a local child by first name (case-insensitive,
 *  trimmed) AND birth date (same calendar day). Returns the matched server child's
 *  serverId, or null when there's no match. Used by the "upload anyway" override so a
 *  local child is attached to an existing server child instead of duplicated. */
export function matchServerChild(local: Child, serverChildren: Child[]): number | null {
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
