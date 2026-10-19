import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const upstreamRoot =
  "https://raw.githubusercontent.com/v2fly/domain-list-community/master/data";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// geosite:cn is the full domestic list; geolocation-cn adds service domains it does not carry.
const chinaDomainsSources = [
  "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/classical/cn.list",
  "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/classical/geolocation-cn.list",
];
// Overseas entries win over the domestic list where both claim a domain.
const overseasDomainsSource = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/classical/geolocation-!cn.list";
const maxSourceBytes = 1024 * 1024;
const maxDomesticSourceBytes = 4 * 1024 * 1024;
const domesticSupplements = [
  { name: "xiaohongshu" },
  { name: "amap" },
  { name: "dingtalk" },
  // Only these app dependencies are taken from company-wide lists, not overseas products or shared cloud hosting.
  { name: "bytedance", domains: ["snssdk.com", "pstatp.com", "toutiao.com", "toutiaoapi.com", "toutiaocdn.com", "toutiaocloud.com", "toutiaoimg.com", "toutiaostatic.com", "toutiaovod.com", "ixigua.com", "ixiguavideo.com", "jinritemai.com", "ecombdapi.com", "ecombdimg.com", "ecombdstatic.com", "ecombdvod.com"] },
  { name: "alibaba", domains: ["taobao.com", "taobao.net", "taobaocdn.com", "taotian.com", "tb.cn", "tbcache.com", "tbcdn.cn", "tmall.com", "alipay.com", "alipay.cn", "alipay.com.cn", "alipaydns.com", "alipayobjects.com", "goofish.com", "1688.com", "juhuasuan.com", "antfortune.com", "fund123.cn", "alitrip.com", "feizhu.com", "fliggy.com"] },
  { name: "aliyun", domains: ["alicdn.com"] },
  { name: "jd", domains: ["jd.com", "jd.cn", "jd.com.cn", "jd-app.com", "360buy.com", "360buyimg.com", "jdcache.com", "jdcdn.com", "jdpay.com", "jdpaydns.com", "jingdong.com", "jdwl.com", "jdl.com", "jddj.com", "jdcloud-api.com"] },
];
const sources = [
  {
    name: "bilibili",
    title: "Bilibili video, live, comics and related services",
    output: "public/rules/media/bilibili.list",
  },
  {
    name: "bahamut",
    title: "Bahamut AniGamer services",
    output: "public/rules/media/anigamer.list",
  },
];

export function convertDomainList(content, excludedAttributes = []) {
  const includes = [];
  const rules = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split(/\s+/u);
    const value = parts[0];
    if (parts.includes("@ads") || excludedAttributes.some(attribute => parts.includes(`@${attribute}`))) {
      continue;
    }
    if (value.startsWith("include:")) {
      if (parts.some(part => part.startsWith("@"))) {
        throw new Error("Selective v2fly includes require a compiled rule source");
      }
      includes.push(value.slice("include:".length));
    } else if (value.startsWith("full:")) {
      rules.push(`DOMAIN,${value.slice("full:".length)}`);
    } else if (value.startsWith("keyword:")) {
      rules.push(`DOMAIN-KEYWORD,${value.slice("keyword:".length)}`);
    } else if (value.startsWith("regexp:")) {
      rules.push(`DOMAIN-REGEX,${value.slice("regexp:".length)}`);
    } else {
      rules.push(`DOMAIN-SUFFIX,${value.replace(/^domain:/u, "")}`);
    }
  }

  return { includes, rules };
}

async function fetchText(url, provenance, limit = maxSourceBytes) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/^text\/(?:plain|csv)(?:;|$)/iu.test(contentType)) {
    throw new Error(`Non-text rule source: ${url}`);
  }
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error(`Rule source exceeds ${limit} bytes: ${url}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Empty rule source: ${url}`);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(`Rule source exceeds ${limit} bytes: ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim() || /<(?:!doctype|html|body)\b/iu.test(text)) throw new Error(`Invalid or empty rule source: ${url}`);
  provenance?.set(url, createHash("sha256").update(text).digest("hex"));
  return text;
}

async function collectRules(name, visited = new Set(), excludedAttributes = [], provenance) {
  if (visited.has(name)) {
    return [];
  }
  visited.add(name);

  const { includes, rules } = convertDomainList(await fetchText(`${upstreamRoot}/${encodeURIComponent(name)}`, provenance), excludedAttributes);
  const includedRules = [];
  for (const include of includes) {
    includedRules.push(...(await collectRules(include, visited, excludedAttributes, provenance)));
  }
  return [...includedRules, ...rules];
}

function renderRules({ name, title }, rules) {
  const uniqueRules = [...new Set(rules)];
  return [
    `# ${title}`,
    `# Source: https://github.com/v2fly/domain-list-community/blob/master/data/${name}`,
    ...uniqueRules,
    "",
  ].join("\n");
}

export function convertChinaDomains(content) {
  const rules = [];
  const omitted = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("DOMAIN-REGEX,")) omitted.push(line);
    else if (/^(?:DOMAIN|DOMAIN-SUFFIX),[a-z0-9_.-]+$/iu.test(line)) rules.push(line);
    else throw new Error(`Unsupported domestic domain rule: ${line}`);
  }
  if (!rules.length) throw new Error("Domestic domain source contains no usable rules");
  return { rules: [...new Set(rules)], omitted };
}

