/**
 * Typed Baby Buddy REST API client.
 *
 * Baby Buddy is Django REST Framework at `<server>/api/`, token auth
 * (`Authorization: Token <key>`), JSON only, LimitOffset pagination, ISO 8601
 * datetimes. Note the non-obvious resource slugs: diaper changes are `changes`
 * and tummy time is `tummy-times`.
 *
 * Docs: https://docs.baby-buddy.net/api/
 */

import type {
  ActivityType,
  BathEntry,
  Child,
  DiaperColor,
  DiaperEntry,
  Entry,
  FeedMethod,
  FeedType,
  FeedingEntry,
  Measurement,
  MeasurementKind,
  MilestoneEntry,
  PhotoChange,
  PickedPhoto,
  NoteEntry,
  Profile,
  PumpingEntry,
  SleepEntry,
  Tag,
  TemperatureEntry,
  TummyEntry,
} from '@/types/models';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** A running timer as returned by `/api/timers/` (start converted to epoch ms). */
export interface ServerTimer {
  id: number;
  child: number | null;
  name: string;
  start: number;
}

const toISO = (ms: number) => new Date(ms).toISOString();
const fromISO = (s: string) => new Date(s).getTime();

// Measurements use a date-only field ('YYYY-MM-DD').
const toDateStr = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromDateStr = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
};

const MEAS_ENDPOINT: Record<MeasurementKind, string> = {
  weight: 'weight',
  height: 'height',
  head: 'head-circumference',
  bmi: 'bmi',
};
const MEAS_FIELD: Record<MeasurementKind, string> = {
  weight: 'weight',
  height: 'height',
  head: 'head_circumference',
  bmi: 'bmi',
};

// --- enum <-> API string mappings (Baby Buddy uses human-readable strings) ---
const FEED_TYPE_TO_API: Record<FeedType, string> = {
  breast: 'breast milk',
  formula: 'formula',
  fortified: 'fortified breast milk',
  solid: 'solid food',
};
const FEED_TYPE_FROM_API: Record<string, FeedType> = {
  'breast milk': 'breast',
  formula: 'formula',
  'fortified breast milk': 'fortified',
  'solid food': 'solid',
};
const FEED_METHOD_TO_API: Record<FeedMethod, string> = {
  left: 'left breast',
  right: 'right breast',
  both: 'both breasts',
  bottle: 'bottle',
  parent: 'parent fed',
  self: 'self fed',
};
const FEED_METHOD_FROM_API: Record<string, FeedMethod> = {
  'left breast': 'left',
  'right breast': 'right',
  'both breasts': 'both',
  bottle: 'bottle',
  'parent fed': 'parent',
  'self fed': 'self',
};

/** Fallback avatar tints for children fetched from a server (API has no color). */
const CHILD_COLORS = ['#EBA06A', '#9F94D4', '#6FC0A6', '#E6BE5E', '#EA958A'];

/** Cycle through the child avatar tint palette — the single source of truth
 *  for child colors, shared by `listChildren` and the store's local-create path. */
export function childColor(index: number): string {
  return CHILD_COLORS[index % CHILD_COLORS.length];
}

/** Activity type -> REST resource slug (note: diaper=changes, tummy=tummy-times).
 *  Baths have no Baby Buddy resource — they ride on generic Notes. */
const ENDPOINT: Record<ActivityType, string> = {
  feeding: 'feedings',
  sleep: 'sleep',
  diaper: 'changes',
  pumping: 'pumping',
  tummy: 'tummy-times',
  bath: 'notes',
  temperature: 'temperature',
  note: 'notes',
  milestone: 'notes',
};

// --- bath <-> Baby Buddy Note (tagged-note) serialization ---
// Baby Buddy has no bath resource, so a bath is a Note tagged `bath` + the wash
// size (`small`/`big`). The tags are the source of truth on read (a `big` tag
// means a big wash; anything else is small). The note text reads sensibly on its
// own so other Baby Buddy clients see a meaningful entry. User tags are kept
// distinct from these structural tags so they survive a round-trip untouched.
const BATH_STRUCTURAL_TAGS = ['bath', 'small', 'big'];

