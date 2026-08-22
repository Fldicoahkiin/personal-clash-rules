export type ClientId =
  | "mihomo"
  | "stash"
  | "surge"
  | "loon"
  | "quantumult-x"
  | "sing-box"
  | "shadowrocket"
  | "egern"
  | "surfboard";

export interface ClientAction {
  kind: "link" | "copy";
  value: string;
}

function readSubscriptionUrl(input: string): URL {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("订阅地址需要使用 HTTP 或 HTTPS");
  }
  return url;
}

export function buildClientAction(
  client: ClientId,
  input: string,
  name: string,
): ClientAction {
  const url = readSubscriptionUrl(input);
  const source = input.trim();
  const params = new URLSearchParams({ url: source });
  const title = name.trim();

  if (client === "mihomo") {
    if (title) {
      params.set("name", title);
    }
    return { kind: "link", value: `mihomo://install-config?${params}` };
  }
  if (client === "stash") {
    return { kind: "link", value: `stash://install-config?${params}` };
  }
  if (client === "surge") {
    return { kind: "link", value: `surge:///install-config?${params}` };
  }
  if (client === "loon") {
    const loonParams = new URLSearchParams({ nodelist: source });
    return { kind: "link", value: `loon://import?${loonParams}` };
  }
  if (client === "quantumult-x") {
    const remoteResource = JSON.stringify({
      server_remote: [`${source}, tag=${title || "Flacier"}`],
    });
    return {
      kind: "link",
      value: `https://quantumult.app/x/open-app/add-resource?remote-resource=${encodeURIComponent(remoteResource)}`,
    };
  }

  return { kind: "copy", value: url.toString() };
}
