export type RulePreview = {
  name: string;
  fingerprint: string;
  ruleSets: Array<{ id: string; label: string; path: string; policy: string; content: string }>;
  groups: Array<{ name: string; type: string; proxies?: string[] }>;
};
