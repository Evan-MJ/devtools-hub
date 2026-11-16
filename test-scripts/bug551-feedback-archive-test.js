// BUG-551: the feedback queue is capped at 100 entries, but the entries that fall off
// the end were destroyed (`feedbackList.length = 100`). They must move to the
// feedback_archive KV key instead, so a submitter's email (the reply address)
// survives. Admin reads see the archive merged in; the public read stays at 100.
//
// Run: node test-scripts/bug551-feedback-archive-test.js
import { onRequestGet, onRequestPost } from '../functions/api/feedback.js';

const ADMIN_SECRET = 'test-admin-secret';

function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key, type) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key, value) => { store.set(key, value); }
  };
}

function makeContext(kv, { url = 'https://tools.scoreroute.com/api/feedback', method = 'GET', body = null } = {}) {
  return {
    env: { FEEDBACK_KV: kv, FEEDBACK_ADMIN_SECRET: ADMIN_SECRET },
    request: {
      url,
      method,
      headers: { get: () => null },
      json: async () => body
    }
  };
}

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}
async function submit(kv, n) {
  for (let i = 0; i < n; i++) {
    const ctx = makeContext(kv, {
      method: 'POST',
      body: { category: 'other', type: 'other', description: 'entry ' + i, email: `u${i}@example.com`, tool: 'Other' }
    });
    const res = await onRequestPost(ctx);
    if (res.status !== 200 && res.status !== 201) throw new Error('POST failed: ' + res.status);
  }
}

console.log('[BUG-551] feedback overflow is archived, not destroyed');

// --- 1. overflow moves to the archive, the public list stays at 100 -------------
{
  const kv = makeKV();
  await submit(kv, 102);

  const list = JSON.parse(kv.store.get('feedback_list'));
  ok(list.length === 100, `feedback_list holds exactly 100 (got ${list.length})`);

  const archive = kv.store.has('feedback_archive') ? JSON.parse(kv.store.get('feedback_archive')) : null;
  ok(Array.isArray(archive), 'feedback_archive key exists');
  ok(archive && archive.length === 2, `archive holds the 2 evicted entries (got ${archive && archive.length})`);

  // the evicted entries must be the OLDEST two, and keep their email
  const ids = new Set(list.map(f => f.id));
  const archivedIds = (archive || []).map(f => f.id);
  ok(!archivedIds.some(id => ids.has(id)), 'archived ids are not still in the live list');
  ok((archive || []).every(f => f.email), 'archived entries keep their email (reply address survives)');
  ok((archive || []).some(f => f.description === 'entry 0') && (archive || []).some(f => f.description === 'entry 1'),
    'the two oldest submissions (entry 0 / entry 1) are the archived ones');
  ok(list.some(f => f.description === 'entry 101'), 'the newest submission is still in the live list');
}

// --- 2. public GET returns 100, admin GET returns 102 -------------------------
{
  const kv = makeKV();
  await submit(kv, 102);

  const pubRes = await onRequestGet(makeContext(kv));
  const pub = await pubRes.json();
  ok(pubRes.status === 200 && pub.length === 100, `public GET returns 100 entries (got ${pub.length})`);

  const admRes = await onRequestGet(makeContext(kv, { url: 'https://tools.scoreroute.com/api/feedback?admin_secret=' + ADMIN_SECRET }));
  const adm = await admRes.json();
  ok(admRes.status === 200 && adm.length === 102, `admin GET returns 102 entries (got ${adm.length})`);
  ok(adm.some(f => f.description === 'entry 0'), 'admin GET sees the archived oldest entry');
}

// --- 3. public GET still hides emails (BUG-401 must not regress) --------------
{
  const kv = makeKV();
  await submit(kv, 3);
  const pub = await (await onRequestGet(makeContext(kv))).json();
  ok(pub.every(f => !('email' in f)), 'public GET still strips the email field');
  const adm = await (await onRequestGet(makeContext(kv, { url: 'https://tools.scoreroute.com/api/feedback?admin_secret=' + ADMIN_SECRET }))).json();
  ok(adm.every(f => 'email' in f), 'admin GET still returns the email field');
}

// --- 4. the archive itself is capped at 500 -----------------------------------
{
  const kv = makeKV();
  await submit(kv, 605);
  const archive = JSON.parse(kv.store.get('feedback_archive'));
  const list = JSON.parse(kv.store.get('feedback_list'));
  ok(list.length === 100, 'live list stays at 100 after 605 submissions');
  ok(archive.length === 500, `archive is capped at 500 (got ${archive.length})`);
}

// --- 5. no archive key is written while there is no overflow ------------------
{
  const kv = makeKV();
  await submit(kv, 5);
  ok(!kv.store.has('feedback_archive'), 'no archive key is created before the list overflows');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
