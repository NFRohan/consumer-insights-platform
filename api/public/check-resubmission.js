// POST /api/public/check-resubmission  { surveyId, ref }
//
// Answers one yes/no question for the anonymous respondent page. It
// deliberately exposes no rows: respondents must not be able to read
// collected responses, so the count that used to run client-side now
// happens behind a narrow SECURITY DEFINER function.

import { queryElevated } from '../_lib/db.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const { surveyId, ref } = await readJson(req);
  if (!surveyId) throw new HttpError(400, 'surveyId is required');
  if (!ref) { json(res, 200, { blocked: false }); return; }

  const rows = await queryElevated(
    `select app.has_completed_response($1, $2) as blocked`, [surveyId, ref],
  );
  json(res, 200, { blocked: !!rows[0]?.blocked });
});