/**
 * Tags the tag picker must never surface or let the user create: the bath
 * structural tags (`bath`/`small`/`big`) plus the breastfeeding "both" side
 * markers (`left`/`right`) that `save()` folds into an entry's tags. They must
 * still round-trip untouched on entries that legitimately carry them — this set
 * only gates the UI (display + creation), not serialization.
 */
export const HIDDEN_TAGS = new Set<string>([...BATH_STRUCTURAL_TAGS, 'left', 'right']);

const tagNames = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).map((t: any) => (typeof t === 'string' ? t : t.name));

// --- milestone <-> Baby Buddy Note (tagged-note) serialization ---
// Baby Buddy has no milestone resource, so a reached milestone is a Note tagged
// `milestone` (marker) + `mk:<key>` (which one). Same pattern as baths.
const isStructuralMilestoneTag = (t: string): boolean => t === 'milestone' || t.startsWith('mk:');

/** True for any tag the picker must never surface or let the user create:
 *  the bath/side structural tags plus the milestone marker and mk:<key> tags. */
export function isHiddenTag(name: string): boolean {
  return HIDDEN_TAGS.has(name) || isStructuralMilestoneTag(name);
}

/**
 * The single discriminator between the two things that share `/api/notes/`: a
 * bath carries the `bath` structural tag, a general note does not. Used by BOTH
 * partition paths (baths vs notes) so the classification can never diverge.
 */
export function isBathNote(n: any): boolean {
  return tagNames(n?.tags).includes('bath');
}

/** Encode a bath entry as the body for a Baby Buddy Note (create/update). */
export function bathToNoteBody(entry: BathEntry, childServerId: number): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: `Bath, ${entry.wash} wash`,
    tags: ['bath', entry.wash, ...userTags],
  };
}

/** Reconstruct a bath entry from a Baby Buddy Note that carries the `bath` tag. */
export function noteToBathEntry(n: any, childId: string): BathEntry {
  const tags = tagNames(n.tags);
  return {
    id: `bath-${n.id}`,
    serverId: n.id,
    childId,
    type: 'bath',
    time: fromISO(n.time),
    wash: tags.includes('big') ? 'big' : 'small',
    tags: tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t)),
  };
}

/** Reconstruct a general note from a Baby Buddy Note (one WITHOUT the `bath`
 *  tag). The `note` field is the primary body; all tag names are kept as-is
 *  (a general note carries no structural tags to strip). */
export function noteToNoteEntry(n: any, childId: string): NoteEntry {
  return {
    id: `note-${n.id}`,
    serverId: n.id,
    childId,
    type: 'note',
    time: fromISO(n.time),
    text: n.note ?? '',
    tags: tagNames(n.tags),
  };
}

/** Encode a general note as the body for a Baby Buddy Note (create/update). The
 *  structural bath tags are stripped so a note can never be misread as a bath. */
export function noteToNoteBody(entry: NoteEntry, childServerId: number): Record<string, unknown> {
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: entry.text,
    tags: entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t)),
  };
}

/** The single discriminator: a milestone note carries the `milestone` tag. */
export function isMilestoneNote(n: any): boolean {
  return tagNames(n?.tags).includes('milestone');
}

/** Encode a milestone entry as the body for a Baby Buddy Note (create/update).
 *  Body is `🎉 <title>` with the optional parent note on a second line. */
export function milestoneToNoteBody(entry: MilestoneEntry, childServerId: number): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !isStructuralMilestoneTag(t));
  const note = entry.note?.trim();
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: note ? `🎉 ${entry.text}\n${note}` : `🎉 ${entry.text}`,
    tags: ['milestone', `mk:${entry.key}`, ...userTags],
  };
}

