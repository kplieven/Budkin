/**
 * Offline op-log: updates/deletes made to already-synced records while offline
 * are recorded here and replayed to the server on reconnect. Backed by
 * AsyncStorage. Pure persistence only — no dedup/merge logic (that's the
 * store's job later).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActivityType, Child, Treatment, Entry, Measurement, MeasurementKind, Timer } from '@/types/models';

export type PendingOp =
  | { op: 'update'; entity: 'child'; payload: Child }
  | { op: 'update'; entity: 'measurement'; payload: Measurement }
  | { op: 'update'; entity: 'entry'; payload: Entry }
  | { op: 'update'; entity: 'timer'; payload: Timer }
  | { op: 'update'; entity: 'treatment'; payload: Treatment }
  | { op: 'delete'; entity: 'entry'; entryType: ActivityType; serverId: number }
  | { op: 'delete'; entity: 'measurement'; kind: MeasurementKind; serverId: number }
  | { op: 'delete'; entity: 'timer'; serverId: number }
  | { op: 'delete'; entity: 'treatment'; serverId: number };

const KEY = 'budkin.pendingOps.v1';

export async function loadPendingOps(): Promise<PendingOp[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    return s ? (JSON.parse(s) as PendingOp[]) : [];
  } catch {
    return [];
  }
}

export async function savePendingOps(ops: PendingOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    /* ignore */
  }
}

export async function addPendingOp(op: PendingOp): Promise<PendingOp[]> {
  const ops = await loadPendingOps();
  ops.push(op);
  await savePendingOps(ops);
  return ops;
}

/**
 * Remove ONE completed op from the log, by value: the first stored entry whose
 * `JSON.stringify` equals the given op's is dropped, the shortened list is
 * saved, and the remaining ops are returned.
 *
 * Stringify-equality is sound here because of who calls this: a flush run
 * removes the very objects it got from `loadPendingOps`, so both sides of the
 * comparison came out of the same serialize/parse round trip, with identical
 * key order and values. That makes removal work with no persisted-shape change
 * (no id field on `PendingOp`, no migration). Matching only the FIRST
 * occurrence keeps duplicates multiset-correct: two identical offline renames
 * queue two identical ops on purpose, and completing one replay must consume
 * exactly one of them.
 *
 * Re-reads the file instead of overwriting it with a list the caller holds,
 * so an op appended by `addPendingOp` while a flush is mid-run survives the
 * removal rather than being clobbered by the run's stale snapshot.
 */
export async function removePendingOp(op: PendingOp): Promise<PendingOp[]> {
  const ops = await loadPendingOps();
  const key = JSON.stringify(op);
  const idx = ops.findIndex((o) => JSON.stringify(o) === key);
  if (idx === -1) return ops;
  ops.splice(idx, 1);
  await savePendingOps(ops);
  return ops;
}

export async function clearPendingOps(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
