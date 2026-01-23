#!/bin/bash

# Exit on error
set -e

# Navigate to the directory where this script resides (backend root)
cd "$(dirname "$0")"

# Check arguments
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 [dev|prod]"
    echo "  dev  : Restart development environment (docker-compose.yml)"
    echo "  prod : Restart production environment (docker-compose.prod.yml)"
    exit 1
fi

ENV=$1

if [ "$ENV" == "dev" ]; then
    echo "🔄  Restarting DEVELOPMENT environment..."
    echo "----------------------------------------"
    
    echo "🛑  Stopping containers..."
    docker-compose -f docker-compose.yml down
    
    echo "🏗️   Building and starting containers..."
    docker-compose -f docker-compose.yml up --build -d
    
    echo "✅  Development environment started!"
    echo "Logs: docker-compose -f docker-compose.yml logs -f"

elif [ "$ENV" == "all" ]; then
    echo "🔄  Restarting BOTH Development and Production environments..."
    echo "---------------------------------------------------------"
    
    # 1. Restart Development
    echo "🔹  Step 1/2: Development Environment"
    echo "🛑  Stopping Dev containers..."
    docker-compose -f docker-compose.yml down
    echo "🏗️   Starting Dev containers (Port: ${PORT:-3000})..."
    # Ensure Dev uses default port 3000 if not set
    PORT=${PORT:-3000} docker-compose -f docker-compose.yml up --build -d
    
    echo ""
    
    # 2. Restart Production
    echo "🔹  Step 2/2: Production Environment"
    echo "🛑  Stopping Prod containers..."
    docker-compose -f docker-compose.prod.yml down
    echo "🏗️   Starting Prod containers (Port: 3001)..."
    # Force Prod to run on port 3001 to avoid conflict with Dev
    PORT=3001 docker-compose -f docker-compose.prod.yml up --build -d
    
    echo "---------------------------------------------------------"
    echo "✅  All systems operational!"
    echo "🖥️   Dev API:  http://localhost:${PORT:-3000}"
    echo "🚀  Prod API: http://localhost:3001"

else
    echo "❌  Error: Invalid argument '$ENV'. Must be 'dev', 'prod', or 'all'."
    exit 1
fi
