import { expect, it } from "vitest";
import { parseProxyEndpoint, proxyEndpointUri } from "../src/app/lib/proxy-endpoint";
import { parseSubscriptionInput } from "../src/app/lib/subscription-input";

it("preserves endpoint credentials and remark including reserved URI characters", () => {
  const endpoint = parseProxyEndpoint("home.example:9004:account:p:a@ss#%");
  for (const protocol of ["socks5", "http", "https"] as const) {
    const uri = proxyEndpointUri({ ...endpoint, protocol, name: "家宽 · A" });
    const parsed = new URL(uri);
    expect(decodeURIComponent(parsed.password)).toBe("p:a@ss#%");
    expect(decodeURIComponent(parsed.hash.slice(1))).toBe("家宽 · A");
    expect(parseSubscriptionInput(uri)[0].type).toBe("node");
  }
});

it("rejects malformed hosts and ports rather than emitting an invalid link", () => {
  const value = { protocol: "socks5" as const, server: "home.example", port: 9004, username: "user", password: "secret", name: "home" };
  expect(() => proxyEndpointUri({ ...value, port: 0 })).toThrow();
  expect(() => proxyEndpointUri({ ...value, server: "https://home.example/path" })).toThrow();
  expect(() => parseProxyEndpoint("missing fields")).toThrow();
});
