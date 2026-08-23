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
    expect(app.indexOf("<RouteTester />")).toBeLessThan(
      app.indexOf("<ConverterWorkspace />"),
    );
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

  it("uses the Flacier product name and leaves the custom subscription name empty", () => {
    const header = projectFile("src/app/components/AppHeader.tsx");
    const form = projectFile("src/app/components/SubscriptionImport.tsx");
    const html = projectFile("index.html");

    expect(header).toContain("Flacierの订阅转换");
    expect(form).toContain('<h1 id="subscription-title">Flacierの订阅转换</h1>');
    expect(form).toContain('name: ""');
    expect(html).toContain("<title>Flacierの订阅转换</title>");
  });

  it("uses a plain connecting line in the route tester", () => {
    const tester = projectFile("src/app/components/RouteTester.tsx");
    const styles = projectFile("src/app/styles.css");

    expect(tester).toContain('className="route-line"');
    expect(styles).toContain(".route-line");
  });
});
