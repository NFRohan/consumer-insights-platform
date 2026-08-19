// POST /api/public/click   { distributionId }
//
// Records that a tracked link was opened.
//
// The visitor key is derived HERE, from the request, and never accepted
// from the caller. It used to be a browser-minted uuid, which made the
// unique constraint a defence against refreshes only: a loop that picked
// a fresh key each time pushed "unique opens" past the audience size
// (500 on an audience of 100, in seconds). A figure whose entire purpose
// is to be trustworthy cannot be the caller's to choose.
//
// What it identifies is a NETWORK CLIENT, not a browser and not a
// person. Colleagues sharing an office connection and a browser version
// count once. That undercounts, which is the direction to err in.

import { createHmac } from 'node:crypto';
import { queryElevated } from '../_lib/db.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

function visitorSignature(req) {
  // Vercel sets x-forwarded-for; the first entry is the client. Locally
  // there is no proxy, so fall back to the socket.
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || '';
  if (!ip) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');

  // Hashed so the table holds no addresses, and keyed so the digest
  // cannot be reproduced by anyone who guesses the inputs. The literal
  // prefix keeps this domain separate from any other use of the secret.
  return createHmac('sha256', secret)
    .update(`click-visitor|${ip}|${req.headers?.['user-agent'] || ''}`)
    .digest('base64url')
    .slice(0, 43);
}

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const { distributionId } = await readJson(req);
  if (!distributionId) throw new HttpError(400, 'distributionId is required');

  const visitor = visitorSignature(req);
  // No usable address means we cannot tell this caller apart from any
  // other, so there is nothing honest to record. Not an error: tracking
  // must never fail a respondent's page load.
  if (!visitor) { json(res, 200, { firstOpen: false }); return; }

  const rows = await queryElevated(
    `select app.record_click($1, $2) as first_open`, [distributionId, visitor],
  );
  json(res, 200, { firstOpen: !!rows[0]?.first_open });
});
