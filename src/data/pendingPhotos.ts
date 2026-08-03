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

/**
 * Mutations run one at a time. They are all read-modify-write over a single
 * stored map, and they are fired without being awaited: a save records a photo
 * with `void`, and a flush settles one while the loop continues. Two of those
 * interleaving would each write back the map they read, so the second to
 * finish silently drops the first one's change, and a dropped change here is a
 * lost photo.
 *
 * A re-read at the start of each call, which is all `removePendingOp` does,
 * cannot fix that: both callers re-read, and both read the same map. Only
 * ordering them does.
 */
let mutations: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = mutations.then(work);
  // Swallow on the CHAIN only, never on `run`, so a caller still sees its own
  // rejection. Nothing in this module can reject today (both helpers swallow),
  // so this guards a future one from stalling every mutation behind it.
  mutations = run.catch(() => {});
  return run;
}

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
 * Record what this child owes the server, replacing anything already recorded
 * for them, and return the replaced record so the caller can discard the file
 * it pointed at.
 *
 * Serialized with the other mutators to prevent concurrent mutations from
 * clobbering each other. See `serialize` above.
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

/**
 * Drop one child's record, returning it so its file can be discarded.
 *
 * Unconditional: it drops whatever is recorded RIGHT NOW, which is what a
 * caller saying "this child is gone" means. A caller that consumed a record
 * and then awaited a round trip wants `clearPendingPhotoIf` instead.
 *
 * Serialized with the other mutators to prevent concurrent mutations from
 * clobbering each other. See `serialize` above.
 */
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

/** Two records naming the same thing. `uri` alone identifies a `set`: the file
 *  name carries the epoch millisecond it was copied at, and `name`/`type`
 *  describe the same file. */
function sameRecord(a: PendingPhoto, b: PendingPhoto): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'set' && b.kind === 'set' ? a.uri === b.uri : true;
}

/**
 * Drop this child's record only if it is still the one the caller consumed,
 * and return it when it was. Every consumer reads the record, awaits a network
 * round trip, then clears: an unconditional clear destroys a photo recorded
 * during that window, which is the one thing this store exists to prevent.
 * Matching on the whole record rather than on identity, since it makes a round
 * trip through JSON.
 *
 * Serialized with the other mutators to prevent concurrent mutations from
 * clobbering each other. See `serialize` above.
 */
export async function clearPendingPhotoIf(childId: string, expected: PendingPhoto): Promise<PendingPhoto | undefined> {
  return serialize(async () => {
    const map = await loadPendingPhotos();
    const prev = map[childId];
    if (prev === undefined || !sameRecord(prev, expected)) return undefined;
    delete map[childId];
    await save(map);
    return prev;
  });
}

/** Drop every record. Serialized with the others: an unserialized wipe can
 *  land BETWEEN a mutation's read and its write, and the mutation then writes
 *  its whole map back, resurrecting records this was called to remove. */
export async function clearPendingPhotos(): Promise<void> {
  return serialize(async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  });
}
