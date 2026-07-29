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

import { INTAKE_LEVELS, feedAmountIsVolume } from '@/lib/activities';
import type {
  ActivityType,
  BathEntry,
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
  medication: 'medication',
  note: 'notes',
  milestone: 'notes',
};

/**
 * Baby Buddy DurationField <-> whole seconds, for the medication
 * `next_dose_interval`. Django REST Framework serializes a duration as
 * `[D ]HH:MM:SS[.ffffff]` (an optional leading day count), so parse that shape
 * back to seconds and format the reverse. A bare numeric string is tolerated on
 * read. Returns undefined for anything unparseable so a malformed value degrades
 * to "no interval" rather than NaN.
 */
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

// --- breastfeeding intake <-> Baby Buddy tag ---
// Baby Buddy's `Feeding.amount` is a plain float that it reads as a VOLUME and
// sums into its feeding-amount statistics, so a subjective intake level must not
// be written there: a level 3 would land in those totals as 3 ml. The level
// rides as a structural tag instead and `amount` goes out null.
//
// The names are prefixed, like the milestone `mk:` tags, so they can never be
// mistaken for the bare `left`/`right` start-side markers that a breastfeed also
// carries, nor collide with a tag the user typed themselves.
//
// KNOWN LIMITATION: the scheme is name-based, so a tag named `intake:...` that
// the user had already created in Baby Buddy before Budkin claimed the prefix is
// indistinguishable from one of ours. It is dropped on read and not written
// back, so a later edit removes it from the server. `isHiddenTag` stops Budkin
// offering to create one, but it cannot un-create an existing one. Preserving it
// is not free: keeping such a tag through a write is exactly what would let a
// stale level survive a level change or a switch to a bottle, which is the bug
// the stripping exists to prevent. Given the prefix and how narrow the window
// is, the trade favours never shipping a wrong level.
// Index 0..2 == level 1..3.
const INTAKE_TAGS = ['intake:little', 'intake:some', 'intake:lot'] as const;

const isIntakeTag = (t: string): boolean => t.startsWith('intake:');

/**
 * Bucket a legacy 1 to 10 intake score into a level, by thirds: 1-3 is a
 * little, 4-7 is some, 8-10 is a lot.
 *
 * Only ever applied to a number that arrived WITHOUT an intake tag, which means
 * it predates the level scale (an older Budkin) or was typed into Baby Buddy's
 * own UI. Baby Buddy's field is an unconstrained float, so any finite value has
 * to land somewhere.
 */
function bucketLegacyIntake(score: number): 1 | 2 | 3 {
  return score <= 3 ? 1 : score <= 7 ? 2 : 3;
}

/** The intake level a server feeding carries: its tag if it has one, else its
 *  legacy numeric score bucketed. `null` when the feed records no intake. */
function intakeLevelFromServer(tags: string[], amount: number | null): 1 | 2 | 3 | null {
  const i = INTAKE_TAGS.findIndex((t) => tags.includes(t));
  if (i >= 0) return (i + 1) as 1 | 2 | 3;
  if (amount == null || !Number.isFinite(amount)) return null;
  return bucketLegacyIntake(amount);
}

// --- milestone <-> Baby Buddy Note (tagged-note) serialization ---
// Baby Buddy has no milestone resource, so a reached milestone is a Note tagged
// `milestone` (marker) + `mk:<key>` (which one). Same pattern as baths.
const isStructuralMilestoneTag = (t: string): boolean => t === 'milestone' || t.startsWith('mk:');

// --- treatment structural tags ---
// A treatment is a Note tagged `treatment` plus its schedule; the full encoding
// and the reasoning behind the tag/body split live with the serializers further
// down.
const TREATMENT_TAG = 'treatment';
const TREATMENT_TOD_PREFIX = 'treatment:tod:';
const TREATMENT_EVERY_PREFIX = 'treatment:every:';
const TREATMENT_PAUSED_TAG = 'treatment:paused';

