import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface ComposeService {
  image?: string;
  command?: string[];
  environment?: Record<string, string>;
  secrets?: string[];
  depends_on?: Record<string, { condition?: string }>;
  healthcheck?: { test?: string[] };
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
  secrets?: Record<string, { file?: string }>;
}

function projectFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Sub-Store deployment", () => {
  it("runs the remotely managed Cloudflare Tunnel without putting its token in Git", () => {
    const compose = parse(projectFile("deploy/sub-store/compose.yaml")) as ComposeFile;
    const tunnel = compose.services?.tunnel;

    expect(tunnel).toMatchObject({
      image:
        "cloudflare/cloudflared:2026.8.2@sha256:0aa26e284f05e6c77ae375b8c9c11d9eb6a448fb7bcd8d40f31cb6176189eb38",
      command: ["tunnel", "--no-autoupdate", "run"],
      environment: {
        TUNNEL_TOKEN_FILE: "/run/secrets/cloudflare_tunnel_token",
      },
      secrets: ["cloudflare_tunnel_token"],
      depends_on: {
        gateway: { condition: "service_healthy" },
      },
    });
    expect(compose.secrets?.cloudflare_tunnel_token?.file).toBe(
      "${CLOUDFLARE_TUNNEL_TOKEN_FILE:-./secrets/cloudflare-tunnel-token}",
    );
    expect(projectFile(".gitignore")).toContain("deploy/sub-store/secrets/");
  });

  it("waits for the authenticated gateway before starting the tunnel", () => {
    const compose = parse(projectFile("deploy/sub-store/compose.yaml")) as ComposeFile;
    expect(compose.services?.gateway?.healthcheck?.test).toContain(
      "http://127.0.0.1:8080/healthz",
    );
    expect(projectFile("deploy/sub-store/Caddyfile")).toContain("handle /healthz");
  });
});
