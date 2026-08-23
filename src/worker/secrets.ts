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
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function importEncryptionKey(encodedKey: string | undefined): Promise<CryptoKey> {
  if (!encodedKey) {
    throw new ApiError(503, "missing_encryption_key", "Encryption key is not configured");
  }

  let key: Uint8Array;
  try {
    key = fromBase64Url(encodedKey);
  } catch {
    throw new ApiError(503, "invalid_encryption_key", "Encryption key is invalid");
  }
  if (key.byteLength !== 32) {
    throw new ApiError(503, "invalid_encryption_key", "Encryption key must contain 32 bytes");
  }

  return crypto.subtle.importKey("raw", key.slice().buffer, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealSubscriptionConfig(
  value: string,
  encodedKey: string | undefined,
): Promise<string> {
  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );

  return [
    tokenVersion,
    toBase64Url(iv),
    toBase64Url(new Uint8Array(ciphertext)),
  ].join(".");
}

export async function openSubscriptionConfig(
  token: string,
  encodedKey: string | undefined,
): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = token.split(".");
  if (version !== tokenVersion || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }

  const key = await importEncryptionKey(encodedKey);
  try {
    const iv = fromBase64Url(encodedIv);
    const ciphertext = fromBase64Url(encodedCiphertext);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 17) {
      throw new Error("invalid token");
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.slice().buffer },
      key,
      ciphertext.slice().buffer,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }
}

export async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}
