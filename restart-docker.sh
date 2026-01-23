#!/bin/bash

# Exit on error
set -e

# Navigate to the directory where this script resides (backend root)
cd "$(dirname "$0")"

# Check arguments
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 [dev|prod|all]"
    echo "  dev  : Restart development environment (docker-compose.yml)"
    echo "  prod : Restart production environment (docker-compose.prod.yml)"
    echo "  all  : Restart BOTH environments (Dev:3000, Prod:3001)"
    exit 1
fi

ENV=$1

if [ "$ENV" == "dev" ]; then
    echo "🔄  Restarting DEVELOPMENT environment..."
    echo "----------------------------------------"
    
    echo "🛑  Stopping containers..."
    docker compose -f docker-compose.yml down --remove-orphans || true
    docker rm -f morph-backend || true
    
    echo "🏗️   Building and starting containers..."
    docker compose -f docker-compose.yml up --build -d
    
    echo "✅  Development environment started!"
    echo "Logs: docker compose -f docker-compose.yml logs -f"

elif [ "$ENV" == "prod" ]; then
    echo "🔄  Restarting PRODUCTION environment..."
    echo "---------------------------------------"
    
    echo "🛑  Stopping containers..."
    docker compose -f docker-compose.prod.yml down --remove-orphans || true
    docker rm -f morph-backend-prod || true
    
    echo "🏗️   Building and starting containers..."
    docker compose -f docker-compose.prod.yml up --build -d
    
    echo "✅  Production environment started!"
    echo "Logs: docker compose -f docker-compose.prod.yml logs -f"

elif [ "$ENV" == "all" ]; then
    echo "🔄  Restarting BOTH Development and Production environments..."
    echo "---------------------------------------------------------"
    
    # 1. Restart PROD (Primary)
    echo "🔹  Step 1/2: Production Environment"
    echo "🛑  Stopping Prod containers..."
    docker compose -f docker-compose.prod.yml down --remove-orphans || true
    docker rm -f morph-backend-prod || true
    echo "🏗️   Starting Prod containers (Port: 3000)..."
    # Prod runs on default port 3000
    PORT=3000 docker compose -f docker-compose.prod.yml up --build -d
    
    echo ""
    
    # 2. Restart DEV (Secondary)
    echo "🔹  Step 2/2: Development Environment"
    echo "🛑  Stopping Dev containers..."
    docker compose -f docker-compose.yml down --remove-orphans || true
    docker rm -f morph-backend || true
    echo "🏗️   Starting Dev containers (Port: 3001)..."
    # Force Dev to run on port 3001
    PORT=3001 docker compose -f docker-compose.yml up --build -d
    
    echo "---------------------------------------------------------"
    echo "✅  All systems operational!"
    echo "�  Prod API: http://localhost:3000"
    echo "�️   Dev API:  http://localhost:3001"

else
    echo "❌  Error: Invalid argument '$ENV'. Must be 'dev', 'prod', or 'all'."
    exit 1
fi
