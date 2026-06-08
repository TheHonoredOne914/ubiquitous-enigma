# Supabase Cache Integration Status

## Current State

### ✅ Supabase Database Connection
- Configured in `backend/src/db.ts`
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Package: `@supabase/supabase-js@^2.107.0`

### ❌ Caches NOT Stored in Supabase

Currently, all caches use in-memory storage:

1. **Retrieval Cache** (`backend/src/core/retrieval-cache/`)
   - Uses `CacheManager` class with in-memory Map
   - Location: `backend/src/services/cache-manager.ts`
   - Stores: search results, URL extractions, evidence cards, provider health
   
2. **Evidence Cache** (`backend/src/lib/evidence-cache.ts`)
   - Uses LRUCache (in-memory)
   - Stores: EvidenceRegistry objects
   
3. **General Cache** (`backend/src/lib/cache.ts`)
   - L1: LRUCache (in-memory, 500 entries, 10min TTL)
   - L2: Optional Redis (not installed, REDIS_URL not set)
   - Used by: web-search.ts

## Required Changes

To store caches in Supabase, you need to:

### 1. Create Supabase Cache Tables

Run this SQL in your Supabase SQL Editor:

```sql
-- Cache entries table
CREATE TABLE IF NOT EXISTS cache_entries (
  id BIGSERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_jsonb JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  source_hash TEXT,
  agenda_fingerprint TEXT,
  mode TEXT,
  run_tags JSONB,
  UNIQUE(namespace, key)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_cache_entries_lookup 
  ON cache_entries(namespace, key, expires_at);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires 
  ON cache_entries(expires_at);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE cache_entries ENABLE ROW LEVEL SECURITY;

-- Policy to allow authenticated access (adjust as needed)
CREATE POLICY "Allow all operations on cache_entries"
  ON cache_entries FOR ALL
  USING (true)
  WITH CHECK (true);
```

### 2. Create Supabase Cache Store

Create new file: `backend/src/lib/supabase-cache.ts`

This will provide Supabase-backed implementations for:
- `cacheGet<T>(key, namespace)` 
- `cacheSet<T>(key, value, ttlSeconds, namespace)`
- Integration with existing cache interfaces

### 3. Update Cache Implementations

Modify these files to use Supabase:
- `backend/src/services/cache-manager.ts` - Add Supabase persistence layer
- `backend/src/lib/cache.ts` - Add Supabase as L2 cache (instead of Redis)
- `backend/src/core/retrieval-cache/retrieval-cache-store.ts` - Use Supabase backend

## Next Steps

Would you like me to:
1. Create the Supabase cache store implementation?
2. Update the existing cache modules to use Supabase?
3. Both?