/** Reconstruct a milestone entry from a Baby Buddy Note carrying the `milestone`
 *  tag. `key` comes from the mk:<key> tag; the body's first line (emoji stripped)
 *  is the title snapshot and any later lines are the parent note. */
export function noteToMilestoneEntry(n: any, childId: string): MilestoneEntry {
  const tags = tagNames(n.tags);
  const keyTag = tags.find((t) => t.startsWith('mk:'));
  const lines = String(n.note ?? '').split('\n');
  const title = (lines[0] ?? '').replace(/^🎉\s*/, '').trim();
  const rest = lines.slice(1).join('\n').trim();
  return {
    id: `milestone-${n.id}`,
    serverId: n.id,
    childId,
    type: 'milestone',
    key: keyTag ? keyTag.slice(3) : '',
    time: fromISO(n.time),
    text: title,
    note: rest || undefined,
    tags: tags.filter((t) => !isStructuralMilestoneTag(t)),
  };
}

/**
 * Map a raw `/api/profile/` response onto our `Profile` shape. Baby Buddy's
 * `ProfileSerializer` nests the account fields (username/first/last/email)
 * under a `user` object, with `language`/`timezone` top-level on the profile
 * itself — NOT under a `settings` sub-object, despite the backing model
 * being named `Settings`. `dashboard_refresh_rate` is a real field on that
 * model but is deliberately excluded from `ProfileSerializer.Meta.fields`,
 * so it's never present on a stock server; mapped defensively in case a
 * fork/future version adds it. Optional chaining throughout so a missing or
 * reshaped response degrades to an all-undefined `Profile` instead of
 * throwing (the caller must never let this break the Settings screen).
 */
export function mapProfile(raw: unknown): Profile {
  const p = (raw ?? {}) as any;
  const u = p.user ?? {};
  return {
    username: u.username || undefined,
    firstName: u.first_name || undefined,
    lastName: u.last_name || undefined,
    email: u.email || undefined,
    language: p.language || undefined,
    timezone: p.timezone || undefined,
    dashboardRefreshRate: p.dashboard_refresh_rate ?? undefined,
  };
}

export function normalizeServerUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

/** JSON body for a child create / PATCH. Pass `clearPicture` to remove the photo. */
export function childBody(child: Child, clearPicture = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: child.first,
    last_name: child.last,
    birth_date: toDateStr(child.birth),
  };
  if (clearPicture) body.picture = null;
  return body;
}

/** The React Native FormData file descriptor for an uploaded picture. */
export function nativePicturePart(photo: PickedPhoto): { uri: string; name: string; type: string } {
  return { uri: photo.uri, name: photo.name, type: photo.type };
}

/** Web only: cover-crop the picked image onto a 512px square canvas and return a
 *  compressed JPEG blob — the web picker has no crop/quality step of its own. */
async function squarePictureBlob(photo: PickedPhoto): Promise<Blob> {
  const srcBlob = photo.file ? photo.file : await fetch(photo.uri).then((r) => r.blob());
  const bitmap = await createImageBitmap(srcBlob);
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.7),
  );
}

/** Multipart child body including a picture upload. Native appends the picker's
 *  file descriptor; web appends the square-cropped JPEG blob. Web is detected by
 *  the presence of `document` (no `react-native` import — keeps this file
 *  loadable under the node test runner). */
async function buildChildForm(child: Child, photo: PickedPhoto): Promise<FormData> {
  const form = new FormData();
  form.append('first_name', child.first);
  form.append('last_name', child.last);
  form.append('birth_date', toDateStr(child.birth));
  if (typeof document !== 'undefined') {
    form.append('picture', await squarePictureBlob(photo), photo.name);
  } else {
    form.append('picture', nativePicturePart(photo) as unknown as Blob);
  }
  return form;
}

export class BabybuddyClient {
  private readonly apiBase: string;
  private readonly token: string;

