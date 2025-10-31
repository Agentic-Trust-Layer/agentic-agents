# Movie Client UI - Cloudflare Pages Deployment Guide

This guide covers deploying the Movie Client UI React app to Cloudflare Pages.

## Prerequisites

1. **Node.js and npm** installed
2. **Wrangler CLI** - Cloudflare's CLI tool
3. **Cloudflare Account** - Sign up at https://dash.cloudflare.com

## Setup

### 1. Install Dependencies

```bash
cd movie-client-ui
npm install
```

### 2. Install Wrangler (if needed)

```bash
npm install -g wrangler
# or use npx: npx wrangler pages deploy dist --project-name movie-client-ui
```

### 3. Authenticate with Cloudflare

```bash
wrangler login
```

This will open your browser to authenticate with Cloudflare.

### 4. Create Pages Project (First Time Only)

```bash
wrangler pages project create movie-client-ui
```

## Deployment

### Quick Deploy

```bash
npm run deploy
```

This will:
1. Build the project (`npm run build`)
2. Deploy to Cloudflare Pages (`wrangler pages deploy dist`)

### Manual Deploy

```bash
# Step 1: Build
npm run build

# Step 2: Deploy
wrangler pages deploy dist --project-name movie-client-ui --commit-dirty=true
```

### Using Deployment Script

```bash
./deploy.sh
```

## Configuration Files

### `wrangler.toml`

```toml
name = "movie-client-ui"
compatibility_date = "2024-01-15"
pages_build_output_dir = "dist"
```

### `public/_redirects`

Handles Single Page Application (SPA) routing:
```
/*    /index.html   200
```

This ensures all routes are handled by React Router (if you add routing later).

## Build Output

The build process creates a `dist/` directory containing:
- Static HTML, CSS, and JavaScript files
- Assets (images, fonts, etc.)
- The `_redirects` file for SPA routing

## Deployment URL

After deployment, your app will be available at:
- `https://[random-hash].movie-client-ui.pages.dev`
- Each deployment gets a unique URL

You can also set up a custom domain in the Cloudflare Pages dashboard.

## Environment Variables

If you need to set environment variables (for example, for different agent URLs), you can set them in:

1. **Cloudflare Dashboard**:
   - Go to Pages → movie-client-ui → Settings → Environment variables
   - Add variables for Production, Preview, or both

2. **Via Wrangler** (in `wrangler.toml`):
   ```toml
   [vars]
   MOVIE_AGENT_URL = "https://b07629d5.movie-agent.pages.dev"
   ```

Note: Currently, the agent URL is hardcoded in `src/App.tsx`. To make it configurable via environment variables, you'd need to update the build process.

## Continuous Deployment

Cloudflare Pages supports continuous deployment from Git:

1. Connect your Git repository in Cloudflare Dashboard
2. Configure build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: (leave empty or set to `movie-client-ui` if monorepo)

## Troubleshooting

### Build Fails

- Check that all dependencies are installed: `npm install`
- Verify TypeScript compiles: `npm run build`
- Check for errors in the terminal output

### Deployment Fails

- Ensure Wrangler is authenticated: `wrangler whoami`
- Check you have the correct project name: `wrangler pages project list`
- Verify the `dist` directory exists after build

### SPA Routing Issues

- Ensure `public/_redirects` file exists
- Check it's copied to `dist/_redirects` after build
- Verify the redirect rule: `/*    /index.html   200`

### CORS Issues

- The movie agent must allow requests from your Cloudflare Pages domain
- Update agent's CORS settings if needed

## Updating the Agent URL

To change which movie agent the UI connects to:

1. Edit `src/App.tsx`:
   ```typescript
   const MOVIE_AGENT_URL = 'https://your-agent-url.pages.dev'
   ```

2. Rebuild and redeploy:
   ```bash
   npm run deploy
   ```

## Production Checklist

- [ ] Build completes without errors
- [ ] All dependencies installed
- [ ] Agent URL is correct
- [ ] Wrangler authenticated
- [ ] Pages project created
- [ ] Deployment successful
- [ ] Test the deployed app
- [ ] Verify agent connection works
- [ ] Check mobile responsiveness
- [ ] Test on different browsers

## Support

For issues:
- Check Cloudflare Pages logs in the dashboard
- Review Wrangler output for errors
- Verify build output in `dist/` directory

