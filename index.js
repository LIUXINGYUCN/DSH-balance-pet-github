/**
 * Host half of the DSH balance pet.
 *
 * It owns what the browser half cannot do on its own:
 *
 *   /api/dsh-balance-pet/assets/<name>  serves the artwork and the sound effects
 *     from this package's `assets/` directory, so nothing has to be inlined into
 *     the client bundle.
 *
 *   /api/dsh-balance-pet/balance        asks DeepSeek for the account balance.
 *     The HTTP call lives on the Host so the page never needs the API key and
 *     never has to pass a CORS preflight. The key is read, in order, from the
 *     plugin config, `DSHPET_KEY`/`DEEPSEEK_API_KEY`, a plain `apikey.txt` next
 *     to this file, or `%USERPROFILE%\.dsh\.credentials.yaml`.
 *
 *   /api/dsh-balance-pet/key            stores a key the user typed into the
 *     pet's "Set API key" row, writing `apikey.txt` and refreshing the cache.
 *
 *   /api/dsh-balance-pet/report         receives the running page's own status
 *     (module loaded, engine started, which images resolved, what the tablet
 *     says, and any page errors). `/pet-check` reads it back, because the
 *     Desktop Host refuses loopback HTTP to anything but its own renderer and
 *     the routes therefore cannot be probed from outside.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Web route prefix owned outright by this plugin. */
const ROUTE_PREFIX = '/api/dsh-balance-pet';
const ASSET_PATH = `${ROUTE_PREFIX}/assets`;
const BALANCE_PATH = `${ROUTE_PREFIX}/balance`;
const KEY_PATH = `${ROUTE_PREFIX}/key`;
const REPORT_PATH = `${ROUTE_PREFIX}/report`;

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSET_DIR = join(PACKAGE_DIR, 'assets');
const DEFAULT_KEY_FILE = join(PACKAGE_DIR, 'apikey.txt');
const DEFAULT_API = 'https://api.deepseek.com/user/balance';

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const API_KEY_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{24,})/;

/** Cached key plus the source that answered, so a failure can name it. */
let keyCache;
let keySource = 'none';

/**
 * The last status the page reported. The browser half POSTs here once it has
 * mounted, and again whenever something changes, because the Desktop Host
 * refuses loopback HTTP to anything that is not its own renderer — so this is
 * the only way `/pet-check` can see what the page is actually doing.
 */
const pageStatus = { at: 0, reports: 0, last: null };

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

const sendNotFound = (res) => sendJson(res, 404, { ok: false, error: 'not-found' });

/** Read a small JSON request body, with a hard ceiling so it cannot be abused. */
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Read the API key from the config, the environment, a sidecar file, or DSH's credentials. */
async function resolveApiKey(config) {
  if (keyCache !== undefined) return keyCache;
  if (typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) {
    keyCache = config.apiKey.trim();
    keySource = 'config';
    return keyCache;
  }
  const fromEnv = process.env.DSHPET_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    keyCache = fromEnv.trim();
    keySource = 'env';
    return keyCache;
  }
  const candidates = [
    typeof config.apiKeyFile === 'string' && config.apiKeyFile.length > 0 ? config.apiKeyFile : DEFAULT_KEY_FILE,
    join(homedir(), '.dsh', 'apikey.txt'),
  ];
  for (const file of candidates) {
    try {
      const text = await readFile(file, 'utf8');
      const hit = text.match(API_KEY_PATTERN);
      if (hit !== null) {
        keyCache = hit[0];
        keySource = `file:${file}`;
        return keyCache;
      }
    } catch {
      /* missing sidecar file: try the next source */
    }
  }
  try {
    const text = await readFile(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8');
    /* The DEEPSEEK_API_KEY entry is the only `sk-` value that file holds. */
    const hit = text.match(/sk-[A-Za-z0-9_-]{8,}/);
    if (hit !== null) {
      keyCache = hit[0];
      keySource = 'credentials';
      return keyCache;
    }
  } catch {
    /* no DSH credentials on this machine: report the missing key downstream */
  }
  keySource = 'none';
  return undefined;
}

