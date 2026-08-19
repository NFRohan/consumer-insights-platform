// =====================================================================
// Client shim.
//
// Presents the same shape the views already call — from().select().eq(),
// auth.signInWithPassword(), channel().on().subscribe() — but talks to
// /api instead of Supabase. That is deliberate: it keeps 21 call sites
// and 4 subscriptions unchanged while the backend swaps underneath.
//
// Two behaviours differ from supabase-js and are worth knowing:
//
//   * channel() polls. Neon has no change stream, so subscribers are
//     invoked on a timer instead of on commit. The views all respond by
//     re-fetching, so the effect is the same, a couple of seconds later.
//
//   * Errors are returned as { data, error }, never thrown, matching
//     what the call sites already expect.
// =====================================================================

const TOKEN_KEY = 'cip.session';
const POLL_MS = Number(import.meta.env.VITE_POLL_MS || 4000);

// ---------------------------------------------------------------------
// session storage
// ---------------------------------------------------------------------
function readSession() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(s) {
  try {
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private browsing */ }
  authListeners.forEach((cb) => {
    try { cb(s ? 'SIGNED_IN' : 'SIGNED_OUT', s); } catch { /* listener's problem */ }
  });
}

const authListeners = new Set();

// Why the last session ended, when the server gave a reason worth
// repeating (expired / withdrawn). Read by the sign-in screen.
let lastSessionEnd = null;
export const sessionEndedBecause = () => lastSessionEnd;

// The public respondent page has no session; it names the survey it is
// answering instead, and the server resolves the tenant from it.
let publicSurveyId = null;
export function setPublicSurvey(id) { publicSurveyId = id; }

// ---------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------
async function post(path, body) {
  const session = readSession();
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(session?.token ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A dead session should not strand the user on a blank screen.
    if (res.status === 401 && session) writeSession(null);
    return { data: null, error: { message: payload.error || res.statusText, status: res.status } };
  }
  // `truncated` rides alongside data/error; every existing call site
  // destructures only what it needs, so this is additive.
  return { data: payload.data, error: null, truncated: !!payload.truncated };
}

// ---------------------------------------------------------------------
// query builder — thenable, so `await` runs it
// ---------------------------------------------------------------------
class Query {
  constructor(table) {
    this.body = { table, op: 'select', filters: [] };
  }

  // Mirrors supabase-js: a write returns rows only if .select() is
  // chained. That matters beyond tidiness — RETURNING is subject to the
  // SELECT policy, so an anonymous respondent submitting a response can
  // write it but may not read it back.
  select(columns = '*') {
    this.body.columns = columns;
    return this;
  }

  insert(rows)  { this.body.op = 'insert'; this.body.rows = rows; return this; }
  update(patch) { this.body.op = 'update'; this.body.patch = patch; return this; }
  delete()      { this.body.op = 'delete'; return this; }

  upsert(rows, opts = {}) {
    this.body.op = 'upsert';
    this.body.rows = rows;
    if (opts.onConflict) this.body.onConflict = opts.onConflict;
    return this;
  }

  eq(col, val)  { this.body.filters.push({ col, op: 'eq',  val }); return this; }
  neq(col, val) { this.body.filters.push({ col, op: 'neq', val }); return this; }
  gt(col, val)  { this.body.filters.push({ col, op: 'gt',  val }); return this; }
  gte(col, val) { this.body.filters.push({ col, op: 'gte', val }); return this; }
  lt(col, val)  { this.body.filters.push({ col, op: 'lt',  val }); return this; }
  lte(col, val) { this.body.filters.push({ col, op: 'lte', val }); return this; }
  like(col, val)  { this.body.filters.push({ col, op: 'like',  val }); return this; }
  ilike(col, val) { this.body.filters.push({ col, op: 'ilike', val }); return this; }
  in(col, vals) { this.body.filters.push({ col, op: 'in', val: vals }); return this; }
  is(col, val)  { this.body.filters.push({ col, op: 'is', val }); return this; }

