import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const upstreamRoot =
  "https://raw.githubusercontent.com/v2fly/domain-list-community/master/data";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

export function convertDomainList(content) {
  const includes = [];
  const rules = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split(/\s+/u);
    const value = parts[0];
    if (parts.includes("@ads")) {
      continue;
    }
    if (value.startsWith("include:")) {
      includes.push(value.slice("include:".length));
    } else if (value.startsWith("full:")) {
      rules.push(`DOMAIN,${value.slice("full:".length)}`);
    } else if (value.startsWith("keyword:")) {
      rules.push(`DOMAIN-KEYWORD,${value.slice("keyword:".length)}`);
    } else if (value.startsWith("regexp:")) {
      rules.push(`DOMAIN-REGEX,${value.slice("regexp:".length)}`);
    } else {
      rules.push(`DOMAIN-SUFFIX,${value}`);
    }
  }

  return { includes, rules };
}

async function fetchDomainList(name) {
  const response = await fetch(`${upstreamRoot}/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${name}: HTTP ${response.status}`);
  }
  return response.text();
}

async function collectRules(name, visited = new Set()) {
  if (visited.has(name)) {
    return [];
  }
  visited.add(name);

  const { includes, rules } = convertDomainList(await fetchDomainList(name));
  const includedRules = [];
  for (const include of includes) {
    includedRules.push(...(await collectRules(include, visited)));
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

async function main() {
  for (const source of sources) {
    const destination = resolve(repositoryRoot, source.output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(
      destination,
      renderRules(source, await collectRules(source.name)),
      "utf8",
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
