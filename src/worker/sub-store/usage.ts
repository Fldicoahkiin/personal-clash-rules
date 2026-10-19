// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
const subscriptionUserinfoFields = ["upload", "download", "total", "expire"] as const;

export type SubscriptionUsage = {
  upload: string;
  download: string;
  total: string;
  expire?: string;
};

export type RemoteSubscriptionMetadata = {
  profileName?: string;
  usage?: SubscriptionUsage;
  usageStatus: "available" | "missing" | "unavailable";
};

function subscriptionProfileName(response: Response): string | undefined {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedName = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/iu)?.[1];
  const plainName = disposition.match(/filename\s*=\s*"?([^";]+)"?/iu)?.[1];
  let value = encodedName ?? plainName ?? response.headers.get("profile-title") ?? "";
  try {
    if (value.startsWith("base64:")) value = new TextDecoder().decode(Uint8Array.from(atob(value.slice(7)), character => character.charCodeAt(0)));
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  const name = value
    .replace(/[\\/\u0000-\u001F\u007F]/gu, "")
    .replace(/\.(?:conf|json|txt|ya?ml)$/iu, "")
    .trim();
  return name ? name.slice(0, 64) : undefined;
}

function parseSubscriptionUsage(value: string | null): SubscriptionUsage | undefined {
  if (!value) {
    return undefined;
  }
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const fieldValue = part.slice(separator + 1).trim();
    if (
      subscriptionUserinfoFields.includes(key as typeof subscriptionUserinfoFields[number])
      && /^\d{1,20}$/u.test(fieldValue)
    ) {
      fields.set(key, fieldValue);
    }
  }
  const upload = fields.get("upload");
  const download = fields.get("download");
  const total = fields.get("total");
  if (!upload || !download || !total) {
    return undefined;
  }
  const expire = fields.get("expire");
  return {
    upload,
    download,
    total,
    ...(expire ? { expire } : {}),
  };
}

export function formatSubscriptionUserinfo(usage: SubscriptionUsage): string {
  return subscriptionUserinfoFields
    .filter((field) => usage[field] !== undefined)
    .map((field) => `${field}=${usage[field]}`)
    .join("; ");
}

export function combineSubscriptionUsage(
  usages: Array<SubscriptionUsage | undefined>,
): SubscriptionUsage | undefined {
  if (usages.length === 0 || usages.some((usage) => usage === undefined)) {
    return undefined;
  }
  const complete = usages as SubscriptionUsage[];
  const positiveExpires = complete
    .map((usage) => usage.expire)
    .filter((expire): expire is string => expire !== undefined && BigInt(expire) > 0n);
  const expire = positiveExpires.reduce<string | undefined>((earliest, value) => (
    earliest === undefined || BigInt(value) < BigInt(earliest) ? value : earliest
  ), undefined);
  return {
    upload: complete.reduce((sum, usage) => sum + BigInt(usage.upload), 0n).toString(),
    download: complete.reduce((sum, usage) => sum + BigInt(usage.download), 0n).toString(),
    total: complete.reduce((sum, usage) => sum + BigInt(usage.total), 0n).toString(),
    ...(expire ? { expire } : complete.every((usage) => usage.expire === "0") ? { expire: "0" } : {}),
  };
}

export function remoteSubscriptionMetadata(response: Response): RemoteSubscriptionMetadata {
  const profileName = subscriptionProfileName(response);
  const usage = parseSubscriptionUsage(response.headers.get("subscription-userinfo"));
  return {
    usageStatus: usage ? "available" : "missing",
    ...(profileName ? { profileName } : {}),
    ...(usage ? { usage } : {}),
  };
}