const isStructuralTreatmentTag = (t: string): boolean => t === TREATMENT_TAG || t.startsWith('treatment:');

// --- gender structural tags ---
// Baby Buddy's `Child` model carries only first_name / last_name / birth_date /
// birth_time / slug / picture — there is no gender field, and DRF drops unknown
// keys silently, so a `gender` sent to /api/children/ would vanish without an
// error. A child's gender therefore rides as a `gender`-tagged note against that
// child, the same channel baths, milestones and treatments use.
const GENDER_TAG = 'gender';
const GENDER_PREFIX = 'g:';

const isStructuralGenderTag = (t: string): boolean => t === GENDER_TAG || t.startsWith(GENDER_PREFIX);

/** True for any tag the picker must never surface or let the user create: the
 *  bath/side structural tags plus the milestone marker, mk:<key>, intake level
 *  and treatment schedule tags. */
export function isHiddenTag(name: string): boolean {
  return (
    HIDDEN_TAGS.has(name) ||
    isStructuralMilestoneTag(name) ||
    isIntakeTag(name) ||
    isStructuralTreatmentTag(name) ||
    isStructuralGenderTag(name)
  );
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

// --- treatment <-> Baby Buddy Note (tagged-note) serialization ---
// Baby Buddy has no regimen resource, so a treatment is a Note tagged
// `treatment` plus its schedule: `treatment:tod:<slot>` per chosen time of day,
// or `treatment:every:<hours>`, plus `treatment:paused` while the treatment is
// off. Same tagged-note pattern as baths and milestones.
//
// Why the split between tags and body: the SCHEDULE rides in tags because it is
// bounded (four slots, a whole number of hours), and a Baby Buddy tag name is
// globally unique and shared by every record on the server. Putting a free-text
// value like a medication name or a dosage unit in a tag would mint a new global
// tag per treatment and pollute the tag list for every other client. So the
// free-text and date fields ride in the note BODY instead, as a machine-readable
// payload line beneath a human-readable summary. A body edited by hand in Baby
// Buddy's own UI therefore degrades to the tag-borne schedule plus a best-effort
// name, rather than losing the treatment altogether.
//
// KNOWN LIMITATION: the scheme is name-based, exactly like the `intake:` tags
// above. A tag the user had already created called `treatment` (or `treatment:…`)
// is indistinguishable from ours, and any note carrying it will read back here as
// a regimen.
/** Marks the machine-readable line in a treatment note's body. Versioned so a
 *  later encoding can be told apart from this one instead of being mis-parsed. */
const TREATMENT_PAYLOAD_PREFIX = 'budkin-treatment-v1:';

const TREATMENT_TIMES_OF_DAY: TreatmentTimeOfDay[] = ['morning', 'noon', 'evening', 'night'];

/** The single discriminator: a treatment note carries the `treatment` tag. */
export function isTreatmentNote(n: any): boolean {
  return tagNames(n?.tags).includes(TREATMENT_TAG);
}

/** The human-readable first line of a treatment note, e.g.
 *  "Omeprazol, 2.5 mL, morning and evening". Kept independent of the UI's label
 *  helpers so the API layer does not reach into `features/`. */
function treatmentSummary(treatment: Treatment): string {
  const dose = treatment.dosage == null ? '' : [String(treatment.dosage), treatment.dosageUnit].filter(Boolean).join(' ');
  const schedule =
    treatment.scheduleMode === 'everyHours'
      ? treatment.everyHours == null
        ? ''
        : `every ${treatment.everyHours} ${treatment.everyHours === 1 ? 'hour' : 'hours'}`
      : TREATMENT_TIMES_OF_DAY.filter((tod) => treatment.timesOfDay?.includes(tod)).join(', ');
  return [treatment.name.trim(), dose, schedule].filter(Boolean).join(', ');
}

/** Encode a treatment as the body for a Baby Buddy Note (create/update). */
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
  } else {
    for (const tod of TREATMENT_TIMES_OF_DAY) if (treatment.timesOfDay?.includes(tod)) tags.push(`${TREATMENT_TOD_PREFIX}${tod}`);
  }
  if (!treatment.active) tags.push(TREATMENT_PAUSED_TAG);

  return {
    child: childServerId,
    // A regimen is not a point event; dating the note at its start is the one
    // timestamp that means something, and `listChildTreatments` filters by tag rather
    // than recency so an old start date can never push a treatment out of view.
    time: toISO(treatment.fromDate),
    note: `${treatmentSummary(treatment)}\n${TREATMENT_PAYLOAD_PREFIX}${JSON.stringify(payload)}`,
    tags,
  };
}

