# Movie Agent Cloudflare Pages Deployment

This directory contains the movie-agent packaged for deployment on Cloudflare Pages.

## Files Overview

- `_worker.js` - Main entry point and implementation for Cloudflare Pages Functions (self-contained)
- `wrangler.toml` - Cloudflare Pages configuration
- `package.json` - Dependencies and scripts for deployment

## Environment Variables Required

Set these in your Cloudflare Pages environment:

- `OPENAI_API_KEY` - Your OpenAI API key
- `TMDB_API_KEY` - Your TMDB API key
- `MOVIE_AGENT_ADDRESS` - Ethereum address for the agent
- `MOVIE_AGENT_OPERATOR_KEY` - Private key for signing (optional)
- `ERC8004_CHAIN_HEX` - Chain ID in hex format (default: 0xaa36a7)
- `AP2_RATE` - Rate for AP2 payments (default: 0.001)
- `AP2_TOKEN` - Token for AP2 payments (default: ETH)

## Deployment Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up Cloudflare Pages:
   ```bash
   npx wrangler pages project create movie-agent
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```

4. Set environment variables in Cloudflare dashboard:
   - Go to your Pages project
   - Navigate to Settings > Environment variables
   - Add all required environment variables

## Development

To run locally:
```bash
npm run dev
```

## API Endpoints

- `/.well-known/agent-card.json` - Agent card
- `/api/feedback-auth/:clientAddress` - Feedback authentication
- `/ap2/quote` - AP2 payment quotes
- `/ap2/invoke` - AP2 payment execution
- `/a2a/skills/agent.feedback.requestAuth` - A2A feedback auth
- `/a2a/*` - A2A protocol endpoints
