import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function projectFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("home page flow", () => {
  it("puts subscription conversion before secondary tools", () => {
    const app = projectFile("src/app/App.tsx");

    expect(app.indexOf("<SubscriptionImport />")).toBeGreaterThan(-1);
    expect(app.indexOf("<SubscriptionImport />")).toBeLessThan(
      app.indexOf("<RouteTester />"),
    );
    expect(app.indexOf("<NetworkChecks />")).toBeLessThan(
      app.indexOf("<RouteTester />"),
    );
    expect(app.indexOf("<RouteTester />")).toBeLessThan(
      app.indexOf("<ConverterWorkspace />"),
    );
  });

  it("links to external DNS, WebRTC, IPv6 and connection checks", () => {
    const checks = projectFile("src/app/components/NetworkChecks.tsx");

    expect(checks).toContain("https://browserleaks.com/dns");
    expect(checks).toContain("https://browserleaks.com/webrtc");
    expect(checks).toContain("https://test-ipv6.com/");
    expect(checks).toContain("https://1.1.1.1/help");
  });

  it("uses GitHub's official Primer mark instead of a third-party glyph", () => {
    const header = projectFile("src/app/components/AppHeader.tsx");
    const app = projectFile("src/app/App.tsx");

    for (const source of [header, app]) {
      expect(source).toContain('/brand/github-mark.svg');
      expect(source).not.toContain("GithubLogo");
    }
  });

  it("has no management navigation or management route", () => {
    const header = projectFile("src/app/components/AppHeader.tsx");
    const root = projectFile("src/app/Root.tsx");

    expect(header).not.toContain("/manage");
    expect(root).not.toContain("SubscriptionConsole");
  });

  it("uses the Flacier product name as an editable value instead of placeholder text", () => {
    const header = projectFile("src/app/components/AppHeader.tsx");
    const form = projectFile("src/app/components/SubscriptionImport.tsx");
    const html = projectFile("index.html");

    expect(header).toContain("Flacierの订阅转换");
    expect(form).toContain('<h1 id="subscription-title">Flacierの订阅转换</h1>');
    expect(form).toContain('name: "Flacierの分流规则"');
    expect(form).not.toContain('placeholder="留空时使用');
    expect(html).toContain("<title>Flacierの订阅转换</title>");
  });

  it("uses a plain connecting line in the route tester", () => {
    const tester = projectFile("src/app/components/RouteTester.tsx");
    const styles = projectFile("src/app/styles.css");

    expect(tester).toContain('className="route-line"');
    expect(styles).toContain(".route-line");
    expect(styles).toContain(".route-steps li::before");
    expect(styles).toContain(".route-steps li:first-child::before");
    expect(styles).toContain(".route-steps li:last-child::before");
    expect(styles).not.toContain("outline: 8px solid var(--paper)");
  });

  it("keeps the subscription name below the source and the result responsive", () => {
    const form = projectFile("src/app/components/SubscriptionImport.tsx");
    const result = projectFile("src/app/components/SubscriptionResult.tsx");
    const styles = projectFile("src/app/styles.css");

    expect(form.indexOf('className="field subscription-name"')).toBeGreaterThan(
      form.indexOf('className="field subscription-source"'),
    );
    expect(styles).toContain(".subscription-name {");
    expect(styles).toContain(".subscription-result-copy");
    expect(styles).toContain(".subscription-result-actions");
    expect(styles).not.toContain("min-width: 320px");
    expect(result).toContain('className="subscription-result-copy"');
    expect(result).toContain('className="subscription-result-actions"');
  });
});
