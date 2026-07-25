/**
 * Offline op-log: updates/deletes made to already-synced records while offline
 * are recorded here and replayed to the server on reconnect. Backed by
 * AsyncStorage. Pure persistence only — no dedup/merge logic (that's the
 * store's job later).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActivityType, Child, Cure, Entry, Measurement, MeasurementKind, Timer } from '@/types/models';

export type PendingOp =
  | { op: 'update'; entity: 'child'; payload: Child }
  | { op: 'update'; entity: 'measurement'; payload: Measurement }
  | { op: 'update'; entity: 'entry'; payload: Entry }
  | { op: 'update'; entity: 'timer'; payload: Timer }
  | { op: 'update'; entity: 'cure'; payload: Cure }
  | { op: 'delete'; entity: 'entry'; entryType: ActivityType; serverId: number }
  | { op: 'delete'; entity: 'measurement'; kind: MeasurementKind; serverId: number }
  | { op: 'delete'; entity: 'timer'; serverId: number }
  | { op: 'delete'; entity: 'cure'; serverId: number };

const KEY = 'babybuddy.pendingOps.v1';

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

export async function clearPendingOps(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
