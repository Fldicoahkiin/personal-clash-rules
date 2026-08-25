import type {
  NodeSortMode,
  OutputTarget,
  RulePreset,
} from "../features/subscriptions/api";

export type LoadedSubscriptionForm = {
  addCountryFlag: boolean;
  excludePattern: string;
  includePattern: string;
  name: string;
  renamePattern: string;
  renameReplacement: string;
  rulePreset: RulePreset;
  showNodeType: boolean;
  skipCertVerify: boolean;
  sourceText: string;
  sourceUserAgent: string;
  sortMode: NodeSortMode;
  target: OutputTarget;
  tfo: boolean;
  udp: boolean;
  updateIntervalHours: number;
};

const outputTargets = new Set<OutputTarget>([
  "clash-party-config",
  "mihomo-config",
  "stash-config",
  "surge-config",
  "surfboard-config",
  "loon-config",
  "egern-config",
  "sing-box-config",
  "mihomo",
  "clash",
  "stash",
  "surge",
  "loon",
  "shadowrocket",
  "quantumult-x",
  "sing-box",
  "egern",
  "surfboard",
  "v2ray",
  "uri",
  "json",
]);

function decodeToken(token: string): unknown {
  const [version, encoded, extra] = token.split(".");
  if (version !== "v1" || !encoded || extra !== undefined || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error("不是本站生成的订阅链接");
  }
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("订阅链接内容无法读取");
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("订阅链接内容无法读取");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseGeneratedSubscriptionUrl(input: string): LoadedSubscriptionForm {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("请输入完整的订阅链接");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "s" || !parts[1]) {
    throw new Error("不是本站生成的订阅链接");
  }
  const config = objectValue(decodeToken(parts[1]));
  const nodeSettings = objectValue(config.nodeSettings);
  if (!Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error("订阅链接中没有来源");
  }
  const sourceText = config.sources.map((candidate) => {
    const source = objectValue(candidate);
    if (typeof source.value !== "string" || !source.value.trim()) {
      throw new Error("订阅链接中的来源无法读取");
    }
    return source.value.trim();
  }).join("\n");
  const renameRule = Array.isArray(nodeSettings.renameRules)
    ? objectValue(nodeSettings.renameRules[0] ?? {})
    : {};
  const targetValue = parts[2] || url.searchParams.get("target") || "clash-party-config";
  const target = outputTargets.has(targetValue as OutputTarget)
    ? targetValue as OutputTarget
    : "clash-party-config";
  const rulePreset = config.rulePreset === "global" ? "global" : "flacier";
  const sortMode = nodeSettings.sortMode === "name-asc" || nodeSettings.sortMode === "name-desc"
    ? nodeSettings.sortMode
    : "source";
  const updateIntervalHours = Number.isInteger(config.updateIntervalHours)
    && Number(config.updateIntervalHours) >= 1
    && Number(config.updateIntervalHours) <= 168
    ? Number(config.updateIntervalHours)
    : 6;

  return {
    addCountryFlag: booleanValue(nodeSettings.addCountryFlag, true),
    excludePattern: stringValue(nodeSettings.excludePattern),
    includePattern: stringValue(nodeSettings.includePattern),
    name: stringValue(config.name),
    renamePattern: stringValue(renameRule.pattern),
    renameReplacement: stringValue(renameRule.replacement),
    rulePreset,
    showNodeType: booleanValue(nodeSettings.showNodeType, false),
    skipCertVerify: booleanValue(nodeSettings.skipCertVerify, false),
    sourceText,
    sourceUserAgent: stringValue(config.sourceUserAgent, "mihomo/1.19"),
    sortMode,
    target,
    tfo: booleanValue(nodeSettings.tfo, false),
    udp: booleanValue(nodeSettings.udp, true),
    updateIntervalHours,
  };
}
