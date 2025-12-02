# Environment Variables Example

Create a `.env` file in the root of the project with the following variables:

```env
# ============================================
# MongoDB Database Configuration
# ============================================
# Option 1: Use MONGODB_URI (Recommended - especially for production)
# This is the preferred method and works with MongoDB Atlas, Docker, and most cloud providers
MONGODB_URI=mongodb://localhost:27017/ticketing_db

# Option 2: Use individual components (fallback if MONGODB_URI is not set)
# MongoDB host address
DB_HOST=localhost

# MongoDB port (default: 27017)
DB_PORT=27017

# MongoDB username (optional - leave empty for local development without auth)
DB_USERNAME=

# MongoDB password (optional - leave empty for local development without auth)
DB_PASSWORD=

# Database name
DB_DATABASE=ticketing_db

# ============================================
# JWT Authentication Configuration
# ============================================
# Secret key for JWT token signing (CHANGE THIS IN PRODUCTION!)
# Generate a strong secret: openssl rand -base64 32
JWT_SECRET=your-secret-key-change-in-production-min-32-characters

# JWT token expiration time
# Examples: '7d' (7 days), '24h' (24 hours), '1h' (1 hour), '30m' (30 minutes)
JWT_EXPIRES_IN=7d

# ============================================
# Application Configuration
# ============================================
# Server port (default: 3000)
PORT=3000

# Node environment: development, production, test
NODE_ENV=development

# CORS origin - allowed frontend URL
# For development, use your frontend URL (e.g., http://localhost:3001)
# For production, use your actual domain
CORS_ORIGIN=http://localhost:3000

# ============================================
# AI/LLM Configuration
# ============================================
# Google Gemini API Key (required for AI agents)
# Get your API key from: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your-gemini-api-key-here

# AI Model to use (optional, defaults to gemini-2.0-flash-exp)
# Options: gemini-2.0-flash-exp, gemini-1.5-pro, gemini-1.5-flash, etc.
AI_MODEL=gemini-2.0-flash-exp
```

## Quick Start

1. Copy the content above into a `.env` file in the project root
2. Update `JWT_SECRET` with a secure random string (use `openssl rand -base64 32`)
3. Update `CORS_ORIGIN` to match your frontend URL
4. If using MongoDB with authentication, fill in `DB_USERNAME` and `DB_PASSWORD`

## Production Example

**Recommended: Using MONGODB_URI**
```env
MONGODB_URI=mongodb://username:password@mongodb.example.com:27017/ticketing_production?authSource=admin
JWT_SECRET=super-secure-secret-key-generated-with-openssl-rand-base64-32
JWT_EXPIRES_IN=24h
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com
```

**Alternative: Using individual components**
```env
DB_HOST=mongodb.example.com
DB_PORT=27017
DB_USERNAME=myuser
DB_PASSWORD=mysecurepassword
DB_DATABASE=ticketing_production
JWT_SECRET=super-secure-secret-key-generated-with-openssl-rand-base64-32
JWT_EXPIRES_IN=24h
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com
```

## MongoDB Connection String Examples

**Local MongoDB (no auth):**
```env
MONGODB_URI=mongodb://localhost:27017/ticketing_db
```

**Local MongoDB (with auth):**
```env
MONGODB_URI=mongodb://username:password@localhost:27017/ticketing_db?authSource=admin
```

**MongoDB Atlas (cloud):**
```env
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/ticketing_db?retryWrites=true&w=majority
```

**Docker MongoDB:**
```env
MONGODB_URI=mongodb://username:password@mongodb:27017/ticketing_db?authSource=admin
```

## Generating a Secure JWT Secret

```bash
openssl rand -base64 32
```

This will generate a 32-character base64 encoded random string suitable for use as `JWT_SECRET`.

