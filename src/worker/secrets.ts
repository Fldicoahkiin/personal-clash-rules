import { ApiError } from "./api-error";

const encoder = new TextEncoder();
const tokenVersion = "v1";

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }
}

export function encodeSubscriptionConfig(value: string): string {
  return `${tokenVersion}.${toBase64Url(encoder.encode(value))}`;
}

export function decodeSubscriptionConfig(token: string): string {
  const [version, encodedValue, extra] = token.split(".");
  if (version !== tokenVersion || !encodedValue || extra !== undefined) {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }
  return new TextDecoder().decode(fromBase64Url(encodedValue));
}

export async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}
