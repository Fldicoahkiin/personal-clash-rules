import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  renderEgernRuleSet,
  renderSingBoxRuleSet,
} from "../scripts/build-rule-formats.mjs";

const root = resolve(import.meta.dirname, "..");

describe("generated client rule formats", () => {
  it("stays aligned with every classical source rule", async () => {
    const manifest = parse(await readFile(resolve(root, "public/rules/manifest.yaml"), "utf8"));

    for (const ruleSet of manifest.ruleSets) {
      const source = await readFile(resolve(root, "public", ruleSet.path), "utf8");
      const egern = await readFile(
        resolve(root, `public/rules/egern/${ruleSet.id}.yaml`),
        "utf8",
      );
      const singBox = await readFile(
        resolve(root, `public/rules/sing-box/${ruleSet.id}.json`),
        "utf8",
      );

      expect(egern, ruleSet.id).toBe(renderEgernRuleSet(source));
      expect(singBox, ruleSet.id).toBe(renderSingBoxRuleSet(source));
    }
  });
});
