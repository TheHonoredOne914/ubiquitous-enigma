import { LRUCache } from "lru-cache";
import { logger } from "./logger.js";

type RedisLike = {
  isOpen?: boolean;
  connect: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  setEx: (key: string, ttl: number, value: string) => Promise<unknown>;
};

const l1 = new LRUCache<string, Record<string, unknown>>({ max: 500, ttl: 1000 * 60 * 10 });
let redisPromise: Promise<RedisLike | null> | null = null;

async function getRedis(): Promise<RedisLike | null> {
  if (!process.env.REDIS_URL) return null;
  redisPromise ??= (async () => {
    try {
      const mod = await Function("return import('redis')")() as { createClient: (opts: { url: string }) => RedisLike };
      const client = mod.createClient({ url: process.env.REDIS_URL! });
      await client.connect();
      return client;
    } catch (err) {
      logger.warn({ err }, "[cache] Redis unavailable; using L1 cache only");
      return null;
    }
  })();
  return redisPromise;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const l1Value = l1.get(key) as T | undefined;
  if (l1Value !== undefined) return l1Value;

  const redis = await getRedis();
  if (!redis) return null;
  const raw = await redis.get(key).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    l1.set(key, parsed as Record<string, unknown>);
    return parsed;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds = 600): Promise<void> {
  l1.set(key, value as Record<string, unknown>, { ttl: ttlSeconds * 1000 });
  const redis = await getRedis();
  if (!redis) return;
  await redis.setEx(key, ttlSeconds, JSON.stringify(value)).catch(() => {});
}
