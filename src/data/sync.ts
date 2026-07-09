/**
 * Pure uploader: pushes locally-created (`serverId == null`) records up to a
 * server in dependency order (children, then their entries/measurements),
 * stamping `serverId` as each push succeeds and remapping child references
 * from local ids to server ids on the wire. No store/network/repository
 * imports — push functions are injected via `deps` so this is fully
 * unit-testable and reusable by both the reconnect-flush and adopt-a-server
 * flows.
 */

import type { Child, Entry, Measurement } from '@/types/models';

export interface UploadDeps {
  /** POST a child, return its new server id (or undefined on failure). */
  pushChild: (child: Child) => Promise<number | undefined>;
  /** POST an entry (whose childId has ALREADY been remapped to the server child id),
   *  return its new server id (or undefined). */
  pushEntry: (entry: Entry) => Promise<number | undefined>;
  /** POST a measurement (childId already remapped), return its new server id. */
  pushMeasurement: (m: Measurement) => Promise<number | undefined>;
}

export interface UploadState {
  children: Child[];
  entries: Entry[];
  measurements: Measurement[];
}

async function tryPush<T>(push: (v: T) => Promise<number | undefined>, value: T): Promise<number | undefined> {
  try {
    return await push(value);
  } catch {
    return undefined;
  }
}

/**
 * Upload every serverId==null record in dependency order (children first, then
 * their entries/measurements), stamping serverId on each success. Idempotent &
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

  const total =
    children.filter((c) => c.serverId == null).length +
    entries.filter((e) => e.serverId == null).length +
    measurements.filter((m) => m.serverId == null).length;
  let done = 0;

  // 1. Children first.
  for (const child of children) {
    if (child.serverId != null) continue;
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
    const id = await tryPush(deps.pushEntry, { ...entry, childId: String(serverChildId) });
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
    const id = await tryPush(deps.pushMeasurement, { ...m, childId: String(serverChildId) });
    if (id != null) m.serverId = id;
    done++;
    onProgress?.(done, total);
  }

  return { children, entries, measurements };
}

/** Find a server child that matches a local child by first name (case-insensitive,
 *  trimmed) AND birth date (same calendar day). Returns the matched server child's
 *  serverId, or null when there's no match. Used by the "upload anyway" override so a
 *  local child is attached to an existing server child instead of duplicated. */
export function matchServerChild(local: Child, serverChildren: Child[]): number | null {
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
