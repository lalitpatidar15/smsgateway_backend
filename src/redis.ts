import IORedis from 'ioredis';

let client: IORedis | null = null;

export function getRedis(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
    client = null;
  }
}
