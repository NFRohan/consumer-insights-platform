// =====================================================================
// Date helpers shared by the staff console and the product shell.
//
// Both need to say the same thing about the same expiry, so they share
// one implementation rather than two that drift.
// =====================================================================

const DAY = 86_400_000;

export const fmtDate = (v) =>
  (v ? new Date(v).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const fmtWhen = (v) =>
  (v ? new Date(v).toLocaleString(undefined,
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Whole days until `iso`; negative once it has passed. */
export const daysUntil = (iso) =>
  (iso ? Math.round((new Date(iso).getTime() - Date.now()) / DAY) : null);

export const hoursUntil = (iso) =>
  (iso ? (new Date(iso).getTime() - Date.now()) / 3_600_000 : null);

/** "in 3 days" / "today" / "2 days ago" — the number people act on. */
export function relativeDays(iso) {
  const d = daysUntil(iso);
  if (d === null) return '';
  if (d === 0) return 'today';
  if (d > 0) return `in ${d} day${d === 1 ? '' : 's'}`;
  return `${-d} day${d === -1 ? '' : 's'} ago`;
}

/** Short form for a status chip: "6 days left", "4 hours left". */
export function remainingLabel(iso) {
  const hours = hoursUntil(iso);
  if (hours === null) return '';
  if (hours <= 0) return 'expired';
  if (hours < 24) {
    const h = Math.max(1, Math.round(hours));
    return `${h} hour${h === 1 ? '' : 's'} left`;
  }
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? '' : 's'} left`;
}
