import { supabase } from './supabase.js';

// The actor is deliberately absent from this payload. It used to be sent
// from here (actor_id / actor_name off the signed-in profile), which
// meant the browser decided whose name appeared against an action — so
// one member could log a deletion under a colleague's name, and before
// the policy fix in 002 an anonymous respondent could write entries at
// all. A before-insert trigger now stamps both columns from the verified
// session; there is nothing left for the client to assert.
export async function logAudit({ kind, ref, detail, meta }) {
  try {
    await supabase.from('audit_logs').insert({
      kind,
      ref: ref ? String(ref).slice(0, 64) : null,
      detail: detail ? String(detail).slice(0, 500) : null,
      meta: meta ?? {},
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('audit log failed', err?.message);
  }
}
