const publishedRuleFiles = {
  "private-domain": "local/private-domain.list",
  "private-ip": "local/private-ip.list",
  "tencent-messaging": "direct/tencent-messaging.list",
  "netease-music": "direct/netease-music.list",
  "china-exceptions": "direct/china-exceptions.list",
  "china-domains": "direct/china-domains.list",
  "apple-download": "apple/download.list",
  "apple-system": "apple/system.list",
  "apple-services": "apple/services.list",
  "apple-icloud": "apple/icloud.list",
  "apple-media": "apple/media.list",
  "apple-intelligence": "apple/intelligence.list",
  "ai-openai": "ai/openai.list",
  "ai-anthropic": "ai/anthropic.list",
  "ai-anthropic-ip": "ai/anthropic-ip.list",
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
  telegram: "social/telegram.list",
  x: "social/x.list",
  reddit: "social/reddit.list",
  instagram: "social/instagram.list",
  facebook: "social/facebook.list",
  linkedin: "social/linkedin.list",
  tiktok: "social/tiktok.list",
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

// Mihomo matches classical providers rule by rule; its copy of the large domestic list uses the domain behavior instead.
export const mihomoProfileRuleProviders = {
  ...mihomoRuleProviders,
  "china-domains": {
    type: "http",
    behavior: "domain",
    format: "text",
    url: "https://rules.flacier.com/rules/mihomo/china-domains.txt",
    path: "./ruleset/personal/china-domains.domain.txt",
    interval: 86_400,
  },
};

export const metadataFilter = "(?i)(剩余|流量|到期|官网|客服|订阅)";
export const mihomoPolicyDisplayNames: Record<string, string> = {
  GLOBAL: "GLOBAL", AUTO: "♻️ 自动选择", AI: "🤖 AI", CLAUDE: "🧠 Claude", APPLE: "🍎 Apple",
  ICLOUD: "☁️ iCloud", "APPLE-MEDIA": "🎧 Apple 媒体", "APPLE-INTELLIGENCE": "✨ Apple 智能",
  "APPLE-DOWNLOAD": "📥 Apple 下载", "APPLE-SYSTEM": "⚙️ Apple 系统",
  STEAM: "🎮 Steam", "STEAM-DOWNLOAD": "📥 Steam 下载", "STEAM-ONLINE": "🕹️ Steam 联机",
  DISCORD: "💬 Discord", DEV: "🛠️ 开发服务", MEDIA: "🎬 流媒体", BILIBILI: "📺 哔哩哔哩",
  ANIGAMER: "📺 巴哈姆特", DEFAULT: "🐟 未匹配流量",
  TELEGRAM: "✈️ Telegram", X: "💬 X", REDDIT: "🗨️ Reddit", INSTAGRAM: "📷 Instagram",
  FACEBOOK: "👥 Facebook", LINKEDIN: "💼 LinkedIn", TIKTOK: "🎵 TikTok",
};

// Other groups carry an emoji in their names; GLOBAL must keep Mihomo's reserved name, so only it keeps its icon.
export function displayMihomoGroup(group: { name: string; proxies?: readonly string[]; icon?: string }) {
  const { icon, ...rest } = group;
  return {
    ...rest,
    name: mihomoPolicyDisplayNames[group.name] ?? group.name,
    ...(group.proxies ? { proxies: group.proxies.map(name => mihomoPolicyDisplayNames[name] ?? name) } : {}),
    ...(group.name === "GLOBAL" && icon ? { icon } : {}),
  };
}

export function displayMihomoRule(rule: string): string {
  const parts = rule.split(",");
  const index = parts.at(-1) === "no-resolve" ? parts.length - 2 : parts.length - 1;
  parts[index] = mihomoPolicyDisplayNames[parts[index]] ?? parts[index];
  return parts.join(",");
}
const policyIconBase = "https://rules.flacier.com/policy-icons";
export const countryGroupNames: Record<string, string> = {
  US: "🇺🇸 美国", JP: "🇯🇵 日本", SG: "🇸🇬 新加坡", HK: "🇭🇰 香港",
  TW: "🇨🇳 台湾", KR: "🇰🇷 韩国", EU: "🇪🇺 欧洲",
};

export const countryNodeFilters = {
  US: "🇺🇸|美国|美國|United States|Los Angeles|Seattle|San Jose|New York|Dallas|Chicago|(^|[ _-])(US|USA)([ _-]|$)",
  JP: "🇯🇵|日本|Japan|Tokyo|Osaka|(^|[ _-])JP([ _-]|$)",
  SG: "🇸🇬|新加坡|Singapore|(^|[ _-])SG([ _-]|$)",
  HK: "🇭🇰|香港|Hong Kong|(^|[ _-])HK([ _-]|$)",
  TW: "🇹🇼|台湾|台灣|Taiwan|Taipei|(^|[ _-])TW([ _-]|$)",
  KR: "🇰🇷|韩国|韓國|South Korea|Seoul|(^|[ _-])KR([ _-]|$)",
  GB: "🇬🇧|英国|英國|United Kingdom|London|(?:^|[ _-])(?:UK|GB)(?:[ _-]|$)",
  DE: "🇩🇪|德国|德國|Germany|Frankfurt|(?:^|[ _-])DE(?:[ _-]|$)",
  FR: "🇫🇷|法国|法國|France|Paris|(?:^|[ _-])FR(?:[ _-]|$)",
  NL: "🇳🇱|荷兰|荷蘭|Netherlands|Amsterdam|(?:^|[ _-])NL(?:[ _-]|$)",
  IT: "🇮🇹|意大利|Italy|(?:^|[ _-])IT(?:[ _-]|$)",
  ES: "🇪🇸|西班牙|Spain|(?:^|[ _-])ES(?:[ _-]|$)",
  CH: "🇨🇭|瑞士|Switzerland|(?:^|[ _-])CH(?:[ _-]|$)",
  CA: "🇨🇦|加拿大|Canada|Toronto|Vancouver|(?:^|[ _-])CA(?:[ _-]|$)",
  AU: "🇦🇺|澳大利亚|澳大利亞|Australia|Sydney|Melbourne|(?:^|[ _-])AU(?:[ _-]|$)",
  RU: "🇷🇺|俄罗斯|俄羅斯|Russia|Moscow|(?:^|[ _-])RU(?:[ _-]|$)",
  IN: "🇮🇳|印度|India|Mumbai|(?:^|[ _-])IN(?:[ _-]|$)",
  BR: "🇧🇷|巴西|Brazil|São Paulo|Sao Paulo|(?:^|[ _-])BR(?:[ _-]|$)",
  VN: "🇻🇳|越南|Vietnam|(?:^|[ _-])VN(?:[ _-]|$)",
  TH: "🇹🇭|泰国|泰國|Thailand|Bangkok|(?:^|[ _-])TH(?:[ _-]|$)",
  MY: "🇲🇾|马来西亚|馬來西亞|Malaysia|Kuala Lumpur|(?:^|[ _-])MY(?:[ _-]|$)",
  ID: "🇮🇩|印度尼西亚|印度尼西亞|Indonesia|Jakarta|(?:^|[ _-])ID(?:[ _-]|$)",
  PH: "🇵🇭|菲律宾|菲律賓|Philippines|Manila|(?:^|[ _-])PH(?:[ _-]|$)",
} as const;

export const countryFlagRules = [
  { flag: "🇺🇸", filter: countryNodeFilters.US },
  { flag: "🇯🇵", filter: countryNodeFilters.JP },
  { flag: "🇸🇬", filter: countryNodeFilters.SG },
  { flag: "🇭🇰", filter: countryNodeFilters.HK },
  { flag: "🇨🇳", filter: countryNodeFilters.TW },
  { flag: "🇰🇷", filter: countryNodeFilters.KR },
  { flag: "🇬🇧", filter: countryNodeFilters.GB },
  { flag: "🇩🇪", filter: countryNodeFilters.DE },
  { flag: "🇫🇷", filter: countryNodeFilters.FR },
  { flag: "🇳🇱", filter: countryNodeFilters.NL },
  { flag: "🇮🇹", filter: countryNodeFilters.IT },
  { flag: "🇪🇸", filter: countryNodeFilters.ES },
  { flag: "🇨🇭", filter: countryNodeFilters.CH },
  { flag: "🇨🇦", filter: countryNodeFilters.CA },
  { flag: "🇦🇺", filter: countryNodeFilters.AU },
  { flag: "🇷🇺", filter: countryNodeFilters.RU },
  { flag: "🇮🇳", filter: countryNodeFilters.IN },
  { flag: "🇧🇷", filter: countryNodeFilters.BR },
  { flag: "🇻🇳", filter: countryNodeFilters.VN },
  { flag: "🇹🇭", filter: countryNodeFilters.TH },
  { flag: "🇲🇾", filter: countryNodeFilters.MY },
  { flag: "🇮🇩", filter: countryNodeFilters.ID },
  { flag: "🇵🇭", filter: countryNodeFilters.PH },
] as const;

function countryGroup(name: string, filter: string) {
  return {
    name,
    type: "select",
    "include-all": true,
    "exclude-type": "direct",
    filter,
    "exclude-filter": metadataFilter,
    icon: `${policyIconBase}/region.svg`,
  };
}

export const businessProxyGroupNames = [
  "AI", "CLAUDE", "APPLE", "ICLOUD", "APPLE-MEDIA", "APPLE-INTELLIGENCE", "APPLE-DOWNLOAD", "APPLE-SYSTEM",
  "STEAM", "STEAM-DOWNLOAD", "STEAM-ONLINE", "DISCORD",
  "DEV", "MEDIA", "BILIBILI", "ANIGAMER", "TELEGRAM", "X", "REDDIT", "INSTAGRAM",
  "FACEBOOK", "LINKEDIN", "TIKTOK", "DEFAULT",
] as const;

function businessGroup(name: typeof businessProxyGroupNames[number], icon: string, initial = "GLOBAL") {
  return {
    name,
    type: "select",
    proxies: [...new Set([initial, "GLOBAL", "AUTO", ...Object.keys(countryGroupNames), "DIRECT"])],
    "include-all": true,
    "exclude-filter": metadataFilter,
    icon: `${policyIconBase}/${icon}.svg`,
  };
}

export const mihomoProxyGroups = [
  {
    name: "GLOBAL",
    type: "select",
    proxies: ["AUTO", "US", "JP", "SG", "HK", "TW", "KR", "EU", "DIRECT"],
    "include-all": true,
    "exclude-filter": metadataFilter,
    icon: `${policyIconBase}/globe.svg`,
  },
  {
    name: "AUTO",
    type: "url-test",
    "include-all": true,
    "exclude-type": "direct",
    url: "https://cp.cloudflare.com/generate_204",
    interval: 300,
    tolerance: 80,
    "exclude-filter": metadataFilter,
    icon: `${policyIconBase}/auto.svg`,
  },
  countryGroup(
    "US",
    `(?i)(${countryNodeFilters.US})`,
  ),
  countryGroup(
    "JP",
    `(?i)(${countryNodeFilters.JP})`,
  ),
  countryGroup(
    "SG",
    `(?i)(${countryNodeFilters.SG})`,
  ),
  countryGroup(
    "HK",
    `(?i)(${countryNodeFilters.HK})`,
  ),
  countryGroup(
    "TW",
    `(?i)(${countryNodeFilters.TW})`,
  ),
  countryGroup(
    "KR",
    `(?i)(${countryNodeFilters.KR})`,
  ),
  countryGroup(
    "EU",
    "(?i)(🇬🇧|🇩🇪|🇫🇷|🇳🇱|🇮🇹|🇪🇸|🇨🇭|🇪🇺|英国|英國|United Kingdom|London|德国|德國|Germany|Frankfurt|法国|法國|France|Paris|荷兰|荷蘭|Netherlands|Amsterdam|意大利|Italy|西班牙|Spain|瑞士|Switzerland|(^|[ _-])(UK|GB|DE|FR|NL|IT|ES|CH|EU)([ _-]|$))",
  ),
  businessGroup("AI", "ai"),
  businessGroup("CLAUDE", "ai", "AI"),
  businessGroup("APPLE", "apple"),
  businessGroup("ICLOUD", "apple"),
  businessGroup("APPLE-MEDIA", "play"),
  businessGroup("APPLE-INTELLIGENCE", "ai"),
  businessGroup("APPLE-DOWNLOAD", "download", "DIRECT"),
  businessGroup("APPLE-SYSTEM", "apple", "DIRECT"),
  businessGroup("STEAM", "steam"),
  businessGroup("STEAM-DOWNLOAD", "download"),
  businessGroup("STEAM-ONLINE", "game"),
  businessGroup("DISCORD", "chat"),
  businessGroup("DEV", "code"),
  businessGroup("MEDIA", "play"),
  businessGroup("BILIBILI", "play", "DIRECT"),
  businessGroup("ANIGAMER", "play", "TW"),
  businessGroup("TELEGRAM", "chat"),
  businessGroup("X", "chat"),
  businessGroup("REDDIT", "chat"),
  businessGroup("INSTAGRAM", "chat"),
  businessGroup("FACEBOOK", "chat"),
  businessGroup("LINKEDIN", "chat"),
  businessGroup("TIKTOK", "play"),
  businessGroup("DEFAULT", "route"),
].map(group => ({
  ...group,
  name: countryGroupNames[group.name] ?? group.name,
  ...("proxies" in group && group.proxies ? { proxies: group.proxies.map(name => countryGroupNames[name] ?? name) } : {}),
  "empty-fallback": "REJECT" as const,
}));

export const mihomoRules = [
  "DOMAIN-SUFFIX,todesk.com,DIRECT",
  "DOMAIN-SUFFIX,todesk.cn,DIRECT",
  "DOMAIN-SUFFIX,alipay.com,DIRECT",
  "DOMAIN-SUFFIX,alipayobjects.com,DIRECT",
  "DOMAIN-SUFFIX,alicdn.com,DIRECT",
  "DOMAIN-SUFFIX,jinhefilm.com,DIRECT",
  "RULE-SET,private-domain,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",
  "RULE-SET,tencent-messaging,DIRECT",
  "RULE-SET,netease-music,DIRECT",
  // Classical lists match in order: the download hosts sit inside the store and iCloud suffixes.
  "RULE-SET,apple-download,APPLE-DOWNLOAD",
  "RULE-SET,apple-system,APPLE-SYSTEM",
  "RULE-SET,apple-services,APPLE",
  "RULE-SET,apple-icloud,ICLOUD",
  "RULE-SET,apple-media,APPLE-MEDIA",
  "RULE-SET,apple-intelligence,APPLE-INTELLIGENCE",
  // Domestic domains go direct before the AI process rules. The two groups below overlap the
  // domestic list or its exceptions and keep their own selectable policy ahead of them.
  "RULE-SET,steam-download,STEAM-DOWNLOAD",
  "RULE-SET,bilibili,BILIBILI",
  "RULE-SET,china-exceptions,DEFAULT",
  "RULE-SET,china-domains,DIRECT",
  "PROCESS-NAME-REGEX,(?i)^claude(\\.exe)?$,CLAUDE",
  "RULE-SET,ai-anthropic,CLAUDE",
  "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,AI",
  "RULE-SET,ai-openai,AI",
  "RULE-SET,ai-xai,AI",
  "RULE-SET,ai-google,AI",
  "RULE-SET,ai-coding,AI",
  "RULE-SET,ai-general,AI",
  "RULE-SET,steam-online,STEAM-ONLINE",
  "RULE-SET,steam,STEAM",
  "RULE-SET,discord,DISCORD",
  "RULE-SET,developer,DEV",
  "RULE-SET,anigamer,ANIGAMER",
  "RULE-SET,media,MEDIA",
  "RULE-SET,telegram,TELEGRAM",
  "RULE-SET,x,X",
  "RULE-SET,reddit,REDDIT",
  "RULE-SET,instagram,INSTAGRAM",
  "RULE-SET,facebook,FACEBOOK",
  "RULE-SET,linkedin,LINKEDIN",
  "RULE-SET,tiktok,TIKTOK",
  "RULE-SET,ai-anthropic-ip,CLAUDE,no-resolve",
  "GEOIP,CN,DIRECT",
  "MATCH,DEFAULT",
] as const;

// Mihomo skips a matched rule when the selected exit cannot carry UDP and, with nothing left, sends the packet DIRECT
// from the home address. Only such UDP reaches rules after MATCH: it goes through the automatic proxy group instead,
// and is refused only when that group's pick cannot carry UDP either, so it never falls back to DIRECT.
export const mihomoUdpFallbackRules = [
  "NETWORK,UDP,AUTO",
  "NETWORK,UDP,REJECT",
] as const;

// Exact executable names from the installed macOS apps, including their network helpers.
// These cover IP-only connections without sending an entire shared cloud range directly.
export const mihomoProfileRules = [
  "PROCESS-NAME,ToDesk,DIRECT",
  "PROCESS-NAME,ToDesk_Service,DIRECT",
  "PROCESS-NAME,ToDesk_Session,DIRECT",
  "PROCESS-NAME,ToDesk_Session_Proxy,DIRECT",
  "PROCESS-NAME,ToDesk_Screenwall_Helper,DIRECT",
  "PROCESS-NAME,ToDesk_XPCHelper,DIRECT",
  "PROCESS-NAME,ToDesk.exe,DIRECT",
  "PROCESS-NAME,ToDesk_Service.exe,DIRECT",
  "PROCESS-NAME,WeChat,DIRECT",
  "PROCESS-NAME,WeChatAppEx,DIRECT",
  "PROCESS-NAME,WeChatAppEx Helper,DIRECT",
  "PROCESS-NAME,QQ,DIRECT",
  "PROCESS-NAME,QQ Helper,DIRECT",
  "PROCESS-NAME,NeteaseMusic,DIRECT",
  "PROCESS-NAME,NeteaseMusic Helper,DIRECT",
  ...mihomoRules,
  ...mihomoUdpFallbackRules,
] as const;
