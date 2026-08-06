#!/usr/bin/env node
/**
 * Bulk personalized videos from a CSV — one Zvid template, one video per row.
 *
 * Flow:
 *   1. Load template.json (the designed video) + campaign.json (batch-level
 *      variables) + data/customers.csv (one row per recipient).
 *   2. Map rows to bulk items and validate them locally.
 *   3. Submit to POST /api/render/bulk/api-key (batched; each valid item
 *      becomes its own render job on Zvid's queue).
 *   4. Poll GET /api/render/bulk/:id until every job is terminal.
 *   5. Download the MP4s to out/ and write out/results.csv.
 *
 * Usage:
 *   node src/index.js                  render every CSV row
 *   node src/index.js --dry-run        validate + credit estimate, render nothing
 *   node src/index.js --limit 2        only the first 2 rows (great for testing)
 *
 * Requires Node.js >= 20 and ZVID_API_KEY in the environment or .env.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';

import { InsufficientCreditsError, ZvidAPIError, ZvidClient } from '@zvid/sdk';
import { loadItems } from './csv.js';
import { loadEnv, color, downloadFile, withConcurrency, csvField } from './util.js';

const EXIT_OK = 0;
const EXIT_FATAL = 1;
const EXIT_PARTIAL = 2;

async function main() {
  loadEnv();

  const { values: options } = parseArgs({
    options: {
      csv: { type: 'string', default: 'data/customers.csv' },
      template: { type: 'string', default: 'template.json' },
      campaign: { type: 'string', default: 'campaign.json' },
      out: { type: 'string', default: 'out' },
      limit: { type: 'string' },
      'batch-size': { type: 'string', default: '100' },
      'poll-interval': { type: 'string', default: '5' },
      timeout: { type: 'string', default: '30' },
      'dry-run': { type: 'boolean', default: false },
      'no-download': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (options.help) {
    printHelp();
    return EXIT_OK;
  }

  const client = new ZvidClient({
    apiKey: process.env.ZVID_API_KEY,
    baseUrl: process.env.ZVID_API_URL || undefined,
  });

  // ---- 1. Load inputs ------------------------------------------------------
  const payload = readJson(options.template);
  const campaignVariables = readJson(options.campaign);
  const { items: allItems, rowErrors } = loadItems(options.csv);

  for (const { row, message } of rowErrors) {
    console.error(color.yellow(`⚠ CSV row ${row} skipped: ${message}`));
  }
  if (allItems.length === 0) {
    console.error(color.red('✖ No valid rows in the CSV — nothing to render.'));
    return EXIT_FATAL;
  }

  const limit = options.limit ? Number(options.limit) : undefined;
  const items = limit ? allItems.slice(0, limit) : allItems;

  console.log(
    `${color.bold('Personalized video campaign')} — ` +
      `${items.length} video(s) from ${path.basename(options.csv)}` +
      (rowErrors.length ? color.yellow(` (${rowErrors.length} row(s) skipped)`) : '')
  );

  // ---- 2. Dry run: validate every item, estimate credits, stop -------------
  if (options['dry-run']) {
    return dryRun(client, payload, campaignVariables, items);
  }

  // ---- 3. Submit in batches ------------------------------------------------
  const batchSize = Math.max(1, Number(options['batch-size']));
  const webhookUrl = process.env.ZVID_WEBHOOK_URL || undefined;
  /** jobId → item, built from each submit response, to map results to CSV rows */
  const itemsByJobId = new Map();
  const bulkIds = [];
  let creditsReserved = 0;

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    let response;
    try {
      response = await client.renders.createBulk({
        payload,
        variables: campaignVariables,
        items: batch.map(({ variables, name }) => ({ variables, name })),
        name: `personalized-offers ${new Date().toISOString().slice(0, 10)}`,
        webhookUrl,
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        console.error(
          color.red(`✖ Insufficient credits: ${error.body?.message || ''}`)
        );
        console.error('  Top up at https://app.zvid.io or reduce rows with --limit.');
        return EXIT_FATAL;
      }
      throw error;
    }

    bulkIds.push(response.bulkId);
    creditsReserved += response.creditsReserved ?? 0;
    // response.jobs[].index is the item's position within THIS batch request.
    for (const job of response.jobs ?? []) {
      const item = batch[job.index];
      if (item) itemsByJobId.set(job.jobId, item);
    }
    console.log(
      `  Batch ${bulkIds.length}: ${color.cyan(response.bulkId)} — ` +
        `${response.totalJobs} job(s) queued, ${response.creditsReserved} credits reserved` +
        (response.queueAhead ? color.dim(` (${response.queueAhead} ahead in queue)`) : '')
    );

    // Items the API rejected during per-item validation (the rest still run).
    for (const itemError of response.errors ?? []) {
      const index = itemError.item ?? itemError.index;
      const item = typeof index === 'number' ? batch[index] : undefined;
      const where = item ? `CSV row ${item.row}` : `item ${index}`;
      const details = (itemError.errors ?? itemError.details ?? [])
        .map((d) => `${d.field}: ${d.message}`)
        .join('; ');
      console.error(
        color.yellow(
          `  ⚠ ${where} rejected: ${details || itemError.error || itemError.message || 'invalid'}`
        )
      );
    }
  }

  // ---- 4. Poll until every batch is terminal -------------------------------
  const pollIntervalMs = Math.max(2, Number(options['poll-interval'])) * 1000;
  const timeoutMs = Number(options.timeout) * 60_000;
  const startedAt = Date.now();
  let lastLine = '';
  let batches;

  for (;;) {
    batches = await Promise.all(bulkIds.map((id) => client.renders.getBulk(id)));
    const counts = { completed: 0, failed: 0, pending: 0 };
    for (const { bulk } of batches) {
      counts.completed += bulk.counts.completed;
      counts.failed += bulk.counts.failed;
      counts.pending += bulk.counts.pending;
    }

    const line =
      `  ${color.green(`${counts.completed} done`)} · ` +
      `${counts.failed ? color.red(`${counts.failed} failed`) : '0 failed'} · ` +
      `${counts.pending} rendering — ${Math.round((Date.now() - startedAt) / 1000)}s`;
    if (line.replace(/\d+s$/, '') !== lastLine.replace(/\d+s$/, '') || counts.pending === 0) {
      console.log(line);
      lastLine = line;
    }

    if (counts.pending === 0) break;
    if (Date.now() - startedAt > timeoutMs) {
      console.error(
        color.red(`✖ Timed out after ${options.timeout} min with ${counts.pending} job(s) still rendering.`)
      );
      console.error(`  Check progress later with: GET /api/render/bulk/${bulkIds[0]}`);
      return EXIT_PARTIAL;
    }
    await sleep(pollIntervalMs);
  }

  // ---- 5. Download outputs + write manifest --------------------------------
  const jobs = batches.flatMap((batch) => batch.jobs);
  const completed = jobs.filter((job) => job.status === 'completed');
  const failed = jobs.filter((job) => job.status === 'failed');

  mkdirSync(options.out, { recursive: true });

  if (!options['no-download'] && completed.length > 0) {
    console.log(`Downloading ${completed.length} video(s) to ${options.out}/ ...`);
    const downloads = completed.map((job) => () => {
      const item = itemsByJobId.get(job.id);
      const fileName = `${job.name || item?.name || job.id}.mp4`;
      return downloadFile(job.outputUrl, path.join(options.out, fileName));
    });
    const results = await withConcurrency(downloads, 4);
    results.forEach((result, i) => {
      if (result.error) {
        console.error(
          color.yellow(`  ⚠ Download failed for ${completed[i].name}: ${result.error.message}`)
        );
      }
    });
  }

  const manifestPath = path.join(options.out, 'results.csv');
  const manifestRows = jobs.map((job) => {
    const item = itemsByJobId.get(job.id);
    return [
      item?.row ?? '',
      job.name ?? item?.name ?? job.id,
      job.status,
      job.outputUrl ?? '',
      job.thumbnailUrl ?? '',
      job.creditsConsumed ?? '',
      job.errorMessage ?? '',
    ].map(csvField).join(',');
  });
  writeFileSync(
    manifestPath,
    ['csv_row,name,status,video_url,thumbnail_url,credits,error', ...manifestRows].join('\n') + '\n'
  );

  // ---- Summary -------------------------------------------------------------
  console.log('');
  console.log(
    `${color.bold('Done.')} ${color.green(`${completed.length} rendered`)}` +
      (failed.length ? `, ${color.red(`${failed.length} failed`)}` : '') +
      ` — ${creditsReserved} credits reserved. Manifest: ${manifestPath}`
  );
  for (const job of failed) {
    const item = itemsByJobId.get(job.id);
    console.error(
      color.red(`  ✖ ${job.name ?? item?.name ?? job.id}${item ? ` (CSV row ${item.row})` : ''}: ${job.errorMessage || 'render failed'}`)
    );
  }
  if (failed.length > 0) {
    console.error(color.dim('  Failed jobs are refunded automatically. Fix the rows and re-run with --limit or a trimmed CSV.'));
  }

  return failed.length > 0 ? EXIT_PARTIAL : EXIT_OK;
}

