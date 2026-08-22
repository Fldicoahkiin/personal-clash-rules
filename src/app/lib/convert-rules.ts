import { parse, stringify } from "yaml";

export type InputFormat = "v2fly" | "classical" | "domain" | "yaml";
export type OutputFormat =
  | "classical-text"
  | "classical-yaml"
  | "domain-text"
  | "provider-snippet";

export interface ConvertOptions {
  input: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  policy: string;
  providerName: string;
  providerUrl: string;
}

export interface ConvertResult {
  output: string;
  count: number;
  warnings: string[];
}

type RuleType =
  | "DOMAIN"
  | "DOMAIN-SUFFIX"
  | "DOMAIN-KEYWORD"
  | "DOMAIN-REGEX"
  | "IP-CIDR"
  | "IP-CIDR6";

interface Rule {
  type: RuleType;
  value: string;
}

const ruleTypes = new Set<RuleType>([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-REGEX",
  "IP-CIDR",
  "IP-CIDR6",
]);

function assertRuleType(value: string, lineNumber: number): RuleType {
  if (!ruleTypes.has(value as RuleType)) {
    throw new Error(`第 ${lineNumber} 行的规则类型 ${value} 不受支持。`);
  }
  return value as RuleType;
}

function parseV2flyLine(
  line: string,
  lineNumber: number,
  warnings: string[],
): Rule | null {
  if (line.startsWith("include:")) {
    warnings.push(
      `第 ${lineNumber} 行是 include 指令，浏览器无法展开外部文件，已跳过。`,
    );
    return null;
  }

  const [value, ...attributes] = line.split(/\s+/u);
  if (attributes.length > 0) {
    warnings.push(
      `第 ${lineNumber} 行带有属性 ${attributes.join(" ")}，已跳过。`,
    );
    return null;
  }
  if (!value) {
    return null;
  }

  const prefixes: Array<[string, RuleType]> = [
    ["full:", "DOMAIN"],
    ["regexp:", "DOMAIN-REGEX"],
    ["keyword:", "DOMAIN-KEYWORD"],
    ["domain:", "DOMAIN-SUFFIX"],
  ];
  const match = prefixes.find(([prefix]) => value.startsWith(prefix));
  if (match) {
    const [prefix, type] = match;
    const ruleValue = value.slice(prefix.length).trim();
    if (!ruleValue) {
      throw new Error(`第 ${lineNumber} 行缺少规则内容。`);
    }
    return { type, value: ruleValue };
  }

  return { type: "DOMAIN-SUFFIX", value };
}

function parseClassicalLine(line: string, lineNumber: number): Rule {
  const firstComma = line.indexOf(",");
  if (firstComma === -1) {
    throw new Error(`第 ${lineNumber} 行不是有效的 classical 规则。`);
  }
  const type = assertRuleType(line.slice(0, firstComma).trim(), lineNumber);
  const remainder = line.slice(firstComma + 1);
  const policySeparator = remainder.indexOf(",");
  const value = (policySeparator === -1
    ? remainder
    : remainder.slice(0, policySeparator)
  ).trim();
  if (!value) {
    throw new Error(`第 ${lineNumber} 行缺少规则内容。`);
  }
  return { type, value };
}

function parseDomainLine(line: string): Rule {
  if (line.startsWith("+.")) {
    return { type: "DOMAIN-SUFFIX", value: line.slice(2) };
  }
  if (line.startsWith(".")) {
    return { type: "DOMAIN-SUFFIX", value: line.slice(1) };
  }
  return { type: "DOMAIN", value: line };
}

function sourceLines(input: string, inputFormat: InputFormat): string[] {
  if (inputFormat !== "yaml") {
    return input.split(/\r?\n/u);
  }

  const document: unknown = parse(input);
  if (
    typeof document !== "object" ||
    document === null ||
    !("payload" in document) ||
    !Array.isArray(document.payload) ||
    !document.payload.every((item) => typeof item === "string")
  ) {
    throw new Error("YAML 必须包含由字符串组成的 payload 数组。");
  }
  return document.payload;
}

function parseRules(
  input: string,
  inputFormat: InputFormat,
): { rules: Rule[]; warnings: string[] } {
  if (!input.trim()) {
    throw new Error("请先粘贴需要转换的规则。");
  }

  const warnings: string[] = [];
  const rules: Rule[] = [];
  const seen = new Set<string>();

  sourceLines(input, inputFormat).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const rule =
      inputFormat === "v2fly"
        ? parseV2flyLine(line, lineNumber, warnings)
        : inputFormat === "domain"
          ? parseDomainLine(line)
          : parseClassicalLine(line, lineNumber);
    if (!rule) {
      return;
    }

    const key = `${rule.type},${rule.value}`;
    if (seen.has(key)) {
      warnings.push(`第 ${lineNumber} 行与已有规则重复，已跳过。`);
      return;
    }
    seen.add(key);
    rules.push(rule);
  });

  if (rules.length === 0) {
    throw new Error("没有找到可输出的规则。");
  }
  return { rules, warnings };
}

function classicalLines(rules: Rule[]): string[] {
  return rules.map((rule) => `${rule.type},${rule.value}`);
}

function domainLines(rules: Rule[]): string[] {
  return rules.map((rule) => {
    if (rule.type === "DOMAIN") {
      return rule.value;
    }
    if (rule.type === "DOMAIN-SUFFIX") {
      return `+.${rule.value}`;
    }
    throw new Error(`domain 文本不支持 ${rule.type}，请改用 classical 输出。`);
  });
}

function providerSnippet(options: ConvertOptions): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(options.providerName)) {
    throw new Error("Provider 名称只能使用小写字母、数字、点、下划线和短横线。");
  }
  let url: URL;
  try {
    url = new URL(options.providerUrl);
  } catch {
    throw new Error("Provider URL 必须是完整的 HTTP 或 HTTPS 地址。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider URL 必须是完整的 HTTP 或 HTTPS 地址。");
  }
  const policy = options.policy.trim();
  if (!policy) {
    throw new Error("策略组名称不能为空。");
  }

  return stringify({
    "rule-providers": {
      [options.providerName]: {
        type: "http",
        behavior: "classical",
        format: "text",
        url: url.toString(),
        path: `./ruleset/${options.providerName}.list`,
        interval: 86400,
      },
    },
    rules: [`RULE-SET,${options.providerName},${policy}`],
  }).trimEnd();
}

export function convertRules(options: ConvertOptions): ConvertResult {
  const { rules, warnings } = parseRules(options.input, options.inputFormat);
  let output: string;

  switch (options.outputFormat) {
    case "classical-text":
      output = classicalLines(rules).join("\n");
      break;
    case "classical-yaml":
      output = stringify({ payload: classicalLines(rules) }).trimEnd();
      break;
    case "domain-text":
      output = domainLines(rules).join("\n");
      break;
    case "provider-snippet":
      output = providerSnippet(options);
      break;
  }

  return { output, count: rules.length, warnings };
}
