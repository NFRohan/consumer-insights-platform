// =====================================================================
// Render smoke test.
//
//   node scripts/test-render.mjs
//
// Renders every view once through Vite's SSR pipeline. Effects do not
// run, so this says nothing about data — it says the component can be
// rendered at all. `npm run build` cannot tell you that: a reference to
// a `const` before its declaration compiles cleanly and throws on every
// render, which is how the builder shipped blank.
// =====================================================================

import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import React from 'react';

// The browser surface these components legitimately use. Rendering has
// no window, so the test supplies one rather than the app guarding for
// an environment it never actually runs in.
globalThis.window = {
  location: { origin: 'https://example.test', href: 'https://example.test/' },
  addEventListener() {}, removeEventListener() {}, open() {},
};
globalThis.document = {
  visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
};
globalThis.localStorage = {
  getItem: () => null, setItem() {}, removeItem() {},
};
// Node already defines navigator and refuses assignment, so extend it.
if (!globalThis.navigator.clipboard) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async () => {} }, configurable: true,
  });
}

const ctx = {
  activeSurveyId: '11111111-1111-1111-1111-111111111111',
  setActiveSurveyId() {}, goBuilder() {}, goDistribute() {}, goLive() {}, setView() {},
};

const VIEWS = [
  'BuilderView', 'SurveysListView', 'DistributeView', 'CrossTabView',
  'LiveDashboardView', 'CleaningView', 'AuditView', 'UsersView',
  'BrandingView', 'ConfigView', 'SentimentView', 'AuthView', 'StaffPortal',
];

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const { AuthProvider } = await server.ssrLoadModule('/src/context/AuthContext.jsx');

let failed = 0;
for (const name of VIEWS) {
  try {
    const mod = await server.ssrLoadModule(`/src/views/${name}.jsx`);
    // Wrapped in the real provider: several views call useAuth, and one
    // that throws without a provider tells us nothing about itself.
    const wrap = (c) => React.createElement(
      AuthProvider, null, React.createElement(mod.default, { ctx: c }));
    // Rendered twice: once with a survey selected, once without, since
    // the empty case takes a different path through most of these.
    renderToString(wrap(ctx));
    renderToString(wrap({ ...ctx, activeSurveyId: null }));
    console.log('  pass:', name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL:', name, '—', String(err.message).split('\n')[0]);
  }
}

await server.close();

if (failed) {
  console.log(`\n${failed} view(s) cannot render\n`);
  process.exit(1);
}
console.log(`\nALL ${VIEWS.length} VIEWS RENDER\n`);
