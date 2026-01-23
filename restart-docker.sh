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
    docker compose -p desk-dev -f docker-compose.yml --env-file .env.development down --remove-orphans || true
    
    echo "🏗️   Building and starting containers..."
    docker compose -p desk-dev -f docker-compose.yml --env-file .env.development up -d --build
    
    echo "✅  Development environment started!"
    echo "Logs: docker compose -p desk-dev -f docker-compose.yml logs -f"

elif [ "$ENV" == "prod" ]; then
    echo "🔄  Restarting PRODUCTION environment..."
    echo "---------------------------------------"
    
    echo "🛑  Stopping containers..."
    docker compose -p desk-prod -f docker-compose.prod.yml --env-file .env.production down --remove-orphans || true
    
    echo "🏗️   Building and starting containers..."
    docker compose -p desk-prod -f docker-compose.prod.yml --env-file .env.production up -d --build
    
    echo "✅  Production environment started!"
    echo "Logs: docker compose -p desk-prod -f docker-compose.prod.yml logs -f"

elif [ "$ENV" == "all" ]; then
    echo "🔄  Restarting BOTH Development and Production environments..."
    echo "---------------------------------------------------------"
    
    # 1. Restart PROD (Primary)
    echo "🔹  Step 1/2: Production Environment"
    echo "🛑  Stopping Prod containers..."
    docker compose -p desk-prod -f docker-compose.prod.yml --env-file .env.production down --remove-orphans || true
    
    echo "🏗️   Starting Prod containers (Port: 3000)..."
    docker compose -p desk-prod -f docker-compose.prod.yml --env-file .env.production up -d --build
    
    echo ""
    
    # 2. Restart DEV (Secondary)
    echo "🔹  Step 2/2: Development Environment"
    echo "🛑  Stopping Dev containers..."
    docker compose -p desk-dev -f docker-compose.yml --env-file .env.development down --remove-orphans || true
    
    echo "🏗️   Starting Dev containers (Port: 3001)..."
    docker compose -p desk-dev -f docker-compose.yml --env-file .env.development up -d --build
    
    echo "---------------------------------------------------------"
    echo "✅  All systems operational!"
    echo "👉  Prod API: http://localhost:3000"
    echo "👉  Dev API:  http://localhost:3001"

else
    echo "❌  Error: Invalid argument '$ENV'. Must be 'dev', 'prod', or 'all'."
    exit 1
fi