  constructor(serverUrl: string, token: string) {
    this.apiBase = normalizeServerUrl(serverUrl) + '/api';
    this.token = token.trim();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
      res = await fetch(`${this.apiBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Token ${this.token}`,
          // A FormData body must keep its auto-generated multipart boundary header.
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new ApiError(0, "Couldn't reach server. Check the URL and your connection.");
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ApiError(res.status, 'Invalid token for this server.');
      }
      let detail = '';
      try {
        const body = await res.text();
        if (body) detail = ' ' + body.slice(0, 300);
      } catch {
        /* ignore body read errors */
      }
      throw new ApiError(res.status, `Request failed (${res.status}).${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Fetch the connected user's Baby Buddy account + general settings (read-only display). */
  async getProfile(): Promise<Profile> {
    const raw = await this.request<unknown>('/profile/');
    return mapProfile(raw);
  }

  /** List the server's tags for the picker. No create endpoint — Baby Buddy
   *  auto-creates a tag when an entry is POSTed carrying a new name. */
  async listTags(): Promise<Tag[]> {
    const data = await this.request<Paginated<any>>('/tags/?limit=100');
    return data.results.map((c) => ({
      name: c.name,
      color: c.color || undefined,
      lastUsed: c.last_used ? fromISO(c.last_used) : undefined,
    }));
  }

  async listChildren(): Promise<Child[]> {
    const data = await this.request<Paginated<any>>('/children/?limit=100');
    return data.results.map((c, i) => ({
      id: String(c.id),
      serverId: c.id,
      first: c.first_name ?? '',
      last: c.last_name ?? '',
      birth: c.birth_date ? fromISO(c.birth_date) : Date.now(),
      color: childColor(i),
      slug: c.slug,
      picture: c.picture ?? null,
    }));
  }

  /** Resolve the path segment that addresses a single child.
   *
   *  Baby Buddy keys the CHILD endpoints by SLUG, not by numeric id: its
   *  `ChildViewSet` sets `lookup_field = "slug"`, and only `TagViewSet` does the
   *  same. Every other resource is keyed by id, which is why the entry, timer
   *  and measurement calls below address `{serverId}` and are right as they
   *  stand. Addressing a child by its numeric id 404s, which is what silently
   *  broke both delete and rename.
   *
   *  The slug is DERIVED from the child's name, so it moves whenever the child
   *  is renamed and a cached copy can go stale. `updateChild` re-stamps it from
   *  the PATCH response for exactly that reason. When a child has no slug at all
   *  (`uploadUnsynced` only learns the new numeric id when it pushes one, and a
   *  child persisted before slugs were captured has none either), look it up by
   *  `serverId`.
   *
   *  Undefined means "do not send the request": either the child was never
   *  pushed, or the lookup positively established it is no longer on the server
   *  (another device deleted it). The caller treats that as a no-op rather than
   *  a failure, since the desired end state already holds. A child that IS
   *  present but has no slug falls back to the numeric id, which is the one case
   *  where a 404 is still possible and worth surfacing.
   *
   *  Propagates rather than swallows: `listChildren` raises `ApiError` on a 5xx
   *  or a timeout, which is a genuine "could not reach the server" the callers
   *  are set up to report. */
  private async childKey(child: Child): Promise<string | number | undefined> {
    if (child.slug) return child.slug;
    if (child.serverId == null) return undefined;
    const match = (await this.listChildren()).find((c) => c.serverId === child.serverId);
    if (!match) return undefined; // confirmed gone server-side
    return match.slug ?? child.serverId;
  }

  /** Create a child on the server; uploads a picture when provided. Returns the
   *  new server id, its slug and the stored picture URL. The slug matters: it is
   *  how the child is addressed from here on (see `childKey`), and without
   *  capturing it a child created this session could not be renamed or deleted
   *  until the next refresh filled it in. */
  async createChild(
    child: Child,
    photo?: PickedPhoto,
  ): Promise<{ id?: number; slug?: string; picture?: string | null }> {
    const init: RequestInit = photo
      ? { method: 'POST', body: await buildChildForm(child, photo) }
      : { method: 'POST', body: JSON.stringify(childBody(child)) };
    const res = await this.request<{ id?: number; slug?: string; picture?: string | null }>('/children/', init);
    return { id: res?.id, slug: res?.slug, picture: res?.picture ?? null };
  }

  /** Update a child (requires a server-backed child). Applies the photo change
   *  and returns the stored picture URL (null when cleared/absent) plus the
   *  child's CURRENT slug, which a rename will have moved. Undefined when
   *  skipped, i.e. the child was never pushed. */
  async updateChild(
    child: Child,
    change: PhotoChange = { kind: 'none' },
  ): Promise<{ picture: string | null; slug?: string } | undefined> {
    if (child.serverId == null) return undefined;
    const key = await this.childKey(child);
    if (key == null) return undefined;
    const init: RequestInit =
      change.kind === 'set'
        ? { method: 'PATCH', body: await buildChildForm(child, change.photo) }
        : { method: 'PATCH', body: JSON.stringify(childBody(child, change.kind === 'remove')) };
    const res = await this.request<{ picture?: string | null; slug?: string }>(`/children/${key}/`, init);
    return { picture: res?.picture ?? null, slug: res?.slug };
  }

  /** Delete a child on the server, addressed by slug (see `childKey`). Baby
   *  Buddy cascades the child's feedings/sleep/changes/etc., so no per-entry
   *  cleanup is needed. A never-pushed child has nothing to delete. */
  async deleteChild(child: Child): Promise<void> {
    if (child.serverId == null) return;
    const key = await this.childKey(child);
    if (key == null) return;
    await this.request(`/children/${key}/`, { method: 'DELETE' });
  }

  async listFeedings(childId: string, limit = 50, offset = 0): Promise<FeedingEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/feedings/?child=${childId}&ordering=-start&limit=${limit}&offset=${offset}`,
    );
    return data.results.map((f) => ({
      id: `feeding-${f.id}`,
      serverId: f.id,
      childId,
      type: 'feeding',
      start: fromISO(f.start),
      end: f.end ? fromISO(f.end) : null,
      feedType: FEED_TYPE_FROM_API[f.type] ?? 'breast',
      method: FEED_METHOD_FROM_API[f.method] ?? 'left',
      amount: f.amount != null ? Number(f.amount) : null,
      notes: f.notes || undefined,
      tags: (f.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
    }));
  }

  async listSleep(childId: string, limit = 50, offset = 0): Promise<SleepEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/sleep/?child=${childId}&ordering=-start&limit=${limit}&offset=${offset}`,
    );
    return data.results.map((s) => ({
      id: `sleep-${s.id}`,
      serverId: s.id,
      childId,
      type: 'sleep',
      start: fromISO(s.start),
      end: s.end ? fromISO(s.end) : null,
      nap: s.nap === true || s.nap === 'true',
      notes: s.notes || undefined,
      tags: (s.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
    }));
  }

  async listChanges(childId: string, limit = 50, offset = 0): Promise<DiaperEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/changes/?child=${childId}&ordering=-time&limit=${limit}&offset=${offset}`,
    );
    return data.results.map((c) => ({
      id: `diaper-${c.id}`,
      serverId: c.id,
      childId,
      type: 'diaper',
      time: fromISO(c.time),
      wet: !!c.wet,
      solid: !!c.solid,
      color: (c.color || null) as DiaperColor | null,
      amount: c.amount != null ? Number(c.amount) : null,
      notes: c.notes || undefined,
      tags: (c.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
    }));
  }

