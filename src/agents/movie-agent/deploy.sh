#!/bin/bash
# Deployment script for Movie Agent to Cloudflare Workers/Pages

set -e

echo "🚀 Deploying Movie Agent to Cloudflare..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Install it with: npm install -g wrangler"
    exit 1
fi

echo "📋 Deploying to Cloudflare Workers..."
echo "⚠️  Note: This requires Express.js to be adapted for Cloudflare Workers using httpServerHandler"
echo "⚠️  The cloudflare.ts entry point needs to be completed with the refactored app setup"
echo ""

# Deploy to Cloudflare Workers
wrangler deploy

echo ""
echo "✅ Deployment complete!"
echo "⚠️  If deployment fails, you may need to:"
echo "   1. Refactor index.ts to export app setup function"
echo "   2. Complete cloudflare.ts with httpServerHandler setup"
echo "   3. Or use a Node.js-friendly platform (Railway, Render, Fly.io)"

