#!/usr/bin/env node
/**
 * One-shot Baby Buddy migration: rename the `cure` tag family to `treatment`.
 *
 * Budkin stores a medication regimen as a Baby Buddy Note carrying structural
 * tags plus a machine-readable payload line in the note body. Budkin 1.1 renamed
 * that whole vocabulary from "cure" to "treatment", on the wire as well as in the
 * code, and ships NO in-app fallback that reads the old names. This script moves
 * the existing server-side records across so the renamed app finds them.
 *
 * What changes, per note:
 *   tag  `cure`             -> `treatment`
 *   tag  `cure:tod:<slot>`  -> `treatment:tod:<slot>`
 *   tag  `cure:every:<n>`   -> `treatment:every:<n>`
 *   tag  `cure:paused`      -> `treatment:paused`
 *   body line prefix `budkin-cure-v1:` -> `budkin-treatment-v1:`
 * Every unrelated tag is left untouched, and the note body's human-readable first
 * line and JSON payload are left byte-identical.
 *
 * USAGE
 *   node scripts/migrate-cure-tags-to-treatment.mjs [options]
 *
 *   Dry run (the default; writes nothing, prints every intended change):
 *     node scripts/migrate-cure-tags-to-treatment.mjs --url=https://bb.example.org --token=abc123
 *
 *   Apply:
 *     node scripts/migrate-cure-tags-to-treatment.mjs --url=... --token=... --apply
 *
 *   Also delete the orphaned `cure*` tag objects afterwards (opt-in, off by default):
 *     node scripts/migrate-cure-tags-to-treatment.mjs --url=... --token=... --apply --delete-old-tags
 *
 * OPTIONS
 *   --url=<base>          Baby Buddy base URL, with or without a trailing /api.
 *                         Env fallback: BABYBUDDY_URL
 *   --token=<key>         Baby Buddy API token (Settings -> API tokens in Baby
 *                         Buddy). Env fallback: BABYBUDDY_TOKEN
 *   --apply               Actually write. Without it nothing is sent but GETs.
 *   --delete-old-tags     After a successful --apply pass, DELETE the leftover
 *                         `cure*` entries from /api/tags/. Off by default.
 *   --page-size=<n>       Notes fetched per request (default 100).
 *   -h, --help            This text.
 *
 * SAFE RUN ORDER
 *   1. Open the CURRENT (pre-rename) app on every device while online and let it
 *      settle. That drains the offline queue, so no device is still holding a
 *      `cure`-tagged write that would land after the migration and recreate the
 *      old tags.
 *   2. Run this script in dry-run mode and read the report.
 *   3. Run it again with --apply.
 *   4. Install the updated app. It starts from an empty local treatment list and
 *      rehydrates from the migrated server records on first connect.
 *   Optionally re-run with --delete-old-tags once step 4 looks right, to clear the
 *   now-unused `cure*` tags out of Baby Buddy's tag list.
 *
 * Re-running is safe: once migrated, the notes no longer carry a `cure` tag, so a
 * second run finds nothing. The per-note mapping is idempotent regardless.
 *
 * Plain Node, no dependencies. Needs Node 18+ for global fetch.
 */

import { pathToFileURL } from 'node:url';

const OLD_TAG = 'cure';
const NEW_TAG = 'treatment';
const OLD_PREFIX = 'cure:';
const NEW_PREFIX = 'treatment:';
const OLD_PAYLOAD_PREFIX = 'budkin-cure-v1:';
const NEW_PAYLOAD_PREFIX = 'budkin-treatment-v1:';

// --- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const opts = { apply: false, deleteOldTags: false, pageSize: 100, help: false };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--delete-old-tags') opts.deleteOldTags = true;
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

/** True for a tag in the old structural family: `cure` itself or any `cure:*`. */
export function isOldStructuralTag(name) {
  return name === OLD_TAG || name.startsWith(OLD_PREFIX);
}

/**
 * Map one tag name. `cure` -> `treatment`, `cure:<rest>` -> `treatment:<rest>`,
 * everything else through untouched. Only the leading `cure` is rewritten, so a
 * user tag like `curewash` or `pedicure` is left alone.
 */
export function mapTagName(name) {
  if (name === OLD_TAG) return NEW_TAG;
  if (name.startsWith(OLD_PREFIX)) return NEW_PREFIX + name.slice(OLD_PREFIX.length);
  return name;
}

/** Map a whole tag list, preserving order and dropping duplicates the mapping
 *  could create (a note already carrying both `cure` and `treatment`). */
