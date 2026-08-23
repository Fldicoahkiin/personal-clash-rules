import { describe, expect, it } from "vitest";

import {
  applyNodeTransforms,
  defaultNodeSettings,
} from "../src/worker/node-transforms";

describe("applyNodeTransforms", () => {
  it("keeps the normalized source order when no settings are enabled", () => {
    const nodes = [
      { name: "Tokyo 2", type: "ss", server: "two.example" },
      { name: "Tokyo 10", type: "ss", server: "ten.example" },
    ];

    expect(applyNodeTransforms(nodes, {
      ...defaultNodeSettings,
      addCountryFlag: false,
      udp: false,
    })).toEqual(nodes);
  });

  it("filters before sequential renaming and natural name sorting", () => {
    const nodes = [
      { name: "🇺🇸 US 10", server: "us-ten.example" },
      { name: "US backup", server: "backup.example" },
      { name: "🇯🇵 JP 1", server: "jp-one.example" },
      { name: "🇺🇸 US 2", server: "us-two.example" },
      { name: "Singapore 1", server: "sg-one.example" },
    ];

    expect(applyNodeTransforms(nodes, {
      ...defaultNodeSettings,
      addCountryFlag: false,
      includePattern: "us|jp",
      excludePattern: "backup",
      renameRules: [
        { pattern: "^🇺🇸\\s*", replacement: "" },
        { pattern: "^🇯🇵\\s*", replacement: "" },
      ],
      sortMode: "name-asc",
      udp: false,
    }).map((node) => node.name)).toEqual([
      "JP 1",
      "US 2",
      "US 10",
    ]);
  });

  it("makes renamed and reserved node names unique", () => {
    const nodes = [
      { name: "US 1", server: "one.example" },
      { name: "US 2", server: "two.example" },
      { name: "DIRECT", server: "direct.example" },
    ];

    expect(applyNodeTransforms(nodes, {
      ...defaultNodeSettings,
      addCountryFlag: false,
      renameRules: [{ pattern: "US \\d+", replacement: "US" }],
      udp: false,
    }).map((node) => node.name)).toEqual([
      "US · 2",
      "US · 3",
      "DIRECT · 2",
    ]);
  });

  it("supports descending natural name order", () => {
    const nodes = [
      { name: "Tokyo 2" },
      { name: "Tokyo 10" },
      { name: "Tokyo 1" },
    ];

    expect(applyNodeTransforms(nodes, {
      ...defaultNodeSettings,
      addCountryFlag: false,
      sortMode: "name-desc",
      udp: false,
    }).map((node) => node.name)).toEqual([
      "Tokyo 10",
      "Tokyo 2",
      "Tokyo 1",
    ]);
  });

  it("keeps the original name when a rename would leave it empty", () => {
    const nodes = [{ name: "remove-me", server: "one.example" }];

    expect(applyNodeTransforms(nodes, {
      ...defaultNodeSettings,
      addCountryFlag: false,
      renameRules: [{ pattern: ".+", replacement: "" }],
      udp: false,
    })).toEqual(nodes);
  });

  it("adds country flags, node types, and requested transport options", () => {
    const nodes = [{
      name: "US-LAX-01",
      type: "ss",
      server: "one.example",
    }];

    expect(applyNodeTransforms(nodes, {
      ...defaultNodeSettings,
      addCountryFlag: true,
      showNodeType: true,
      udp: true,
      skipCertVerify: true,
      tfo: true,
    })).toEqual([{
      name: "🇺🇸 [SS] US-LAX-01",
      type: "ss",
      server: "one.example",
      udp: true,
      "skip-cert-verify": true,
      tfo: true,
    }]);
  });
});
