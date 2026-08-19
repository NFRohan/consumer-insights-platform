import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------
// Serve /api locally the way Vercel does in production.
//
// Vercel maps api/foo/bar.js to /api/foo/bar and calls its default
// export with (req, res). This reproduces that so `npm run dev` gives
// the same behaviour as a deployment, without needing the Vercel CLI.
//
// Handlers are imported fresh on every request so editing one does not
// require restarting the dev server.
// ---------------------------------------------------------------------
function apiDevServer() {
  return {
    name: 'api-dev-server',
    apply: 'serve',
    configureServer(server) {
      // The API reads DATABASE_URL / JWT_SECRET from the process, not
      // from Vite's import.meta.env, so load .env into process.env.
      const envPath = resolve(process.cwd(), '.env');
      if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, 'utf8').split('\n')) {
          const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
          if (m && !process.env[m[1]]) {
            process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
          }
        }
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const route = req.url.split('?')[0].replace(/^\/api\//, '').replace(/\/+$/, '');
        const file = resolve(process.cwd(), 'api', `${route}.js`);
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `no api route: /api/${route}` }));
          return;
        }

        // Give the handler the Express-ish surface Vercel provides.
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (body) => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
          return res;
        };

        try {
          // ssrLoadModule resolves against the project root, not the fs.
          const mod = await server.ssrLoadModule(`/api/${route}.js`);
          await mod.default(req, res);
        } catch (err) {
          server.config.logger.error(`[api] ${route}: ${err.stack || err}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'internal error' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevServer()],
  server: {
    port: 5173,
    host: true,
  },
});
