const subStoreUrl = process.env.SUB_STORE_URL ?? "http://127.0.0.1:3010";
const endpoint = new URL(subStoreUrl);
if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
  throw new Error("SUB_STORE_URL must use HTTP or HTTPS");
}

const headers = new Headers({ "Content-Type": "application/json" });
if (process.env.SUB_STORE_ACCESS_CLIENT_ID && process.env.SUB_STORE_ACCESS_CLIENT_SECRET) {
  headers.set("CF-Access-Client-Id", process.env.SUB_STORE_ACCESS_CLIENT_ID);
  headers.set("CF-Access-Client-Secret", process.env.SUB_STORE_ACCESS_CLIENT_SECRET);
} else if (process.env.SUB_STORE_TOKEN) {
  headers.set("Authorization", `Bearer ${process.env.SUB_STORE_TOKEN}`);
}

const targets = [
  ["mihomo", "Mihomo"],
  ["clash", "Clash"],
  ["stash", "Stash"],
  ["surge", "Surge"],
  ["loon", "Loon"],
  ["shadowrocket", "Shadowrocket"],
  ["quantumult-x", "QX"],
  ["sing-box", "sing-box"],
  ["egern", "Egern"],
  ["surfboard", "Surfboard"],
  ["v2ray", "V2Ray"],
  ["uri", "URI"],
  ["json", "JSON"],
];

const nodeUri = "ss://YWVzLTEyOC1nY206bG9jYWwtdGVzdA==@node.example:8388#E2E";
const clashYaml = `proxies:
  - name: E2E
    type: ss
    server: node.example
    port: 8388
    cipher: aes-128-gcm
    password: local-test
    udp: true
`;

async function post(path, body) {
  const response = await fetch(new URL(path, endpoint), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`${path} returned HTTP ${response.status} without JSON`);
  }
  if (!response.ok || result?.status !== "success" || !result.data) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return result.data;
}

const preview = await post("/api/preview/sub?target=JSON", {
  name: "E2E",
  source: "local",
  url: "",
  content: nodeUri,
  process: [],
  noFlow: true,
});
if (!Array.isArray(preview.processed) || preview.processed.length !== 1) {
  throw new Error("Sub-Store did not normalize the test node");
}

const generated = await Promise.all(targets.map(async ([target, client]) => {
  const data = await post("/api/proxy/parse", { data: clashYaml, client });
  const output = data.par_res;
  if (typeof output !== "string" || !output.trim()) {
    throw new Error(`${target} returned empty output`);
  }
  return target;
}));

console.log(JSON.stringify({ normalizedNodes: preview.processed.length, targets: generated }));
