# Mutating child ids: root cause behind the expecting-state bug class

Status: **open problem, no fix attempted.** Written when the `expecting-child-state`
branch was paused. That branch is NOT merged and is not mergeable as it stands.

## Why this document exists

The expecting-child branch triggered five distinct data-loss bugs across six
review rounds. Every one was the same defect wearing a different hat. Five
instance-level fixes each closed one hole and opened the next, which is the
signal that the defect is structural rather than local.

This records the root cause while it is fresh, so the redesign starts from it
rather than rediscovering it.

## The root cause

**A child's `id` mutates, and the records referencing it do not follow.**

When a locally created child is pushed to Baby Buddy, `pushAndRekeyChild`
rewrites that child's `id` from a local string (`child1752...`) to the server's
numeric id, and re-points `selectedChildId`. It does not rewrite the `childId`
carried by that child's entries or measurements.

Everything else follows from that. The moment a child is re-keyed, every record
pointing at it is orphaned: it references an id no child has. Orphans are then
either dropped by whatever next replaces state from server data, or pushed to
the server with an id it rejects and retried forever.

## Why five fixes did not fix it

Each fix protected the held-back records by testing a **proxy** for "the server
does not know about this record":

| Round | Proxy used | Where it expired |
|---|---|---|
| 1, 2 | `serverId == null` | `adopt()` read it as failed work, then dropped the child |
| 3 | `serverId == null` | `refresh()`/`hydrate()` dropped the entries |
| 4 | `expected === true` | entries and measurements clauses were unguarded |
| 5 | `expected === true` | `confirmBirth` clears the flag while re-keying the id, orphaning everything at once |

Both proxies are approximations of the real invariant, which is:

> this record references a child by an id the server does not know

Neither proxy survives the transition that matters. `serverId == null` stops
being true the instant the child is pushed. `expected === true` stops being true
the instant the birth is confirmed, which is the *same action* that re-keys the
id. So the round-5 fix expired at precisely the moment it was needed.

## What the expecting state exposed

Nothing here is caused by the expecting feature. It is caused by the id design.
The feature made it reachable by creating two things that had never existed:

1. A child that deliberately never reaches the server, so it stays local
   indefinitely rather than for the seconds between creation and push.
2. Entries whose only durable home is the entity store, because they are
   neither on the server nor on the retry queue. The spec explicitly encourages
   these (pregnancy notes: scan dates, name shortlists, hospital-bag lists).

Before this branch the window between a local id and its server id was
sub-second and usually empty, so the missing re-key was invisible. The expecting
state stretched that window to weeks and filled it with user-authored content.

## Two ways forward

**A. Complete the re-key.** In the same `set()` that re-keys a child, rewrite
`childId` on that child's entries and measurements. Narrow, and it closes the
known instances. But it keeps mutating ids, so it stays one forgotten call site
away from the next instance, and every future consumer has to know the rule.

**B. Stop mutating ids.** A record's local `id` is assigned once and never
changes. `serverId` is the only thing that ever gets stamped, and it is used
solely when talking to the server. Server responses are reconciled onto the
existing local record rather than replacing its identity.

B removes the class rather than the instances: if identity never changes, no
reference can be orphaned, and no proxy is needed to decide which records are
held back. It is the larger change, touching `pushAndRekeyChild`, `saveChild`,
`adopt`, `refresh`, `hydrate`, `uploadUnsynced`, `matchServerChild`, the retry
queue, and anything keying off `child.id`.

The pause was called to do B properly rather than to keep buying rounds with A.

## Concrete failures observed, for regression tests later

Each was reproduced against real code, not reasoned about:

1. `adopt()` returned `partial` forever with any expecting child, so Connect
   Baby Buddy was a permanent dead end.
2. `adopt()`'s success path dropped the expecting child from state and from
   durable storage, reporting success.
3. Entries logged after a confirmed birth carried the stale local id, were
   rejected, queued forever, and vanished at the next refresh.
4. A nap started from the Android widget and stopped while an expecting child
   was selected was logged against the unborn baby.
5. Pregnancy notes were destroyed by the first refresh after the birth was
   confirmed, at the moment they became keepsakes.
6. `hydrate()`'s network-unreachable branch writes `saveEntries([])`, destroying
   durable entries. Harmless before this branch, because every entry also lived
   on the queue.

Items 1 through 4 have fixes on the branch with mutation-verified tests. Items 5
and 6 are unfixed. All six are worth keeping as regression tests against
whichever design is chosen, because each one survived at least one review round.

## State of the branch

`expecting-child-state`, 21 commits, not merged. 641/641 unit tests, `tsc`
clean, 22/22 end-to-end web checks. Those numbers are not evidence it is safe:
items 5 and 6 are live, and both destroy user data. Do not merge it as a
"mostly working" state.
