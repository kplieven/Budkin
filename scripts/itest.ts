/**
 * Integration test for BabybuddyClient against a real Baby Buddy server.
 * Covers create/update/delete for entries and measurements.
 * Run:  BB_URL=http://localhost:8000 BB_TOKEN=... BB_CHILD=1 npx tsx scripts/itest.ts
 */
import { BabybuddyClient } from '../src/api/client';
import type { Entry, Measurement, MeasurementKind } from '../src/types/models';

const URL = process.env.BB_URL ?? 'http://localhost:8000';
const TOKEN = process.env.BB_TOKEN ?? '';
const CHILD = process.env.BB_CHILD ?? '1';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

const client = new BabybuddyClient(URL, TOKEN);
const now = Date.now();
const M = 60000;

async function main() {
  const children = await client.listChildren();
  check('listChildren (auth ok)', children.length > 0, children.map((c) => `${c.first} #${c.id}`));

  // ---- feeding create -> update -> delete ----
  const feeding: Entry = {
    id: 'x', childId: CHILD, type: 'feeding',
    start: now - 20 * M, end: now - 2 * M, feedType: 'formula', method: 'bottle', amount: 120, tags: [],
  };
  const fid = await client.createEntry(feeding);
  check('create feeding returns id', typeof fid === 'number', fid);

  await client.updateEntry({ ...feeding, serverId: fid, amount: 150 });
  let feeds = await client.listFeedings(CHILD);
  check('feeding amount updated -> 150', feeds.find((x) => x.serverId === fid)?.amount === 150, feeds.find((x) => x.serverId === fid)?.amount);

  if (fid != null) await client.deleteEntry('feeding', fid);
  feeds = await client.listFeedings(CHILD);
  check('feeding deleted', !feeds.some((x) => x.serverId === fid));

  // ---- other entry types create ----
  const others: Entry[] = [
    { id: 'x', childId: CHILD, type: 'sleep', start: now - 120 * M, end: now - 30 * M, nap: true, tags: [] },
    { id: 'x', childId: CHILD, type: 'diaper', time: now - 10 * M, wet: true, solid: true, color: 'yellow', tags: [] },
    { id: 'x', childId: CHILD, type: 'pumping', start: now - 60 * M, end: now - 45 * M, amount: 90, tags: [] },
    { id: 'x', childId: CHILD, type: 'tummy', start: now - 200 * M, end: now - 195 * M, milestone: 'Rolled over', tags: [] },
  ];
  for (const e of others) {
    try {
      const id = await client.createEntry(e);
      check(`create ${e.type}`, typeof id === 'number');
    } catch (err) {
      check(`create ${e.type}`, false, (err as Error).message);
    }
  }

  // ---- measurements create -> (update) -> delete ----
  const values: Record<MeasurementKind, number> = { weight: 5.4, height: 60, head: 40, bmi: 15.2 };
  const kinds: MeasurementKind[] = ['weight', 'height', 'head', 'bmi'];
  for (const kind of kinds) {
    const m: Measurement = { id: 'x', childId: CHILD, kind, value: values[kind], date: now };
    let mid: number | undefined;
    try {
      mid = await client.createMeasurement(m);
      check(`create measurement ${kind}`, typeof mid === 'number', mid);
    } catch (err) {
      check(`create measurement ${kind}`, false, (err as Error).message);
      continue;
    }
    const list = await client.listMeasurements(kind, CHILD);
    check(`list ${kind} round-trip`, list.some((x) => x.serverId === mid && x.value === values[kind]), list.map((x) => x.value));

    if (kind === 'weight' && mid != null) {
      await client.updateMeasurement({ ...m, serverId: mid, value: 5.9 });
      const l2 = await client.listMeasurements('weight', CHILD);
      check('weight updated -> 5.9', l2.find((x) => x.serverId === mid)?.value === 5.9, l2.find((x) => x.serverId === mid)?.value);
    }
    if (mid != null) await client.deleteMeasurement(kind, mid);
    const l3 = await client.listMeasurements(kind, CHILD);
    check(`measurement ${kind} deleted`, !l3.some((x) => x.serverId === mid));
  }

  // ---- tags + intake + diaper amount round-trip (new write fields) ----
  const taggedFeed: Entry = {
    id: 'x', childId: CHILD, type: 'feeding',
    start: now - 300 * M, end: now - 290 * M, feedType: 'breast', method: 'both', amount: 7, tags: ['left'],
  };
  const tfid = await client.createEntry(taggedFeed);
  check('create breastfeed w/ tag + 1-10 intake', typeof tfid === 'number', tfid);
  const tf = (await client.listFeedings(CHILD)).find((x) => x.serverId === tfid);
  check('feeding tag "left" round-trips', !!tf && tf.tags.includes('left'), tf?.tags);
  check('feeding intake amount=7 round-trips', tf?.amount === 7, tf?.amount);

  const amtDiaper: Entry = {
    id: 'x', childId: CHILD, type: 'diaper',
    time: now - 15 * M, wet: true, solid: false, color: null, amount: 3, tags: [],
  };
  const adid = await client.createEntry(amtDiaper);
  check('create diaper w/ amount', typeof adid === 'number', adid);
  const ad = (await client.listChanges(CHILD)).find((x) => x.serverId === adid);
  check('diaper amount=3 round-trips', ad?.amount === 3, ad?.amount);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
