import { ApiError } from "./api-error";
import type { RemoteSubscriptionSource, SubscriptionUsage } from "./sub-store";

export type SubscriptionSnapshot = { sources: RemoteSubscriptionSource[]; readAt: string };
export type ManagedSubscriptionSnapshot = SubscriptionSnapshot & { managementHash: string };
export const maximumSyncRequestBytes = 2 * 1024 * 1024;

function invalid(): never { throw new ApiError(400, "invalid_source_snapshot", "Source snapshot is invalid or does not match its sources"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

export function readSubscriptionSnapshot(value: unknown, sourceCount: number): SubscriptionSnapshot {
  const input = record(value);
  if (!Array.isArray(input.sources) || input.sources.length !== sourceCount || sourceCount > 10) return invalid();
  if (typeof input.readAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.readAt)
    || !Number.isFinite(Date.parse(input.readAt)) || Date.parse(input.readAt) > Date.now() + 60_000) return invalid();
  let bytes = 0;
  const sources = input.sources.map((value): RemoteSubscriptionSource => {
    const source = record(value);
    if (typeof source.content !== "string") return invalid();
    const size = new TextEncoder().encode(source.content).length;
    bytes += size;
    if (!size || size > 1_048_576 || bytes > 1_800_000) throw new ApiError(413, "source_snapshot_too_large", "Source snapshots exceed the sync limit");
    const metadata = record(source.metadata);
    const name = metadata.profileName;
    if (name !== undefined && (typeof name !== "string" || name.length > 64 || /[\u0000-\u001f\u007f]/u.test(name))) return invalid();
    let usage: SubscriptionUsage | undefined;
    if (metadata.usage !== undefined) {
      const fields = record(metadata.usage);
      for (const field of ["upload", "download", "total", ...(fields.expire === undefined ? [] : ["expire"])]) {
        if (typeof fields[field] !== "string" || !/^\d{1,20}$/u.test(fields[field])) return invalid();
      }
      usage = { upload: String(fields.upload), download: String(fields.download), total: String(fields.total),
        ...(fields.expire === undefined ? {} : { expire: String(fields.expire) }) };
    }
    return { content: source.content, metadata: { usageStatus: usage ? "available" : "missing",
      ...(typeof name === "string" ? { profileName: name } : {}), ...(usage ? { usage } : {}) } };
  });
  return { sources, readAt: input.readAt };
}
