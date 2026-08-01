#!/usr/bin/env node
/**
 * One-shot Baby Buddy migration: move the bath size tags to the `bath:` prefix.
 *
 * Budkin stores a bath as a Note tagged `bath` plus a size tag. That size tag was
 * a bare `small` or `big` until 2026-08 and is now `bath:quick` / `bath:full`.
 * This script moves the existing server-side records across.
 *
 * What changes, per note carrying the `bath` tag:
 *   tag  `small`            -> `bath:quick`
 *   tag  `big`              -> `bath:full`
 *   body `Bath, small wash` -> `Quick wash`
 *   body `Bath, big wash`   -> `Full bath`
 * The `bath` marker tag, every user tag, and any hand-edited body are left
 * untouched.
 *
 * SCOPING, and why this script is narrower than the cure/treatment one: `small`
 * and `big` are ordinary words that may legitimately tag a feeding, a sleep, or
 * anything else. Only notes that actually carry the `bath` tag are rewritten,
 * re-checked locally rather than trusted from the server filter.
 *
 * The app still READS a bare `big` tag, so a note this script misses keeps
 * reporting the right wash and self-heals on its next edit. The migration is
 * therefore a tidy-up, not a correctness gate.
 *
 * There is deliberately NO --delete-old-tags. In Baby Buddy a tag can attach to
 * feedings, changes, sleeps and more, so proving `small` is unused would mean
 * sweeping every model, and deleting a tag you use elsewhere is not worth the
 * tidiness. Delete them by hand in Baby Buddy's tag admin, where usage is visible.
 *
 * USAGE
 *   Dry run (the default; writes nothing, prints every intended change):
 *     node scripts/migrate-bath-tags.mjs --url=https://bb.example.org --token=abc123
 *
 *   Apply:
 *     node scripts/migrate-bath-tags.mjs --url=... --token=... --apply
 *
 * OPTIONS
 *   --url=<base>     Baby Buddy base URL, with or without a trailing /api.
 *                    Env fallback: BABYBUDDY_URL
 *   --token=<key>    Baby Buddy API token. Env fallback: BABYBUDDY_TOKEN
 *   --apply          Actually write. Without it nothing is sent but GETs.
 *   --page-size=<n>  Notes fetched per request (default 100).
 *   -h, --help       This text.
 *
 * SAFE RUN ORDER
 *   1. Open the CURRENT app on every device while online and let it settle, so
 *      no device is holding a queued write that would land mid-migration.
 *   2. Run in dry-run mode and read the report.
 *   3. Run again with --apply.
 *
 * Re-running is safe: a migrated note no longer carries a bare size tag, so a
 * second run finds nothing. The per-note mapping is idempotent regardless.
 *
 * Plain Node, no dependencies. Needs Node 18+ for global fetch.
 */

import { pathToFileURL } from 'node:url';

const BATH_TAG = 'bath';
const TAG_MAP = { small: 'bath:quick', big: 'bath:full' };
const BODY_MAP = { 'Bath, small wash': 'Quick wash', 'Bath, big wash': 'Full bath' };

// --- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const opts = { apply: false, pageSize: 100, help: false };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('--url=')) opts.url = arg.slice('--url='.length);
    else if (arg.startsWith('--token=')) opts.token = arg.slice('--token='.length);
    else if (arg.startsWith('--page-size=')) opts.pageSize = Number(arg.slice('--page-size='.length));
    else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Run with --help for usage.');
      process.exit(2);
    }
  }
  return opts;
}

/** Same normalisation the app applies, plus tolerating a pasted `/api` suffix. */
function apiBase(raw) {
  let url = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  url = url.replace(/\/api$/i, '');
  return url + '/api';
}

// --- HTTP -------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}${body ? ': ' + body.slice(0, 300) : ''}`);
    this.status = status;
  }
}

async function request(base, token, path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore body read errors */
    }
    throw new HttpError(res.status, body);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

// --- pure mapping helpers (the actual migration rules) ----------------------

/** Baby Buddy returns tags as objects on read and accepts names on write. */
export function tagNames(raw) {
  return (Array.isArray(raw) ? raw : []).map((t) => (typeof t === 'string' ? t : t?.name)).filter((n) => typeof n === 'string');
}

/**
 * Map a whole tag list, preserving order and dropping duplicates the mapping
 * could create (a note already carrying both `big` and `bath:full`). Only an
 * EXACT `small` or `big` is rewritten, so `smallish` and `bigger` survive.
 */
