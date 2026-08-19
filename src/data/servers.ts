/**
 * Saved-server history: the list of servers the user has successfully connected
 * to, surfaced as one-tap retry rows on onboarding. Distinct from the single
 * active connection in `storage.ts`. Persistence goes through secureKv
 * (secure-store on native, localStorage on web), which no-ops on unsupported
 * platforms.
 */

import { normalizeServerUrl } from '@/api/client';
import { kvGet, kvSet } from '@/data/secureKv';

export interface SavedServer {
  /** as the user entered it, not normalized: it is displayed back to them */
  serverUrl: string;
  token: string;
  /** epoch ms of the last successful connect (most-recent-first ordering) */
  lastUsedAt: number;
}

const KEY = 'budkin.servers.v1';

export const MAX_SERVERS = 6;

export async function loadServers(): Promise<SavedServer[]> {
  const s = await kvGet(KEY);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as SavedServer[]) : [];
  } catch {
    return [];
  }
}

export async function persistServers(list: SavedServer[]): Promise<void> {
  await kvSet(KEY, JSON.stringify(list));
}

/** Dedupe by NORMALIZED URL, move to the front, cap at MAX_SERVERS. */
export function upsertServer(list: SavedServer[], server: SavedServer): SavedServer[] {
  const key = normalizeServerUrl(server.serverUrl);
  const rest = list.filter((s) => normalizeServerUrl(s.serverUrl) !== key);
  return [server, ...rest].slice(0, MAX_SERVERS);
}

export function removeServer(list: SavedServer[], serverUrl: string): SavedServer[] {
  const key = normalizeServerUrl(serverUrl);
  return list.filter((s) => normalizeServerUrl(s.serverUrl) !== key);
}
