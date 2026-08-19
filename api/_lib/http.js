// =====================================================================
// Small helpers shared by every handler.
// =====================================================================

import { HttpError } from './tables.js';

export { HttpError };

export function json(res, status, body) {
  res.status(status);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function methodGuard(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('allow', allowed.join(', '));
    json(res, 405, { error: `${req.method} not allowed` });
    return false;
  }
  return true;
}

/** Vercel parses JSON bodies already; this covers the raw case too. */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body must be valid JSON');
  }
}

/**
 * Wrap a handler so thrown HttpErrors become clean responses and
 * anything else becomes a 500 without leaking internals to the client.
 */
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message });
        return;
      }
      // Postgres refuses an RLS-violating write with 42501. Surfacing
      // that as 403 keeps the client honest without describing the
      // policy that stopped it.
      if (err?.code === '42501') {
        json(res, 403, { error: 'not permitted' });
        return;
      }
      if (err?.code === '23505') {
        json(res, 409, { error: 'already exists' });
        return;
      }
      console.error('[api]', err?.stack || err);
      json(res, 500, { error: 'internal error' });
    }
  };
}
