#!/bin/bash
# Deployment script for Movie Client UI to Cloudflare Pages

set -e

echo "🚀 Deploying Movie Client UI to Cloudflare Pages..."

# Build the project
echo "📦 Building project..."
npm run build

# Deploy to Cloudflare Pages
echo "☁️  Deploying to Cloudflare Pages..."
wrangler pages deploy dist --project-name movie-client-ui --commit-dirty=true

echo "✅ Deployment complete!"
echo ""
echo "Your app should be available at: https://movie-client-ui.pages.dev"
echo "(URL may vary - check the deployment output above)"

