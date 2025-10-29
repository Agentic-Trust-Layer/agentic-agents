import { createMovieAgentApp } from './cloudflare-app.js';

export default {
  async fetch(request, env, ctx) {
    const app = await createMovieAgentApp(env);
    return app.fetch(request, env, ctx);
  },
};
