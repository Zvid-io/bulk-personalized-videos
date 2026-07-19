/** Small shared helpers: .env loading, terminal colors, file download. */

import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Load KEY=VALUE pairs from a .env file into process.env without overriding
 * variables that are already set. No dependency needed for this much.
 *
 * @param {string} [path]
 */
export function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text);

export const color = {
  green: paint('32'),
  red: paint('31'),
  yellow: paint('33'),
  cyan: paint('36'),
  dim: paint('2'),
  bold: paint('1'),
};

/**
 * Download a URL to a local file (streams, no buffering in memory).
 * @param {string} url
 * @param {string} filePath
 */
export async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await mkdir(dirname(filePath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
}

/**
 * Run tasks with a concurrency limit. Results keep input order; failures are
 * returned (not thrown) as { error }.
 *
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 * @returns {Promise<Array<{ value?: T, error?: Error }>>}
 */
export async function withConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const index = next++;
        try {
          results[index] = { value: await tasks[index]() };
        } catch (error) {
          results[index] = { error };
        }
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/** Escape one CSV field per RFC 4180. */
export function csvField(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
