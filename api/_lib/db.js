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

/**
 * The session preamble, as ONE statement.
 *
 * It used to be three round trips (begin / set role / set_config), and a
 * transaction cost five in total. Against a database in another region
 * that is most of the response time, so the preamble is batched into a
 * single simple query.
 *
 * Batching means no bind parameters, so every value is validated to a
 * shape that cannot contain a quote before it is embedded: two UUIDs, a
 * role from a fixed set, and a boolean. Anything else is a bug in the
 * caller and is refused here rather than concatenated.
 */
function preamble(ctx) {
  const id = (v, what) => {
    if (v === null || v === undefined || v === '') return '';
    if (!UUID.test(String(v))) throw new HttpError(400, `${what} is not a uuid`);
    return String(v);
  };
  const tenant = id(ctx.tenantId, 'tenant id');
  const user = id(ctx.userId, 'user id');
  const role = ROLES.has(ctx.role) ? ctx.role : 'anon';
  const staff = ctx.isStaff ? 'true' : 'false';

  return `begin;
          set local role app_api;
          select set_config('app.tenant_id', '${tenant}', true),
                 set_config('app.user_id',   '${user}',   true),
                 set_config('app.role',      '${role}',   true),
                 set_config('app.is_staff',  '${staff}',  true);`;
}

/**
 * Run `fn` with the given identity applied to the session.
 *
 * @param ctx  {{tenantId?, userId?, role?, isStaff?}}
 * @param fn   (client) => Promise<T>   — receives a pg client
 */
export async function withContext(ctx, fn) {
  const client = await getPool().connect();
  let open = false;
  try {
    // One round trip: open the transaction, drop to the unprivileged
    // role for its lifetime, and set the context RLS reads.
    //
    // The role drop matters on its own. Without it a connection that
    // happens to be an owner or superuser bypasses RLS entirely and
    // every tenant sees everything. Production should ALSO connect as a
    // non-owner; this makes the guarantee hold either way.
    try {
      await client.query(preamble(ctx));
      open = true;
    } catch (err) {
      if (err instanceof HttpError) throw err;
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
      try { await client.query('rollback'); } catch { /* connection already gone */ }
    }
    throw err;
  } finally {
    client.release();
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
