/** Where the connect step goes once a server connection succeeds. A server with
 *  no children on it yet (a fresh Baby Buddy install) continues into the
 *  add-baby step rather than dead-ending the user on an empty Home. */
export function nextAfterConnect(childCount: number): '/setup/baby' | '/(tabs)' {
  return childCount === 0 ? '/setup/baby' : '/(tabs)';
}
