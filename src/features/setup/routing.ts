/** Where the connect step goes once a connection is live, server or local. A store with
 *  no children on it yet (a fresh Baby Buddy install, or the empty local store a sign-out
 *  leaves behind) continues into the add-baby step rather than dead-ending the user on an
 *  empty Home. */
export function nextAfterConnect(childCount: number): '/setup/baby' | '/(tabs)' {
  return childCount === 0 ? '/setup/baby' : '/(tabs)';
}