  match(obj) {
    Object.entries(obj || {}).forEach(([col, val]) => this.eq(col, val));
    return this;
  }

  order(col, opts = {}) {
    this.body.order = { col, asc: opts.ascending !== false };
    return this;
  }

  limit(n) { this.body.limit = n; return this; }

  single() { this.body.single = true; this.body.limit = 2; return this; }

  maybeSingle() { this.body.single = true; this.body.limit = 2; return this; }

  then(resolve, reject) {
    const body = { ...this.body };
    if (body.op === 'select' && !body.columns) body.columns = '*';
    if (publicSurveyId && !readSession()) body.publicSurveyId = publicSurveyId;
    return post('/api/data', body).then(resolve, reject);
  }
}

// ---------------------------------------------------------------------
// polling stand-in for realtime
// ---------------------------------------------------------------------
class Channel {
  constructor(name) {
    this.name = name;
    this.handlers = [];
    this.timer = null;
  }

  on(_event, _filter, cb) {
    this.handlers.push(typeof _filter === 'function' ? _filter : cb);
    return this;
  }

  subscribe() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      // Views re-fetch on any event, so the payload is not inspected.
      this.handlers.forEach((h) => { try { h({ table: this.name }); } catch { /* ignore */ } });
    }, POLL_MS);
    return this;
  }

  unsubscribe() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }
}

// ---------------------------------------------------------------------
// auth surface
// ---------------------------------------------------------------------
const auth = {
  async signInWithPassword({ email, username, password }) {
    const identifier = username || email;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: identifier, password }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { data: { session: null, user: null }, error: { message: payload.error || 'sign in failed' } };
    }
    const session = {
      token: payload.token,
      user: payload.user,
      tenant: payload.tenant,
      access_token: payload.token,
    };
    writeSession(session);
    return { data: { session, user: payload.user }, error: null };
  },

  // Self-service signup is not part of the evaluation flow: accounts are
  // minted by staff. Kept so the existing call site fails cleanly.
  async signUp() {
    return {
      data: { session: null, user: null },
      error: { message: 'accounts are issued by Intelligent Machines, not self-registered' },
    };
  },

  async signOut() {
    writeSession(null);
    return { error: null };
  },

  async getSession() {
    const session = readSession();
    if (!session) return { data: { session: null }, error: null };
    // Confirm the tenant is still live rather than trusting the token.
    const res = await fetch('/api/auth/me', {
      headers: { authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) {
      // Keep WHY. An expired or withdrawn sandbox ends the session
      // mid-use, and dropping the reason here turns a deliberate,
      // explainable cutoff into an unexplained logout.
      const why = await res.json().catch(() => ({}));
      lastSessionEnd = res.status === 403 ? (why.error || null) : null;
      writeSession(null);
      return { data: { session: null }, error: null };
    }
    lastSessionEnd = null;
    const payload = await res.json();
    const fresh = { ...session, user: payload.user, tenant: payload.tenant };
    return { data: { session: fresh }, error: null };
  },

  onAuthStateChange(cb) {
    authListeners.add(cb);
    return {
      data: { subscription: { unsubscribe: () => authListeners.delete(cb) } },
    };
  },
};


/**
 * Authenticated fetch for endpoints outside the data shim (the staff
 * portal). Throws on failure so callers can use try/catch rather than
 * the { data, error } convention the query builder follows.
 */
export async function authFetch(path, { method = 'GET', body } = {}) {
  const session = readSession();
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session?.token ? { authorization: `Bearer ${session.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || res.statusText);
  return payload;
}

// ---------------------------------------------------------------------
// the exported client
// ---------------------------------------------------------------------
export const api = {
  from: (table) => new Query(table),
  channel: (name) => new Channel(name),
  removeChannel: (ch) => { ch?.unsubscribe?.(); },
  auth,
  session: readSession,
};

export default api;