// Drop entries a broader DOMAIN-SUFFIX in the same list already matches.
export function withoutCoveredDomains(rules) {
  const suffixes = new Set(rules.filter(rule => rule.startsWith("DOMAIN-SUFFIX,")).map(rule => rule.slice("DOMAIN-SUFFIX,".length)));
  return rules.filter(rule => {
    const [type, domain] = rule.split(",");
    const labels = domain.split(".");
    for (let index = type === "DOMAIN" ? 0 : 1; index < labels.length; index += 1) {
      if (suffixes.has(labels.slice(index).join("."))) return false;
    }
    return true;
  });
}

// Overseas DOMAIN / DOMAIN-SUFFIX entries that a domestic rule would otherwise send direct.
export function overseasExceptions(content, domestic) {
  const suffixes = new Set(domestic.filter(rule => rule.startsWith("DOMAIN-SUFFIX,")).map(rule => rule.slice("DOMAIN-SUFFIX,".length)));
  const exact = new Set(domestic.filter(rule => rule.startsWith("DOMAIN,")).map(rule => rule.slice("DOMAIN,".length)));
  const exceptions = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^(DOMAIN|DOMAIN-SUFFIX),([a-z0-9_.-]+)$/iu.exec(line);
    if (!match) continue;
    const labels = match[2].split(".");
    const covered = (match[1] === "DOMAIN" && exact.has(match[2]))
      || labels.some((_, index) => suffixes.has(labels.slice(index).join(".")));
    if (covered) exceptions.push(line);
  }
  return [...new Set(exceptions)];
}

// Mihomo domain-behavior text: "+.example.com" matches the domain and its subdomains.
export function renderMihomoDomainSet(rules) {
  return rules.map(rule => rule.startsWith("DOMAIN-SUFFIX,") ? `+.${rule.slice("DOMAIN-SUFFIX,".length)}` : rule.slice("DOMAIN,".length));
}

function validateRules(rules, name) {
  if (!rules.length || rules.some(rule => !/^(?:DOMAIN(?:-SUFFIX|-KEYWORD|-REGEX)?),[^,\s<>]+$/u.test(rule))) {
    throw new Error(`Invalid or empty rule source: ${name}`);
  }
}

export async function syncRules(root = repositoryRoot) {
  const outputs = [];
  for (const source of sources) {
    const rules = await collectRules(source.name);
    validateRules(rules, source.name);
    outputs.push([source.output, renderRules(source, rules)]);
  }
  const provenance = new Map();
  let rules = [];
  let omitted = [];
  for (const source of chinaDomainsSources) {
    const converted = convertChinaDomains(await fetchText(source, provenance, maxDomesticSourceBytes));
    rules = rules.concat(converted.rules);
    omitted = omitted.concat(converted.omitted);
  }
  const supplements = [];
  for (const source of domesticSupplements) {
    const selected = source.domains
      ? convertDomainList(await fetchText(`${upstreamRoot}/${source.name}`, provenance), ["!cn"]).rules.filter(rule => source.domains.includes(rule.split(",")[1]))
      : await collectRules(source.name, new Set(), ["!cn"], provenance);
    validateRules(selected, source.name);
    supplements.push(...selected);
  }
  const domestic = withoutCoveredDomains([...new Set([...rules, ...supplements])]);
  const domesticHeader = [
    "# Mainland China domains (geosite:cn and geolocation-cn); explicit service and personal rules take precedence.",
    "# Modified by Flacier (2026-10-19): domain-only union with selected domestic app dependencies, covered entries removed; no warranty.",
    "# Overseas and advertising attributes are excluded from v2fly supplements; company-wide includes are not imported.",
    "# Artifact license: GPL-3.0; source licenses: MetaCubeX/meta-rules-dat GPL-3.0, v2fly/domain-list-community MIT.",
    "# License texts: /rules/licenses/MetaCubeX-GPL-3.0.txt and /rules/licenses/v2fly-MIT.txt",
    ...[...provenance].flatMap(([url, hash]) => [`# Source: ${url}`, `# Source SHA-256: ${hash}`]),
    `# Omitted ${omitted.length} DOMAIN-REGEX rules for the shared mobile/domain format:`,
    ...omitted.map(rule => `# ${rule}`),
  ];
  outputs.push(["public/rules/direct/china-domains.list", [...domesticHeader, ...domestic, ""].join("\n")]);
  const overseasProvenance = new Map();
  const exceptions = overseasExceptions(await fetchText(overseasDomainsSource, overseasProvenance, maxDomesticSourceBytes), domestic);
  outputs.push(["public/rules/direct/china-exceptions.list", [
    "# Overseas domains (geolocation-!cn) that the domestic list would otherwise route direct; evaluated before it.",
    "# Modified by Flacier (2026-10-19): only entries covered by china-domains are kept; no warranty.",
    "# Artifact license: GPL-3.0; source license: MetaCubeX/meta-rules-dat GPL-3.0. License text: /rules/licenses/MetaCubeX-GPL-3.0.txt",
    ...[...overseasProvenance].flatMap(([url, hash]) => [`# Source: ${url}`, `# Source SHA-256: ${hash}`]),
    ...exceptions,
    "",
  ].join("\n")]);
  outputs.push(["public/rules/mihomo/china-domains.txt", [...domesticHeader, ...renderMihomoDomainSet(domestic), ""].join("\n")]);
  // Fetch and validate every source before replacing any last-known-good published file.
  for (const [output, content] of outputs) {
    const destination = resolve(root, output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await syncRules();
}
