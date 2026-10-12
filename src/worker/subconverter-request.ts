import { ruleTemplates } from "../config/rule-templates";
import { ApiError } from "./api-error";

// This is the documented Clash/Mihomo subset of /sub, not a script/template execution service.
export function readSubconverterRequest(url: URL) {
  if (new TextEncoder().encode(url.href).length > 16384) throw new ApiError(413, "request_too_large", "Conversion URL exceeds 16 KiB");
  const parameters = url.searchParams;
  const allowed = new Set(["target", "url", "config", "list", "sort", "emoji", "append_type", "udp", "tfo", "scv", "include", "exclude", "filename", "ua", "insert", "fdn", "expand", "new_name"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) throw new ApiError(400, "unsupported_sub_parameter", `Unsupported or repeated parameter: ${key.slice(0, 40)}`);
  }
  function boolean(key: string, fallback: boolean) {
    const value = parameters.get(key)?.toLowerCase();
    if (value === undefined) return fallback;
    if (value !== "true" && value !== "false") throw new ApiError(400, "invalid_sub_parameter", `${key} must be true or false`);
    return value === "true";
  }
  if (!["clash", "clashr", "mihomo"].includes(parameters.get("target") || "clash")) throw new ApiError(400, "unsupported_target", "The /sub compatibility endpoint supports Clash/Mihomo; use the website for other clients");
  if (boolean("insert", false) || !boolean("new_name", true)) throw new ApiError(400, "unsupported_sub_parameter", "insert=true and legacy Clash field names are not supported");
  const nodesOnly = boolean("list", false);
  const sources = (parameters.get("url") || "").split("|").map(value => value.trim()).filter(Boolean).map(value => {
    let type = "node";
    if (/^https?:\/\//iu.test(value)) {
      let source: URL;
      try { source = new URL(value); } catch { throw new ApiError(400, "invalid_source", "Invalid source URL"); }
      if (!(source.pathname === "/" && !source.search && (source.username || source.password || (source.port && source.hash)))) type = "subscription";
    }
    return { type, value };
  });
  const templateUrl = parameters.get("config") || "";
  const template = ruleTemplates.find(item => item.url === templateUrl && item.id !== "custom");
  return {
    expand: !nodesOnly && boolean("expand", true),
    filterUnsupported: boolean("fdn", true),
    body: {
      target: nodesOnly ? "mihomo" : "mihomo-config", sources, name: parameters.get("filename") || "",
      sourceUserAgent: parameters.get("ua") || "clash.meta", fallbackMode: "error",
      rulePreset: nodesOnly ? "flacier" : template?.id || "custom", ruleTemplateUrl: templateUrl,
      nodeSettings: { sortMode: boolean("sort", false) ? "name-asc" : "source", addCountryFlag: boolean("emoji", true),
        showNodeType: boolean("append_type", false), udp: boolean("udp", true), tfo: boolean("tfo", false),
        skipCertVerify: boolean("scv", false), includePattern: parameters.get("include") || "", excludePattern: parameters.get("exclude") || "" },
    },
  };
}