/** The payload object encoded in a treatment note's body, or `null` when the body
 *  carries none (hand-edited in Baby Buddy, or written by an older client). */
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

/**
 * Reconstruct a treatment from a Baby Buddy Note carrying the `treatment` tag. The tags are
 * the source of truth for the schedule and the paused flag; the body payload
 * supplies the name, dose, dates and free text. With no usable payload the treatment
 * still comes back with its schedule intact and the body's first line as its
 * name, which is what keeps a hand-edited note from destroying the record.
 */
export function noteToTreatment(n: any, childId: string): Treatment {
  const tags = tagNames(n.tags);
  const payload = treatmentNotePayload(String(n.note ?? '')) ?? {};
  const everyTag = tags.find((t) => t.startsWith(TREATMENT_EVERY_PREFIX));
  const everyHours = everyTag ? Number(everyTag.slice(TREATMENT_EVERY_PREFIX.length)) : Number.NaN;
  const timesOfDay = TREATMENT_TIMES_OF_DAY.filter((tod) => tags.includes(`${TREATMENT_TOD_PREFIX}${tod}`));
  const isInterval = Number.isFinite(everyHours);
  const fromDate = asString(payload.fromDate);
  const toDate = asString(payload.toDate);

  return {
    id: `treatment-${n.id}`,
    serverId: n.id,
    childId,
    // Falls back to the note's first line, which is the human summary we wrote.
    name: asString(payload.name) ?? String(n.note ?? '').split('\n')[0]?.trim() ?? '',
    scheduleMode: isInterval ? 'everyHours' : 'timesOfDay',
    ...(isInterval ? { everyHours } : { timesOfDay }),
    dosage: asNumber(payload.dosage),
    dosageUnit: asString(payload.dosageUnit),
    // The note's own time is exactly what `treatmentToNoteBody` wrote the start date
    // from, so it is a lossless fallback for a missing payload.
    fromDate: fromDate ? fromDateStr(fromDate) : startOfLocalDay(fromISO(n.time)),
    toDate: toDate ? fromDateStr(toDate) : undefined,
    condition: asString(payload.condition),
    notes: asString(payload.notes),
    active: !tags.includes(TREATMENT_PAUSED_TAG),
  };
}

// --- gender <-> Baby Buddy Note (tagged-note) serialization ---
// One note per child, tagged `gender` + `g:<value>`. An attribute rather than an
// event, so unlike a bath its `time` carries no meaning beyond recency: the
// NEWEST gender note for a child wins, which is what lets a re-write that failed
// to find the old note still resolve to the right answer.

const CHILD_GENDERS: ChildGender[] = ['girl', 'boy'];

/** The single discriminator: a gender note carries the `gender` tag. */
export function isGenderNote(n: any): boolean {
  return tagNames(n?.tags).includes(GENDER_TAG);
}

/** Encode a child's gender as the body for a Baby Buddy Note (create/update). */
export function genderToNoteBody(gender: ChildGender, childServerId: number, atMs: number): Record<string, unknown> {
  return {
    child: childServerId,
    time: toISO(atMs),
    note: `Gender: ${gender}`,
    tags: [GENDER_TAG, `${GENDER_PREFIX}${gender}`],
  };
}

