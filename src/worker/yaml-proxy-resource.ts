import { parse as parseYaml } from "yaml";

import { ApiError } from "./api-error";

export function readYamlProxyResource(input: string, client: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch {
    throw new ApiError(502, "converter_invalid_response", `${client} node resource is invalid`);
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || !Array.isArray((parsed as { proxies?: unknown }).proxies)
    || (parsed as { proxies: unknown[] }).proxies.length === 0
  ) {
    throw new ApiError(502, "converter_invalid_response", `${client} node resource is invalid`);
  }
  return (parsed as { proxies: unknown[] }).proxies;
}
