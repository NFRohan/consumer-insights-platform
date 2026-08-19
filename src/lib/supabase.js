// =====================================================================
// Compatibility re-export.
//
// The app used to hold a Supabase client and talk to it directly from
// the browser. It now talks to /api, which owns the database
// credentials and resolves the caller's tenant from a verified token.
//
// Every view still imports `{ supabase }` from this module, so the
// cutover happens here rather than across twelve files. Renaming the
// import throughout is a tidy-up for later, not part of the swap.
//
// Gone with the old client: ~70 lines of workaround for the supabase-js
// navigator.locks bug, and the visibilitychange re-check that went with
// it. Neither has an equivalent problem here.
// =====================================================================

export { api as supabase, setPublicSurvey } from './apiClient.js';
export { default } from './apiClient.js';
