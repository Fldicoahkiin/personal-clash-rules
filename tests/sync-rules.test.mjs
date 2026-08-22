import { describe, expect, it } from "vitest";

import { convertDomainList } from "../scripts/sync-rules.mjs";

describe("v2fly rule sync", () => {
  it("converts domain entries and keeps includes separate", () => {
    const result = convertDomainList(`
include:bilibili-game
bilibili.com @cn
full:api.bilibili.com
keyword:bilibili
regexp:^bili.+$
tracking.example @ads
`);

    expect(result).toEqual({
      includes: ["bilibili-game"],
      rules: [
        "DOMAIN-SUFFIX,bilibili.com",
        "DOMAIN,api.bilibili.com",
        "DOMAIN-KEYWORD,bilibili",
        "DOMAIN-REGEX,^bili.+$",
      ],
    });
  });
});
