// =====================================================================
// Passwords and tokens.
//
// scrypt comes from node:crypto — no native module to fail on a
// serverless build, and stronger than a PBKDF2 hand-roll.
//
// The token's `exp` is capped at the tenant's expiry, so a session
// issued minutes before a demo lapses dies with it. Expiry is also
// re-checked server-side on every request; the token is a fast path,
// not the source of truth.
// =====================================================================

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { HttpError } from './tables.js';

const scrypt = promisify(_scrypt);

const N = 16384, r = 8, p = 1, KEYLEN = 32;
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 12 * 60 * 60);

// ---------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain, stored) {
  try {
    const [scheme, n, rr, pp, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(plain, salt, expected.length,
      { N: Number(n), r: Number(rr), p: Number(pp) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Readable credential for handing to a prospect: 4 groups of 4. */
export function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

// ---------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------
function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  }
  return new TextEncoder().encode(s);
}

export async function signToken({ userId, tenantId, role, isStaff, tenantExpiresAt }) {
  const now = Math.floor(Date.now() / 1000);
  let exp = now + SESSION_TTL_SECONDS;
  if (tenantExpiresAt) {
    exp = Math.min(exp, Math.floor(new Date(tenantExpiresAt).getTime() / 1000));
  }
  if (exp <= now) throw new HttpError(403, 'this access has expired');

  return new SignJWT({ tid: tenantId ?? null, role, staff: !!isStaff })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret());
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, secret());
  return payload;
}

/**
 * Build the DB session context from the Authorization header.
 * Returns an anonymous context when there is no usable token — the
 * public respondent flow depends on that.
 */
export async function contextFromRequest(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return { tenantId: null, userId: null, role: 'anon', isStaff: false };

  try {
    const p = await verifyToken(token);
    return {
      tenantId: p.tid || null,
      userId: p.sub || null,
      role: p.role || 'viewer',
      isStaff: !!p.staff,
      // When this session began. A password reset makes every token
      // issued before it stale, which is what ends the old sessions.
      issuedAt: p.iat || null,
    };
  } catch {
    throw new HttpError(401, 'invalid or expired session');
  }
}

/** Require a signed-in, non-staff tenant member. */
export function requireTenant(ctx) {
  if (!ctx.userId || !ctx.tenantId) throw new HttpError(401, 'sign in required');
  return ctx;
}

export function requireStaff(ctx) {
  if (!ctx.isStaff) throw new HttpError(403, 'staff only');
  return ctx;
}