/** Persist a key the user typed into the pet's menu, next to this package. */
async function storeApiKey(config, key) {
  const file = typeof config.apiKeyFile === 'string' && config.apiKeyFile.length > 0 ? config.apiKeyFile : DEFAULT_KEY_FILE;
  await writeFile(file, key, 'utf8');
  keyCache = key;
  keySource = `file:${file}`;
}

/** Pull the spendable total out of DeepSeek's balance payload. */
function parseBalance(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
  const cny = infos.find((entry) => String(entry?.currency).toUpperCase() === 'CNY') ?? infos[0];
  const raw = cny?.total_balance ?? payload?.total_balance;
  const total = Number.parseFloat(String(raw ?? ''));
  if (!Number.isFinite(total)) return undefined;
  return { total, currency: String(cny?.currency ?? 'CNY') };
}

/** Register both routes and keep them for exactly as long as this plugin is mounted. */
export const inject = ['webServer', 'commands'];

export function apply(ctx, config = {}) {
  const assetDir = typeof config.assetDir === 'string' && config.assetDir.length > 0 ? config.assetDir : DEFAULT_ASSET_DIR;
  const apiUrl = typeof config.apiUrl === 'string' && config.apiUrl.length > 0 ? config.apiUrl : DEFAULT_API;
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 12000;

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ASSET_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          const pathname = new URL(String(req.url), 'http://localhost').pathname;
          const name = decodeURIComponent(pathname.slice(ASSET_PATH.length).replace(/^\//, ''));
          if (!NAME_PATTERN.test(name) || name.includes('..')) {
            sendNotFound(res);
            return;
          }
          const file = join(assetDir, name);
          try {
            const info = await stat(file);
            if (!info.isFile()) {
              sendNotFound(res);
              return;
            }
            const body = await readFile(file);
            res.statusCode = 200;
            res.setHeader('content-type', CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('content-length', String(body.byteLength));
            res.setHeader('cache-control', 'public, max-age=300');
            if (req.method === 'HEAD') res.end();
            else res.end(body);
          } catch {
            sendNotFound(res);
          }
        },
      }),
    `dsh-balance-pet: GET ${ASSET_PATH}/<name>`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: BALANCE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          const key = await resolveApiKey(config);
          if (key === undefined) {
            sendJson(res, 200, { ok: false, error: 'no-key' });
            return;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetch(apiUrl, {
              method: 'GET',
              headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
              signal: controller.signal,
            });
            if (!response.ok) {
              sendJson(res, 200, { ok: false, error: `http-${response.status}` });
              return;
            }
            const parsed = parseBalance(await response.json());
            if (parsed === undefined) {
              sendJson(res, 200, { ok: false, error: 'bad-payload' });
              return;
            }
            sendJson(res, 200, { ok: true, total: parsed.total, currency: parsed.currency });
          } catch (error) {
            const aborted = error instanceof Error && error.name === 'AbortError';
            sendJson(res, 200, { ok: false, error: aborted ? 'timeout' : 'network' });
          } finally {
            clearTimeout(timer);
          }
        },
      }),
    `dsh-balance-pet: GET ${BALANCE_PATH}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: KEY_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          try {
            const body = await readBody(req);
            const parsed = JSON.parse(body);
            const key = typeof parsed?.key === 'string' ? parsed.key.trim() : '';
            if (key.length < 8) {
              sendJson(res, 400, { ok: false, error: 'key-too-short' });
              return;
            }
            await storeApiKey(config, key);
            sendJson(res, 200, { ok: true });
          } catch {
            sendJson(res, 400, { ok: false, error: 'bad-request' });
          }
        },
      }),
    `dsh-balance-pet: POST ${KEY_PATH}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: REPORT_PATH,
        handler: async (req, res) => {
          if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, at: pageStatus.at, reports: pageStatus.reports, last: pageStatus.last });
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
            return;
          }
          try {
            const parsed = JSON.parse(await readBody(req));
            pageStatus.at = Date.now();
            pageStatus.reports += 1;
            pageStatus.last = parsed;
            sendJson(res, 200, { ok: true });
          } catch {
            sendJson(res, 400, { ok: false, error: 'bad-report' });
          }
        },
      }),
    `dsh-balance-pet: GET/POST ${REPORT_PATH}`,
  );

  /* `/pet-check [--json]` — a read-only self test, because the Desktop Host
     denies loopback HTTP to anything that is not the Electron renderer, so the
     routes cannot be probed with an ordinary client. */
  ctx.effect(
    () =>
      ctx.commands.register({
        definitionId: 'dsh-balance-pet',
        name: 'pet-check',
        description: 'Check the balance-pet assets and the balance lookup',
        input: { hint: '[--json]' },
        recordInput: false,
        handler: async (invocation) => {
          const verbose = invocation.rawInput.includes('--json');
          const lines = [];
          const assetNames = ['sprite.png', 'flash.png', 'expression_happy.png', 'expression_nervous.png', 'expression_aloof.png', 'expression_calm.png', 'rice.png', 'iron_bowl.webp', 'hit.mp3', 'feed.mp3'];
          const assets = [];
          for (const name of assetNames) {
            try {
              const info = await stat(join(assetDir, name));
              assets.push({ name, bytes: info.size, ok: info.isFile() && info.size > 0 });
            } catch {
              assets.push({ name, ok: false });
            }
          }
          const missing = assets.filter((entry) => entry.ok !== true).map((entry) => entry.name);
          const key = await resolveApiKey(config);
          let live = 'no-key';
          if (key !== undefined) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const response = await fetch(apiUrl, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: controller.signal });
              const parsed = response.ok ? parseBalance(await response.json()) : undefined;
              live = parsed === undefined ? `http-${response.status}` : `ok total=${parsed.total} ${parsed.currency}`;
            } catch (error) {
              live = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network';
            } finally {
              clearTimeout(timer);
            }
          }
          lines.push(`asset dir : ${assetDir}`);
          lines.push(`assets     : ${assets.length - missing.length}/${assets.length} readable${missing.length > 0 ? ` (missing: ${missing.join(', ')})` : ''}`);
          lines.push(`asset route: GET ${ASSET_PATH}/<name>`);
          lines.push(`balance    : GET ${BALANCE_PATH} -> ${live}`);
          if (pageStatus.last === null) {
            lines.push('page       : no report yet — refresh the page (and check the browser console if it stays quiet)');
          } else {
            const age = Math.round((Date.now() - pageStatus.at) / 1000);
            const page = pageStatus.last;
            lines.push(`page       : ${age}s ago, report #${pageStatus.reports}`);
            lines.push(`  module   : ${String(page.module)}`);
            lines.push(`  engine   : ${String(page.engine)}`);
            lines.push(`  images   : ${JSON.stringify(page.images)}`);
            lines.push(`  readout  : ${JSON.stringify(page.readout)}`);
            lines.push(`  badge    : ${JSON.stringify(page.badge)}`);
            lines.push(`  status   : ${JSON.stringify(page.status)}`);
            if (Array.isArray(page.errors) && page.errors.length > 0) lines.push(`  errors   : ${page.errors.join(' | ')}`);
          }
          if (!verbose) return { kind: missing.length === 0 && live.startsWith('ok') ? 'success' : 'error', text: lines.join('\n') };
          return {
            kind: 'success',
            text: `${lines.join('\n')}\n${JSON.stringify({ assets, apiUrl, live }, null, 2)}`,
          };
        },
      }),
    'dsh-balance-pet: /pet-check',
  );
}
