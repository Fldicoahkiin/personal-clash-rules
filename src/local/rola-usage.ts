export function parseRolaUsage(value: unknown) {
  if (!value || typeof value !== "object" || !("code" in value) || value.code !== 0 || !("data" in value)) {
    throw new Error("Rola API reported an error; check the account console");
  }
  const data = value.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Unexpected Rola package response");
  return Object.entries(data).map(([product, item]) => {
    if (!/^[a-z0-9_-]{1,64}$/iu.test(product) || !item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Unexpected Rola package entry");
    }
    const fields = item as Record<string, unknown>;
    function bytes(name: string) {
      const value = fields[name];
      if (value === undefined || value === null) return null;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Rola byte counter");
      return value;
    }
    const totalBytes = bytes("total_traffic");
    const usedBytes = bytes("cost_traffic");
    const expiry = fields.expire_time;
    if (expiry !== undefined && expiry !== null && (typeof expiry !== "string" || expiry.length > 128 || /[\u0000-\u001f\u007f]/u.test(expiry))) {
      throw new Error("Invalid Rola expiry value");
    }
    return {
      product,
      totalBytes,
      usedBytes,
      remainingBytes: totalBytes === null || usedBytes === null ? null : Math.max(0, totalBytes - usedBytes),
      status: ["active", "inactive"].includes(String(fields.status)) ? String(fields.status) : "unknown",
      // The documented example has no timezone and is not a valid ISO timestamp.
      // Preserve it as provider text; never invent expire=0 or a Unix expiry.
      expiresAtProviderText: expiry || null,
    };
  });
}

export async function readRolaUsage(apiToken: unknown, request: typeof fetch = fetch) {
  if (typeof apiToken !== "string" || !/^[\x21-\x7e]{1,512}$/u.test(apiToken)) throw new Error("Set apiToken in the private local settings file");
  let response: Response;
  try {
    response = await request("https://api2.rola-ip.co/api/users/traffic/packages/current", {
      method: "GET",
      headers: { "Api-Token": apiToken, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error("Rola usage request failed or timed out; no retry or alternate endpoint was used"); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Rola usage returned HTTP ${response.status}; no retry was attempted`);
  }
  if (!response.body) throw new Error("Rola usage returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch { throw new Error("Rola usage response could not be read; no retry was attempted"); }
  finally { reader.releaseLock(); }
  if (size > 1024 * 1024) throw new Error("Rola usage response exceeds 1 MiB");
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Rola usage is not valid JSON"); }
  return {
    source: "Rola package API",
    fetchedAt: new Date().toISOString(),
    packages: parseRolaUsage(data),
    accounting: "separate-from-airport; do not sum quotas for a proxy chain",
  };
}
