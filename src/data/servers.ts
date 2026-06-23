/**
 * Saved-server history (server URL + token), persisted via expo-secure-store.
 *
 * Distinct from the single active connection in `storage.ts`: this is the list
 * of servers the user has successfully connected to, surfaced as one-tap retry
 * rows on the onboarding page. Tokens are stored, consistent with how the active
 * token is already stored. All SecureStore calls are guarded so unsupported
 * platforms (e.g. web) degrade to no-ops rather than crashing.
 */

import * as SecureStore from 'expo-secure-store';

import { normalizeServerUrl } from '@/api/client';

export interface SavedServer {
  /** server URL as the user entered it (used for display + reconnect) */
  serverUrl: string;
  /** API token, stored in secure storage */
  token: string;
  /** epoch ms of the last successful connect (most-recent-first ordering) */
  lastUsedAt: number;
}

const KEY = 'babybuddy.servers.v1';

/** Maximum number of servers kept in the history list. */
export const MAX_SERVERS = 6;

export async function loadServers(): Promise<SavedServer[]> {
  try {
    const s = await SecureStore.getItemAsync(KEY);
    if (!s) return [];
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as SavedServer[]) : [];
  } catch {
    return [];
  }
}

export async function persistServers(list: SavedServer[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(list));
  } catch {
    /* unsupported platform — skip persistence */
  }
}

/**
 * Add or refresh a server: dedupe by normalized URL, move it to the front, and
 * cap the list at MAX_SERVERS (dropping the oldest).
 */
export function upsertServer(list: SavedServer[], server: SavedServer): SavedServer[] {
  const key = normalizeServerUrl(server.serverUrl);
  const rest = list.filter((s) => normalizeServerUrl(s.serverUrl) !== key);
  return [server, ...rest].slice(0, MAX_SERVERS);
}

/** Remove the server whose normalized URL matches (no-op if absent). */
export function removeServer(list: SavedServer[], serverUrl: string): SavedServer[] {
  const key = normalizeServerUrl(serverUrl);
  return list.filter((s) => normalizeServerUrl(s.serverUrl) !== key);
}