/** The gender a `gender`-tagged note records, or undefined when its `g:` tag is
 *  missing or holds a value this build doesn't know. */
export function genderFromNote(n: any): ChildGender | undefined {
  const tags = tagNames(n?.tags);
  const tag = tags.find((t) => t.startsWith(GENDER_PREFIX));
  const value = tag?.slice(GENDER_PREFIX.length);
  return CHILD_GENDERS.find((g) => g === value);
}

/** Local midnight of the day containing `ms`. Treatment dates are stored at local
 *  midnight, so a fallback derived from a timestamp has to be floored to it. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
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
      // On web, let a mutating request outlive the page. An installed PWA freezes
      // its webview the instant it is backgrounded — locking the phone right after
      // a log is saved is the common case — which cancels a normal in-flight fetch
      // and drops the write to the offline queue, where it sits (with no "offline"
      // signal, since the app never actually went offline) until the next
      // foreground refresh replays it. `keepalive` tells the browser to complete
      // the request regardless. Web only (native fetch has no such freeze and does
      // not support the flag); never for FormData (a photo upload can exceed
      // keepalive's 64KB body budget); writes only (a GET has no side effect to
      // lose).
      const method = init?.method ?? 'GET';
      const keepalive = typeof document !== 'undefined' && !isForm && method !== 'GET';
      res = await fetch(`${this.apiBase}${path}`, {
        ...init,
        keepalive,
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
        // The intake tag is a wire detail, not one of the entry's own tags:
        // `amount` is the local truth and `buildBody` re-derives the tag on the
        // way out. Dropping it here is what keeps a changed level from shipping
        // alongside the stale one.
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
      // next_dose_interval is a duration string; parse to seconds when present.
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

  /**
   * Read the child's recent `/api/notes/` ONCE and partition it three ways:
   * `milestone`-tagged notes become `MilestoneEntry`s, `bath`-tagged notes become
   * `BathEntry`s, and everything else becomes general `NoteEntry`s. All three
   * share this one endpoint, so a single fetch feeds them all — no double-fetch.
   * Milestone is checked first, so a note carrying both marker tags is a milestone.
   *
   * `treatment`-tagged notes are DROPPED here rather than returned: they are treatment
   * regimens, not timeline events, and `listChildTreatments` fetches them in full by
   * tag. Recognising them is still this method's job, because otherwise they
   * would fall through to the general-notes bucket and show up in the Notes tab.
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
      else if (isTreatmentNote(n) || isGenderNote(n)) continue;
      else notes.push(noteToNoteEntry(n, childId));
    }
    return { baths, milestones, notes };
  }

  /**
   * The child's treatment regimens, as `treatment`-tagged notes. Filtered server-side
   * by tag (`NoteFilter` extends `TagsFieldFilter`) rather than read out of the
   * recent-notes window: a treatment note is dated at the regimen's START, so a
   * long-running treatment would otherwise fall off the end of `listChildNotes`
   * and silently vanish from the other device.
   */
  async listChildTreatments(childId: string, limit = 100): Promise<Treatment[]> {
    const data = await this.request<Paginated<any>>(
      `/notes/?child=${childId}&tags=${TREATMENT_TAG}&ordering=-time&limit=${limit}`,
    );
    // The tag filter is a server-side `tags__name in [...]` match, so re-check
    // locally: an instance that ignores the filter would otherwise turn every
    // note into a treatment.
    return data.results.filter((n: any) => isTreatmentNote(n)).map((n: any) => noteToTreatment(n, childId));
  }

  /**
   * Every child's gender in ONE request, keyed by the child's SERVER id. Notes
   * come back newest-first, so the first note seen per child wins and an older
   * duplicate (left behind by a write that couldn't find the previous note)
   * loses without needing a cleanup pass.
   *
   * Unfiltered by child on purpose: one request covers the whole account, where
   * per-child fetches would be one request per child on every load.
   */
  async listGenders(limit = 200): Promise<Map<number, ChildGender>> {
    const data = await this.request<Paginated<any>>(
      `/notes/?tags=${GENDER_TAG}&ordering=-time&limit=${limit}`,
    );
    const out = new Map<number, ChildGender>();
    for (const n of data.results) {
      // Re-check the tag locally: an instance that ignored the filter would
      // otherwise read a plain note's absent `g:` tag as a real answer.
      if (!isGenderNote(n)) continue;
      const childServerId = typeof n.child === 'number' ? n.child : Number(n.child);
      const gender = genderFromNote(n);
      if (!Number.isFinite(childServerId) || !gender || out.has(childServerId)) continue;
      out.set(childServerId, gender);
    }
    return out;
  }

  /**
   * Write a child's gender, overwriting the existing `gender` note when there is
   * one and deleting it when `gender` is undefined ("not recorded"). Reads
   * before writing rather than caching the note id locally: the id would be one
   * more thing to keep in sync across devices, and a gender is written rarely
   * enough that the extra GET costs nothing.
   */
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

  /** Create a treatment on the server as a tagged note; returns its new server id. */
  async createTreatment(treatment: Treatment, childServerId: number): Promise<number | undefined> {
    const res = await this.request<{ id?: number }>('/notes/', {
      method: 'POST',
      body: JSON.stringify(treatmentToNoteBody(treatment, childServerId)),
    });
    return res?.id;
  }

  /** Overwrite an already-synced treatment's note. */
  async updateTreatment(treatment: Treatment, childServerId: number): Promise<void> {
    if (treatment.serverId == null) return;
    await this.request(`/notes/${treatment.serverId}/`, {
      method: 'PATCH',
      body: JSON.stringify(treatmentToNoteBody(treatment, childServerId)),
    });
  }

  /** Delete a treatment's note. Deleting a treatment deletes the regimen only; the doses
   *  already logged from it are ordinary medication entries and stay put. */
  async deleteTreatment(serverId: number): Promise<void> {
    await this.request(`/notes/${serverId}/`, { method: 'DELETE' });
  }

  private buildBody(entry: Entry, childServerId: number): Record<string, unknown> {
    const child = childServerId;
    const tags = entry.tags ?? [];
    switch (entry.type) {
      case 'feeding': {
        // At the breast, `amount` is an intake level, and Baby Buddy would read
        // any number in its `amount` as millilitres and sum it into the child's
        // feeding totals. So the level goes out as a tag and `amount` as null.
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
        // `nap` goes out explicitly so the CLIENT wins. Baby Buddy derives nap
        // from its own server-side NAP_START_MIN/NAP_START_MAX when the field is
        // absent, so omitting it (as this did) meant a manual Nap/Night choice
        // silently reverted on the next `listSleep`. Sending it means Budkin's
        // nap window overrides that Baby Buddy instance's own setting for
        // everyone using it, not just this device.
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
        // /api/medication/ has a required name + a single time. dosage, unit and
        // interval are numeric/duration fields whose server nullability is
        // unknown, so omit them when unset (rather than sending null) so a
        // partly-filled entry validates and DRF keeps its own defaults.
        // dosage_unit is Baby Buddy's free text, sent verbatim.
        const body: Record<string, unknown> = { child, time: toISO(entry.time), name: entry.name, tags };
        if (entry.dosage != null) body.dosage = entry.dosage;
        if (entry.dosageUnit) body.dosage_unit = entry.dosageUnit;
        if (entry.nextDoseIntervalSec != null) body.next_dose_interval = secToDuration(entry.nextDoseIntervalSec);
        // notes is a blankable text field (temperature clears it the same way),
        // so always send it: an empty string clears it on a PATCH edit.
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
