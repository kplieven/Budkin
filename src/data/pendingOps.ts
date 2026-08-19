/** Offline op-log: updates and deletes to already-synced records made while offline
 *  are recorded here and replayed on reconnect. Pure persistence, no dedup/merge. */

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

/** Remove ONE completed op by value. Stringify-equality is sound because a flush run
 *  removes the very objects it got from `loadPendingOps`, so both sides came out of
 *  the same serialize/parse round trip with identical key order. Matching only the
 *  FIRST occurrence keeps duplicates multiset-correct: two identical offline renames
 *  are two ops on purpose. Re-reads the file rather than writing back the caller's
 *  list, so an op appended while a flush is mid-run is not clobbered. */
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
