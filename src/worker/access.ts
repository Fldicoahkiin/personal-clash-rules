import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "./api-error";
import type { SubscriptionEnv } from "./types";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const encoder = new TextEncoder();

async function tokensMatch(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function acceptsServiceToken(request: Request, env: SubscriptionEnv): Promise<boolean> {
  if (!env.CONTROL_API_TOKEN) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  return tokensMatch(authorization.slice(7), env.CONTROL_API_TOKEN);
}

async function acceptsAccessToken(request: Request, env: SubscriptionEnv): Promise<boolean> {
  const { ACCESS_ADMIN_EMAIL, ACCESS_AUD, ACCESS_TEAM_DOMAIN } = env;
  if (!ACCESS_ADMIN_EMAIL || !ACCESS_AUD || !ACCESS_TEAM_DOMAIN) {
    return false;
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return false;
  }

  const domain = ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  let keySet = keySets.get(domain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
    keySets.set(domain, keySet);
  }

  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: domain,
      audience: ACCESS_AUD,
    });
    return typeof payload.email === "string"
      && payload.email.toLowerCase() === ACCESS_ADMIN_EMAIL.toLowerCase();
  } catch {
    return false;
  }
}

export async function authorizeControlRequest(
  request: Request,
  env: SubscriptionEnv,
): Promise<void> {
  if (await acceptsServiceToken(request, env) || await acceptsAccessToken(request, env)) {
    return;
  }

  throw new ApiError(401, "authentication_required", "Authentication required");
}
