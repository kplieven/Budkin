/**
 * Serialize a running Timer's structural fields into (and out of) the one
 * free-form field a Baby Buddy timer exposes: `name`. `child` and `start` ride
 * natively on the BB timer, so `name` carries only the fields that shape the
 * committed entry: saveAs (as the leading human label), feed type, method,
 * start side, nap flag, and amount. Freeform notes/tags and the tummy milestone
 * text are deliberately NOT carried; they stay on the device where they were
 * typed. The `v1` marker after the label versions the grammar and doubles as
 * the "made by Budkin" signal: a name without it (e.g. a timer created in Baby
 * Buddy's own UI) decodes to a generic feeding timer that is still stoppable.
 */
import { ACTIVITY_LABEL } from '@/lib/activities';
import type { ActivityType, FeedMethod, FeedType, Timer } from '@/types/models';

const SEP = ' · ';
const VERSION = 'v1';

// Reverse of ACTIVITY_LABEL, built once: display label -> saveAs activity.
const LABEL_TO_ACTIVITY: Record<string, ActivityType> = Object.fromEntries(
  (Object.entries(ACTIVITY_LABEL) as [ActivityType, string][]).map(([k, v]) => [v, k]),
);

export interface DecodedTimer {
  saveAs: ActivityType;
  feedType?: FeedType;
  method?: FeedMethod;
  startSide?: 'left' | 'right';
  amount?: number;
  nap?: boolean;
}

/**
 * NOTE the `amt:` token is canonical MILLILITRES, always, whatever the device's
 * units preference says. Imperial (fl oz) is a display lens only, and this
 * string is shared state: the timer name is what another device decodes when it
 * picks the timer up. Writing a converted number here would corrupt the amount
 * across devices. Do not change the encoding.
 */
export function encodeTimerName(t: Timer): string {
  const toks: string[] = [VERSION];
  if (t.saveAs === 'feeding') {
    if (t.feedType) toks.push(`ft:${t.feedType}`);
    if (t.method) toks.push(`m:${t.method}`);
    if (t.startSide) toks.push(`s:${t.startSide}`);
    if (t.amount != null) toks.push(`amt:${t.amount}`);
  } else if (t.saveAs === 'pumping') {
    if (t.method) toks.push(`m:${t.method}`);
    if (t.amount != null) toks.push(`amt:${t.amount}`);
  } else if (t.saveAs === 'sleep') {
    if (t.nap === true) toks.push('nap');
  }
  return `${ACTIVITY_LABEL[t.saveAs]}${SEP}${toks.join(SEP)}`;
}

export function decodeTimerName(name: string): DecodedTimer {
  const parts = name.split(SEP);
  const saveAs = LABEL_TO_ACTIVITY[parts[0] ?? ''] ?? 'feeding';
  // No version marker => foreign timer (e.g. made in Baby Buddy's own UI).
  if (parts[1] !== VERSION) return { saveAs };
  const d: DecodedTimer = { saveAs };
  for (const tok of parts.slice(2)) {
    if (tok === 'nap') d.nap = true;
    else if (tok.startsWith('ft:')) d.feedType = tok.slice(3) as FeedType;
    else if (tok.startsWith('m:')) d.method = tok.slice(2) as FeedMethod;
    else if (tok.startsWith('s:')) d.startSide = tok.slice(2) as 'left' | 'right';
    else if (tok.startsWith('amt:')) {
      const n = Number(tok.slice(4));
      if (Number.isFinite(n)) d.amount = n;
    }
  }
  return d;
}

/** Reconstruct a local Timer from a server timer record (start already in ms). */
export function serverTimerToTimer(
  raw: { id: number; name: string; start: number },
  childId: string,
): Timer {
  const d = decodeTimerName(raw.name);
  return {
    id: `tsrv${raw.id}`,
    serverId: raw.id,
    childId,
    activity: d.saveAs,
    saveAs: d.saveAs,
    name: ACTIVITY_LABEL[d.saveAs],
    start: raw.start,
    feedType: d.feedType,
    method: d.method,
    startSide: d.startSide,
    amount: d.amount,
    nap: d.nap,
  };
}

/**
 * Merge the device's local running timers with the server's. Same-account cross
 * device: the server is authoritative for timers that carry a serverId, but
 * local-only fields (notes/tags, never sent to the server) and not-yet-pushed
 * local timers (serverId == null) are preserved.
 */
export function reconcileTimers(local: Timer[], server: Timer[]): Timer[] {
  const serverById = new Map<number, Timer>();
  for (const t of server) if (t.serverId != null) serverById.set(t.serverId, t);

  const out: Timer[] = [];
  const matched = new Set<number>();
  for (const l of local) {
    if (l.serverId == null) {
      out.push(l); // pending push
      continue;
    }
    const s = serverById.get(l.serverId);
    if (!s) continue; // stopped/discarded elsewhere
    matched.add(l.serverId);
    // Server wins for structural fields + start; local notes/tags are preserved.
    out.push({ ...s, id: l.id, notes: l.notes, tags: l.tags });
  }
  for (const s of server) {
    if (s.serverId != null && !matched.has(s.serverId)) out.push(s);
  }
  return out;
}