export function mapTagList(names) {
  const out = [];
  for (const n of names) {
    const mapped = mapTagName(n);
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Rewrite only the machine-readable payload marker in a note body. The human
 * summary line above it and the JSON after the prefix are left byte-identical,
 * and a body with no payload line comes back unchanged.
 */
export function mapNoteBody(body) {
  const text = String(body ?? '');
  return text
    .split('\n')
    .map((line) => {
      const lead = line.length - line.trimStart().length;
      const rest = line.slice(lead);
      if (!rest.startsWith(OLD_PAYLOAD_PREFIX)) return line;
      return line.slice(0, lead) + NEW_PAYLOAD_PREFIX + rest.slice(OLD_PAYLOAD_PREFIX.length);
    })
    .join('\n');
}

/** The full per-note plan, or null when the note already needs nothing. */
export function planForNote(note) {
  const oldTags = tagNames(note.tags);
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
 * Every note carrying the `cure` tag, collected in FULL before anything is
 * written. Paginating while patching would shift the offsets underneath us (a
 * migrated note drops out of the `?tags=cure` result set), which silently skips
 * records, so collection and mutation are kept strictly in that order.
 */
async function fetchAllCureNotes(base, token, pageSize) {
  const notes = [];
  let offset = 0;
  let expected = null;
  for (;;) {
    const page = await request(base, token, `/notes/?tags=${encodeURIComponent(OLD_TAG)}&limit=${pageSize}&offset=${offset}`);
    const results = Array.isArray(page?.results) ? page.results : [];
    if (expected === null && typeof page?.count === 'number') expected = page.count;
    notes.push(...results);
    if (results.length === 0 || !page?.next) break;
    offset += results.length;
    // Belt and braces against a server that always reports a `next`.
    if (expected !== null && notes.length >= expected) break;
  }
  return notes;
}

async function fetchAllTags(base, token, pageSize) {
  const tags = [];
  let offset = 0;
  for (;;) {
    const page = await request(base, token, `/tags/?limit=${pageSize}&offset=${offset}`);
    const results = Array.isArray(page?.results) ? page.results : [];
    tags.push(...results);
    if (results.length === 0 || !page?.next) break;
    offset += results.length;
  }
  return tags;
}

// --- main -------------------------------------------------------------------

const HELP = `Rename the Baby Buddy \`cure\` tag family to \`treatment\`.

  node scripts/migrate-cure-tags-to-treatment.mjs --url=<base> --token=<key> [--apply]

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
  try {
    notes = await fetchAllCureNotes(base, token, opts.pageSize);
  } catch (e) {
    console.error(`Could not list \`${OLD_TAG}\`-tagged notes: ${e.message}`);
    return 1;
  }

  let found = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  for (const note of notes) {
    // The tag filter is the server's; re-check locally so a loose filter match
    // can never make us rewrite a note that carries no `cure` tag at all.
    const names = tagNames(note.tags);
    if (!names.some(isOldStructuralTag)) {
      console.log(`note ${note.id}: no \`${OLD_TAG}\` tag on the record, ignoring`);
      continue;
    }
    found++;

    const plan = planForNote(note);
    if (!plan) {
      skipped++;
      console.log(`note ${note.id}: already migrated, nothing to do`);
      continue;
    }

    console.log(`note ${note.id}:`);
    if (plan.tagsChanged) {
      console.log(`  tags [${plan.oldTags.join(', ')}]`);
      console.log(`    -> [${plan.newTags.join(', ')}]`);
    }
    if (plan.bodyChanged) {
      console.log(`  body prefix ${OLD_PAYLOAD_PREFIX} -> ${NEW_PAYLOAD_PREFIX}`);
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
  console.log(`found:    ${found}`);
  console.log(`${opts.apply ? 'migrated' : 'would migrate'}: ${migrated}`);
  console.log(`skipped:  ${skipped} (already carried the new names)`);
  console.log(`failed:   ${failed}`);
  if (failures.length > 0) {
    console.log('');
    console.log('Failures (re-run to retry; the migration is idempotent):');
    for (const f of failures) console.log(`  note ${f.id}: ${f.message}`);
  }

  if (opts.deleteOldTags) {
    console.log('');
    console.log('--- orphaned tags ---');
    if (failed > 0) {
      console.log('Skipped: some notes failed to migrate, so the old tags are still in use.');
    } else {
      await deleteOldTags(base, token, opts);
    }
  }

  return failed > 0 ? 1 : 0;
}

/** Delete the leftover `cure*` tag objects. Baby Buddy keys Tag by SLUG, not by
 *  numeric id, and the slug is not derivable from the name, so it is read off the
 *  API response rather than computed. */
async function deleteOldTags(base, token, opts) {
  let tags;
  try {
    tags = await fetchAllTags(base, token, opts.pageSize);
  } catch (e) {
    console.error(`Could not list tags: ${e.message}`);
    return;
  }
  const stale = tags.filter((t) => typeof t?.name === 'string' && isOldStructuralTag(t.name));
  console.log(`found:    ${stale.length}`);
  let deleted = 0;
  let tagFailures = 0;
  for (const tag of stale) {
    const slug = tag.slug;
    if (!slug) {
      tagFailures++;
      console.error(`  tag "${tag.name}": no slug on the record, cannot delete`);
      continue;
    }
    if (!opts.apply) {
      deleted++;
      console.log(`  would delete tag "${tag.name}" (slug ${slug})`);
      continue;
    }
    try {
      await request(base, token, `/tags/${encodeURIComponent(slug)}/`, { method: 'DELETE' });
      deleted++;
      console.log(`  deleted tag "${tag.name}"`);
    } catch (e) {
      tagFailures++;
      console.error(`  FAILED to delete tag "${tag.name}": ${e.message}`);
    }
  }
  console.log(`${opts.apply ? 'deleted' : 'would delete'}:  ${deleted}`);
  console.log(`failed:   ${tagFailures}`);
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
