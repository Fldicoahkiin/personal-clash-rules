export const ruleTemplates = [
  { id: "flacier", name: "Flacier 分流", url: "" },
  { id: "acl4ssr", name: "ACL4SSR · 默认", url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini" },
  { id: "acl4ssr-multicountry", name: "ACL4SSR · 多国分组", url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_MultiCountry.ini" },
  { id: "acl4ssr-noauto", name: "ACL4SSR · 无自动测速", url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_NoAuto.ini" },
  { id: "custom", name: "自定义远程规则 · INI", url: "" },
] as const;
export type RuleTemplateId = (typeof ruleTemplates)[number]["id"];
