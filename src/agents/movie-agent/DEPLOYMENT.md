# Movie Agent Deployment Guide

This guide explains how to deploy the movie-agent Express.js server.

## Important Note

**Movie Agent is an Express.js server** and requires a Node.js runtime. Cloudflare Workers/Pages Functions have limitations with Node.js APIs, so you have two options:

## Option 1: Deploy to Node.js-Compatible Platform (Recommended)

### Railway (Easiest)

1. Install Railway CLI:
   ```bash
   npm install -g @railway/cli
   ```

2. Login and initialize:
   ```bash
   railway login
   cd src/agents/movie-agent
   railway init
   ```

3. Set environment variables:
   ```bash
   railway variables set OPENAI_API_KEY=sk-...
   railway variables set TMDB_API_KEY=...
   # Add other required env vars
   ```

4. Deploy:
   ```bash
   railway up
   ```

### Render

1. Connect your GitHub repository
2. Create a new Web Service
3. Set build command: `pnpm install` (from workspace root)
4. Set start command: `cd src/agents/movie-agent && pnpm start`
5. Add environment variables in the dashboard

### Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Initialize:
   ```bash
   cd src/agents/movie-agent
   fly launch
   ```
3. Set environment variables: `fly secrets set KEY=value`
4. Deploy: `fly deploy`

## Option 2: Cloudflare Workers (Using Wrangler)

**Note**: This uses Cloudflare's `httpServerHandler` to run Express.js on Workers.

### Prerequisites

1. Install Wrangler CLI (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

### Deployment Steps

1. **Set Environment Variables (Secrets)**:
   ```bash
   cd src/agents/movie-agent
   wrangler secret put OPENAI_API_KEY
   wrangler secret put TMDB_API_KEY
   wrangler secret put RPC_URL
   wrangler secret put MOVIE_AGENT_OPERATOR_KEY  # Optional, for AP2
   # Add other required secrets as needed
   ```

2. **Deploy**:
   ```bash
   wrangler deploy
   ```

   Or use the deployment script:
   ```bash
   ./deploy.sh
   ```

### Important: Code Adaptation Required

The `cloudflare.ts` entry point needs to be completed. It requires:
- Refactoring `index.ts` to export an app setup function (instead of calling `app.listen()`)
- Completing `cloudflare.ts` to use `httpServerHandler` with the exported app

**Current Status**: The basic structure is in place (`wrangler.toml`, `cloudflare.ts`), but the Express app setup needs to be extracted from `index.ts` to work with `httpServerHandler`.

## Required Environment Variables

Set these before deploying (see README.md for full list):

**Required:**
- `OPENAI_API_KEY` - OpenAI API key
- `TMDB_API_KEY` - TMDB API key (v3) or `TMDB_API_TOKEN` (v4)

**Optional but recommended:**
- `PORT` - Port to run on (default: 41241)
- `HOST` - Host to bind to (default: 0.0.0.0)
- `CORS_ORIGINS` - Comma-separated allowed origins
- `RPC_URL` - Ethereum RPC endpoint
- `AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA` - ERC-8004 registry address (Sepolia)
- `MOVIE_AGENT_OPERATOR_KEY` - Server private key for AP2 signing

## Deployment URL

After deployment, your agent will be available at:
- Railway: `https://your-app.railway.app`
- Render: `https://your-app.onrender.com`
- Fly.io: `https://your-app.fly.dev`
- Cloudflare: `https://[hash].movie-agent.pages.dev`

## Update Client Configuration

After deploying, update your client apps to use the new agent URL:

```typescript
// In the client UI app
const MOVIE_AGENT_URL = 'https://your-deployed-agent-url'
```

## Testing Deployment

1. Check agent card endpoint: `https://your-agent-url/.well-known/agent.json`
2. Test A2A endpoint: `https://your-agent-url/a2a` (POST with JSON-RPC)
3. Verify CORS headers are set correctly


