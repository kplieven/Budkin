/**
 * Which children owe the server a photo: a change made while the push is deferred
 * (offline, or a child the server has not seen) is recorded here and applied by
 * whichever push claims that child later. Its OWN store, not a field on `Child` or
 * `PendingOp`, because `reconcileChildren` replaces a synced child wholesale on every
 * refresh and the op log appends without dedup on purpose. Keyed by LOCAL child id,
 * safe because a push stamps `serverId` and leaves `id` alone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Persisted as JSON, so it carries the durable file path, never the `Blob` or the
 *  `expo-file-system` `File` a `PickedPhoto` holds. */
export type PendingPhoto =
  | { kind: 'set'; uri: string; name: string; type: string }
  | { kind: 'remove' };

const KEY = 'budkin.pendingPhotos.v1';

/** Mutations run one at a time: they are read-modify-write over a single stored map
 *  and are fired without being awaited, so two interleaving would each write back the
 *  map they read and the second would drop the first's change, losing a photo. */
let mutations: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = mutations.then(work);
  // Swallow on the CHAIN only, never on `run`, so a caller still sees its own
  // rejection while a future one cannot stall every mutation behind it.
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

/** Returns the replaced record so the caller can discard the file it pointed at. */
export async function setPendingPhoto(childId: string, photo: PendingPhoto): Promise<PendingPhoto | undefined> {
  return serialize(async () => {
    const map = await loadPendingPhotos();
    const prev = map[childId];
    map[childId] = photo;
    await save(map);
    return prev;
  });
}

/** Unconditional: drops whatever is recorded RIGHT NOW. A caller that consumed a
 *  record and then awaited a round trip wants `clearPendingPhotoIf` instead. */
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

/** `uri` alone identifies a `set`: the file name carries the epoch millisecond it
 *  was copied at. */
function sameRecord(a: PendingPhoto, b: PendingPhoto): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'set' && b.kind === 'set' ? a.uri === b.uri : true;
}

/** Drop this child's record only if it is still the one the caller consumed. Every
 *  consumer reads, awaits a round trip, then clears, and an unconditional clear would
 *  destroy a photo recorded in that window. Matched by value, not identity, because
 *  the record makes a round trip through JSON. */
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

/** Serialized with the others: an unserialized wipe can land BETWEEN a mutation's
 *  read and its write, and that write then resurrects the records it removed. */
export async function clearPendingPhotos(): Promise<void> {
  return serialize(async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  });
}
