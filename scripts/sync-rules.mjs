import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const upstreamRoot =
  "https://raw.githubusercontent.com/v2fly/domain-list-community/master/data";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chinaDomainsSource = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/classical/geolocation-cn.list";
const maxSourceBytes = 1024 * 1024;
const domesticSupplements = [
  { name: "xiaohongshu" },
  { name: "amap" },
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

async function fetchText(url, provenance) {
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
  if (Number(response.headers.get("content-length")) > maxSourceBytes) {
    await response.body?.cancel();
    throw new Error(`Rule source exceeds ${maxSourceBytes} bytes: ${url}`);
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
      if (size > maxSourceBytes) {
        await reader.cancel();
        throw new Error(`Rule source exceeds ${maxSourceBytes} bytes: ${url}`);
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
  const { rules, omitted } = convertChinaDomains(await fetchText(chinaDomainsSource, provenance));
  const supplements = [];
  for (const source of domesticSupplements) {
    const selected = source.domains
      ? convertDomainList(await fetchText(`${upstreamRoot}/${source.name}`, provenance), ["!cn"]).rules.filter(rule => source.domains.includes(rule.split(",")[1]))
      : await collectRules(source.name, new Set(), ["!cn"], provenance);
    validateRules(selected, source.name);
    supplements.push(...selected);
  }
  const domestic = [...new Set([...rules, ...supplements])];
  outputs.push(["public/rules/direct/china-domains.list", [
    "# Mainland China service domains; explicit service and personal rules take precedence.",
    "# Modified by Flacier (2026-10-12): domain-only compilation plus selected domestic app dependencies; no warranty.",
    "# Overseas and advertising attributes are excluded from v2fly supplements; company-wide includes are not imported.",
    "# Artifact license: GPL-3.0; source licenses: MetaCubeX/meta-rules-dat GPL-3.0, v2fly/domain-list-community MIT.",
    "# License texts: /rules/licenses/MetaCubeX-GPL-3.0.txt and /rules/licenses/v2fly-MIT.txt",
    ...[...provenance].flatMap(([url, hash]) => [`# Source: ${url}`, `# Source SHA-256: ${hash}`]),
    `# Omitted ${omitted.length} DOMAIN-REGEX rules for the shared mobile/domain format:`,
    ...omitted.map(rule => `# ${rule}`),
    ...domestic,
    "",
  ].join("\n")]);
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
