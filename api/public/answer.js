// POST /api/public/answer
// { responseId, questionId, surveyId, value, reactionMs }
//
// The respondent page saves one answer at a time. Routed through a
// SECURITY DEFINER function because the upsert's ON CONFLICT path needs
// read access that anonymous respondents must not have.

import { queryElevated } from '../_lib/db.js';
import { handler, json, methodGuard, readJson, HttpError } from '../_lib/http.js';

export default handler(async (req, res) => {
  if (!methodGuard(req, res, ['POST'])) return;

  const { responseId, questionId, surveyId, value, reactionMs } = await readJson(req);
  if (!responseId || !questionId || !surveyId) {
    throw new HttpError(400, 'responseId, questionId and surveyId are required');
  }

  await queryElevated(
    `select app.save_answer($1, $2, $3, $4::jsonb, $5)`,
    [responseId, questionId, surveyId, JSON.stringify(value ?? null),
     Number.isFinite(reactionMs) ? reactionMs : null],
  );
  json(res, 200, { saved: true });
});
