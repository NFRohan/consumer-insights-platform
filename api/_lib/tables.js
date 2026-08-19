// =====================================================================
// The whitelist.
//
// The data endpoint accepts a table name, a column list, filters and an
// ordering from the client. Every one of those becomes a SQL identifier,
// so none of them may be passed through untrusted — they are matched
// against this map and rejected otherwise. Values are always bound as
// parameters, never interpolated.
//
// tenant_id appears in NO writable list. It is set by the column default
// (app.current_tenant()) and policed by RLS; a client can neither read
// it back nor choose it.
// =====================================================================

// The UI still says `profiles` where the database says `app_users`. A
// table alias is safe because the table name never appears in a result.
//
// There is deliberately no COLUMN alias map. One existed (msisdn ->
// respondent_ref) and was silently broken in one direction: it rewrote
// the request, so `select msisdn` became `select respondent_ref` and the
// rows came back keyed `respondent_ref` -- leaving every `r.msisdn` read
// in the UI undefined, with no error anywhere. Columns are renamed at
// the call sites instead.
export const TABLE_ALIASES = { profiles: 'app_users' };

// `json` lists the jsonb columns. Every value bound to one must be
// JSON-encoded — including bare strings, since `Daily` is not valid
// JSON but `"Daily"` is. Getting this wrong fails at insert time, so it
// is declared here rather than inferred.
const T = (readable, writable, json = []) => ({ readable, writable, json });

export const TABLES = {
  surveys: T(
    ['id', 'name', 'description', 'status', 'scenario', 'audience', 'audience_count',
     'branding', 'languages', 'default_language', 'block_resubmission', 'owner_id',
     'published_at', 'closed_at', 'created_at', 'updated_at'],
    ['name', 'description', 'status', 'scenario', 'audience', 'audience_count',
     'branding', 'languages', 'default_language', 'block_resubmission', 'owner_id',
     'published_at', 'closed_at'],
    ['branding'],
  ),
  questions: T(
    ['id', 'survey_id', 'position', 'type', 'text', 'description', 'required',
     'config', 'logic', 'created_at', 'updated_at'],
    ['survey_id', 'position', 'type', 'text', 'description', 'required', 'config', 'logic'],
    ['config', 'logic'],
  ),
  responses: T(
    ['id', 'survey_id', 'respondent_ref', 'language', 'channel', 'region', 'status',
     'duration_ms', 'meta', 'started_at', 'submitted_at', 'created_at'],
    // `id` is writable here alone: the respondent page mints the uuid
    // client-side so a retried submit is idempotent rather than
    // duplicating. Choosing an id that already exists fails on the
    // primary key, which is a conflict, not a way to reach other data.
    ['id', 'survey_id', 'respondent_ref', 'language', 'channel', 'region', 'status',
     'duration_ms', 'meta', 'started_at', 'submitted_at'],
    ['meta'],
  ),
  answers: T(
    ['id', 'response_id', 'question_id', 'survey_id', 'value', 'reaction_ms', 'created_at'],
    ['response_id', 'question_id', 'survey_id', 'value', 'reaction_ms'],
    ['value'],
  ),
  // `clicked` and `delivered` are readable but NOT writable. clicked is
  // maintained solely by app.record_click, which is what lets the UI
  // call it a measurement; delivered stays null until a gateway exists
  // to report it. A client that could set either could restore exactly
  // the invented figures 005 removed.
  distributions: T(
    ['id', 'survey_id', 'channel', 'message', 'audience_size', 'sent', 'delivered',
     'clicked', 'created_by', 'created_at'],
    ['survey_id', 'channel', 'message', 'audience_size', 'sent', 'created_by'],
  ),
  cleaning_rules: T(
    ['id', 'survey_id', 'name', 'active', 'condition', 'action', 'last_run_at',
     'flagged_count', 'deleted_count', 'created_by', 'created_at', 'updated_at'],
    ['survey_id', 'name', 'active', 'condition', 'action', 'last_run_at',
     'flagged_count', 'deleted_count', 'created_by'],
    ['condition'],
  ),
  // The actor is not writable: a before-insert trigger (006) stamps both
  // columns from the verified session. Accepting them from the client
  // let one member log an action under another member's name.
  audit_logs: T(
    ['id', 'ts', 'actor_id', 'actor_name', 'kind', 'ref', 'detail', 'meta'],
    ['kind', 'ref', 'detail', 'meta'],
    ['meta'],
  ),
  // Password hashes are deliberately absent from `readable`: the column
  // exists but no client query can ever project it.
  app_users: T(
    ['id', 'username', 'full_name', 'email', 'role', 'department', 'status',
     'must_change_pw', 'last_login_at', 'created_at', 'updated_at'],
    ['full_name', 'email', 'role', 'department', 'status'],
  ),
  tenants: T(
    ['id', 'name', 'slug', 'kind', 'expires_at', 'revoked_at', 'notes', 'created_at'],
    [],  // tenants are managed only through the provisioning functions
  ),
};

export const OPERATORS = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
  like: 'like', ilike: 'ilike',
};

export function resolveTable(name) {
  const real = TABLE_ALIASES[name] || name;
  const def = TABLES[real];
  if (!def) throw new HttpError(400, `unknown table: ${name}`);
  return { name: real, ...def };
}

export function resolveColumn(table, col) {
  if (!table.readable.includes(col)) {
    throw new HttpError(400, `unknown column ${col} on ${table.name}`);
  }
  return col;
}

export function resolveWritable(table, col) {
  if (!table.writable.includes(col)) {
    throw new HttpError(400, `column ${col} is not writable on ${table.name}`);
  }
  return col;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
