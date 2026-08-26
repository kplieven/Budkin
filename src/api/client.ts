/**
 * Typed Baby Buddy REST API client.
 *
 * Baby Buddy is Django REST Framework at `<server>/api/`, token auth
 * (`Authorization: Token <key>`), JSON only, LimitOffset pagination, ISO 8601
 * datetimes. Docs: https://docs.baby-buddy.net/api/
 */

import { INTAKE_LEVELS, feedAmountIsVolume } from '@/lib/activities';
import { normalizeWash } from '@/lib/wash';
import type {
  ActivityType,
  BathEntry,
  BathRhythm,
  Child,
  ChildGender,
  Treatment,
  TreatmentTimeOfDay,
  DiaperColor,
  DiaperEntry,
  Entry,
  FeedMethod,
  FeedType,
  FeedingEntry,
  Measurement,
  MeasurementKind,
  MedicationEntry,
  MilestoneEntry,
  PhotoChange,
  PickedPhoto,
  NoteEntry,
  Profile,
  PumpingEntry,
  ServerChild,
  SleepEntry,
  Tag,
  TemperatureEntry,
  TummyEntry,
  UploadableFile,
} from '@/types/models';

export class ApiError extends Error {
  /** `cause` carries whatever actually failed. The transport errors below are written
   *  for the user, so without it a client-side failure reads as an unreachable server. */
  constructor(
    public status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
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

// Date-only fields ('YYYY-MM-DD') are LOCAL calendar days app-wide, so both directions
// must stay in local time. `new Date('YYYY-MM-DD')` is not a substitute: it parses to UTC
// midnight, which west of UTC displays a day early and walks the value back a day on
// every edit round-trip.
export const toDateStr = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fromDateStr = (s: string) => {
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

// Baby Buddy stores feed type and method as human-readable strings.
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

/** Baths, milestones and treatments have no Baby Buddy resource of their own: they ride
 *  on generic Notes, tagged. */
const ENDPOINT: Record<ActivityType, string> = {
  feeding: 'feedings',
  sleep: 'sleep',
  diaper: 'changes',
  pumping: 'pumping',
  tummy: 'tummy-times',
  bath: 'notes',
  temperature: 'temperature',
  medication: 'medication',
  note: 'notes',
  milestone: 'notes',
};

/** DRF serializes a DurationField as `[D ]HH:MM:SS[.ffffff]`, the day count optional. A
 *  bare numeric string is tolerated; anything unparseable degrades to undefined. */
export function durationToSec(raw: string): number | undefined {
  const str = String(raw).trim();
  const m = str.match(/^(?:(\d+)\s+)?(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
  if (!m) {
    const n = Number(str);
    return Number.isFinite(n) ? n : undefined;
  }
  const days = m[1] ? Number(m[1]) : 0;
  return days * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export function secToDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const days = Math.floor(total / 86400);
  const rem = total % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(Math.floor(rem / 3600))}:${pad(Math.floor((rem % 3600) / 60))}:${pad(rem % 60)}`;
  return days ? `${days} ${hms}` : hms;
}

// A bath is a Note tagged `bath` plus the wash size. Tags are the source of truth on
// read; the body is human copy only, so other Baby Buddy clients see a meaningful entry.
//
// The bare `small`/`big` tags predate `bath:quick`/`bath:full`: still read so an
// unmigrated note does not come back as the wrong wash, never written, and listed here
// so they stay stripped. Freeing them would let a user tag named `big` read back as a
// full bath.
const BATH_STRUCTURAL_TAGS = ['bath', 'bath:quick', 'bath:full', 'small', 'big'];

// The wash CADENCE, not a wash: a per-child attribute riding as its own note, the
// channel gender already uses. Deliberately namespaced under `bath:` but never carrying
// the bare `bath` tag, which `isBathNote` keys off: a rhythm note misread as a wash
// would put a phantom bath on the timeline and reset the very cadence it describes.
const BATH_RHYTHM_TAG = 'bath:rhythm';
const BATH_RHYTHM_FULL_PREFIX = 'bath:rhythm:full:';
const BATH_RHYTHM_QUICK_PREFIX = 'bath:rhythm:quick:';

const isStructuralBathRhythmTag = (t: string): boolean =>
  t === BATH_RHYTHM_TAG || t.startsWith(`${BATH_RHYTHM_TAG}:`);

/** Gates the UI (display and creation) only, never serialization: entries that
 *  legitimately carry these must round-trip untouched. */
export const HIDDEN_TAGS = new Set<string>([...BATH_STRUCTURAL_TAGS, 'left', 'right']);

const tagNames = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).map((t: any) => (typeof t === 'string' ? t : t.name));

// Baby Buddy's `Feeding.amount` is a VOLUME it sums into its feeding statistics, so a
// subjective intake level must not go there: level 3 would land in those totals as 3 ml.
// The level rides as a structural tag instead and `amount` goes out null. Index 0..2 ==
// level 1..3.
//
// Known limitation: name-based, so an `intake:…` tag the user already had is
// indistinguishable from ours and a later edit strips it from the server.
const INTAKE_TAGS = ['intake:little', 'intake:some', 'intake:lot'] as const;

const isIntakeTag = (t: string): boolean => t.startsWith('intake:');

/** Only for a number that arrived WITHOUT an intake tag, so it was typed into Baby
 *  Buddy's own UI or predates the level scale. */
function bucketLegacyIntake(score: number): 1 | 2 | 3 {
  return score <= 3 ? 1 : score <= 7 ? 2 : 3;
}

function intakeLevelFromServer(tags: string[], amount: number | null): 1 | 2 | 3 | null {
  const i = INTAKE_TAGS.findIndex((t) => tags.includes(t));
  if (i >= 0) return (i + 1) as 1 | 2 | 3;
  if (amount == null || !Number.isFinite(amount)) return null;
  return bucketLegacyIntake(amount);
}

// A reached milestone is a Note tagged `milestone` (marker) + `mk:<key>` (which one).
const isStructuralMilestoneTag = (t: string): boolean => t === 'milestone' || t.startsWith('mk:');

const TREATMENT_TAG = 'treatment';
const TREATMENT_TOD_PREFIX = 'treatment:tod:';
const TREATMENT_EVERY_PREFIX = 'treatment:every:';
const TREATMENT_PAUSED_TAG = 'treatment:paused';
const TREATMENT_SPORADIC_TAG = 'treatment:sporadic';
/** Sporadic's own tag for its cooldown hours, distinct from `every:` on purpose: an
 *  older client that has never heard of `treatment:sporadic` must not mistake a
 *  cooldown for a recurring interval and start nagging about a dose that isn't due -
 *  it should instead degrade to a harmless no-times-chosen `timesOfDay` treatment. */
const TREATMENT_COOLDOWN_PREFIX = 'treatment:cooldown:';

const isStructuralTreatmentTag = (t: string): boolean => t === TREATMENT_TAG || t.startsWith('treatment:');

// Baby Buddy's `Child` has no gender field, and DRF drops unknown keys silently, so a
// `gender` sent to /api/children/ would vanish without an error. Gender rides as a
// `gender`-tagged note instead, the same channel baths and milestones use.
const GENDER_TAG = 'gender';
const GENDER_PREFIX = 'g:';

const isStructuralGenderTag = (t: string): boolean => t === GENDER_TAG || t.startsWith(GENDER_PREFIX);

export function isHiddenTag(name: string): boolean {
  return (
    HIDDEN_TAGS.has(name) ||
    isStructuralMilestoneTag(name) ||
    isIntakeTag(name) ||
    isStructuralTreatmentTag(name) ||
    isStructuralGenderTag(name) ||
    isStructuralBathRhythmTag(name)
  );
}

/** The single discriminator between the things sharing `/api/notes/`. */
export function isBathNote(n: any): boolean {
  return tagNames(n?.tags).includes('bath');
}

/** `normalizeWash` rather than a raw compare: an entry sitting in the offline queue or
 *  pending-ops log still carries the legacy literal `'big'`, since neither store gets
 *  the load-time normalization, and a bare compare downgrades it to a quick wash. */
export function bathToNoteBody(entry: BathEntry, childServerId: number): Record<string, unknown> {
  const userTags = entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t));
  const full = normalizeWash(entry.wash) === 'full';
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: full ? 'Full bath' : 'Quick wash',
    tags: ['bath', full ? 'bath:full' : 'bath:quick', ...userTags],
  };
}

export function noteToBathEntry(n: any, childId: string): BathEntry {
  const tags = tagNames(n.tags);
  return {
    id: `bath-${n.id}`,
    serverId: n.id,
    childId,
    type: 'bath',
    time: fromISO(n.time),
    // Self-healing: the next edit rewrites the legacy tags to the current ones.
    wash: tags.includes('bath:full') || tags.includes('big') ? 'full' : 'quick',
    tags: tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t)),
  };
}

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

/** Structural bath tags are stripped so a note can never be misread as a bath. */
export function noteToNoteBody(entry: NoteEntry, childServerId: number): Record<string, unknown> {
  return {
    child: childServerId,
    time: toISO(entry.time),
    note: entry.text,
    tags: entry.tags.filter((t) => !BATH_STRUCTURAL_TAGS.includes(t) && !isStructuralMilestoneTag(t)),
  };
}

export function isMilestoneNote(n: any): boolean {
  return tagNames(n?.tags).includes('milestone');
}

/** Body is `🎉 <title>` with the optional parent note on a second line. */
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

// A treatment is a Note tagged `treatment` plus its schedule: `treatment:tod:<slot>` per
// chosen time of day, or `treatment:every:<hours>`, plus `treatment:paused` while off.
//
// The split between tags and body matters: a Baby Buddy tag name is globally unique and
// shared by every record on the server, so a free-text medication name would mint a new
// global tag per treatment and pollute every other client's tag list. Only the bounded
// schedule rides in tags. Free text and dates ride in the note body as a payload line
// under a human-readable summary, so a body hand-edited in Baby Buddy's own UI degrades
// to the tag-borne schedule plus a best-effort name rather than losing the treatment.
//
// Known limitation: name-based, like the `intake:` tags above.
/** Versioned so a later encoding can be told apart rather than mis-parsed. */
const TREATMENT_PAYLOAD_PREFIX = 'budkin-treatment-v1:';

const TREATMENT_TIMES_OF_DAY: TreatmentTimeOfDay[] = ['morning', 'noon', 'evening', 'night'];

export function isTreatmentNote(n: any): boolean {
  return tagNames(n?.tags).includes(TREATMENT_TAG);
}

/** The human-readable first line, e.g. "Omeprazol, 2.5 mL, morning and evening". */
function treatmentSummary(treatment: Treatment): string {
  const dose = treatment.dosage == null ? '' : [String(treatment.dosage), treatment.dosageUnit].filter(Boolean).join(' ');
  const schedule =
    treatment.scheduleMode === 'everyHours'
      ? treatment.everyHours == null
        ? ''
        : `every ${treatment.everyHours} ${treatment.everyHours === 1 ? 'hour' : 'hours'}`
      : treatment.scheduleMode === 'sporadic'
        ? treatment.everyHours == null
          ? 'as needed'
          : `as needed, min ${treatment.everyHours} ${treatment.everyHours === 1 ? 'hour' : 'hours'} apart`
        : TREATMENT_TIMES_OF_DAY.filter((tod) => treatment.timesOfDay?.includes(tod)).join(', ');
  return [treatment.name.trim(), dose, schedule].filter(Boolean).join(', ');
}

export function treatmentToNoteBody(treatment: Treatment, childServerId: number): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: treatment.name.trim(), fromDate: toDateStr(treatment.fromDate) };
  if (treatment.dosage != null) payload.dosage = treatment.dosage;
  if (treatment.dosageUnit) payload.dosageUnit = treatment.dosageUnit;
  if (treatment.toDate != null) payload.toDate = toDateStr(treatment.toDate);
  if (treatment.condition) payload.condition = treatment.condition;
  if (treatment.notes) payload.notes = treatment.notes;

  const tags = [TREATMENT_TAG];
  if (treatment.scheduleMode === 'everyHours') {
    if (treatment.everyHours != null) tags.push(`${TREATMENT_EVERY_PREFIX}${treatment.everyHours}`);
  } else if (treatment.scheduleMode === 'sporadic') {
    tags.push(TREATMENT_SPORADIC_TAG);
    if (treatment.everyHours != null) tags.push(`${TREATMENT_COOLDOWN_PREFIX}${treatment.everyHours}`);
  } else {
    for (const tod of TREATMENT_TIMES_OF_DAY) if (treatment.timesOfDay?.includes(tod)) tags.push(`${TREATMENT_TOD_PREFIX}${tod}`);
  }
  if (!treatment.active) tags.push(TREATMENT_PAUSED_TAG);

  return {
    child: childServerId,
    // A regimen is not a point event: `time` carries its start date, and
    // `listChildTreatments` filters by tag rather than recency so an old start date
    // can never push a treatment out of view.
    time: toISO(treatment.fromDate),
    note: `${treatmentSummary(treatment)}\n${TREATMENT_PAYLOAD_PREFIX}${JSON.stringify(payload)}`,
    tags,
  };
}

/** `null` when the body carries no payload line: hand-edited in Baby Buddy, or older. */
function treatmentNotePayload(note: string): Record<string, unknown> | null {
  const line = note.split('\n').find((l) => l.trimStart().startsWith(TREATMENT_PAYLOAD_PREFIX));
  if (!line) return null;
  try {
    const parsed: unknown = JSON.parse(line.trimStart().slice(TREATMENT_PAYLOAD_PREFIX.length));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Tags are the source of truth for the schedule and the paused flag, the body payload
 *  for everything else. With no usable payload the schedule and the body's first line
 *  survive, so a hand-edited note cannot destroy the record. */
export function noteToTreatment(n: any, childId: string): Treatment {
  const tags = tagNames(n.tags);
  const payload = treatmentNotePayload(String(n.note ?? '')) ?? {};
  const everyTag = tags.find((t) => t.startsWith(TREATMENT_EVERY_PREFIX));
  const everyHours = everyTag ? Number(everyTag.slice(TREATMENT_EVERY_PREFIX.length)) : Number.NaN;
  const cooldownTag = tags.find((t) => t.startsWith(TREATMENT_COOLDOWN_PREFIX));
  const cooldownHours = cooldownTag ? Number(cooldownTag.slice(TREATMENT_COOLDOWN_PREFIX.length)) : Number.NaN;
  const timesOfDay = TREATMENT_TIMES_OF_DAY.filter((tod) => tags.includes(`${TREATMENT_TOD_PREFIX}${tod}`));
  const isInterval = Number.isFinite(everyHours);
  const isSporadic = tags.includes(TREATMENT_SPORADIC_TAG);
  const fromDate = asString(payload.fromDate);
  const toDate = asString(payload.toDate);

  return {
    id: `treatment-${n.id}`,
    serverId: n.id,
    childId,
    name: asString(payload.name) ?? String(n.note ?? '').split('\n')[0]?.trim() ?? '',
    scheduleMode: isSporadic ? 'sporadic' : isInterval ? 'everyHours' : 'timesOfDay',
    ...(isSporadic ? (Number.isFinite(cooldownHours) ? { everyHours: cooldownHours } : {}) : isInterval ? { everyHours } : { timesOfDay }),
    dosage: asNumber(payload.dosage),
    dosageUnit: asString(payload.dosageUnit),
    // Lossless fallback: `treatmentToNoteBody` wrote `time` from this same date.
    fromDate: fromDate ? fromDateStr(fromDate) : startOfLocalDay(fromISO(n.time)),
    toDate: toDate ? fromDateStr(toDate) : undefined,
    condition: asString(payload.condition),
    notes: asString(payload.notes),
    active: !tags.includes(TREATMENT_PAUSED_TAG),
  };
}

// One note per child, tagged `gender` + `g:<value>`. An attribute rather than an event,
// so `time` means nothing beyond recency: the newest gender note wins, which lets a
// re-write that failed to find the old note still resolve to the right answer.

const CHILD_GENDERS: ChildGender[] = ['girl', 'boy'];

export function isGenderNote(n: any): boolean {
  return tagNames(n?.tags).includes(GENDER_TAG);
}

export function genderToNoteBody(gender: ChildGender, childServerId: number, atMs: number): Record<string, unknown> {
  return {
    child: childServerId,
    time: toISO(atMs),
    note: `Gender: ${gender}`,
    tags: [GENDER_TAG, `${GENDER_PREFIX}${gender}`],
  };
}

/** Undefined when the `g:` tag is missing or holds a value this build doesn't know,
 *  so a retired gender degrades to "not recorded". */
export function genderFromNote(n: any): ChildGender | undefined {
  const tags = tagNames(n?.tags);
  const tag = tags.find((t) => t.startsWith(GENDER_PREFIX));
  const value = tag?.slice(GENDER_PREFIX.length);
  return CHILD_GENDERS.find((g) => g === value);
}

// One note per child, tagged `bath:rhythm` + an interval tag per wash kind. Like gender
// it is an attribute rather than an event, so `time` means nothing beyond recency and
// the newest note wins.

/** Days as English, because the body is what a non-Budkin client shows. `0` is the OFF
 *  switch for that wash, so it reads as "off" rather than "every 0 days". */
const cadenceCopy = (label: string, days: number): string =>
  days <= 0 ? `${label} off` : days === 1 ? `${label} daily` : `${label} every ${days} days`;

export function isBathRhythmNote(n: any): boolean {
  return tagNames(n?.tags).includes(BATH_RHYTHM_TAG);
}

export function bathRhythmToNoteBody(
  rhythm: BathRhythm,
  childServerId: number,
  atMs: number,
): Record<string, unknown> {
  return {
    child: childServerId,
    time: toISO(atMs),
    note: `Bath rhythm: ${cadenceCopy('full bath', rhythm.fullEveryDays)}, ${cadenceCopy('quick wash', rhythm.quickEveryDays)}`,
    tags: [
      BATH_RHYTHM_TAG,
      `${BATH_RHYTHM_FULL_PREFIX}${rhythm.fullEveryDays}`,
      `${BATH_RHYTHM_QUICK_PREFIX}${rhythm.quickEveryDays}`,
    ],
  };
}

const intervalFromTag = (tags: string[], prefix: string): number | undefined => {
  const tag = tags.find((t) => t.startsWith(prefix));
  if (tag == null) return undefined;
  const n = Number(tag.slice(prefix.length));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * PARTIAL on purpose, and undefined when neither interval parses. Clamping needs the
 * fallback rhythm this device would otherwise use, which only the store knows, so the
 * numbers go up raw and `clampBathRhythm` owns the range. A half this build cannot read
 * is left out rather than defaulted, so a note from a future build still contributes
 * the half it does understand.
 */
export function bathRhythmFromNote(n: any): Partial<BathRhythm> | undefined {
  const tags = tagNames(n?.tags);
  const fullEveryDays = intervalFromTag(tags, BATH_RHYTHM_FULL_PREFIX);
  const quickEveryDays = intervalFromTag(tags, BATH_RHYTHM_QUICK_PREFIX);
  if (fullEveryDays === undefined && quickEveryDays === undefined) return undefined;
  return {
    ...(fullEveryDays !== undefined ? { fullEveryDays } : {}),
    ...(quickEveryDays !== undefined ? { quickEveryDays } : {}),
  };
}

/** Treatment dates are stored at local midnight, so a timestamp fallback has to be
 *  floored to it. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `ProfileSerializer` nests the account fields under `user`, with `language`/`timezone`
 *  top-level on the profile itself, NOT under a `settings` sub-object despite the backing
 *  model being named `Settings`. `dashboard_refresh_rate` is excluded from
 *  `ProfileSerializer.Meta.fields`, so it is absent on a stock server and mapped only in
 *  case a fork adds it. A reshaped response degrades to undefined rather than throwing. */
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

export function childBody(child: Child, clearPicture = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: child.first,
    last_name: child.last,
    birth_date: toDateStr(child.birth),
  };
  if (clearPicture) body.picture = null;
  return body;
}

/** Native bundles run expo/fetch, whose multipart encoder reads a part's `bytes()` and
 *  cannot read RN's `{ uri, name, type }` descriptor: that throws inside `fetch` before
 *  a byte leaves the device. The picker layer attaches the file object, since building
 *  it needs `expo-file-system` and this file stays free of native imports. */
function nativePicturePart(photo: PickedPhoto): UploadableFile {
  if (!photo.nativeFile) throw new ApiError(0, "Couldn't read the selected photo.");
  return photo.nativeFile;
}

/** Web only: cover-crop the picked image onto a 512px square canvas and return a
 *  compressed JPEG blob. The web picker has no crop/quality step of its own. */
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

/** Web is detected by `document` rather than `Platform`, so this file needs no
 *  `react-native` import and stays loadable under the node test runner. Native passes no
 *  filename: expo's FormData patch keeps the third argument only for a real `Blob`, so
 *  the native part is named after the picker's cache filename instead. */
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

/** The RequestInit for a child write that carries a picture.
 *
 *  NATIVE ENCODES THE MULTIPART ITSELF rather than handing `fetch` the `FormData`.
 *  Handing it over looks correct and is not: the request reaches Baby Buddy, returns 200,
 *  and applies nothing, so the photo and any name or birthday riding along are silently
 *  lost and the next refresh reverts them. Confirmed on device; the same upload by `curl`
 *  always worked. The mechanism inside expo/fetch was never established, and reading its
 *  source the `FormData` branch looks like it should work, so do not "simplify" this back
 *  to passing the `FormData`. Web keeps that path, where the browser owns the encoding. */
async function pictureInit(method: 'POST' | 'PATCH', child: Child, photo: PickedPhoto): Promise<RequestInit> {
  const form = await buildChildForm(child, photo);
  if (typeof document !== 'undefined') return { method, body: form };
  const { convertFormDataAsync } = await import('expo/src/winter/fetch/convertFormData');
  const { body, boundary } = await convertFormDataAsync(form);
  return {
    method,
    body: body as unknown as BodyInit,
    // Explicit, so the boundary cannot go missing: this wins over `request()`'s default.
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  };
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
    const method = init?.method ?? 'GET';
    // Away from the home LAN the server address often black-holes, and `fetch` then
    // neither resolves nor rejects until the platform's socket timeout, which can be
    // minutes. A write gets more room because aborting one the server actually committed
    // re-queues it and risks a duplicate.
    const timeoutMs = method === 'GET' ? 10000 : 20000;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
      // Let a mutating request outlive the page. An installed PWA freezes its webview the
      // instant it is backgrounded (locking the phone right after saving a log is the
      // common case), which cancels an in-flight fetch and drops the write to the offline
      // queue with no "offline" signal until the next foreground refresh. Never for
      // FormData: a photo upload can exceed keepalive's 64KB body budget. The abort timer
      // does not fight it, since freezing the page freezes the timer.
      const keepalive = typeof document !== 'undefined' && !isForm && method !== 'GET';
      res = await fetch(`${this.apiBase}${path}`, {
        ...init,
        keepalive,
        signal: controller.signal,
        headers: {
          Authorization: `Token ${this.token}`,
          // A FormData body must keep its auto-generated multipart boundary header.
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      // Timed out vs unreachable: distinct copy, same status 0, so callers switching on
      // the status keep working. `cause` matters because not every rejection here is the
      // network: `fetch` also throws when it cannot serialize the body.
      if (controller.signal.aborted) {
        throw new ApiError(0, 'Server took too long to respond.', { cause: err });
      }
      throw new ApiError(0, "Couldn't reach server. Check the URL and your connection.", { cause: err });
    } finally {
      clearTimeout(abortTimer);
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

  /** `/api/profile/` is read-only over the token API, so this is display only. */
  async getProfile(): Promise<Profile> {
    const raw = await this.request<unknown>('/profile/');
    return mapProfile(raw);
  }

  /** No create endpoint: Baby Buddy auto-creates a tag when an entry is POSTed
   *  carrying a new name. */
  async listTags(): Promise<Tag[]> {
    const data = await this.request<Paginated<any>>('/tags/?limit=100');
    return data.results.map((c) => ({
      name: c.name,
      color: c.color || undefined,
      lastUsed: c.last_used ? fromISO(c.last_used) : undefined,
    }));
  }

  /** No `color`: the avatar tint is a local concept, so inventing one here would key it
   *  to the server's list position and move it under the child on the next fetch. */
  async listChildren(): Promise<ServerChild[]> {
    const data = await this.request<Paginated<any>>('/children/?limit=100');
    return data.results.map((c) => ({
      id: String(c.id),
      serverId: c.id,
      first: c.first_name ?? '',
      last: c.last_name ?? '',
      // birth_date is date-only: parse as a LOCAL calendar day, never with fromISO,
      // which reads it as UTC midnight and desyncs it from childBody's serialization.
      birth: c.birth_date ? fromDateStr(c.birth_date) : Date.now(),
      slug: c.slug,
      picture: c.picture ?? null,
    }));
  }

  /** Baby Buddy keys the CHILD endpoints by SLUG, not by numeric id: its `ChildViewSet`
   *  sets `lookup_field = "slug"`, and only `TagViewSet` does the same. Every other
   *  resource is keyed by id, which is why the calls below address `{serverId}`.
   *  Addressing a child by numeric id 404s, which silently broke both delete and rename.
   *  The slug is derived from the name, so a rename moves it and a cached copy goes
   *  stale; `updateChild` re-stamps it from the PATCH response for that reason.
   *
   *  Undefined means "do not send the request": the child was never pushed, or the lookup
   *  positively established it is gone, which the caller treats as a no-op. */
  private async childKey(child: Child): Promise<string | number | undefined> {
    if (child.slug) return child.slug;
    if (child.serverId == null) return undefined;
    const match = (await this.listChildren()).find((c) => c.serverId === child.serverId);
    if (!match) return undefined; // confirmed gone server-side
    return match.slug ?? child.serverId;
  }

  /** Capturing the slug matters: without it a child created this session could not be
   *  renamed or deleted until the next refresh filled it in. */
  async createChild(
    child: Child,
    photo?: PickedPhoto,
  ): Promise<{ id?: number; slug?: string; picture?: string | null }> {
    const init: RequestInit = photo
      ? await pictureInit('POST', child, photo)
      : { method: 'POST', body: JSON.stringify(childBody(child)) };
    const res = await this.request<{ id?: number; slug?: string; picture?: string | null }>('/children/', init);
    return { id: res?.id, slug: res?.slug, picture: res?.picture ?? null };
  }

  /** Returns the stored picture URL (null when cleared or absent) plus the child's
   *  CURRENT slug, which a rename will have moved. Undefined when skipped, i.e. the
   *  child was never pushed. */
  async updateChild(
    child: Child,
    change: PhotoChange = { kind: 'none' },
  ): Promise<{ picture: string | null; slug?: string } | undefined> {
    if (child.serverId == null) return undefined;
    const key = await this.childKey(child);
    if (key == null) return undefined;
    const init: RequestInit =
      change.kind === 'set'
        ? await pictureInit('PATCH', child, change.photo)
        : { method: 'PATCH', body: JSON.stringify(childBody(child, change.kind === 'remove')) };
    const res = await this.request<{ picture?: string | null; slug?: string }>(`/children/${key}/`, init);
    return { picture: res?.picture ?? null, slug: res?.slug };
  }

  /** Addressed by slug (see `childKey`). Baby Buddy cascades the child's
   *  feedings/sleep/changes/etc., so no per-entry cleanup is needed. */
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
    return data.results.map((f) => {
      const feedType = FEED_TYPE_FROM_API[f.type] ?? 'breast';
      const method = FEED_METHOD_FROM_API[f.method] ?? 'left';
      const tags = tagNames(f.tags);
      const amount = f.amount != null ? Number(f.amount) : null;
      return {
        id: `feeding-${f.id}`,
        serverId: f.id,
        childId,
        type: 'feeding',
        start: fromISO(f.start),
        end: f.end ? fromISO(f.end) : null,
        feedType,
        method,
        // Volumes come back as-is. At the breast the field holds an intake
        // level, recovered from the tag (or from a legacy score, bucketed).
        amount: feedAmountIsVolume(feedType, method) ? amount : intakeLevelFromServer(tags, amount),
        notes: f.notes || undefined,
        // The intake tag is a wire detail, not one of the entry's own tags. Dropping it
        // keeps a changed level from shipping alongside the stale one.
        tags: tags.filter((t) => !isIntakeTag(t)),
      };
    });
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

  async listMedication(childId: string, limit = 50): Promise<MedicationEntry[]> {
    const data = await this.request<Paginated<any>>(
      `/medication/?child=${childId}&ordering=-time&limit=${limit}`,
    );
    return data.results.map((r) => ({
      id: `medication-${r.id}`,
      serverId: r.id,
      childId,
      type: 'medication',
      time: fromISO(r.time),
      name: r.name ?? '',
      // dosage is a plain number; dosage_unit is free text (never unit-converted).
      dosage: r.dosage != null ? Number(r.dosage) : undefined,
      dosageUnit: r.dosage_unit || undefined,
      nextDoseIntervalSec: r.next_dose_interval ? durationToSec(r.next_dose_interval) : undefined,
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

  /** Baths, milestones and general notes share `/api/notes/`, so one fetch feeds all
   *  three. Milestone is checked first, so a note carrying both markers is a milestone.
   *
   *  `treatment`-tagged notes are dropped: they are regimens, not timeline events, and
   *  `listChildTreatments` fetches them by tag. Recognising them here is still necessary,
   *  or they would fall through to general notes and show up in the Notes tab. */
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
      else if (isTreatmentNote(n) || isGenderNote(n) || isBathRhythmNote(n)) continue;
      else notes.push(noteToNoteEntry(n, childId));
    }
    return { baths, milestones, notes };
  }

  /** Filtered server-side by tag (`NoteFilter` extends `TagsFieldFilter`) rather than
   *  read out of the recent-notes window: a treatment note is dated at the regimen's
   *  START, so a long-running one would fall off the end of `listChildNotes`. */
  async listChildTreatments(childId: string, limit = 100): Promise<Treatment[]> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childId}&tags=${TREATMENT_TAG}&ordering=-time&limit=${limit}`,
    );
    // The tag filter is server-side, so re-check locally: an instance that ignores it
    // would otherwise turn every note into a treatment.
    return data.results.filter((n: any) => isTreatmentNote(n)).map((n: any) => noteToTreatment(n, childId));
  }

  /** Keyed by the child's SERVER id. Notes come back newest-first, so the first note seen
   *  per child wins and an older duplicate loses without needing a cleanup pass.
   *  Unfiltered by child on purpose: one request covers the whole account, where
   *  per-child fetches would be one request per child on every load. */
  async listGenders(limit = 200): Promise<Map<number, ChildGender>> {
    const data = await this.request<Paginated<any>>(
      `/notes/?tags=${GENDER_TAG}&ordering=-time&limit=${limit}`,
    );
    const out = new Map<number, ChildGender>();
    for (const n of data.results) {
      // Re-check locally: an ignored filter would read a plain note's absent `g:` tag as
      // a real answer.
      if (!isGenderNote(n)) continue;
      const childServerId = typeof n.child === 'number' ? n.child : Number(n.child);
      const gender = genderFromNote(n);
      if (!Number.isFinite(childServerId) || !gender || out.has(childServerId)) continue;
      out.set(childServerId, gender);
    }
    return out;
  }

  /** Reads before writing rather than caching the note id locally: the id would be one
   *  more thing to keep in sync across devices, and a gender is written rarely enough
   *  that the extra GET costs nothing. */
  async setChildGender(childServerId: number, gender: ChildGender | undefined, atMs: number): Promise<void> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childServerId}&tags=${GENDER_TAG}&ordering=-time&limit=1`,
    );
    const existing = data.results.find((n: any) => isGenderNote(n));
    if (gender == null) {
      if (existing) await this.request(`/notes/${existing.id}/`, { method: 'DELETE' });
      return;
    }
    const body = JSON.stringify(genderToNoteBody(gender, childServerId, atMs));
    if (existing) await this.request(`/notes/${existing.id}/`, { method: 'PATCH', body });
    else await this.request('/notes/', { method: 'POST', body });
  }

  /** Keyed by the child's SERVER id, one account-wide request, newest note per child
   *  wins: the same shape as `listGenders`, for the same reasons. Values stay PARTIAL;
   *  the caller clamps them against the rhythm it would otherwise have used. */
  async listBathRhythms(limit = 200): Promise<Map<number, Partial<BathRhythm>>> {
    const data = await this.request<Paginated<any>>(
      `/notes/?tags=${encodeURIComponent(BATH_RHYTHM_TAG)}&ordering=-time&limit=${limit}`,
    );
    const out = new Map<number, Partial<BathRhythm>>();
    for (const n of data.results) {
      // Re-check locally: an instance that ignores the tag filter would otherwise read
      // every plain note as a rhythm and flatten every child to the default cadence.
      if (!isBathRhythmNote(n)) continue;
      const childServerId = typeof n.child === 'number' ? n.child : Number(n.child);
      const rhythm = bathRhythmFromNote(n);
      if (!Number.isFinite(childServerId) || !rhythm || out.has(childServerId)) continue;
      out.set(childServerId, rhythm);
    }
    return out;
  }

  /** Reads before writing rather than caching the note id locally, as gender does: the
   *  id would be one more thing to keep in sync across devices, and a rhythm changes
   *  rarely enough that the extra GET costs nothing. */
  async setChildBathRhythm(childServerId: number, rhythm: BathRhythm, atMs: number): Promise<void> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childServerId}&tags=${encodeURIComponent(BATH_RHYTHM_TAG)}&ordering=-time&limit=1`,
    );
    const existing = data.results.find((n: any) => isBathRhythmNote(n));
    const body = JSON.stringify(bathRhythmToNoteBody(rhythm, childServerId, atMs));
    if (existing) await this.request(`/notes/${existing.id}/`, { method: 'PATCH', body });
    else await this.request('/notes/', { method: 'POST', body });
  }

  async createTreatment(treatment: Treatment, childServerId: number): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>('/notes/', {
      method: 'POST',
      body: JSON.stringify(treatmentToNoteBody(treatment, childServerId)),
    });
    return res?.id;
  }

  async updateTreatment(treatment: Treatment, childServerId: number): Promise<void> {
    if (treatment.serverId == null) return;
    await this.request(`/notes/${treatment.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(treatmentToNoteBody(treatment, childServerId)),
    });
  }

  /** Deletes the regimen only: the doses already logged from it are ordinary medication
   *  entries and stay put. */
  async deleteTreatment(serverId: number): Promise<void> {
    await this.request(`/notes/${serverId}/`, { method: 'DELETE' });
  }

  private buildBody(entry: Entry, childServerId: number): Record<string, unknown> {
    const child = childServerId;
    const tags = entry.tags ?? [];
    switch (entry.type) {
      case 'feeding': {
        // At the breast `amount` is an intake level, which Baby Buddy would read as
        // millilitres and sum into the child's feeding totals, so it goes out as a tag.
        const isVolume = feedAmountIsVolume(entry.feedType, entry.method);
        const level = entry.amount == null ? null : INTAKE_LEVELS.bucket(entry.amount);
        const own = tags.filter((t) => !isIntakeTag(t));
        return {
          child,
          start: toISO(entry.start),
          end: toISO(entry.end ?? entry.start),
          type: FEED_TYPE_TO_API[entry.feedType],
          method: FEED_METHOD_TO_API[entry.method],
          amount: isVolume ? entry.amount : null,
          notes: entry.notes ?? '',
          tags: !isVolume && level != null ? [...own, INTAKE_TAGS[level - 1]] : own,
        };
      }
      case 'sleep':
        // `nap` goes out explicitly so the client wins: Baby Buddy derives it from its own
        // NAP_START_MIN/NAP_START_MAX when the field is absent, so omitting it makes a
        // manual Nap/Night choice revert on the next `listSleep`. The tradeoff is that
        // Budkin's nap window then overrides that instance's setting for everyone on it.
        return { child, start: toISO(entry.start), end: toISO(entry.end ?? entry.start), nap: entry.nap, notes: entry.notes ?? '', tags };
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
      case 'medication': {
        // dosage, unit and interval have unknown server nullability, so they are omitted
        // when unset rather than sent as null: a partly-filled entry then validates and
        // DRF keeps its own defaults.
        const body: Record<string, unknown> = { child, time: toISO(entry.time), name: entry.name, tags };
        if (entry.dosage != null) body.dosage = entry.dosage;
        if (entry.dosageUnit) body.dosage_unit = entry.dosageUnit;
        if (entry.nextDoseIntervalSec != null) body.next_dose_interval = secToDuration(entry.nextDoseIntervalSec);
        // Always sent: an empty string is what clears it on a PATCH edit.
        body.notes = entry.notes ?? '';
        return body;
      }
      case 'bath':
        return bathToNoteBody(entry, childServerId);
      case 'note':
        return noteToNoteBody(entry, childServerId);
      case 'milestone':
        return milestoneToNoteBody(entry, childServerId);
    }
  }

  async createEntry(entry: Entry, childServerId: number): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>(`/${ENDPOINT[entry.type]}/`, {
      method: 'POST',
      body: JSON.stringify(this.buildBody(entry, childServerId)),
    });
    return res?.id;
  }

  async updateEntry(entry: Entry, childServerId: number): Promise<void> {
    if (entry.serverId == null) return;
    await this.request(`/${ENDPOINT[entry.type]}/${entry.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(this.buildBody(entry, childServerId)),
    });
  }

  async deleteEntry(type: ActivityType, serverId: number): Promise<void> {
    await this.request(`/${ENDPOINT[type]}/${serverId}/`, { method: 'DELETE' });
  }

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

  async listTimers(limit = 100): Promise<ServerTimer[]> {
    const data = await this.request<Paginated<any>>(`/timers/?limit=${limit}`);
    return data.results.map((t) => ({
      id: t.id,
      child: t.child ?? null,
      name: t.name ?? '',
      start: fromISO(t.start),
    }));
  }

  async createTimer(childServerId: number, startMs: number, name: string): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>('/timers/', {
      method: 'POST',
      body: JSON.stringify({ child: childServerId, start: toISO(startMs), name }),
    });
    return res?.id;
  }

  async updateTimer(id: number, name: string, startMs: number): Promise<void> {
    await this.request(`/timers/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ name, start: toISO(startMs) }),
    });
  }

  async deleteTimer(id: number): Promise<void> {
    await this.request(`/timers/${id}/`, { method: 'DELETE' });
  }
}