export function mapTagList(names) {
  const out = [];
  for (const n of names) {
    const mapped = TAG_MAP[n] ?? n;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Rewrite a note body, but only when it is EXACTLY one Budkin generated. A body
 * someone edited in Baby Buddy comes back byte-identical, because there is no
 * way to rewrite the vocabulary inside it without risking their words.
 */
export function mapNoteBody(body) {
  const text = String(body ?? '');
  return BODY_MAP[text] ?? text;
}

/**
 * The full per-note plan, or null when the note needs nothing.
 *
 * Returns null for any note WITHOUT the `bath` tag, whatever else it carries.
 * That is the whole safety property of this script.
 */
export function planForNote(note) {
  const oldTags = tagNames(note.tags);
  if (!oldTags.includes(BATH_TAG)) return null;
  const newTags = mapTagList(oldTags);
  const oldBody = String(note.note ?? '');
  const newBody = mapNoteBody(oldBody);
  const tagsChanged = newTags.length !== oldTags.length || newTags.some((t, i) => t !== oldTags[i]);
  const bodyChanged = newBody !== oldBody;
  if (!tagsChanged && !bodyChanged) return null;
  return { oldTags, newTags, oldBody, newBody, tagsChanged, bodyChanged };
}

// --- fetching ---------------------------------------------------------------

/**
 * Every note carrying the `bath` tag, collected in FULL before anything is
 * written. Collection and mutation are kept strictly in that order, so a page
 * boundary never shifts underneath an in-flight patch.
 *
 * `ordering=id` is not decoration. DRF's limit/offset pagination over an
 * unordered queryset can shift page boundaries between requests, duplicating one
 * row and dropping another. Budkin dates every bath note at the moment it was
 * logged, so ties on the default `-time` ordering are possible, and ties are
 * exactly where row order stops being guaranteed.
 *
 * Returns the server's own `count` alongside the rows so the caller can prove it
 * saw everything, rather than trusting that the loop terminated for a good
 * reason.
 */
async function fetchAllBathNotes(base, token, pageSize) {
  const notes = [];
  let offset = 0;
  let expected = null;
  for (;;) {
    const page = await request(base, token, `/notes/?tags=${encodeURIComponent(BATH_TAG)}&ordering=id&limit=${pageSize}&offset=${offset}`);
    const results = Array.isArray(page?.results) ? page.results : [];
    if (expected === null && typeof page?.count === 'number') expected = page.count;
    notes.push(...results);
    if (results.length === 0 || !page?.next) break;
    offset += results.length;
    // Belt and braces against a server that always reports a `next`.
    if (expected !== null && notes.length >= expected) break;
  }
  return { notes, reported: expected };
}

// --- main -------------------------------------------------------------------

const HELP = `Move the Baby Buddy bath size tags to the \`bath:\` prefix.

  node scripts/migrate-bath-tags.mjs --url=<base> --token=<key> [--apply]

Dry run by default. See the header comment in this file for the full options
list and the safe run order.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  const rawUrl = opts.url ?? process.env.BABYBUDDY_URL;
  const token = opts.token ?? process.env.BABYBUDDY_TOKEN;
  if (!rawUrl || !token) {
    console.error('Missing server URL or token.');
    console.error('Pass --url=<base> --token=<key>, or set BABYBUDDY_URL / BABYBUDDY_TOKEN.');
    return 2;
  }
  if (!Number.isFinite(opts.pageSize) || opts.pageSize < 1) {
    console.error('--page-size must be a positive number.');
    return 2;
  }

  const base = apiBase(rawUrl);
  const mode = opts.apply ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)';
  console.log(`Baby Buddy: ${base}`);
  console.log(`Mode:       ${mode}`);
  console.log('');

  let notes;
  let reported;
  try {
    ({ notes, reported } = await fetchAllBathNotes(base, token, opts.pageSize));
  } catch (e) {
    console.error(`Could not list \`${BATH_TAG}\`-tagged notes: ${e.message}`);
    return 1;
  }

  // The one number that proves the scan was complete. If these disagree, the
  // pagination under-scanned and the run must not be trusted.
  if (reported !== null && reported !== notes.length) {
    console.error(`WARNING: server reported ${reported} \`${BATH_TAG}\`-tagged notes but only ${notes.length} were collected.`);
    console.error('Re-run before trusting the counts below. The migration is idempotent, so a re-run is safe.');
    console.error('');
  }

  let found = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (const note of notes) {
    const plan = planForNote(note);
    if (!plan) {
      skipped++;
      continue;
    }
    found++;
    console.log(`note ${note.id}:`);
    if (plan.tagsChanged) {
      console.log(`  tags [${plan.oldTags.join(', ')}]`);
      console.log(`    -> [${plan.newTags.join(', ')}]`);
    }
    if (plan.bodyChanged) {
      console.log(`  body "${plan.oldBody}" -> "${plan.newBody}"`);
    }
    if (!opts.apply) {
      migrated++;
      continue;
    }
    try {
      await request(base, token, `/notes/${note.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: plan.newTags, note: plan.newBody }),
      });
      migrated++;
      console.log('  patched');
    } catch (e) {
      failed++;
      failures.push({ id: note.id, message: e.message });
      console.error(`  FAILED: ${e.message}`);
    }
  }

  console.log('');
  console.log('--- notes ---');
  console.log(`reported: ${reported === null ? 'unknown' : reported} (by the server)`);
  console.log(`found:    ${found}`);
  console.log(`${opts.apply ? 'migrated' : 'would migrate'}: ${migrated}`);
  console.log(`skipped:  ${skipped} (already carried the new names, or the bath tag was missing on a local re-check)`);
  console.log(`failed:   ${failed}`);
  if (failures.length > 0) {
    console.log('');
    console.log('Failures (re-run to retry; the migration is idempotent):');
    for (const f of failures) console.log(`  note ${f.id}: ${f.message}`);
  }

  console.log('');
  console.log('The bare `small` and `big` tag objects are left in place. They may');
  console.log("be attached to other records, so delete them in Baby Buddy's tag");
  console.log('admin only once you have checked their usage there.');

  return failed > 0 ? 1 : 0;
}

// Run only when invoked directly, so the pure mapping helpers above can be
// imported and exercised without touching a server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
