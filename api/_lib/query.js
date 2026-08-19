// =====================================================================
// Query builder for the data endpoint.
//
// Identifiers are only ever emitted after passing the whitelist in
// tables.js; values are only ever emitted as bind parameters. Those two
// rules together are what make a generic endpoint safe.
// =====================================================================

import { resolveTable, resolveColumn, resolveWritable, OPERATORS, HttpError } from './tables.js';

const MAX_LIMIT = 5000;
const MAX_ROWS_PER_WRITE = 1000;

function quote(id) {
  // Belt and braces: everything here already came from the whitelist,
  // but an identifier that could not survive this check must never be
  // emitted.
  if (!/^[a-z_][a-z0-9_]*$/.test(id)) throw new HttpError(400, `bad identifier: ${id}`);
  return `"${id}"`;
}

function projection(table, columns) {
  if (!columns || columns === '*') return table.readable.map(quote).join(', ');
  const wanted = String(columns).split(',').map((c) => c.trim()).filter(Boolean);
  if (!wanted.length) throw new HttpError(400, 'empty column list');
  return wanted.map((c) => quote(resolveColumn(table, c))).join(', ');
}

function whereClause(table, filters, params) {
  if (!filters?.length) return { text: '', params };
  const parts = [];
  for (const f of filters) {
    const col = quote(resolveColumn(table, f.col));

    if (f.op === 'is') {
      if (f.val !== null && f.val !== 'null') {
        throw new HttpError(400, "the `is` operator only supports null");
      }
      parts.push(`${col} is null`);
      continue;
    }

    if (f.op === 'in' || f.op === 'notin') {
      const list = Array.isArray(f.val) ? f.val : [f.val];
      if (!list.length) { parts.push(f.op === 'in' ? 'false' : 'true'); continue; }
      const holes = list.map((v) => `$${params.push(v)}`);
      parts.push(`${col} ${f.op === 'in' ? 'in' : 'not in'} (${holes.join(', ')})`);
      continue;
    }

    const sqlOp = OPERATORS[f.op];
    if (!sqlOp) throw new HttpError(400, `unknown operator: ${f.op}`);
    parts.push(`${col} ${sqlOp} $${params.push(f.val)}`);
  }
  return { text: ` where ${parts.join(' and ')}`, params };
}

function orderLimit(table, order, limit) {
  let text = '';
  if (order?.col) {
    text += ` order by ${quote(resolveColumn(table, order.col))} ${order.asc === false ? 'desc' : 'asc'}`;
  }
  // MAX_LIMIT is the default, not only the cap. A select with no limit
  // used to stream the tenant's whole table out of a serverless function
  // with no ceiling at all -- the cross-tab view issues exactly that.
  const n = Number(limit);
  const capped = (Number.isFinite(n) && n > 0) ? Math.min(Math.floor(n), MAX_LIMIT) : MAX_LIMIT;
  text += ` limit ${capped}`;
  return { text, applied: capped };
}

function rowsToColumnsAndValues(table, rows, params) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) throw new HttpError(400, 'no rows supplied');
  if (list.length > MAX_ROWS_PER_WRITE) {
    throw new HttpError(413, `too many rows (max ${MAX_ROWS_PER_WRITE})`);
  }
  // Union of keys so a ragged payload still produces one consistent
  // statement; missing keys fall back to the column default.
  const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
  const cols = keys.map((k) => resolveWritable(table, k));
  const tuples = list.map((r) => {
    const holes = keys.map((k, i) =>
      (k in r ? `$${params.push(normalise(table, cols[i], r[k]))}` : 'default'));
    return `(${holes.join(', ')})`;
  });
  return { cols, tuples };
}

// jsonb columns need every value JSON-encoded, strings included.
// Non-json columns are passed through so text[] and friends still bind
// natively.
function normalise(table, col, v) {
  if (v === undefined) return null;
  if (table.json?.includes(col)) return JSON.stringify(v ?? null);
  return v;
}

/**
 * Turn a validated request body into { text, params }.
 *
 * body: { table, op, columns?, filters?, order?, limit?, rows?, patch?, onConflict? }
 */
export function build(body) {
  const table = resolveTable(body.table);
  const params = [];
  // Writes only get a RETURNING clause when the caller asked for one.
  const proj = body.columns ? projection(table, body.columns) : null;
  const returning = proj ? ` returning ${proj}` : '';

  switch (body.op) {
    case 'select': {
      const where = whereClause(table, body.filters, params);
      const tail = orderLimit(table, body.order, body.limit);
      return {
        // `limit` is reported back so the caller can tell a full result
        // from one that stopped at the ceiling. A quietly truncated
        // answer set produces a confident, wrong cross-tab.
        limit: tail.applied,
        text: `select ${proj || projection(table, '*')} from ${quote(table.name)}${where.text}${tail.text}`,
        params,
      };
    }

    case 'insert': {
      const { cols, tuples } = rowsToColumnsAndValues(table, body.rows, params);
      return {
        text: `insert into ${quote(table.name)} (${cols.map(quote).join(', ')}) `
            + `values ${tuples.join(', ')}${returning}`,
        params,
      };
    }

    case 'upsert': {
      const { cols, tuples } = rowsToColumnsAndValues(table, body.rows, params);
      const conflict = (body.onConflict || 'id').split(',').map((c) => c.trim()).filter(Boolean)
        .map((c) => quote(resolveColumn(table, c)));
      const updates = cols.filter((c) => !conflict.includes(quote(c)))
        .map((c) => `${quote(c)} = excluded.${quote(c)}`);
      const doClause = updates.length ? `do update set ${updates.join(', ')}` : 'do nothing';
      return {
        text: `insert into ${quote(table.name)} (${cols.map(quote).join(', ')}) `
            + `values ${tuples.join(', ')} `
            + `on conflict (${conflict.join(', ')}) ${doClause}${returning}`,
        params,
      };
    }

    case 'update': {
      if (!body.patch || !Object.keys(body.patch).length) {
        throw new HttpError(400, 'update requires a patch');
      }
      // An unfiltered UPDATE would rewrite the whole tenant. RLS would
      // still contain it to one tenant, but that is not the intent of
      // any call site, so refuse it outright.
      if (!body.filters?.length) throw new HttpError(400, 'update requires at least one filter');
      const sets = Object.entries(body.patch).map(([k, v]) => {
        const col = resolveWritable(table, k);
        return `${quote(col)} = $${params.push(normalise(table, col, v))}`;
      });
      const where = whereClause(table, body.filters, params);
      return {
        text: `update ${quote(table.name)} set ${sets.join(', ')}${where.text}${returning}`,
        params,
      };
    }

    case 'delete': {
      if (!body.filters?.length) throw new HttpError(400, 'delete requires at least one filter');
      const where = whereClause(table, body.filters, params);
      return {
        text: `delete from ${quote(table.name)}${where.text}${returning}`,
        params,
      };
    }

    default:
      throw new HttpError(400, `unknown op: ${body.op}`);
  }
}
