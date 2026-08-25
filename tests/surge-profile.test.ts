import { describe, expect, it } from "vitest";

import {
  createSurgeProfile,
  createSurfboardProfile,
} from "../src/worker/surge-profile";

const nodeResource = "US-01 = ss, us.example.com, 443, encrypt-method=aes-128-gcm, password=test";

describe("Surge-compatible profiles", () => {
  it("builds a complete Surge profile around converted proxy lines", () => {
    const output = createSurgeProfile(nodeResource, 12);

    expect(output).toContain("#!MANAGED-CONFIG __FLACIER_SUBSCRIPTION_URL__ interval=43200");
    expect(output).toContain("[General]\n");
    expect(output).toContain("[Proxy]\nUS-01 = ss, us.example.com");
    expect(output).toContain("[Proxy Group]\nAUTO = url-test");
    expect(output).toContain("AI = select, GLOBAL, US, JP, SG, TW");
    expect(output).toContain(
      "RULE-SET,https://rules.flacier.com/rules/ai/openai.list,AI,update-interval=43200",
    );
    expect(output).toContain("PROCESS-NAME,codex,AI");
    expect(output.trimEnd().endsWith("FINAL,DEFAULT,dns-failed")).toBe(true);
  });

  it("builds a Surfboard profile with the same routing policies", () => {
    const output = createSurfboardProfile(nodeResource, 12);

    expect(output).toContain("#!MANAGED-CONFIG __FLACIER_SUBSCRIPTION_URL__ interval=43200");
    expect(output).toContain("[Proxy]\nUS-01 = ss, us.example.com");
    expect(output).toContain("ANIGAMER = select, TW, GLOBAL, DIRECT, AUTO");
    expect(output).toContain("FINAL,DEFAULT,dns-failed");
  });

  it("rejects a profile fragment with sections instead of proxy lines", () => {
    expect(() => createSurgeProfile("[Proxy]\nUS-01 = direct")).toThrow(
      "Surge node resource is invalid",
    );
  });
});
