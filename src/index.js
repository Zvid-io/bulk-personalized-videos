#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ZvidClient } from '@zvid/sdk';
import { loadItems } from './csv.js';
import { loadEnv } from './util.js';
import { runCampaign, validateItems, positiveNumber } from './run.js';

async function main() {
  const { values: o } = parseArgs({ options: {
    csv: { type: 'string', default: 'data/customers.csv' },
    template: { type: 'string', default: 'template.json' },
    campaign: { type: 'string', default: 'campaign.json' },
    out: { type: 'string', default: 'out' },
    limit: { type: 'string' },
    'batch-size': { type: 'string', default: '100' },
    'poll-interval': { type: 'string', default: '5' },
    timeout: { type: 'string', default: '30' },
    'max-credits': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'no-download': { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (o.help) {
    console.log(`Usage: node src/index.js [options]
  --dry-run              validate and estimate; does not consume render credits
  --limit <n>            select the first n CSV data rows
  --max-credits <n>      refuse a new run when its validation estimate exceeds n
  --out <dir>            run state, results and downloads (default: out)
  --resume               only poll/download the saved run; never submit jobs
  --csv <path>           input CSV (default: data/customers.csv)
  --template <path>      video project JSON (default: template.json)
  --campaign <path>      shared variables (default: campaign.json)
  --batch-size <n>       items per request, 1-500 (default: 100)
  --poll-interval <sec>  polling delay, minimum 2 (default: 5)
  --timeout <min>        polling deadline (default: 30)
  --no-download          save output URLs without downloading MP4s

Requires Node.js 20+ and ZVID_API_KEY from https://app.zvid.io/api-keys.
ZVID_WEBHOOK_URL optionally adds callbacks; this CLI still polls.
New runs spend credits. Use a new --out directory for each intended campaign.`);
    return 0;
  }
  if (o.resume && o['dry-run']) throw new Error('--resume and --dry-run cannot be combined.');
  const batchSize = positiveNumber(o['batch-size'], 'batch-size', { integer: true, max: 500 });
  const pollMs = Math.max(2, positiveNumber(o['poll-interval'], 'poll-interval')) * 1000;
  const timeoutMs = positiveNumber(o.timeout, 'timeout') * 60000;
  const limit = o.limit === undefined ? Infinity : positiveNumber(o.limit, 'limit', { integer: true });
  const maxCredits = o['max-credits'] === undefined ? Infinity : positiveNumber(o['max-credits'], 'max-credits');
  loadEnv();
  // A lost POST response can mean accepted work. Do not automatically retry it.
  const client = new ZvidClient({ apiKey: process.env.ZVID_API_KEY,
    baseUrl: process.env.ZVID_API_URL || undefined, maxRetries: 0 });
  const common = { client, out: o.out, pollMs, timeoutMs, noDownload: o['no-download'] };
  if (o.resume) return runCampaign({ ...common, resume: true });
  const payload = JSON.parse(readFileSync(o.template, 'utf8'));
  const variables = JSON.parse(readFileSync(o.campaign, 'utf8'));
  const loaded = loadItems(o.csv);
  const errors = loaded.rowErrors.filter(r => r.row <= limit);
  if (errors.length) throw new Error(errors.map(r => `CSV row ${r.row}: ${r.message}`).join('\n'));
  const items = loaded.items.filter(r => r.row <= limit);
  if (!items.length) throw new Error('No selected CSV rows.');
  if (o['dry-run']) {
    await validateItems({ client, payload, variables, items, out: o.out, maxCredits });
    return 0;
  }
  return runCampaign({ ...common, payload, variables, items, batchSize, maxCredits,
    webhookUrl: process.env.ZVID_WEBHOOK_URL || undefined });
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  if (error.body?.details) for (const d of error.body.details) console.error(`${d.field}: ${d.message}`);
  process.exitCode = 1;
});
