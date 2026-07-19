# Stable child ids

## Goal

Stop a child's `id` changing when it is pushed to Baby Buddy, so the records
that reference it can never be orphaned.

This is the fix for the root cause recorded in
`docs/superpowers/specs/2026-07-19-mutating-child-ids-findings.md`, which the
paused `expecting-child-state` branch surfaced as five distinct data-loss bugs
across six review rounds.

## The invariant

> A child's `id` is assigned once at creation and never changes. `serverId` is
> the only field ever stamped onto it, and `serverId` is the only thing ever
> sent to the server.

Everything below exists to make that true. If identity never changes, no
reference can be orphaned, and no code needs a proxy to work out which records
are "held back" from the server.

## Why the re-key exists today

Worth stating, because it is not arbitrary and the fix has to replace its job.

`loadFromServer` returns children keyed by the server's id (`String(c.id)` in
`src/api/client.ts:417`). `refresh` and `hydrate` then treat that list as the
new truth. If a locally created child kept its local id, it would either vanish
at the next refresh or appear twice.

`saveChild`'s create branch avoids that by rewriting the child's `id` to the
server's id in the push callback, so the next refresh lines up. It also
re-points `selectedChildId`. Its own comment states the reason plainly: the
refresh "replaces `children` wholesale with server data keyed by real ids".
What it never does is rewrite the `childId` on that child's entries and
measurements, which is precisely the defect.

(On the paused `expecting-child-state` branch this block was extracted into a
`pushAndRekeyChild` helper. That branch is not the base for this work, so the
change here is to the inline block in `saveChild`.)

Worth noting as the model to follow: `uploadUnsynced` in `src/data/sync.ts`
already gets this right. It pushes `{ ...entry, childId: String(serverChildId) }`,
a copy with the id remapped for the payload only, and stamps nothing but
`serverId` onto the stored record. Stored state keeps the local `childId`. That
is exactly the discipline this spec generalises.

Entry pushes then compound it: `src/api/client.ts:184` sends
`child: entry.childId` verbatim, which only works because the id was rewritten
to something numeric.

## The three changes

### a. Stop re-keying

`pushAndRekeyChild` keeps stamping `serverId` and adopting the server's picture
URL, and loses its id rewrite and its `selectedChildId` re-point. This is a
deletion, and it is the change that actually fixes the bug.

### b. Reconcile by `serverId` instead of replacing

One new helper replaces the wholesale assignment that made the re-key necessary:

```ts
reconcileChildren(serverChildren: Child[], localChildren: Child[]): Child[]
```

| Case | Behaviour |
|---|---|
| Server child matches a local child by `serverId` | Update in place, KEEP the local `id` |
| Server child with no local match | Add as-is (it never had a local phase, so its server-derived id is already stable) |
| Local child with no `serverId` | Keep (never pushed: an offline creation, or an expecting child) |

Used by `refresh`, `hydrate` and `adopt`, replacing their current
`mergeUnsynced(data.children, ...)` usage for children. It subsumes what
`mergeUnsynced` does for the child case.

Ordering: preserve the server's order for server-known children, and prepend
local-only children, which is where `mergeUnsynced` puts them today. Keeping the
existing order matters so the child switcher does not visibly reshuffle on a
refresh.

### c. Send `serverId`, never `id`

`pushTimerToServer` already takes `childServerId: number` as an explicit
parameter (`src/data/repository.ts:256-259`). Entries and measurements follow
that established precedent:

```ts
pushEntryToServer(conn, entry, childServerId: number)
pushMeasurementToServer(conn, m, childServerId: number)
```

A required parameter means no caller can silently forget, and TypeScript finds
every call site rather than leaving it to a grep.

Each caller resolves the owning child first. **If that child has no `serverId`,
the record is not pushed at all: it is enqueued.** Pushing with an unresolvable
id is what produced the stuck-queue bug, where an entry was rejected by the
server and then retried verbatim forever.

The same rule applies to the update and delete paths for entries and
measurements, not just create.

## What this removes

Once the invariant holds, several things added to the paused branch become dead
and should be deleted on rebase, not carried forward:

- `mergeHeldBackEntries`, added in review round 5.
- The `expected`-keyed and `serverId == null`-keyed guards accumulated across
  rounds 3 to 5, which exist only to protect records from being dropped.

The expecting branch gets smaller as a result. What it keeps is its three sync
guards refusing to push an expected child, because those are about not sending a
due date as a `birth_date`, which remains a real and separate concern.

## Migration

None. The invariant is already satisfied by existing data.

An existing already-pushed child has `id: "501"` and `serverId: 501`.
Reconciliation matches it by `serverId` and keeps `"501"`. A newly created one
has `id: "child1752..."` and `serverId: 501`, takes the same path, and keeps its
local id. Both are stable from here on, so there is nothing to rewrite and no
upgrade step that can go wrong.

Deliberately NOT doing: scanning for and repairing entries already orphaned by
the old re-key. That window was sub-second in practice, so there is little to
find, and a wrong guess would attach an entry to the wrong baby.

## Scope

Children only. Entries and measurements are also effectively re-keyed today, by
being replaced wholesale from server data on refresh, but nothing references
them by id except React keys, so no orphaning is reachable through them. Fixing
identity for them as well would roughly double the work for no currently
reachable bug.

Expected files: `src/api/client.ts`, `src/data/repository.ts`, `src/data/sync.ts`,
`src/store/useAppStore.ts`, plus a new `reconcileChildren` and its tests.

## Testing

The load-bearing test is the one nothing in the codebase has ever had:

> Create an entry against a locally created child. Push the child. Refresh.
> Assert the entry still resolves to that child.

That single test would have caught the entire class. Alongside it:

- `reconcileChildren`, all four cases in the table above, plus an explicit
  no-duplicates assertion when a child is both local-with-serverId and present
  in the server list.
- An entry whose owning child has no `serverId` is enqueued, not pushed.
- `selectedChildId` still points at a real child after a push and after a
  refresh, since the re-point is being removed.
- The six reproduced failures listed in the findings doc, as regressions.

Every test that asserts an id changed after a push is now asserting the bug and
must be inverted rather than deleted, so the new behaviour stays pinned.
