/**
 * Minimal Zvid API client for the bulk render workflow.
 *
 * Zero dependencies — uses the global fetch available in Node.js >= 18.
 * Covers exactly the endpoints this example needs:
 *
 *   POST /api/render/bulk/api-key      submit one payload/template + N variable sets
 *   GET  /api/render/bulk/:id          poll a batch (status + per-job results)
 *   POST /api/render/validate/api-key  validate one item without spending credits
 *
 * Full API reference: https://docs.zvid.io
 */

const DEFAULT_BASE_URL = 'https://api.zvid.io';

/** Error thrown for any non-2xx API response. Carries the parsed body. */
export class ZvidApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, body?: any }} info
   */
  constructor(message, { status, body }) {
    super(message);
    this.name = 'ZvidApiError';
    this.status = status;
    this.body = body;
  }
}

/** HTTP statuses worth retrying (throttling / transient upstream issues). */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ZvidClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey  Zvid API key (dashboard → API Keys)
   * @param {string} [options.baseUrl]  API origin, defaults to https://api.zvid.io
   * @param {number} [options.maxRetries]  retries for transient failures (default 3)
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, maxRetries = 3 }) {
    if (!apiKey) {
      throw new Error(
        'Missing API key. Set ZVID_API_KEY in your environment or .env file ' +
          '(create one at https://app.zvid.io under API Keys).'
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.maxRetries = maxRetries;
  }

  /**
   * Submit a bulk render: one base `payload` (or stored `template` id) fanned
   * out over `items[]`, where each item's `variables` merge over the batch
   * `variables`. Returns the 202 response: { bulkId, totalJobs, jobs, ... }.
   *
   * @param {object} request
   * @param {object} [request.payload]   full project JSON (inline template)
   * @param {string} [request.template]  stored template id (tpl_...) instead of payload
   * @param {Array<{variables: object, name?: string}>} request.items
   * @param {object} [request.variables] batch-level variables applied to every item
   * @param {string} [request.name]      batch name shown in the dashboard
   * @param {string} [request.webhookUrl] per-job webhook for render.completed/failed
   */
  submitBulk(request) {
    return this.#request('POST', '/api/render/bulk/api-key', request);
  }

  /**
   * Fetch a batch: { bulk: { status, counts, ... }, jobs: [{ id, status,
   * outputUrl, thumbnailUrl, errorMessage, ... }] }. `bulk.status` is one of
   * processing | completed | completed_with_errors | failed.
   *
   * @param {string} bulkId
   */
  getBulk(bulkId) {
    return this.#request('GET', `/api/render/bulk/${encodeURIComponent(bulkId)}`);
  }

  /**
   * Validate a single render request without queueing it or spending credits.
   * Returns { valid: true, creditsRequired, warnings } on success; throws a
   * ZvidApiError with field-level `body.details` when the payload is invalid.
   *
   * @param {{ payload?: object, template?: string, variables?: object }} request
   */
  validateRender(request) {
    return this.#request('POST', '/api/render/validate/api-key', request);
  }

  /**
   * Perform one API call with retries on 429/5xx/network failures.
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   */
  async #request(method, path, body) {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            'x-api-key': this.apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (networkError) {
        if (attempt >= this.maxRetries) {
          throw new ZvidApiError(
            `Network error calling ${method} ${path}: ${networkError.message}`,
            { status: 0 }
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) {
        return response.json();
      }

      const errorBody = await response.json().catch(() => undefined);

      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs(attempt);
        await sleep(delay);
        continue;
      }

      const summary =
        errorBody?.message || errorBody?.error || `HTTP ${response.status}`;
      throw new ZvidApiError(`${method} ${path} failed: ${summary}`, {
        status: response.status,
        body: errorBody,
      });
    }
  }
}

/** Exponential backoff with jitter: ~1s, ~2s, ~4s, ... */
function backoffMs(attempt) {
  const base = 1000 * 2 ** attempt;
  return base + Math.floor(Math.random() * 250);
}
