/**
 * Cloudflare Workers entry point for movie-agent
 * Hono works natively with Cloudflare Workers - no adapter needed!
 */

import { setupMovieAgentApp } from './index.js';

// Lazily create the app using the Worker env bindings (secrets/vars live on `env`, not `process.env`)
let appPromise: Promise<any> | null = null;
function getApp(env: any) {
  if (!appPromise) {
    appPromise = setupMovieAgentApp({ env });
  }
  return appPromise;
}

// Export the fetch handler for Cloudflare Workers
// Hono's fetch method works directly with Cloudflare Workers
// Wrap it to ensure it always returns a Response
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    try {
      const app = await getApp(env);
      const response = await app.fetch(request, env, ctx);
      // Ensure we always return a Response
      if (response instanceof Response) {
        return response;
      }
      // Fallback if something unexpected happened
      console.error('[Cloudflare] Handler did not return a Response:', typeof response);
      return new Response('Internal Server Error', { status: 500 });
    } catch (error) {
      console.error('[Cloudflare] Error in fetch handler:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

