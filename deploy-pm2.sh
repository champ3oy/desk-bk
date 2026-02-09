#!/bin/bash

# PM2 Deployment Script for Morph Backend
# ----------------------------------------

set -e

echo "🚀 Starting PM2 deployment..."

# Navigate to backend directory
cd "$(dirname "$0")"

# Create logs directory if it doesn't exist
mkdir -p logs

# Install dependencies
echo "📦 Installing dependencies..."
yarn install --frozen-lockfile

# Build the application with increased memory
echo "🔨 Building application..."
export NODE_OPTIONS="--max-old-space-size=2048"
yarn build
unset NODE_OPTIONS

# Check if PM2 is installed globally
if ! command -v pm2 &> /dev/null; then
    echo "📥 Installing PM2 globally..."
    npm install -g pm2
fi

# Stop existing process if running
echo "🛑 Stopping existing processes..."
pm2 stop morph-backend 2>/dev/null || true
pm2 delete morph-backend 2>/dev/null || true

# Start with PM2 using production environment
echo "▶️  Starting application with PM2..."
pm2 start ecosystem.config.js --env production

# Save PM2 process list (for auto-restart on server reboot)
pm2 save

# Setup PM2 to start on system boot (run once manually if needed)
# pm2 startup

echo "✅ Deployment complete!"
echo ""
echo "📊 Useful PM2 commands:"
echo "   pm2 status          - View running processes"
echo "   pm2 logs            - View logs"
echo "   pm2 monit           - Monitor resources"
echo "   pm2 restart morph-backend  - Restart the app"
echo ""

# Show status
pm2 status
