const publishedRuleFiles = {
  "private-domain": "local/private-domain.list",
  "private-ip": "local/private-ip.list",
  "apple-system": "apple/system.list",
  "apple-services": "apple/services.list",
  "ai-openai": "ai/openai.list",
  "ai-anthropic": "ai/anthropic.list",
  "ai-xai": "ai/xai.list",
  "ai-google": "ai/google.list",
  "ai-coding": "ai/coding.list",
  "ai-general": "ai/general.list",
  steam: "gaming/steam.list",
  "steam-download": "gaming/steam-download.list",
  "steam-online": "gaming/steam-online.list",
  discord: "messaging/discord.list",
  developer: "developer/developer.list",
  media: "media/media.list",
  bilibili: "media/bilibili.list",
  anigamer: "media/anigamer.list",
  social: "social/social.list",
} as const;

export const mihomoRuleProviders = Object.fromEntries(
  Object.entries(publishedRuleFiles).map(([name, file]) => [
    name,
    {
      type: "http",
      behavior: "classical",
      format: "text",
      url: `https://rules.flacier.com/rules/${file}`,
      path: `./ruleset/personal/${name}.list`,
      interval: 86_400,
    },
  ]),
);

const metadataFilter = "(?i)(剩余|流量|到期|官网|客服|订阅)";

function countryGroup(name: string, filter: string) {
  return {
    name,
    type: "select",
    "include-all": true,
    "empty-fallback": "DIRECT",
    "exclude-type": "direct",
    filter,
    "exclude-filter": metadataFilter,
  };
}

export const mihomoProxyGroups = [
  {
    name: "AUTO",
    type: "url-test",
    "include-all": true,
    "exclude-type": "direct",
    url: "https://cp.cloudflare.com/generate_204",
    interval: 300,
    tolerance: 80,
    "exclude-filter": metadataFilter,
  },
  countryGroup(
    "US",
    "(?i)(🇺🇸|美国|美國|United States|Los Angeles|Seattle|San Jose|New York|Dallas|Chicago|(^|[ _-])(US|USA)([ _-]|$))",
  ),
  countryGroup(
    "JP",
    "(?i)(🇯🇵|日本|Japan|Tokyo|Osaka|(^|[ _-])JP([ _-]|$))",
  ),
  countryGroup(
    "SG",
    "(?i)(🇸🇬|新加坡|Singapore|(^|[ _-])SG([ _-]|$))",
  ),
  countryGroup(
    "HK",
    "(?i)(🇭🇰|香港|Hong Kong|(^|[ _-])HK([ _-]|$))",
  ),
  countryGroup(
    "TW",
    "(?i)(🇹🇼|台湾|台灣|Taiwan|Taipei|(^|[ _-])TW([ _-]|$))",
  ),
  countryGroup(
    "KR",
    "(?i)(🇰🇷|韩国|韓國|South Korea|Seoul|(^|[ _-])KR([ _-]|$))",
  ),
  countryGroup(
    "EU",
    "(?i)(🇬🇧|🇩🇪|🇫🇷|🇳🇱|🇮🇹|🇪🇸|🇨🇭|🇪🇺|英国|英國|United Kingdom|London|德国|德國|Germany|Frankfurt|法国|法國|France|Paris|荷兰|荷蘭|Netherlands|Amsterdam|意大利|Italy|西班牙|Spain|瑞士|Switzerland|(^|[ _-])(UK|GB|DE|FR|NL|IT|ES|CH|EU)([ _-]|$))",
  ),
  {
    name: "GLOBAL",
    type: "select",
    proxies: ["AUTO", "US", "JP", "SG", "HK", "TW", "KR", "EU", "DIRECT"],
    "include-all": true,
    "exclude-filter": metadataFilter,
  },
  { name: "AI", type: "select", proxies: ["GLOBAL", "US", "JP", "SG", "TW"] },
  { name: "APPLE", type: "select", proxies: ["DIRECT", "GLOBAL", "US", "JP", "SG"] },
  { name: "STEAM", type: "select", proxies: ["DIRECT", "GLOBAL", "JP", "US", "SG"] },
  {
    name: "STEAM-DOWNLOAD",
    type: "select",
    proxies: ["DIRECT", "GLOBAL", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "STEAM-ONLINE",
    type: "select",
    proxies: ["DIRECT", "GLOBAL", "JP", "US", "SG", "HK", "TW"],
  },
  { name: "DISCORD", type: "select", proxies: ["GLOBAL", "US", "JP", "SG", "DIRECT"] },
  { name: "DEV", type: "select", proxies: ["GLOBAL", "DIRECT", "US", "JP", "SG"] },
  { name: "MEDIA", type: "select", proxies: ["GLOBAL", "US", "JP", "SG", "DIRECT"] },
  { name: "BILIBILI", type: "select", proxies: ["DIRECT", "GLOBAL", "HK", "TW", "SG"] },
  { name: "ANIGAMER", type: "select", proxies: ["TW", "GLOBAL", "DIRECT", "AUTO"] },
  { name: "SOCIAL", type: "select", proxies: ["GLOBAL", "US", "JP", "SG", "DIRECT"] },
  { name: "DEFAULT", type: "select", proxies: ["GLOBAL", "DIRECT", "AUTO"] },
] as const;

export const mihomoRules = [
  "RULE-SET,private-domain,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",
  "RULE-SET,apple-system,DIRECT",
  "RULE-SET,apple-services,APPLE",
  "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,AI",
  "PROCESS-NAME-REGEX,(?i)^claude(\\.exe)?$,AI",
  "RULE-SET,ai-openai,AI",
  "RULE-SET,ai-anthropic,AI",
  "RULE-SET,ai-xai,AI",
  "RULE-SET,ai-google,AI",
  "RULE-SET,ai-coding,AI",
  "RULE-SET,ai-general,AI",
  "RULE-SET,steam-download,STEAM-DOWNLOAD",
  "RULE-SET,steam-online,STEAM-ONLINE",
  "RULE-SET,steam,STEAM",
  "RULE-SET,discord,DISCORD",
  "RULE-SET,developer,DEV",
  "RULE-SET,bilibili,BILIBILI",
  "RULE-SET,anigamer,ANIGAMER",
  "RULE-SET,media,MEDIA",
  "RULE-SET,social,SOCIAL",
  "MATCH,DEFAULT",
] as const;
