import { env } from "cloudflare:workers";

// Worker tests share their test-only KV. Each upstream fixture represents a different source revision.
export async function clearSourceCache() {
  const entries = await env.SUBSCRIPTIONS.list({ prefix: "source-cache:" });
  await Promise.all(entries.keys.map(entry => env.SUBSCRIPTIONS.delete(entry.name)));
}
