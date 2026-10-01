import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuildDetails } from "../src/app/components/BuildDetails";
import { isBuildInfo, isVersionInfo, type BuildInfo } from "../src/config/build-info";

const build: BuildInfo = {
  builtAt: "2026-10-02T01:00:00.000Z",
  commit: "e0588bb" + "0".repeat(33),
  dirty: false,
};
const version = { build, deployment: { createdAt: "2026-10-02T01:05:00.000Z", id: "version-id" } };

describe("build and deployment metadata", () => {
  it("validates metadata without accepting malformed timestamps or commit links", () => {
    expect(isBuildInfo(build)).toBe(true);
    expect(isVersionInfo(version)).toBe(true);
    expect(isVersionInfo({ build, deployment: null })).toBe(true);
    expect(isVersionInfo({ build })).toBe(false);
    expect(isBuildInfo({ ...build, builtAt: "invalid" })).toBe(false);
    expect(isBuildInfo({ ...build, commit: "https://example.com" })).toBe(false);
    expect(isVersionInfo({ ...version, deployment: { createdAt: "invalid", id: "id" } })).toBe(false);
  });

  it("renders distinct build and deployment timestamps in UTC+8 with the exact commit link", () => {
    const html = renderToStaticMarkup(createElement(BuildDetails, { build, version }));
    expect(html).toContain("2026-10-02 09:00:00");
    expect(html).toContain("2026-10-02 09:05:00");
    expect(html).toContain(`dateTime="${version.deployment.createdAt}"`);
    expect(html).toContain(`https://github.com/Fldicoahkiin/personal-clash-rules/commit/${build.commit}`);
    expect(html).toContain(">e0588bb</a>");
    expect(html).toContain("UTC+8");
    expect(html).not.toContain("页面与后端版本不同");
  });

  it("does not invent a deployment time for local builds, unavailable metadata or failures", () => {
    const local = renderToStaticMarkup(createElement(BuildDetails, { build, version: { build, deployment: null } }));
    expect(local).toContain("未部署");
    const unavailable = renderToStaticMarkup(createElement(BuildDetails, {
      build, version: { build, deployment: { createdAt: null, id: "id" } },
    }));
    expect(unavailable).toContain("未提供");
    const failed = renderToStaticMarkup(createElement(BuildDetails, { build, version: null, failed: true }));
    expect(failed).toContain("读取失败");
    expect(failed).not.toContain("未部署");
  });

  it("identifies an old page even when the same commit was rebuilt", () => {
    const html = renderToStaticMarkup(createElement(BuildDetails, {
      build, version: { ...version, build: { ...build, builtAt: "2026-10-02T02:00:00.000Z" } },
    }));
    expect(html).toContain("页面与后端版本不同，请刷新页面");
  });

  it("marks uncommitted local work and development previews", () => {
    const html = renderToStaticMarkup(createElement(BuildDetails, {
      build: { ...build, dirty: true, builtAt: null }, version: null,
    }));
    expect(html).toContain("本地修改");
    expect(html).toContain("开发模式");
    expect(html).toContain("读取中…");
  });
});
