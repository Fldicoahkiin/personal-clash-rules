import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "../src/app/App";
import { SubscriptionResult } from "../src/app/components/SubscriptionResult";
import { completeConfigFormats } from "../src/app/features/subscriptions/client-formats";

let page = "";

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "https://rules.flacier.com", hostname: "rules.flacier.com", protocol: "https:" } });
  vi.stubGlobal("__BUILD_INFO__", { builtAt: null, commit: null, dirty: false });
  page = renderToStaticMarkup(createElement(App));
  vi.unstubAllGlobals();
});

function positionOf(fragment: string): number {
  const index = page.indexOf(fragment);
  expect(index, fragment).toBeGreaterThan(-1);
  return index;
}

describe("home page", () => {
  it("puts subscription conversion before secondary tools", () => {
    expect(positionOf('id="subscription"')).toBeLessThan(positionOf('id="network"'));
    expect(positionOf('id="network"')).toBeLessThan(positionOf('id="tester"'));
    expect(positionOf('id="tester"')).toBeLessThan(positionOf('id="converter"'));
  });

  it("links to external DNS, WebRTC, IPv6 and connection checks", () => {
    for (const href of ["https://browserleaks.com/dns", "https://browserleaks.com/webrtc", "https://test-ipv6.com/", "https://1.1.1.1/help"]) {
      expect(page).toContain(`href="${href}"`);
    }
  });

  it("uses GitHub's official mark and has no management navigation", () => {
    expect(page).toContain('src="/brand/github-mark.svg"');
    expect(page).not.toContain('href="/manage');
  });

  it("prefills the product name as an editable value", () => {
    expect(page).toContain('<h1 id="subscription-title">Flacierの订阅转换</h1>');
    expect(page).toMatch(/<input[^>]*value="Flacierの分流规则"/u);
    expect(page).not.toContain('placeholder="留空时使用');
    expect(readFileSync(new URL("../index.html", import.meta.url), "utf8")).toContain("<title>Flacierの订阅转换</title>");
  });

  it("draws the route tester as a plain line and keeps the name below the source", () => {
    expect(page).toContain('class="route-line"');
    expect(page).not.toMatch(/railway|signal/iu);
    expect(positionOf("subscription-source")).toBeLessThan(positionOf("subscription-name"));
  });

  it("renders the result link with separate copy and action areas", () => {
    const result = renderToStaticMarkup(createElement(SubscriptionResult, {
      copied: false, onCopy: () => undefined,
      format: completeConfigFormats.find(format => format.target === "clash-party-config")!,
      result: {
        target: "clash-party-config", sourceMode: "convert", profileName: "Flacier",
        nodeStats: { read: 1, output: 1, skipped: 0 }, usage: { combined: null, sources: [] },
        url: "https://rules.flacier.com/s/abcdefghijklmnop/clash-party-config", universalUrl: "https://rules.flacier.com/s/abcdefghijklmnop",
      },
    }));
    expect(result).toContain('class="subscription-result-copy"');
    expect(result).toContain('class="subscription-result-actions"');
  });
});
