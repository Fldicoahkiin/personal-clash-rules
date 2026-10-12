import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { parse, parseDocument, stringify } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fields = {
  DOMAIN: ["domain_set", "domain"],
  "DOMAIN-SUFFIX": ["domain_suffix_set", "domain_suffix"],
  "DOMAIN-KEYWORD": ["domain_keyword_set", "domain_keyword"],
  "DOMAIN-REGEX": ["domain_regex_set", "domain_regex"],
  "IP-CIDR": ["ip_cidr_set", "ip_cidr"],
  "IP-CIDR6": ["ip_cidr6_set", "ip_cidr"],
};

export function parseClassicalRules(content) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf(",");
      if (separator === -1) {
        throw new Error(`Invalid classical rule: ${line}`);
      }
      const type = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (!fields[type] || !value) {
        throw new Error(`Unsupported classical rule: ${line}`);
      }
      return { type, value };
    });
}

function groupedRule(rules, fieldIndex) {
  const result = {};
  for (const rule of rules) {
    const field = fields[rule.type][fieldIndex];
    (result[field] ??= []).push(rule.value);
  }
  return result;
}

export function renderEgernRuleSet(content) {
  return stringify(groupedRule(parseClassicalRules(content), 0));
}

export function renderSingBoxRuleSet(content) {
  return `${JSON.stringify({
    version: 3,
    rules: [groupedRule(parseClassicalRules(content), 1)],
  }, null, 2)}\n`;
}

async function main() {
  const manifest = parse(await readFile(
    resolve(repositoryRoot, "public/rules/manifest.yaml"),
    "utf8",
  ));
  for (const ruleSet of manifest.ruleSets) {
    const source = await readFile(resolve(repositoryRoot, "public", ruleSet.path), "utf8");
    const outputs = [
      [`public/rules/egern/${ruleSet.id}.yaml`, renderEgernRuleSet(source)],
      [`public/rules/sing-box/${ruleSet.id}.json`, renderSingBoxRuleSet(source)],
    ];
    for (const [relativePath, content] of outputs) {
      const destination = resolve(repositoryRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
  }
  const policyModule = await build({
    entryPoints: [resolve(repositoryRoot, "src/config/mihomo-policy.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const policy = await import(`data:text/javascript;base64,${Buffer.from(policyModule.outputFiles[0].text).toString("base64")}`);
  const overridePath = resolve(repositoryRoot, "public/overrides/clash-party.yaml");
  const override = parseDocument(await readFile(overridePath, "utf8"));
  override.set("rule-providers", override.createNode(policy.mihomoRuleProviders));
  override.set("+proxy-groups", override.createNode(policy.mihomoProxyGroups.map(policy.displayMihomoGroup)));
  override.set("+rules", override.createNode(policy.mihomoProfileRules.map(policy.displayMihomoRule)));
  await writeFile(overridePath, override.toString({ lineWidth: 0 }), "utf8");
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
