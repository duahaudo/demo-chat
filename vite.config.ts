/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Mounts the same `api/chat.ts` Vercel picks up by convention, so there is no `vercel dev`
 * dependency and no drift between dev and deploy. `ssrLoadModule` re-evaluates per request, so
 * editing the proxy needs no restart.
 */
function apiChatMount(): Plugin {
  return {
    name: 'api-chat-mount',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res, next) => {
        void (async () => {
          try {
            const mod = await server.ssrLoadModule('/api/chat.ts');
            const handler = (mod as { default?: unknown }).default;
            if (typeof handler !== 'function') {
              next(new Error('api/chat.ts must export a default (req, res) handler.'));
              return;
            }
            await (handler as (req: unknown, res: unknown) => Promise<void>)(req, res);
          } catch (cause) {
            server.ssrFixStacktrace(cause as Error);
            next(cause);
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The credential is not `VITE_`-prefixed — anything Vite exposes to the client is inlined into
  // the bundle. Loading it into `process.env` keeps it server-side for the handler.
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'OPENROUTER_'));

  return {
    plugins: [react(), apiChatMount()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
      // Core is pure; a DOM arrives in Phase 4, scoped to the component tests that need one.
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'lcov'],
        // Core and adapter only (ADR-0005).
        include: ['src/core/**/*.ts', 'src/adapter/**/*.ts'],
        exclude: ['**/*.test.ts'],
        thresholds: {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
      },
    },
  };
});
