import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");

async function read(relativePath: string): Promise<string> {
  return readFile(resolve(root, relativePath), "utf8");
}

describe("published rule sets", () => {
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
