import {
  countryFlagRules,
  mihomoProxyGroups,
} from "../config/mihomo-policy";
import { ApiError } from "./api-error";

export type NodeSortMode = "source" | "name-asc" | "name-desc";

export interface NodeRenameRule {
  pattern: string;
  replacement: string;
}

export interface NodeSettings {
  addCountryFlag: boolean;
  includePattern: string;
  excludePattern: string;
  renameRules: NodeRenameRule[];
  showNodeType: boolean;
  skipCertVerify: boolean;
  sortMode: NodeSortMode;
  tfo: boolean;
  udp: boolean;
  xudp: boolean;
}

export interface SubscriptionNode {
  name: string;
  [key: string]: unknown;
}

export const defaultNodeSettings: NodeSettings = {
  addCountryFlag: true,
  includePattern: "",
  excludePattern: "",
  renameRules: [],
  showNodeType: false,
  skipCertVerify: false,
  sortMode: "source",
  tfo: false,
  udp: true,
  xudp: false,
};

const maximumFilterLength = 256;
const maximumRenameLength = 128;
const maximumRenameRules = 12;
const sortModes = new Set<NodeSortMode>(["source", "name-asc", "name-desc"]);
const nameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function readPattern(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_node_settings", "Node pattern must be a string");
  }
  const pattern = value.trim();
  if ((!allowEmpty && !pattern) || pattern.length > maximum) {
    throw new ApiError(400, "invalid_node_settings", "Node pattern is invalid");
  }
  return pattern;
}

function compilePattern(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new ApiError(400, "invalid_node_pattern", "Node pattern is not valid regular expression");
  }
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ApiError(400, "invalid_node_settings", "Node option must be a boolean");
  }
  return value;
}

export function parseNodeSettings(input: Record<string, unknown>): NodeSettings {
  const includePattern = readPattern(
    input.includePattern,
    maximumFilterLength,
    true,
  );
  const excludePattern = readPattern(
    input.excludePattern,
    maximumFilterLength,
    true,
  );
  if (includePattern) {
    compilePattern(includePattern, "iu");
  }
  if (excludePattern) {
    compilePattern(excludePattern, "iu");
  }

  if (!Array.isArray(input.renameRules) || input.renameRules.length > maximumRenameRules) {
    throw new ApiError(400, "invalid_node_settings", "Rename rules are invalid");
  }
  const renameRules = input.renameRules.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ApiError(400, "invalid_node_settings", "Rename rule must be an object");
    }
    const rule = candidate as Record<string, unknown>;
    const pattern = readPattern(rule.pattern, maximumRenameLength, false);
    if (typeof rule.replacement !== "string" || rule.replacement.length > maximumRenameLength) {
      throw new ApiError(400, "invalid_node_settings", "Rename replacement is invalid");
    }
    compilePattern(pattern, "giu");
    return { pattern, replacement: rule.replacement };
  });

  if (typeof input.sortMode !== "string" || !sortModes.has(input.sortMode as NodeSortMode)) {
    throw new ApiError(400, "invalid_node_settings", "Node sort mode is invalid");
  }

  return {
    addCountryFlag: readBoolean(input.addCountryFlag),
    includePattern,
    excludePattern,
    renameRules,
    showNodeType: readBoolean(input.showNodeType),
    skipCertVerify: readBoolean(input.skipCertVerify),
    sortMode: input.sortMode as NodeSortMode,
    tfo: readBoolean(input.tfo),
    udp: readBoolean(input.udp),
    xudp: readBoolean(input.xudp),
  };
}

function withCountryFlag(name: string): string {
  if (/^\p{Regional_Indicator}{2}\s*/u.test(name)) {
    return name;
  }
  const match = countryFlagRules.find((rule) => new RegExp(rule.filter, "iu").test(name));
  return match ? `${match.flag} ${name}` : name;
}

function withNodeType(name: string, type: unknown): string {
  if (typeof type !== "string" || !type.trim()) {
    return name;
  }
  const flag = name.match(/^(\p{Regional_Indicator}{2})\s*/u);
  const withoutFlag = flag ? name.slice(flag[0].length) : name;
  const typed = `[${type.toUpperCase()}] ${withoutFlag}`;
  return flag ? `${flag[1]} ${typed}` : typed;
}

export function applyNodeTransforms(
  nodes: SubscriptionNode[],
  settings: NodeSettings,
): SubscriptionNode[] {
  const include = settings.includePattern
    ? compilePattern(settings.includePattern, "iu")
    : null;
  const exclude = settings.excludePattern
    ? compilePattern(settings.excludePattern, "iu")
    : null;
  const renameRules = settings.renameRules.map((rule) => ({
    expression: compilePattern(rule.pattern, "giu"),
    replacement: rule.replacement,
  }));
  const names = new Set([
    "DIRECT",
    "REJECT",
    ...mihomoProxyGroups.map((group) => group.name),
  ]);

  const transformed = nodes.flatMap((node) => {
    if (include && !include.test(node.name)) {
      return [];
    }
    if (exclude?.test(node.name)) {
      return [];
    }

    const renamed = renameRules.reduce(
      (name, rule) => name.replace(rule.expression, rule.replacement),
      node.name,
    ).trim();
    const baseName = settings.showNodeType
      ? withNodeType(settings.addCountryFlag ? withCountryFlag(renamed || node.name) : renamed || node.name, node.type)
      : settings.addCountryFlag ? withCountryFlag(renamed || node.name) : renamed || node.name;
    let name = baseName;
    let suffix = 2;
    while (names.has(name)) {
      name = `${baseName} · ${suffix}`;
      suffix += 1;
    }
    names.add(name);
    return [{
      ...node,
      ...(settings.xudp && (node.type === "vmess" || node.type === "vless")
        ? { "packet-encoding": "xudp" }
        : {}),
      ...(settings.udp ? { udp: true } : {}),
      ...(settings.skipCertVerify ? { "skip-cert-verify": true } : {}),
      ...(settings.tfo ? { tfo: true } : {}),
      name,
    }];
  });

  if (settings.sortMode === "source") {
    return transformed;
  }
  const direction = settings.sortMode === "name-asc" ? 1 : -1;
  return transformed.sort((left, right) => (
    nameCollator.compare(left.name, right.name) * direction
  ));
}
