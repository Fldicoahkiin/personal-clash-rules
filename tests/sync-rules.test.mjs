import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { convertChinaDomains, convertDomainList, syncRules } from "../scripts/sync-rules.mjs";

afterEach(() => vi.unstubAllGlobals());

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

  it("does not import overseas attributes or silently drop selective include semantics", () => {
    expect(convertDomainList("domain:xiaohongshu.com\nrednote.com @!cn\ntracking.example @ads", ["!cn"]).rules)
      .toEqual(["DOMAIN-SUFFIX,xiaohongshu.com"]);
    expect(() => convertDomainList("include:bytedance @-!cn")).toThrow("Selective v2fly includes");
  });
});

describe("domestic rule sync", () => {
  it("retains supported domains and reports omitted regex rules instead of applying broad keywords", () => {
    expect(convertChinaDomains("# source\nDOMAIN-SUFFIX,douyin.com\nDOMAIN,lf3-static.bytednsdoc.com\nDOMAIN-REGEX,^test\\.cn$\nDOMAIN-SUFFIX,douyin.com"))
      .toEqual({ rules: ["DOMAIN-SUFFIX,douyin.com", "DOMAIN,lf3-static.bytednsdoc.com"], omitted: ["DOMAIN-REGEX,^test\\.cn$"] });
    for (const body of ["", "# empty", "<html>upstream error</html>", "DOMAIN-KEYWORD,microsoft", "DOMAIN-SUFFIX,example.com,DIRECT"]) {
      expect(() => convertChinaDomains(body), body).toThrow();
    }
  });

  it.each(["empty", "denied", "network", "html", "non-text", "oversize-header", "oversize-body"])("preserves every published snapshot when a domestic source is %s", async failure => {
    const root = await mkdtemp(resolve(tmpdir(), "flacier-rule-sync-"));
    const files = ["public/rules/media/bilibili.list", "public/rules/media/anigamer.list", "public/rules/direct/china-domains.list"];
    for (const file of files) {
      await mkdir(dirname(resolve(root, file)), { recursive: true });
      await writeFile(resolve(root, file), "# previous valid snapshot\nDOMAIN-SUFFIX,existing.example\n");
    }
    vi.stubGlobal("fetch", vi.fn(async url => {
      if (String(url).includes("geolocation-cn")) {
        if (failure === "network") throw new Error("upstream disconnected");
        if (failure === "html") return new Response("<html>denied</html>");
        if (failure === "non-text") return new Response("DOMAIN-SUFFIX,example.com", { headers: { "Content-Type": "application/octet-stream" } });
        if (failure === "oversize-header") return new Response("DOMAIN-SUFFIX,example.com", { headers: { "Content-Length": "1048577" } });
        if (failure === "oversize-body") return new Response("#".repeat(1048577), { headers: { "Content-Length": "1" } });
        return new Response("", { status: failure === "denied" ? 403 : 200 });
      }
      return new Response("replacement.example\n");
    }));
    await expect(syncRules(root)).rejects.toThrow();
    for (const file of files) {
      expect(await readFile(resolve(root, file), "utf8")).toBe("# previous valid snapshot\nDOMAIN-SUFFIX,existing.example\n");
    }
  });

  it("publishes bounded domains with provenance, preserving attribute filters through includes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "flacier-rule-sync-"));
    const bodies = {
      "geolocation-cn.list": "DOMAIN-SUFFIX,douyin.com\nDOMAIN-REGEX,^limited\\.cn$",
      xiaohongshu: "include:askdiandian\nxiaohongshu.com\nrednote.com @!cn",
      askdiandian: "askdiandian.com\nforeign.example @!cn",
      amap: "amap.com\ntracking.example @ads",
      dingtalk: "dingtalk.com\ndingtalkapps.com\nforeign-dingtalk.example @!cn",
      bytedance: "include:tiktok\nsnssdk.com\ntiktok.com\nbyteoversea.com @!cn",
      alibaba: "include:alibabacloud\ntaobao.com\nalipay.com\naliexpress.com",
      aliyun: "alicdn.com\noss-us-west-1.aliyuncs.com @!cn",
      jd: "jd.com\njd.id @!cn",
    };
    vi.stubGlobal("fetch", vi.fn(async url => new Response(bodies[String(url).split("/").at(-1)] ?? "bilibili.com")));
    await syncRules(root);
    const content = await readFile(resolve(root, "public/rules/direct/china-domains.list"), "utf8");
    expect(content).toContain("# Omitted 1 DOMAIN-REGEX");
    expect(content).toMatch(/# Source SHA-256: [a-f0-9]{64}/u);
    for (const domain of ["douyin.com", "xiaohongshu.com", "askdiandian.com", "amap.com", "dingtalk.com", "dingtalkapps.com", "snssdk.com", "taobao.com", "alipay.com", "alicdn.com", "jd.com"]) {
      expect(content).toContain(`DOMAIN-SUFFIX,${domain}\n`);
    }
    for (const domain of ["tiktok.com", "byteoversea.com", "rednote.com", "foreign.example", "foreign-dingtalk.example", "tracking.example", "aliexpress.com", "jd.id", "oss-us-west-1.aliyuncs.com"]) {
      expect(content).not.toContain(`DOMAIN-SUFFIX,${domain}`);
    }
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/tiktok"), expect.anything());
  });
});
