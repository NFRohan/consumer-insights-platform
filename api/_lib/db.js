// =====================================================================
// Database access.
//
// Every query runs inside a transaction that first sets the request's
// session context. That context is what RLS reads, and it is
// transaction-local (`set_config(..., true)`) so it cannot leak to the
// next request sharing a pooled connection — which on a serverless
// platform is the failure mode that matters.
//
// tenantId always comes from a verified token or a server-side lookup,
// never from the request body.
// =====================================================================

import pg from 'pg';
import { HttpError } from './tables.js';

const { Pool } = pg;

let pool;

/** Lazily created so importing this module never opens a socket. */
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString,
      // Neon terminates TLS at the pooler; local Postgres has none.
      ssl: /localhost|127\.0\.0\.1/.test(connectionString)
        ? false
        : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
  }
  return pool;
}

/**
 * Run `fn` with the given identity applied to the session.
 *
 * @param ctx  {{tenantId?, userId?, role?, isStaff?}}
 * @param fn   (client) => Promise<T>   — receives a pg client
 */
const ROLES = new Set(['admin', 'creator', 'viewer', 'anon']);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Validated, so the batched preamble can embed these without binding. */
function clean(ctx) {
  const id = (v, what) => {
    if (v === null || v === undefined || v === '') return null;
    if (!UUID.test(String(v))) throw new HttpError(400, `${what} is not a uuid`);
    return String(v);
  };
  const iat = Number(ctx.issuedAt);
  return {
    tenant: id(ctx.tenantId, 'tenant id'),
    user: id(ctx.userId, 'user id'),
    role: ROLES.has(ctx.role) ? ctx.role : 'anon',
    staff: ctx.isStaff ? 'true' : 'false',
    iat: Number.isSafeInteger(iat) && iat > 0 ? String(iat) : null,
  };
}

/**
 * The session preamble, as ONE statement.
 *
 * Three round trips (begin / set role / set_config) used to cost most of
 * a cross-region response, so they are batched into a single simple
 * query. Batching means no bind parameters, so every value is validated
 * to a shape that cannot contain a quote first: two UUIDs, a role from a
 * fixed set, a boolean, and an integer.
 *
 * app.begin_request also decides whether this caller may proceed at all
 * — the sandbox is still live, and the token predates no password change
 * — because a check placed here cannot be forgotten by the next endpoint
 * someone writes.
 */
function preamble(ctx) {
  const c = clean(ctx);
  const arg = (v) => (v === null ? 'null' : `'${v}'`);
  return `begin;
          set local role app_api;
          select app.begin_request(${arg(c.tenant)}::uuid, ${arg(c.user)}::uuid,
                                   '${c.role}', ${c.staff}, ${c.iat ?? 'null'}::bigint);`;
}

/**
 * Run `fn` with the given identity applied to the session.
 *
 * @param ctx  {{tenantId?, userId?, role?, isStaff?, issuedAt?}}
 * @param fn   (client) => Promise<T>   — receives a pg client
 */
export async function withContext(ctx, fn) {
  const client = await getPool().connect();
  // `begin` is the first statement of the batch below, so from the
  // moment it is sent this connection may be inside a transaction --
  // including when a later statement in the same batch raises. Marking
  // it open only on success left an aborted transaction on a connection
  // that then went back to the pool, where the next request inherited
  // "current transaction is aborted, commands ignored".
  let open = true;
  let poisoned = false;
  try {
    // One round trip: open the transaction, drop to the unprivileged
    // role for its lifetime, validate the caller, and set the context
    // RLS reads.
    //
    // The role drop matters on its own. Without it a connection that
    // happens to be an owner or superuser bypasses RLS entirely and
    // every tenant sees everything. Production should ALSO connect as a
    // non-owner; this makes the guarantee hold either way.
    try {
      await client.query(preamble(ctx));
    } catch (err) {
      if (err instanceof HttpError) throw err;

      // A refusal from app.begin_request is an answer, not a fault: the
      // sandbox lapsed, was withdrawn, or the password has since
      // changed. Carry the reason out as a 403 the client can show.
      if (err?.code === 'P0001' && err?.hint) {
        throw new HttpError(403, {
          expired: 'this evaluation access has expired',
          revoked: 'this evaluation access has been withdrawn',
          missing: 'this evaluation no longer exists',
          password_changed: 'your password was changed — please sign in again',
        }[err.hint] || 'access is no longer valid');
      }

      // A failed role switch is a deploy mistake, not a permission
      // decision. Postgres raises 42501, which the HTTP layer would
      // otherwise render as a bland 403 on every single request with
      // nothing in the log to explain it.
      if (/set role|app_api/i.test(err.message)) {
        throw new Error(
          `cannot assume the app_api role -- the role this process connects as `
          + `must be a member of it: grant app_api to "<runtime_role>". (${err.message})`,
        );
      }
      throw err;
    }

    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    if (open) {
      try {
        await client.query('rollback');
      } catch {
        // The connection cannot be cleaned up, so it must not be reused.
        poisoned = true;
      }
    }
    throw err;
  } finally {
    // Passing a truthy argument destroys the connection instead of
    // returning it to the pool.
    client.release(poisoned);
  }
}

/** Convenience for a single statement. */
export async function queryAs(ctx, text, params = []) {
  return withContext(ctx, async (client) => (await client.query(text, params)).rows);
}

/**
 * Elevated access for provisioning and login, which must read across
 * tenants (resolve a username -> tenant) before any tenant is known.
 * Restricted to this module's callers by convention; every SQL function
 * it reaches also enforces app.is_staff() itself.
 */
export async function queryAsStaff(text, params = []) {
  return queryAs({ isStaff: true, role: 'admin' }, text, params);
}

/**
 * The same elevated context, under the name the ANONYMOUS endpoints
 * should use — /api/public/*, which have no session at all.
 *
 * Identical behaviour, deliberately different name: those handlers run
 * one parameterised SECURITY DEFINER call that validates its own inputs,
 * and calling that `queryAsStaff` invites a later edit to add a second
 * statement that silently inherits staff privileges. Anything reached
 * through this helper must be a single call to a function that checks
 * what it was given.
 */
export const queryElevated = queryAsStaff;
