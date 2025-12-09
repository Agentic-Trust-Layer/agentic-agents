# Deployment Guide: Both Services on Cloudflare

This guide explains how to deploy both **movie-client-ui** (frontend) and **web-client** (backend) on Cloudflare.

## Overview

- **movie-client-ui**: Static React app → Cloudflare Pages ✅ (Already configured)
- **web-client**: Express.js backend → Cloudflare Workers/Pages Functions ⚠️ (Needs conversion)

## Quick Start

### 1. Deploy movie-client-ui (Frontend)

```bash
cd movie-client-ui
npm install
npm run build
npm run deploy
# Or: wrangler pages deploy dist --project-name movie-client-ui
```

**Result:** Your frontend will be available at `https://[hash].movie-client-ui.pages.dev`

### 2. Deploy web-client (Backend)

You have two options:

#### Option A: Deploy to Cloudflare Workers (Recommended)

**Note:** Cloudflare Workers have limitations with some Node.js APIs. You may need to adapt the code.

```bash
cd src/web-client-cloudflare
npm install
wrangler deploy
```

#### Option B: Deploy Express.js to Alternative Platform

Since web-client uses Express.js, consider deploying to:

- **Railway** (Recommended - Easy setup)
  ```bash
  # Install Railway CLI
  npm i -g @railway/cli
  railway login
  railway init
  railway up
  ```

- **Render** (Free tier available)
  - Connect your GitHub repo
  - Set build command: `npm install`
  - Set start command: `npm run web-client`
  - Add environment variables

- **Fly.io**
  ```bash
  fly launch
  fly deploy
  ```

### 3. Configure Environment Variables

**For web-client backend**, set these secrets:

```bash
# Cloudflare Workers
wrangler secret put CLIENT_WALLET_EOA_PRIVATE_KEY
wrangler secret put RPC_URL
wrangler secret put REPUTATION_REGISTRY
wrangler secret put GRAPHQL_URL  # Optional

# Or for Railway/Render/etc, set in their dashboard:
CLIENT_WALLET_EOA_PRIVATE_KEY=0x...
RPC_URL=https://rpc.sepolia.org
REPUTATION_REGISTRY=0x...
ERC8004_CHAIN_ID=11155111
ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
```

### 4. Update Frontend Configuration

After deploying web-client, update movie-client-ui to point to your backend:

**Option 1: Environment Variable** (Recommended)
```bash
# In movie-client-ui/.env
VITE_WEB_CLIENT_URL=https://your-web-client.pages.dev
# Or: https://your-app.railway.app
# Or: https://your-app.onrender.com
```

**Option 2: Update Code**
```typescript
// In movie-client-ui/src/App.tsx
const WEB_CLIENT_URL = 'https://your-web-client.pages.dev'
```

### 5. Redeploy Frontend

After updating the backend URL:

```bash
cd movie-client-ui
npm run build
npm run deploy
```

## Architecture

```
┌─────────────────────┐
│  movie-client-ui   │  Cloudflare Pages
│   (Frontend)       │  https://[hash].movie-client-ui.pages.dev
└──────────┬──────────┘
           │
           │ API Calls
           │
┌──────────▼──────────┐
│    web-client       │  Cloudflare Workers / Railway / Render
│    (Backend)        │  https://your-backend-url
└──────────┬──────────┘
           │
           │ Blockchain Operations
           │
    ┌──────┴──────┐
    │  Ethereum    │
    │  Blockchain  │
    └──────────────┘
```

## Testing Your Deployment

1. **Frontend**: Visit `https://[hash].movie-client-ui.pages.dev`
2. **Backend API**: Test `https://your-backend-url/api/config/client-address`
3. **Feedback**: Type "give review" in the chat interface

## Troubleshooting

### CORS Issues

If you see CORS errors, ensure your backend includes CORS headers:
```javascript
res.header('Access-Control-Allow-Origin', '*');
res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
```

### Connection Refused

- Check that backend is running and accessible
- Verify `VITE_WEB_CLIENT_URL` is set correctly
- Check browser console for actual URL being called

### Environment Variables Not Working

- Cloudflare Workers: Use `wrangler secret put`
- Railway/Render: Set in their dashboard
- Local dev: Use `.env` file (not committed to git)

## Recommended Setup

For production, I recommend:

1. **Frontend**: Cloudflare Pages (free, fast CDN)
2. **Backend**: Railway or Render (better Node.js support than Workers)

This gives you:
- ✅ Fast static frontend delivery
- ✅ Full Node.js compatibility for backend
- ✅ Easy environment variable management
- ✅ Free tier available on both platforms