/**
 * Validate every item through POST /api/render/validate/api-key (free) and
 * print a per-row report plus the total credit estimate.
 */
async function dryRun(client, payload, campaignVariables, items) {
  console.log(color.bold('Dry run — validating every row (no credits spent):'));

  const tasks = items.map((item) => () =>
    client.authoring.validate({
      payload,
      variables: { ...campaignVariables, ...item.variables },
    })
  );
  const results = await withConcurrency(tasks, 4);

  let totalCredits = 0;
  let invalid = 0;
  results.forEach((result, i) => {
    const item = items[i];
    if (result.error) {
      invalid += 1;
      const details = result.error.body?.details
        ?.map((d) => `${d.field}: ${d.message}`)
        .join('; ');
      console.error(
        color.red(`  ✖ CSV row ${item.row} (${item.name}): ${details || result.error.message}`)
      );
      return;
    }
    if (!result.value.valid) {
      invalid += 1;
      const details = result.value.errors
        ?.map((detail) => `${detail.field}: ${detail.message}`)
        .join('; ');
      console.error(
        color.red(`  ✖ CSV row ${item.row} (${item.name}): ${details || result.value.message}`)
      );
      return;
    }
    totalCredits += result.value.creditsRequired ?? 0;
    const warnings = result.value.warnings?.length
      ? color.yellow(` — ${result.value.warnings.length} layout warning(s)`)
      : '';
    console.log(
      `  ${color.green('✔')} CSV row ${item.row} (${item.name}) — ` +
        `${result.value.creditsRequired} credits${warnings}`
    );
  });

  console.log('');
  console.log(
    `${color.bold('Estimate:')} ${totalCredits} credits for ${items.length - invalid} video(s).` +
      (invalid ? color.red(` ${invalid} row(s) would be rejected.`) : '')
  );
  return invalid > 0 ? EXIT_PARTIAL : EXIT_OK;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printHelp() {
  console.log(`Bulk personalized videos with the Zvid API.

Usage: node src/index.js [options]

Options:
  --csv <path>            CSV file, one video per row      (default: data/customers.csv)
  --template <path>       project JSON with {{variables}}  (default: template.json)
  --campaign <path>       batch-level variable values      (default: campaign.json)
  --out <dir>             output directory                 (default: out)
  --limit <n>             only render the first n rows
  --dry-run               validate rows + estimate credits, render nothing
  --no-download           keep outputs on Zvid's CDN, skip local download
  --batch-size <n>        items per bulk request           (default: 100, max 500)
  --poll-interval <sec>   seconds between status polls     (default: 5)
  --timeout <min>         give up polling after n minutes  (default: 30)

Environment:
  ZVID_API_KEY       required — create one at https://app.zvid.io/api-keys
  ZVID_API_URL       optional API origin override
  ZVID_WEBHOOK_URL   optional — get a webhook per finished job instead of polling`);
}

// Set exitCode instead of calling process.exit(): letting the event loop
// drain avoids killing in-flight keep-alive sockets (which aborts with a
// libuv assertion on Windows) and never truncates pending stdout.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(color.red(`✖ ${error.message}`));
    if (error instanceof ZvidAPIError && error.body?.details) {
      for (const detail of error.body.details) {
        console.error(color.red(`    ${detail.field}: ${detail.message}`));
      }
    }
    process.exitCode = EXIT_FATAL;
  });
