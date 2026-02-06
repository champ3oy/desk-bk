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
    echo "🔄  Restarting PRODUCTION environment (Swarm Mode)..."
    echo "---------------------------------------"
    
    # 0. Ensure Swarm is active
    if ! docker info | grep -q "Swarm: active"; then
        echo "⚠️  Swarm not active. Initializing..."
        docker swarm init
    fi

    echo "🏗️   Building image..."
    docker build -t morph-backend:prod -f Dockerfile .
    
    echo "📄  Generating stack config..."
    docker compose -f docker-compose.prod.yml --env-file .env.production config > docker-stack.yml

    # HACK: Fix docker compose config outputting strings for ports AND top-level 'name' property
    if [ "$(uname)" == "Darwin" ]; then
        sed -i '' 's/published: "3000"/published: 3000/g' docker-stack.yml
        sed -i '' '/^name:/d' docker-stack.yml
    else
        sed -i 's/published: "3000"/published: 3000/g' docker-stack.yml
        sed -i '/^name:/d' docker-stack.yml
    fi

    echo "🚀  Deploying stack..."
    # Note: We rely on the internal healthchecks and 'update_config' in docker-compose.prod.yml
    # to handle the zero-downtime rollover.
    docker stack deploy -c docker-stack.yml desk-prod
    rm docker-stack.yml
    
    echo "✅  Production deployment triggered!"
    echo "Check status: docker stack services desk-prod"

elif [ "$ENV" == "all" ]; then
    echo "🔄  Restarting BOTH Development and Production environments..."
    echo "---------------------------------------------------------"
    
    # 1. Restart PROD (Primary) - SWARM
    echo "🔹  Step 1/2: Production Environment"
    
     # Ensure Swarm is active
    if ! docker info | grep -q "Swarm: active"; then
        echo "⚠️  Swarm not active. Initializing..."
        docker swarm init
    fi

    echo "🏗️   Building Prod image..."
    docker build -t morph-backend:prod -f Dockerfile .

    echo "📄  Generating stack config..."
    docker compose -f docker-compose.prod.yml --env-file .env.production config > docker-stack.yml

    # HACK: Fix docker compose config outputting strings for ports AND top-level 'name' property
    if [ "$(uname)" == "Darwin" ]; then
        sed -i '' 's/published: "3000"/published: 3000/g' docker-stack.yml
        sed -i '' '/^name:/d' docker-stack.yml
    else
        sed -i 's/published: "3000"/published: 3000/g' docker-stack.yml
        sed -i '/^name:/d' docker-stack.yml
    fi

    echo "🚀  Deploying Prod stack..."
    docker stack deploy -c docker-stack.yml desk-prod
    rm docker-stack.yml
    
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
