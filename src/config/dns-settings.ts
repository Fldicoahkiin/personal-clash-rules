export type DnsSettings = {
  bootstrapMode: "domestic" | "upstream" | "custom";
  bootstrap: string[];
  nameservers: string[];
  ipv6: boolean;
};

export const defaultDnsSettings: DnsSettings = {
  bootstrapMode: "domestic",
  bootstrap: [],
  nameservers: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
  ipv6: false,
};

export function parseDnsSettings(value: unknown): DnsSettings {
  if (value === undefined) return structuredClone(defaultDnsSettings);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid DNS settings");
  const input = value as Record<string, unknown>;
  // Records saved before "domestic" existed used "system": plain UDP to the OS resolver, which a client running TUN
  // with DNS hijacking answers from its own fake-ip pool, so node domains resolved to fake addresses. They migrate here.
  const mode = input.bootstrapMode === "system" ? "domestic" : input.bootstrapMode;
  if (!["domestic", "upstream", "custom"].includes(String(mode)) || typeof input.ipv6 !== "boolean") {
    throw new Error("Invalid DNS settings");
  }
  function resolvers(value: unknown, optional = false): string[] {
    if (!Array.isArray(value) || value.length > 4 || (!optional && value.length === 0)) throw new Error("Invalid DNS resolvers");
    return value.map((item) => {
      if (typeof item !== "string" || item.length > 256 || /\s/u.test(item)) throw new Error("Invalid DNS resolver");
      const url = new URL(item);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("DNS resolvers must use HTTPS without routing parameters");
      return url.href;
    });
  }
  return {
    bootstrapMode: mode as DnsSettings["bootstrapMode"],
    bootstrap: resolvers(input.bootstrap, mode !== "custom"),
    nameservers: resolvers(input.nameservers),
    ipv6: input.ipv6,
  };
}
