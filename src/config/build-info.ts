export type BuildInfo = {
  builtAt: string | null;
  commit: string | null;
  dirty: boolean;
};

export type VersionInfo = {
  build: BuildInfo;
  deployment: { createdAt: string | null; id: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)));
}

export function isBuildInfo(value: unknown): value is BuildInfo {
  return isRecord(value) && isTimestamp(value.builtAt)
    && (value.commit === null || (typeof value.commit === "string" && /^[a-f0-9]{40}$/u.test(value.commit)))
    && typeof value.dirty === "boolean";
}

export function isVersionInfo(value: unknown): value is VersionInfo {
  return isRecord(value) && isBuildInfo(value.build)
    && (value.deployment === null || (isRecord(value.deployment)
      && isTimestamp(value.deployment.createdAt) && typeof value.deployment.id === "string"));
}