  async listTemperature(childId: string, limit = 50): Promise<TemperatureEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/temperature/?child=${childId}&ordering=-time&limit=${limit}`,
    );
    return data.results.map((r) => ({
      id: `temperature-${r.id}`,
      serverId: r.id,
      childId,
      type: 'temperature',
      time: fromISO(r.time),
      value: Number(r.temperature),
      notes: r.notes || undefined,
      tags: (r.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
    }));
  }

  async listPumping(childId: string, limit = 50): Promise<PumpingEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/pumping/?child=${childId}&ordering=-start&limit=${limit}`,
    );
    return data.results.map((p) => ({
      id: `pumping-${p.id}`,
      serverId: p.id,
      childId,
      type: 'pumping',
      start: p.start ? fromISO(p.start) : fromISO(p.time),
      end: p.end ? fromISO(p.end) : null,
      amount: p.amount != null ? Number(p.amount) : null,
      notes: p.notes || undefined,
      tags: (p.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)),
    }));
  }

  async listTummy(childId: string, limit = 50): Promise<TummyEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/tummy-times/?child=${childId}&ordering=-start&limit=${limit}`,
    );
    return data.results.map((t) => ({
      id: `tummy-${t.id}`,
      serverId: t.id,
      childId,
      type: 'tummy',
      start: fromISO(t.start),
      end: t.end ? fromISO(t.end) : null,
      milestone: t.milestone || undefined,
      notes: t.notes || undefined,
      tags: (t.tags ?? []).map((tag: any) => (typeof tag === 'string' ? tag : tag.name)),
    }));
  }

  /**
   * Read the child's recent `/api/notes/` ONCE and partition it three ways:
   * `milestone`-tagged notes become `MilestoneEntry`s, `bath`-tagged notes become
   * `BathEntry`s, and everything else becomes general `NoteEntry`s. All three
   * share this one endpoint, so a single fetch feeds them all — no double-fetch.
   * Milestone is checked first, so a note carrying both marker tags is a milestone.
   */
  async listChildNotes(
    childId: string,
    limit = 100,
  ): Promise<{ baths: BathEntry[]; milestones: MilestoneEntry[]; notes: NoteEntry[] }> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childId}&ordering=-time&limit=${limit}`,
    );
    const baths: BathEntry[] = [];
    const milestones: MilestoneEntry[] = [];
    const notes: NoteEntry[] = [];
    for (const n of data.results) {
      if (isMilestoneNote(n)) milestones.push(noteToMilestoneEntry(n, childId));
      else if (isBathNote(n)) baths.push(noteToBathEntry(n, childId));
      else notes.push(noteToNoteEntry(n, childId));
    }
    return { baths, milestones, notes };
  }

  private buildBody(entry: Entry, childServerId: number): Record<string, unknown> {
    const child = childServerId;
    const tags = entry.tags ?? [];
    switch (entry.type) {
      case 'feeding':
        return {
          child,
          start: toISO(entry.start),
          end: toISO(entry.end ?? entry.start),
          type: FEED_TYPE_TO_API[entry.feedType],
          method: FEED_METHOD_TO_API[entry.method],
          amount: entry.amount,
          notes: entry.notes ?? '',
          tags,
        };
      case 'sleep':
        return { child, start: toISO(entry.start), end: toISO(entry.end ?? entry.start), notes: entry.notes ?? '', tags };
      case 'diaper':
        return {
          child,
          time: toISO(entry.time),
          wet: entry.wet,
          solid: entry.solid,
          color: entry.color ?? '',
          amount: entry.amount ?? null,
          notes: entry.notes ?? '',
          tags,
        };
      case 'pumping':
        return {
          child,
          start: toISO(entry.start),
          end: toISO(entry.end ?? entry.start),
          amount: entry.amount,
          notes: entry.notes ?? '',
          tags,
        };
      case 'tummy':
        return {
          child,
          start: toISO(entry.start),
          end: toISO(entry.end ?? entry.start),
          milestone: entry.milestone ?? '',
          notes: entry.notes ?? '',
          tags,
        };
      case 'temperature':
        return { child, time: toISO(entry.time), temperature: entry.value, notes: entry.notes ?? '', tags };
      case 'bath':
        return bathToNoteBody(entry, childServerId);
      case 'note':
        return noteToNoteBody(entry, childServerId);
      case 'milestone':
        return milestoneToNoteBody(entry, childServerId);
    }
  }

  /** Create an entry on the server; returns the new server id. */
  async createEntry(entry: Entry, childServerId: number): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>(`/${ENDPOINT[entry.type]}/`, {
      method: 'POST',
      body: JSON.stringify(this.buildBody(entry, childServerId)),
    });
    return res?.id;
  }

  /** Update an existing entry on the server (requires entry.serverId). */
  async updateEntry(entry: Entry, childServerId: number): Promise<void> {
    if (entry.serverId == null) return;
    await this.request(`/${ENDPOINT[entry.type]}/${entry.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(this.buildBody(entry, childServerId)),
    });
  }

  /** Delete an entry on the server by type + server id. */
  async deleteEntry(type: ActivityType, serverId: number): Promise<void> {
    await this.request(`/${ENDPOINT[type]}/${serverId}/`, { method: 'DELETE' });
  }

  // ---- measurements (weight / height / head circumference / BMI) ----

  async listMeasurements(kind: MeasurementKind, childId: string, limit = 50): Promise<Measurement[]> {
    const field = MEAS_FIELD[kind];
    const data = await this.request<Paginated<any>>(
      `/${MEAS_ENDPOINT[kind]}/?child=${childId}&ordering=-date&limit=${limit}`,
    );
    return data.results.map((r) => ({
      id: `${kind}-${r.id}`,
      serverId: r.id,
      childId,
      kind,
      value: Number(r[field]),
      date: fromDateStr(r.date),
      notes: r.notes || undefined,
    }));
  }

  private measBody(m: Measurement, childServerId: number): Record<string, unknown> {
    return { child: childServerId, date: toDateStr(m.date), [MEAS_FIELD[m.kind]]: m.value, notes: m.notes ?? '' };
  }

  async createMeasurement(m: Measurement, childServerId: number): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>(`/${MEAS_ENDPOINT[m.kind]}/`, {
      method: 'POST',
      body: JSON.stringify(this.measBody(m, childServerId)),
    });
    return res?.id;
  }

  async updateMeasurement(m: Measurement, childServerId: number): Promise<void> {
    if (m.serverId == null) return;
    await this.request(`/${MEAS_ENDPOINT[m.kind]}/${m.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(this.measBody(m, childServerId)),
    });
  }

  async deleteMeasurement(kind: MeasurementKind, serverId: number): Promise<void> {
    await this.request(`/${MEAS_ENDPOINT[kind]}/${serverId}/`, { method: 'DELETE' });
  }

  // ---- running timers (/api/timers/) ----

  /** List the connected user's running timers. */
  async listTimers(limit = 100): Promise<ServerTimer[]> {
    const data = await this.request<Paginated<any>>(`/timers/?limit=${limit}`);
    return data.results.map((t) => ({
      id: t.id,
      child: t.child ?? null,
      name: t.name ?? '',
      start: fromISO(t.start),
    }));
  }

  /** Create a timer for a child; returns its new server id. */
  async createTimer(childServerId: number, startMs: number, name: string): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>('/timers/', {
      method: 'POST',
      body: JSON.stringify({ child: childServerId, start: toISO(startMs), name }),
    });
    return res?.id;
  }

  /** Update a timer's encoded name and start. */
  async updateTimer(id: number, name: string, startMs: number): Promise<void> {
    await this.request(`/timers/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ name, start: toISO(startMs) }),
    });
  }

  /** Delete a timer on the server. */
  async deleteTimer(id: number): Promise<void> {
    await this.request(`/timers/${id}/`, { method: 'DELETE' });
  }
}
