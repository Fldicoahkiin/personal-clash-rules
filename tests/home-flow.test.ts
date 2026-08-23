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
    const controlHeader = projectFile(
      "src/app/features/subscriptions/ControlHeader.tsx",
    );

    for (const source of [header, app, controlHeader]) {
      expect(source).toContain('/brand/github-mark.svg');
      expect(source).not.toContain("GithubLogo");
    }
  });

  it("uses a plain connecting line in the route tester", () => {
    const tester = projectFile("src/app/components/RouteTester.tsx");
    const styles = projectFile("src/app/styles.css");

    expect(tester).toContain('className="route-line"');
    expect(styles).toContain(".route-line");
  });
});
