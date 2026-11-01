import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { downloadFile, csvField } from './util.js';

export function positiveNumber(value, name, { integer = false, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max || (integer && !Number.isSafeInteger(n))) {
    throw new Error(`--${name} must be a positive ${integer ? 'integer' : 'number'}${Number.isFinite(max) ? ` no greater than ${max}` : ''}.`);
  }
  return n;
}

function writeJson(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}

export async function validateItems({ client, payload, variables, items, out, maxCredits = Infinity, log = console.log }) {
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const item of items) {
    try {
      const r = await client.authoring.validate({ payload, variables: { ...variables, ...item.variables } });
      if (!r.valid || !Number.isFinite(r.creditsRequired) || r.creditsRequired < 0) {
        throw new Error(r.errors?.map(e => `${e.field}: ${e.message}`).join('; ') || 'Validation did not return a valid credit estimate.');
      }
      results.push({ row: item.row, name: item.name, valid: true, credits: r.creditsRequired, warnings: r.warnings || [] });
      log(`CSV row ${item.row} (${item.name}): ${r.creditsRequired} credits`);
      for (const w of r.warnings || []) log(`  Warning: ${w.message}`);
    } catch (error) {
      results.push({ row: item.row, name: item.name, valid: false, error: error.message });
    }
  }
  const credits = results.reduce((sum, r) => sum + (r.credits || 0), 0);
  const report = { checkedAt: new Date().toISOString(), credits, results };
  writeJson(path.join(out, 'validation.json'), report);
  if (results.some(r => !r.valid)) throw new Error(`Validation failed. Read ${path.join(out, 'validation.json')}; no jobs submitted.`);
  log(`Estimate: ${credits} credits for ${items.length} video(s).`);
  if (credits > maxCredits) throw new Error(`Estimate ${credits} exceeds --max-credits ${maxCredits}; no jobs submitted.`);
  return report;
}

function saveResults(out, state) {
  const header = 'csv_row,name,status,bulk_id,job_id,video_url,thumbnail_url,credits,local_file,error';
  const rows = state.items.map(item => [item.row, item.name, item.status, item.bulkId,
    item.jobId, item.outputUrl, item.thumbnailUrl, item.creditsConsumed,
    item.localFile, item.downloadError || item.error].map(csvField).join(','));
  writeFileSync(path.join(out, 'results.csv'), [header, ...rows].join('\n') + '\n');
}

export async function runCampaign({ client, out, resume = false, payload, variables, items,
  batchSize = 100, maxCredits = Infinity, webhookUrl, noDownload = false,
  pollMs = 5000, timeoutMs = 1800000, log = console.log,
  download = downloadFile, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  mkdirSync(out, { recursive: true });
  const stateFile = path.join(out, 'run.json');
  let state;
  const save = () => { writeJson(stateFile, state); saveResults(out, state); };
  if (resume) {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.items) || !Array.isArray(state.batches)) throw new Error('Unsupported run state.');
    log('Resuming saved jobs. No new render requests will be submitted.');
  } else {
    if (existsSync(stateFile)) throw new Error(`Run already exists in ${out}. Use --resume or choose a new --out directory.`);
    await validateItems({ client, payload, variables, items, out, maxCredits, log });
    state = { version: 1, createdAt: new Date().toISOString(), creditsReserved: 0, batches: [],
      items: items.map(item => ({ row: item.row, name: item.name, status: 'not_submitted' })) };
    // Exclusive creation prevents two new runs from sharing the same journal.
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
    for (let start = 0; start < items.length; start += batchSize) {
      const selected = items.slice(start, start + batchSize);
      const batch = { status: 'submission_unknown', rows: selected.map(i => i.row) };
      state.batches.push(batch);
      for (const row of batch.rows) state.items.find(i => i.row === row).status = 'submission_unknown';
      save(); // Persist intent before POST so a crash never invites a blind retry.
      let response;
      try {
        response = await client.renders.createBulk({ payload, variables,
          items: selected.map(({ name, variables }) => ({ name, variables })),
          name: `personalized-offers ${state.createdAt}`, ...(webhookUrl ? { webhookUrl } : {}) });
      } catch (error) {
        batch.error = error.message;
        save();
        throw new Error(`Submission did not return a confirmed batch ID. Check your dashboard before another paid run. Saved state: ${stateFile}. ${error.message}`);
      }
      if (!response.bulkId) {
        save();
        throw new Error(`Submission returned no batch ID. Inspect your dashboard before retrying. Saved state: ${stateFile}`);
      }
      batch.bulkId = response.bulkId;
      batch.status = 'accepted';
      batch.creditsReserved = response.creditsReserved || 0;
      state.creditsReserved += batch.creditsReserved;
      for (const job of response.jobs || []) {
        const source = selected[job.index];
        if (!source) continue;
        Object.assign(state.items.find(i => i.row === source.row), { jobId: job.jobId, bulkId: batch.bulkId, status: 'pending' });
      }
      for (const err of response.errors || []) {
        const source = selected[err.item ?? err.index];
        if (!source) continue;
        Object.assign(state.items.find(i => i.row === source.row), { status: 'rejected', bulkId: batch.bulkId,
          error: (err.errors || err.details || []).map(d => `${d.field}: ${d.message}`).join('; ') || err.message || err.error || 'Rejected' });
      }
      save();
      log(`Batch ${batch.bulkId}: ${response.totalJobs} job(s), ${batch.creditsReserved} credits reserved.`);
      if (state.creditsReserved > maxCredits) {
        log('Reserved credits exceeded the earlier estimate. Stopping further submissions; accepted jobs will still be tracked.');
        break;
      }
    }
  }
  const accepted = state.batches.filter(b => b.bulkId);
  const started = now();
  for (;;) {
    let pending = 0;
    for (const batch of accepted) {
      const response = await client.renders.getBulk(batch.bulkId);
      if (!response.bulk?.counts || !Array.isArray(response.jobs)) throw new Error('Incomplete batch status response. Use --resume later.');
      pending += response.bulk.counts.pending;
      for (const job of response.jobs) {
        const item = state.items.find(i => i.jobId === job.id);
        if (item) Object.assign(item, { status: job.status, outputUrl: job.outputUrl,
          thumbnailUrl: job.thumbnailUrl, creditsConsumed: job.creditsConsumed, error: job.errorMessage || '' });
      }
      save();
    }
    log(`${state.items.filter(i => i.status === 'completed').length} completed; ${pending} pending.`);
    if (!pending) break;
    if (now() - started >= timeoutMs) {
      log(`Polling timed out. Resume with: node src/index.js --resume --out "${out}"`);
      return 2;
    }
    await sleep(pollMs);
  }
  if (!noDownload) for (const item of state.items.filter(i => i.status === 'completed')) {
    // Use our CSV-derived safe name, never an arbitrary server-returned path.
    const file = `${item.name.replace(/[^a-zA-Z0-9_-]/g, '-')}.mp4`;
    const dest = path.join(out, file);
    try {
      if (!(item.localFile === file && existsSync(dest) && statSync(dest).size > 0)) await download(item.outputUrl, dest);
      item.localFile = file;
      delete item.downloadError;
    } catch (error) { item.downloadError = error.message; }
    save();
  }
  const incomplete = state.items.filter(i => i.status !== 'completed' || (!noDownload && i.downloadError));
  if (state.batches.some(b => !b.bulkId)) log('A submission is still unconfirmed. Inspect the dashboard before creating another run.');
  log(`Results: ${path.join(out, 'results.csv')}. ${incomplete.length} row(s) need attention.`);
  return incomplete.length ? 2 : 0;
}
