import { mihomoProxyGroups } from "../config/mihomo-policy";
import { ApiError } from "./api-error";

export type NodeSortMode = "source" | "name-asc" | "name-desc";

export interface NodeRenameRule {
  pattern: string;
  replacement: string;
}

export interface NodeSettings {
  includePattern: string;
  excludePattern: string;
  renameRules: NodeRenameRule[];
  sortMode: NodeSortMode;
}

export interface SubscriptionNode {
  name: string;
  [key: string]: unknown;
}

export const defaultNodeSettings: NodeSettings = {
  includePattern: "",
  excludePattern: "",
  renameRules: [],
  sortMode: "source",
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
    includePattern,
    excludePattern,
    renameRules,
    sortMode: input.sortMode as NodeSortMode,
  };
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
    const baseName = renamed || node.name;
    let name = baseName;
    let suffix = 2;
    while (names.has(name)) {
      name = `${baseName} · ${suffix}`;
      suffix += 1;
    }
    names.add(name);
    return [{ ...node, name }];
  });

  if (settings.sortMode === "source") {
    return transformed;
  }
  const direction = settings.sortMode === "name-asc" ? 1 : -1;
  return transformed.sort((left, right) => (
    nameCollator.compare(left.name, right.name) * direction
  ));
}
