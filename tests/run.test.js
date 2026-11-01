import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCampaign, positiveNumber } from '../src/run.js';
import { loadItems } from '../src/csv.js';
import { downloadFile } from '../src/util.js';

function fixture(t, { pending = false, reject = false, unknown = false } = {}) {
  const out = mkdtempSync(path.join(tmpdir(), 'zvid-campaign-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  let posts = 0;
  const items = [1, 2].map(row => ({ row, name: `offer-person-r${row}`, variables: { firstName: `Person ${row}` } }));
  const client = { authoring: { validate: async () => ({ valid: true, creditsRequired: 11 }) }, renders: {
    createBulk: async () => {
      posts++;
      assert.equal(JSON.parse(readFileSync(path.join(out, 'run.json'))).batches[0].status, 'submission_unknown');
      if (unknown) throw new Error('Connection lost');
      return { bulkId: 'blk_test', totalJobs: reject ? 1 : 2, creditsReserved: reject ? 11 : 22,
        jobs: (reject ? items.slice(0, 1) : items).map((i, index) => ({ jobId: `job_${i.row}`, index })),
        errors: reject ? [{ item: 1, errors: [{ field: 'productImage', message: 'Invalid image' }] }] : [] };
    },
    getBulk: async () => ({ bulk: { counts: { pending: pending ? 2 : 0 } },
      jobs: (reject ? items.slice(0, 1) : items).map(i => ({ id: `job_${i.row}`, name: '../../unsafe',
        status: pending ? 'rendering' : 'completed', outputUrl: `https://example.com/${i.row}.mp4`, creditsConsumed: 11 })) }),
  } };
  return { out, items, client, posts: () => posts, setPending: v => { pending = v; },
    options: { out, items, client, payload: {}, variables: {}, log: () => {},
      download: async (_url, file) => writeFileSync(file, 'test video') } };
}

test('completed jobs download safely, and the same directory cannot submit again', async t => {
  const f = fixture(t);
  assert.equal(await runCampaign(f.options), 0);
  assert.ok(existsSync(path.join(f.out, 'offer-person-r1.mp4')));
  assert.match(readFileSync(path.join(f.out, 'results.csv'), 'utf8'), /job_1/);
  await assert.rejects(runCampaign(f.options), /Run already exists/);
  assert.equal(f.posts(), 1);
});
test('timeout resumes saved jobs without another POST', async t => {
  const f = fixture(t, { pending: true });
  assert.equal(await runCampaign({ ...f.options, timeoutMs: 0 }), 2);
  f.setPending(false);
  assert.equal(await runCampaign({ ...f.options, resume: true }), 0);
  assert.equal(f.posts(), 1);
});
test('an ambiguous submission stays unconfirmed and resume never retries it', async t => {
  const f = fixture(t, { unknown: true });
  await assert.rejects(runCampaign(f.options), /Check your dashboard/);
  assert.equal(await runCampaign({ ...f.options, resume: true }), 2);
  assert.equal(f.posts(), 1);
  assert.match(readFileSync(path.join(f.out, 'results.csv'), 'utf8'), /submission_unknown/);
});
test('a rejected API item survives in the manifest and returns a partial exit code', async t => {
  const f = fixture(t, { reject: true });
  assert.equal(await runCampaign(f.options), 2);
  assert.match(readFileSync(path.join(f.out, 'results.csv'), 'utf8'), /rejected.*Invalid image/);
});
test('download failures return partial; resume retries only downloads', async t => {
  const f = fixture(t);
  assert.equal(await runCampaign({ ...f.options, download: async () => { throw new Error('HTTP 503'); } }), 2);
  assert.match(readFileSync(path.join(f.out, 'results.csv'), 'utf8'), /HTTP 503/);
  assert.equal(await runCampaign({ ...f.options, resume: true }), 0);
  assert.equal(f.posts(), 1);
});
test('credit cap prevents submission', async t => {
  const f = fixture(t);
  await assert.rejects(runCampaign({ ...f.options, maxCredits: 21 }), /exceeds --max-credits/);
  assert.equal(f.posts(), 0);
  assert.equal(existsSync(path.join(f.out, 'run.json')), false);
});
test('invalid validation prevents submission', async t => {
  const f = fixture(t);
  f.client.authoring.validate = async () => ({ valid: false, errors: [{ field: 'payload', message: 'Missing scenes' }] });
  await assert.rejects(runCampaign(f.options), /Validation failed/);
  assert.equal(f.posts(), 0);
});
test('numeric arguments reject NaN, zero, fractions and oversized batches', () => {
  for (const n of ['oops', '0', '-1', 'Infinity', '1.5', '501']) {
    assert.throws(() => positiveNumber(n, 'batch-size', { integer: true, max: 500 }));
  }
});
test('CSV preserves row numbers and reports invalid URLs', t => {
  const f = fixture(t);
  const file = path.join(f.out, 'bad.csv');
  writeFileSync(file, 'first_name,product_name,product_tagline,product_image,discount_label,coupon_code,cta_url\nAmira,Watch,Black,ftp://example.com/a.jpg,20% OFF,A20,example.com\n');
  const result = loadItems(file);
  assert.equal(result.items.length, 0);
  assert.equal(result.rowErrors[0].row, 1);
  assert.match(result.rowErrors[0].message, /http\(s\)/);
});
test('failed streaming download removes the partial file', async t => {
  const f = fixture(t);
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => ({ ok: true, body: new ReadableStream({
    start(controller) { controller.error(new Error('Broken response')); },
  }) });
  const target = path.join(f.out, 'video.mp4');
  await assert.rejects(downloadFile('https://example.com/video.mp4', target), /Broken response/);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(`${target}.part`), false);
});
