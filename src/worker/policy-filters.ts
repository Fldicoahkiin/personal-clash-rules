import { countryGroupNames, metadataFilter } from "../config/mihomo-policy";

// Non-Mihomo renderers evaluate Mihomo's (?i) group filters themselves.
export const countryRegionNames = new Set(Object.values(countryGroupNames));
export const metadataNamePattern = new RegExp(metadataFilter.replace(/^\(\?i\)/u, ""), "iu");

export function namesMatchingFilter(names: string[], filter: string | undefined): string[] {
  if (!filter) {
    return names;
  }
  const pattern = new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu");
  return names.filter((name) => pattern.test(name));
}
