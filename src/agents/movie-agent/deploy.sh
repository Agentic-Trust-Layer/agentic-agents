#!/bin/bash

# Movie Agent Cloudflare Pages Deployment Script

echo "🎬 Deploying Movie Agent to Cloudflare Pages..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

# Check if logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo "🔐 Please login to Cloudflare:"
    wrangler login
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create Cloudflare Pages project (if it doesn't exist)
echo "🏗️  Setting up Cloudflare Pages project..."
wrangler pages project create movie-agent --compatibility-date 2024-01-15 || echo "Project may already exist"

# Deploy to Cloudflare Pages
echo "🚀 Deploying to Cloudflare Pages..."
wrangler pages deploy . --project-name movie-agent

echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set environment variables in Cloudflare dashboard:"
echo "   - OPENAI_API_KEY"
echo "   - TMDB_API_KEY"
echo "   - MOVIE_AGENT_ADDRESS"
echo "   - MOVIE_AGENT_OPERATOR_KEY (optional)"
echo "   - ERC8004_CHAIN_HEX (default: 0xaa36a7)"
echo "   - AP2_RATE (default: 0.001)"
echo "   - AP2_TOKEN (default: ETH)"
echo ""
echo "2. Configure custom domain (optional):"
echo "   - Go to Cloudflare Pages dashboard"
echo "   - Select your project"
echo "   - Go to Custom domains"
echo "   - Add your domain (e.g., movieagent.8004-agent.eth)"
echo ""
echo "3. Test your deployment:"
echo "   - Visit your Pages URL"
echo "   - Check /.well-known/agent-card.json"
echo "   - Test API endpoints"