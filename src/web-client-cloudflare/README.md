# Web Client Cloudflare Deployment

This directory contains the web-client backend configured for Cloudflare Workers/Pages.

## Deployment Options

### Option 1: Cloudflare Workers (Recommended)

Deploy as a Cloudflare Worker that handles API endpoints.

**Prerequisites:**
- Cloudflare account
- Wrangler CLI installed

**Steps:**

1. Install dependencies:
   ```bash
   cd src/web-client-cloudflare
   npm install
   ```

2. Set environment variables in Cloudflare:
   ```bash
   wrangler secret put AGENT_EOA_PRIVATE_KEY
   wrangler secret put RPC_URL
   wrangler secret put REPUTATION_REGISTRY
   wrangler secret put GRAPHQL_URL  # Optional
   ```

3. Deploy:
   ```bash
   wrangler deploy
   ```

### Option 2: Keep Express.js and Deploy Elsewhere

If you prefer to keep the Express.js version, consider deploying to:
- **Railway** - Easy Express.js deployment
- **Render** - Free tier available
- **Fly.io** - Good for Node.js apps
- **Heroku** - Traditional option

Then update `VITE_WEB_CLIENT_URL` in movie-client-ui to point to your deployed backend.

## Required Environment Variables

Set these in Cloudflare Workers secrets:

- `AGENT_EOA_PRIVATE_KEY` - Your agent EOA private key (0x-prefixed hex)
- `RPC_URL` - Ethereum RPC endpoint (default: https://rpc.sepolia.org)
- `REPUTATION_REGISTRY` - ERC-8004 Reputation Registry address
- `ENS_REGISTRY` - ENS Registry address (default: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e)
- `ERC8004_CHAIN_ID` - Chain ID (default: 11155111)
- `GRAPHQL_URL` - GraphQL endpoint for feedback queries (optional)
- `ERC8004_FEEDBACKAUTH_TTL_SEC` - Feedback auth TTL in seconds (default: 3600)

## API Endpoints

Once deployed, the following endpoints will be available:

- `GET /api/config/client-address` - Get client address
- `GET /api/feedback-auth?clientAddress=...&agentName=...` - Get feedback auth
- `POST /api/feedback` - Submit feedback
- `GET /api/feedback?agentName=...` - Get feedback list
- `GET /.well-known/agent-card.json` - Agent card

## Updating movie-client-ui

After deploying web-client, update the frontend:

1. Set environment variable in movie-client-ui:
   ```bash
   # In movie-client-ui/.env
   VITE_WEB_CLIENT_URL=https://your-web-client.pages.dev
   ```

2. Or update the constant in `src/App.tsx`:
   ```typescript
   const WEB_CLIENT_URL = 'https://your-web-client.pages.dev'
   ```

## Note

Cloudflare Workers have some limitations with Node.js APIs. If you encounter issues, consider:
- Using Cloudflare Pages Functions (like movie-agent)
- Deploying to a Node.js-compatible platform (Railway, Render, etc.)

