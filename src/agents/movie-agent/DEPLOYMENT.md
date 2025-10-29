# Movie Agent Cloudflare Pages Deployment Guide

## Overview

This guide will help you deploy the movie-agent to Cloudflare Pages. The movie-agent is an AI-powered agent that can answer questions about movies, actors, and directors using The Movie Database (TMDB) API.

## Prerequisites

1. **Node.js** (v18 or higher)
2. **npm** or **pnpm**
3. **Cloudflare account** (free tier works)
4. **Wrangler CLI** (Cloudflare's command-line tool)

## Required Environment Variables

Before deploying, you'll need these environment variables:

### Required
- `OPENAI_API_KEY` - Your OpenAI API key
- `TMDB_API_KEY` - Your TMDB API key
- `MOVIE_AGENT_ADDRESS` - Ethereum address for the agent

### Optional
- `MOVIE_AGENT_OPERATOR_KEY` - Private key for signing (for AP2 payments)
- `ERC8004_CHAIN_HEX` - Chain ID in hex format (default: 0xaa36a7)
- `AP2_RATE` - Rate for AP2 payments (default: 0.001)
- `AP2_TOKEN` - Token for AP2 payments (default: ETH)
- `AP2_TERMS_CID` - IPFS CID for terms (optional)

## Quick Deployment

### Option 1: Automated Script
```bash
cd src/agents/movie-agent
./deploy.sh
```

### Option 2: Manual Steps

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare:**
   ```bash
   wrangler login
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Create Cloudflare Pages project:**
   ```bash
   wrangler pages project create movie-agent --compatibility-date 2024-01-15
   ```

5. **Deploy:**
   ```bash
   wrangler pages deploy . --project-name movie-agent
   ```

6. **Set environment variables:**
   ```bash
   wrangler pages secret put OPENAI_API_KEY --project-name movie-agent
   wrangler pages secret put TMDB_API_KEY --project-name movie-agent
   wrangler pages secret put MOVIE_AGENT_ADDRESS --project-name movie-agent
   # Add other secrets as needed
   ```

## Configuration Files

### wrangler.toml
```toml
name = "movie-agent"
compatibility_date = "2024-01-15"
compatibility_flags = ["nodejs_compat"]

[env.production]
name = "movie-agent"

[[env.production.routes]]
pattern = "movieagent.orgtrust.eth/*"
zone_name = "orgtrust.eth"

[build]
command = "npm run build"
cwd = "."

[functions]
directory = "functions"
```

### package.json
```json
{
  "name": "movie-agent-cloudflare",
  "version": "0.0.2",
  "description": "Movie Agent deployed on Cloudflare Pages",
  "type": "module",
  "main": "_worker.js",
  "scripts": {
    "build": "echo 'Build completed'",
    "deploy": "wrangler pages deploy",
    "dev": "wrangler pages dev",
    "start": "wrangler pages dev"
  },
  "dependencies": {
    "@a2a-js/sdk": "^0.2.4",
    "@metamask/delegation-toolkit": "0.11.0",
    "openai": "^4.56.0",
    "permissionless": "0.2.42",
    "uuid": "^11.0.3",
    "viem": "2.31.4",
    "ethers": "^6.0.0"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

## API Endpoints

Once deployed, your movie-agent will be available at these endpoints:

- `/.well-known/agent-card.json` - Agent card metadata
- `/api/feedback-auth/:clientAddress` - Feedback authentication
- `/ap2/quote` - AP2 payment quotes
- `/ap2/invoke` - AP2 payment execution
- `/a2a/skills/agent.feedback.requestAuth` - A2A feedback auth
- `/a2a/*` - A2A protocol endpoints

## Custom Domain Setup

To set up a custom domain (e.g., `movieagent.orgtrust.eth`):

1. Go to Cloudflare Pages dashboard
2. Select your `movie-agent` project
3. Go to **Custom domains**
4. Click **Set up a custom domain**
5. Enter your domain name
6. Follow the DNS configuration instructions

## Testing Your Deployment

1. **Check agent card:**
   ```bash
   curl https://your-domain.com/.well-known/agent-card.json
   ```

2. **Test API endpoints:**
   ```bash
   curl https://your-domain.com/api/feedback-auth/0x1234567890123456789012345678901234567890
   ```

3. **Verify environment variables:**
   - Check Cloudflare Pages dashboard
   - Go to Settings > Environment variables
   - Ensure all required variables are set

## Development

To run locally for development:

```bash
npm run dev
```

This will start a local development server with hot reloading.

## Monitoring

Monitor your deployment:

- **Cloudflare Pages dashboard** - View deployment status and logs
- **Cloudflare Analytics** - Monitor traffic and performance
- **Function logs** - Use `wrangler pages tail` to view real-time logs

## Troubleshooting

### Common Issues

1. **Environment variables not working:**
   - Ensure variables are set in Cloudflare Pages dashboard
   - Check variable names match exactly (case-sensitive)

2. **Build failures:**
   - Check Node.js version compatibility
   - Verify all dependencies are installed

3. **API errors:**
   - Check API keys are valid
   - Verify TMDB API quota limits

4. **CORS issues:**
   - CORS is handled automatically by Cloudflare Pages
   - Check if custom headers are needed

### Getting Help

- Check Cloudflare Pages documentation
- Review function logs in the dashboard
- Use `wrangler pages tail` for real-time debugging

## Security Considerations

1. **API Keys:** Never commit API keys to version control
2. **Private Keys:** Use Cloudflare's secret management for sensitive data
3. **Rate Limiting:** Consider implementing rate limiting for production use
4. **CORS:** Configure CORS appropriately for your use case

## Production Checklist

- [ ] Environment variables configured
- [ ] Custom domain set up
- [ ] SSL certificate active
- [ ] Monitoring configured
- [ ] Error handling tested
- [ ] Performance optimized
- [ ] Security review completed

## Support

For issues specific to this deployment:
1. Check the logs in Cloudflare Pages dashboard
2. Review the configuration files
3. Test locally with `npm run dev`
4. Verify all environment variables are set correctly
