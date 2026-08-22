import { ApiError } from "./api-error";

const encoder = new TextEncoder();

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

  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new ApiError(503, "invalid_encryption_key", "Encryption key is invalid");
  }
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  const key = fromBase64Url(encodedKey);
  if (key.byteLength !== 32) {
    throw new ApiError(503, "invalid_encryption_key", "Encryption key must contain 32 bytes");
  }

  return crypto.subtle.importKey("raw", key.slice().buffer, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function decryptSource(
  ciphertext: string,
  encodedIv: string,
  encodedKey: string | undefined,
): Promise<string> {
  if (!encodedKey) {
    throw new ApiError(503, "missing_encryption_key", "Encryption key is not configured");
  }

  try {
    const key = await importEncryptionKey(encodedKey);
    const iv = fromBase64Url(encodedIv).slice().buffer;
    const encrypted = fromBase64Url(ciphertext).slice().buffer;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted,
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "source_decryption_failed", "Stored source could not be decrypted");
  }
}

export async function encryptSource(
  value: string,
  encodedKey: string | undefined,
): Promise<{ ciphertext: string; iv: string }> {
  if (!encodedKey) {
    throw new ApiError(503, "missing_encryption_key", "Encryption key is not configured");
  }

  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );

  return {
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    iv: toBase64Url(iv),
  };
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export function createShareToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
