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
export function bathToNoteBody(entry: BathEntry): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
  return {
    child: entry.childId,
    time: toISO(entry.time),
    note: `Bath — ${entry.wash} wash`,
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
export function noteToNoteBody(entry: NoteEntry): Record<string, unknown> {
  return {
    child: entry.childId,
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
export function milestoneToNoteBody(entry: MilestoneEntry): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !isStructuralMilestoneTag(t));
  const note = entry.note?.trim();
  return {
    child: entry.childId,
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

  /** Create a child on the server; uploads a picture when provided. Returns the
   *  new server id and the stored picture URL. */
  async createChild(child: Child, photo?: PickedPhoto): Promise<{ id?: number; picture?: string | null }> {
    const init: RequestInit = photo
      ? { method: 'POST', body: await buildChildForm(child, photo) }
      : { method: 'POST', body: JSON.stringify(childBody(child)) };
    const res = await this.request<{ id?: number; picture?: string | null }>('/children/', init);
    return { id: res?.id, picture: res?.picture ?? null };
  }

  /** Update a child (requires a numeric id). Applies the photo change and returns
   *  the stored picture URL (null when cleared/absent, undefined when skipped). */
  async updateChild(child: Child, change: PhotoChange = { kind: 'none' }): Promise<string | null | undefined> {
    const id = child.serverId;
    if (id == null) return undefined;
    const init: RequestInit =
      change.kind === 'set'
        ? { method: 'PATCH', body: await buildChildForm(child, change.photo) }
        : { method: 'PATCH', body: JSON.stringify(childBody(child, change.kind === 'remove')) };
    const res = await this.request<{ picture?: string | null }>(`/children/${id}/`, init);
    return res?.picture ?? null;
  }

  /** Delete a child on the server (requires a numeric id). Baby Buddy cascades
   *  the child's feedings/sleep/changes/etc., so no per-entry cleanup is needed. */
  async deleteChild(id: number): Promise<void> {
    await this.request(`/children/${id}/`, { method: 'DELETE' });
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
   * Read the child's recent `/api/notes/` ONCE and partition it by the `bath`
   * tag: bath-tagged notes become `BathEntry`s, everything else becomes general
   * `NoteEntry`s. Baths and general notes share this one endpoint, so a single
   * fetch feeds both — no double-fetch. `isBathNote` is the shared discriminator.
   */
  async listChildNotes(
    childId: string,
    limit = 100,
  ): Promise<{ baths: BathEntry[]; notes: NoteEntry[] }> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childId}&ordering=-time&limit=${limit}`,
    );
    const baths: BathEntry[] = [];
    const notes: NoteEntry[] = [];
    for (const n of data.results) {
      if (isBathNote(n)) baths.push(noteToBathEntry(n, childId));
      else notes.push(noteToNoteEntry(n, childId));
    }
    return { baths, notes };
  }

  private buildBody(entry: Entry): Record<string, unknown> {
    const child = entry.childId;
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
        return bathToNoteBody(entry);
      case 'note':
        return noteToNoteBody(entry);
      case 'milestone':
        return milestoneToNoteBody(entry);
    }
  }

  /** Create an entry on the server; returns the new server id. */
  async createEntry(entry: Entry): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>(`/${ENDPOINT[entry.type]}/`, {
      method: 'POST',
      body: JSON.stringify(this.buildBody(entry)),
    });
    return res?.id;
  }

  /** Update an existing entry on the server (requires entry.serverId). */
  async updateEntry(entry: Entry): Promise<void> {
    if (entry.serverId == null) return;
    await this.request(`/${ENDPOINT[entry.type]}/${entry.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(this.buildBody(entry)),
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

  private measBody(m: Measurement): Record<string, unknown> {
    return { child: m.childId, date: toDateStr(m.date), [MEAS_FIELD[m.kind]]: m.value, notes: m.notes ?? '' };
  }

  async createMeasurement(m: Measurement): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>(`/${MEAS_ENDPOINT[m.kind]}/`, {
      method: 'POST',
      body: JSON.stringify(this.measBody(m)),
    });
    return res?.id;
  }

  async updateMeasurement(m: Measurement): Promise<void> {
    if (m.serverId == null) return;
    await this.request(`/${MEAS_ENDPOINT[m.kind]}/${m.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(this.measBody(m)),
    });
  }

  async deleteMeasurement(kind: MeasurementKind, serverId: number): Promise<void> {
    await this.request(`/${MEAS_ENDPOINT[kind]}/${serverId}/`, { method: 'DELETE' });
  }
}
