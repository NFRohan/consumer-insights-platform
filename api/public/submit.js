// POST /api/public/submit  { responseId, surveyId, durationMs }
//
// Marks a response finished. Anonymous, so it goes through a SECURITY
// DEFINER function for the same reason as saving an answer: an UPDATE
// has to read the row it changes, and respondents must not be able to
// read collected responses.

import { queryElevated } from '../_lib/db.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const { responseId, surveyId, durationMs } = await readJson(req);
  if (!responseId || !surveyId) {
    throw new HttpError(400, 'responseId and surveyId are required');
  }

  const rows = await queryElevated(
    `select app.submit_response($1, $2, $3) as submitted`,
    [responseId, surveyId, Number.isFinite(durationMs) ? Math.round(durationMs) : null],
  );
  json(res, 200, { submitted: !!rows[0]?.submitted });
});
