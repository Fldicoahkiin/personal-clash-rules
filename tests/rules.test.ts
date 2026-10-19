import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createRuleSet, matchUrl } from "../src/app/lib/rule-matcher";
import { mihomoRules } from "../src/config/mihomo-policy";

const root = resolve(import.meta.dirname, "..");

async function read(relativePath: string): Promise<string> {
  return readFile(resolve(root, relativePath), "utf8");
}

describe("published rule sets", () => {
  it("keeps explicit QQ, WeChat images, observed Tencent services and NetEase Music coverage", async () => {
    const rules = await Promise.all(["tencent-messaging", "netease-music"].map(async id => createRuleSet({
      id, label: id, path: `rules/direct/${id}.list`, policy: "DIRECT",
    }, await read(`public/rules/direct/${id}.list`))));
    for (const host of ["meeting.tencent.com", "rmonitor.qq.com", "dav.qq.com", "imap.qq.com", "weixin.qq.com", "res.wx.qq.com", "thirdwx.qlogo.cn", "mmbiz.qpic.cn", "gchat.qpic.cn", "qzonestyle.gtimg.cn", "iot-tencent.com", "device.iot-tencent.com", "music.163.com", "p1.music.126.net", "m7.music.126.net"]) {
      expect(matchUrl(host, rules), host).toMatchObject({ matched: true, policy: "DIRECT" });
    }
    for (const host of ["api.openai.com", "api.anthropic.com", "example.cn", "cloud.tencent.com", "cos.ap-guangzhou.myqcloud.com", "qpic.cn.example.org", "iot-tencent.com.example.org", "news.163.com"]) {
      expect(matchUrl(host, rules), host).toMatchObject({ matched: false, policy: "DEFAULT" });
    }
    expect(rules.flatMap(set => set.rules).every(rule => ["DOMAIN", "DOMAIN-SUFFIX"].includes(rule.type))).toBe(true);
  });

  it("covers domestic video, shopping and daily apps without classifying overseas services as domestic", async () => {
    const rules = [
      createRuleSet({ id: "china-exceptions", label: "境外例外", policy: "DEFAULT", path: "rules/direct/china-exceptions.list" }, await read("public/rules/direct/china-exceptions.list")),
      createRuleSet({ id: "china-domains", label: "国内服务", policy: "DIRECT", path: "rules/direct/china-domains.list" }, await read("public/rules/direct/china-domains.list")),
    ];
    for (const host of ["www.workbuddy.cn", "www.workbuddy.ai", "acc-1258344699.cos.accelerate.myqcloud.com", "gateway.icloud.com.cn", "lf-normal-gr-sourcecdn.bytegecko.com", "h-adashx.dingtalkapps.com", "shortconnv6.im.qcloud.com", "www.douyin.com", "v3.douyinvod.com", "p3.douyinpic.com", "aweme.snssdk.com", "p3.pstatp.com", "www.kuaishou.com", "sns-webpic.xhscdn.com", "www.xiaohongshu.com", "www.taobao.com", "www.alipay.com", "img.alicdn.com", "img.360buyimg.com", "www.jd.com", "www.meituan.com", "www.amap.com", "www.12306.cn"]) {
      expect(matchUrl(host, rules), host).toMatchObject({ matched: true, policy: "DIRECT" });
    }
    for (const host of ["api.openai.com", "api.anthropic.com", "github.com", "raw.githubusercontent.com", "www.tiktok.com", "v16.byteoversea.com", "douyin.com.example.org", "gitlab-assets.oss-cn-hongkong.aliyuncs.com", "dl.acm.org"]) {
      expect(matchUrl(host, rules), host).toMatchObject({ policy: "DEFAULT" });
    }
    expect(rules.every(set => set.rules.every(rule => ["DOMAIN", "DOMAIN-SUFFIX"].includes(rule.type)))).toBe(true);
    const domestic = mihomoRules.indexOf("RULE-SET,china-domains,DIRECT");
    expect(mihomoRules[domestic - 1]).toBe("RULE-SET,china-exceptions,DEFAULT");
    for (const explicit of ["RULE-SET,ai-openai,AI", "RULE-SET,ai-coding,AI", "RULE-SET,developer,DEV", "RULE-SET,social,SOCIAL"]) {
      expect(mihomoRules.indexOf(explicit as typeof mihomoRules[number])).toBeLessThan(domestic);
    }
    expect(mihomoRules.slice(-2)).toEqual(["GEOIP,CN,DIRECT", "MATCH,DEFAULT"]);
  });

  it("routes DingTalk services and subdomains directly without accepting lookalike suffixes", async () => {
    const rules = [createRuleSet({ id: "china-domains", label: "国内服务", policy: "DIRECT", path: "rules/direct/china-domains.list" }, await read("public/rules/direct/china-domains.list"))];
    for (const host of ["ddurl.to", "dingding.xin", "dingstore.cn", "dingtalk.cn", "dingtalk.com", "dingtalk.net", "dingtalkapps.com", "dingtalkcloud.com", "laiwang.com", "lwurl.to", "ztna-dingtalk.com", "login.dingtalk.com", "static.dingtalkapps.com"]) {
      expect(matchUrl(host, rules), host).toMatchObject({ matched: true, policy: "DIRECT" });
    }
    for (const host of ["dingtalk.com.example.org", "notdingtalk.com", "evil-dingtalkapps.com", "api.openai.com", "github.com", "www.tiktok.com"]) {
      expect(matchUrl(host, rules), host).toMatchObject({ matched: false, policy: "DEFAULT" });
    }
  });

  it("keeps Claude authentication, content and specific intake hosts on the AI policy", async () => {
    const rules = [createRuleSet({
      id: "ai-anthropic", label: "Claude", policy: "AI", path: "rules/ai/anthropic.list",
    }, await read("public/rules/ai/anthropic.list"))];

    for (const hostname of [
      "api.anthropic.com",
      "downloads.claude.ai",
      "bridge.claudeusercontent.com",
      "widget.claudemcpcontent.com",
      "servd-anthropic-website.b-cdn.net",
      "anthropic.com.cdn.cloudflare.net",
      "anthropic.auth0.com",
      "anthropic-com.ghost.io",
      "http-intake.logs.us5.datadoghq.com",
      "browser-intake-us5-datadoghq.com",
      "cdn.usefathom.com",
    ]) {
      expect(matchUrl(hostname, rules), hostname).toMatchObject({ matched: true, policy: "AI" });
    }
  });

  it("does not assign unrelated shared-service traffic to the Claude policy", async () => {
    const rules = [createRuleSet({
      id: "ai-anthropic", label: "Claude", policy: "AI", path: "rules/ai/anthropic.list",
    }, await read("public/rules/ai/anthropic.list"))];

    for (const hostname of [
      "api.datadoghq.com",
      "browser-intake-us3-datadoghq.com",
      "cdn.sift.com",
      "events.sentry.io",
      "api.intercom.io",
      "events.statsigapi.net",
      "another.auth0.com",
      "anthropic.auth0.com.example.org",
    ]) {
      expect(matchUrl(hostname, rules), hostname).toMatchObject({ matched: false, policy: "DEFAULT" });
    }
  });

  it("contains the requested AI, gaming, media and Discord coverage", async () => {
    const [
      openai,
      anthropic,
      xai,
      coding,
      steam,
      steamDownload,
      steamOnline,
      bilibili,
      anigamer,
      discord,
    ] = await Promise.all([
      read("public/rules/ai/openai.list"),
      read("public/rules/ai/anthropic.list"),
      read("public/rules/ai/xai.list"),
      read("public/rules/ai/coding.list"),
      read("public/rules/gaming/steam.list"),
      read("public/rules/gaming/steam-download.list"),
      read("public/rules/gaming/steam-online.list"),
      read("public/rules/media/bilibili.list"),
      read("public/rules/media/anigamer.list"),
      read("public/rules/messaging/discord.list"),
    ]);

    expect(openai).toContain("DOMAIN-SUFFIX,openai.com");
    expect(anthropic).toContain("DOMAIN-SUFFIX,claude.ai");
    expect(xai).toContain("DOMAIN-SUFFIX,grok.com");
    expect(coding).toContain("DOMAIN-SUFFIX,githubcopilot.com");
    expect(steam).toContain("DOMAIN-SUFFIX,steampowered.com");
    expect(steamDownload).toContain("DOMAIN-SUFFIX,steamcontent.com");
    expect(steamOnline).toContain("DOMAIN-SUFFIX,steamserver.net");
    expect(bilibili).toContain("DOMAIN-SUFFIX,bilibili.com");
    expect(anigamer).toContain("DOMAIN-SUFFIX,gamer.com.tw");
    expect(discord).toContain("DOMAIN-SUFFIX,discord.com");
  });

  it("separates selectable Apple services from direct system endpoints", async () => {
    const [services, system] = await Promise.all([
      read("public/rules/apple/services.list"),
      read("public/rules/apple/system.list"),
    ]);

    expect(services).toContain("DOMAIN,gsa.apple.com");
    expect(services).toContain("DOMAIN,account.apple.com");
    expect(services).toContain("DOMAIN-SUFFIX,icloud.com");
    expect(services).toContain("DOMAIN,apple-relay.cloudflare.com");
    expect(system).toContain("DOMAIN,captive.apple.com");
    expect(system).toContain("DOMAIN-SUFFIX,push.apple.com");
    expect(system).toContain("DOMAIN,ocsp.apple.com");
    expect(`${services}\n${system}`).not.toContain("icloud.com.cn");
    expect(`${services}\n${system}`).not.toContain("apzones.com");
  });

  it("keeps every text rule valid, unique and free of v2fly attributes", async () => {
    const manifest = parse(await read("public/rules/manifest.yaml")) as {
      ruleSets: Array<{ path: string }>;
    };

    for (const entry of manifest.ruleSets) {
      const content = await read(`public/${entry.path}`);
      const lines = content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));

      expect(new Set(lines).size, entry.path).toBe(lines.length);
      expect(content, entry.path).not.toContain("@cn");
      expect(content, entry.path).not.toContain("@ads");
      for (const line of lines) {
        expect(
          /^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|DOMAIN-REGEX|IP-CIDR|IP-CIDR6),[^,]+$/u.test(
            line,
          ),
          `${entry.path}: ${line}`,
        ).toBe(true);
      }
    }
  });
});
