import { parse as parseYaml } from "yaml";

import { ApiError } from "./api-error";

export function readYamlProxyResource(
  input: string,
  client: string,
  allowEmpty = false,
): Array<Record<string, unknown>> {
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
    || (!allowEmpty && (parsed as { proxies: unknown[] }).proxies.length === 0)
    || !(parsed as { proxies: unknown[] }).proxies.every((proxy) => (
      proxy !== null && typeof proxy === "object" && !Array.isArray(proxy)
    ))
  ) {
    throw new ApiError(502, "converter_invalid_response", `${client} node resource is invalid`);
  }
  return (parsed as { proxies: Array<Record<string, unknown>> }).proxies;
}
