# Supabase Cache Setup Guide

This guide explains how to configure and test Supabase-backed caching for your application.

## Overview

The application now supports **persistent caching in Supabase** in addition to the existing in-memory (L1) and Redis (L2) cache layers. When Supabase is configured, it becomes the primary L2 cache, replacing Redis.

### Cache Architecture

```
┌─────────────┐
│  L1 Cache   │  →  In-memory LRUCache (fast, lost on restart)
│  (always)   │
└──────┬──────┘
       │ Miss
       ▼
┌─────────────┐
│  L2 Cache   │  →  Supabase (persistent) OR Redis (if configured)
│  (optional) │
└─────────────┘
```

## Step 1: Get Your Supabase Credentials

1. Go to [Supabase](https://supabase.com/) and log in
2. Create a new project or select an existing one
3. Navigate to **Settings** → **API**
4. Copy these two values:
   - **Project URL** (e.g., `https://xyzcompany.supabase.co`)
   - **anon public** key (e.g., `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)

## Step 2: Configure Environment Variables

Create or edit the `.env` file in the `backend` directory:

```bash
cd backend
cp .env.example .env  # if you haven't already
```

Edit `.env` and set your Supabase credentials:

```env
# Required: Supabase credentials
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional: Enable debug logging for cache operations
RETRIEVAL_CACHE_DEBUG=true
LOG_LEVEL=debug
```

## Step 3: Run the Database Migration

You need to create the `cache_entries` table in your Supabase database:

### Option A: Using Supabase SQL Editor (Recommended)

1. Go to your Supabase project dashboard
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy and paste the contents of `backend/scripts/setup-supabase-cache.sql`
5. Click **Run** to execute the migration

### Option B: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
cd backend
supabase db execute --file scripts/setup-supabase-cache.sql
```

## Step 4: Verify the Setup

### Test Connection

Start your backend server:

```bash
cd backend
bun install  # ensure dependencies are installed
bun run dev
```

Look for log messages indicating cache initialization. With `LOG_LEVEL=debug`, you should see messages like:

```
[SupabaseCache] Set success { key: "...", namespace: "...", ttlSeconds: 604800 }
```

### Test Cache Operations

You can test the cache with a simple script or by using the application. The cache will automatically:

1. **Store** retrieval results, search results, and other cached data in Supabase
2. **Retrieve** cached data on subsequent requests
3. **Expire** old entries based on TTL settings

## Configuration Options

### Cache TTL Settings

These environment variables control cache expiration:

| Variable | Default | Description |
|----------|---------|-------------|
| `RETRIEVAL_CACHE_DEFAULT_TTL_SECONDS` | 604800 (7 days) | Default cache TTL |
| `RETRIEVAL_CACHE_NEGATIVE_TTL_SECONDS` | 3600 (1 hour) | TTL for empty/negative results |
| `RETRIEVAL_CACHE_FRESH_TTL_SECONDS` | 43200 (12 hours) | TTL for "fresh" results |

### Enable/Disable Supabase Cache

- **Enabled**: Set both `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- **Disabled**: Leave either variable unset (falls back to Redis or L1 only)

## How It Works

### Writing to Cache

When you call `cacheSet()`:

```typescript
import { cacheSet } from './lib/cache.js';

await cacheSet('my-key', { data: 'value' }, 3600, 'my-namespace');
```

1. Data is stored in L1 (in-memory) cache
2. Data is also stored in Supabase `cache_entries` table
3. If Redis is configured but Supabase is not, data goes to Redis instead

### Reading from Cache

When you call `cacheGet()`:

```typescript
import { cacheGet } from './lib/cache.js';

const value = await cacheGet<MyType>('my-key', 'my-namespace');
```

1. Check L1 cache first (fastest)
2. If miss, check Supabase cache
3. If Supabase miss and Redis is configured, check Redis
4. Populate L1 cache with any found value

## Monitoring

### View Cache Entries in Supabase

In Supabase Dashboard:
1. Go to **Table Editor**
2. Select `cache_entries` table
3. View all cached entries, their expiration times, and namespaces

### Cache Statistics

You can get cache statistics programmatically:

```typescript
import { getSupabaseCacheStore } from './lib/supabase-cache.js';

const store = getSupabaseCacheStore();
const stats = await store.stats();
console.log(`Total: ${stats.total}, Expired: ${stats.expired}`);
```

### Cleanup Expired Entries

Expired entries are cleaned up automatically on access, or you can run manual cleanup:

```typescript
import { getSupabaseCacheStore } from './lib/supabase-cache.js';

const store = getSupabaseCacheStore();
const deletedCount = await store.cleanup();
console.log(`Deleted ${deletedCount} expired entries`);
```

## Troubleshooting

### "Missing Supabase credentials" Error

Ensure both `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in your `.env` file.

### Cache Not Persisting

1. Check that the `cache_entries` table exists in Supabase
2. Verify Row Level Security policies allow writes
3. Check application logs for errors

### Slow Cache Operations

- Supabase cache is slower than Redis but provides persistence
- Consider increasing TTL for frequently accessed data
- Use appropriate namespaces to organize cache entries

## Migration from Redis

If you're migrating from Redis to Supabase cache:

1. Set up Supabase cache as described above
2. Remove or comment out `REDIS_URL` in your `.env`
3. The application will automatically use Supabase instead of Redis
4. Note: Existing Redis cache will not be migrated automatically

## Security Notes

- The default RLS policy allows all operations. For production, consider restricting access.
- Never commit `.env` files with real credentials to version control
- Use the `anon` key for client-side operations; use `service_role` key only server-side

## Files Modified/Created

- `backend/src/lib/supabase-cache.ts` - New Supabase cache store implementation
- `backend/src/lib/cache.ts` - Updated to support Supabase as L2 cache
- `backend/scripts/setup-supabase-cache.sql` - Database migration script
- `backend/.env.example` - Example environment configuration
- `backend/.env` - Your local environment configuration (not committed)

## Next Steps

1. ✅ Set up Supabase credentials
2. ✅ Run the database migration
3. ✅ Test cache operations
4. 🔄 Monitor cache hit rates and adjust TTL settings as needed
5. 🔄 Consider implementing cache warming strategies for critical data
