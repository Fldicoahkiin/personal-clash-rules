import { describe, expect, it } from "vitest";

import { buildClientAction } from "../src/app/lib/client-import";

const subscription = "https://example.com/sub?id=1&token=a b";

describe("buildClientAction", () => {
  it("builds Mihomo, Stash, Surge and Loon links", () => {
    expect(buildClientAction("mihomo", subscription, "Flacier")).toMatchObject({
      kind: "link",
      value:
        "mihomo://install-config?url=https%3A%2F%2Fexample.com%2Fsub%3Fid%3D1%26token%3Da+b&name=Flacier",
    });
    expect(buildClientAction("stash", subscription, "Flacier").value).toBe(
      "stash://install-config?url=https%3A%2F%2Fexample.com%2Fsub%3Fid%3D1%26token%3Da+b",
    );
    expect(buildClientAction("surge", subscription, "Flacier").value).toBe(
      "surge:///install-config?url=https%3A%2F%2Fexample.com%2Fsub%3Fid%3D1%26token%3Da+b",
    );
    expect(buildClientAction("loon", subscription, "Flacier").value).toBe(
      "loon://import?nodelist=https%3A%2F%2Fexample.com%2Fsub%3Fid%3D1%26token%3Da+b",
    );
  });

  it("builds a Quantumult X universal link", () => {
    const action = buildClientAction("quantumult-x", subscription, "Flacier");

    expect(action.kind).toBe("link");
    expect(action.value).toContain(
      "https://quantumult.app/x/open-app/add-resource?remote-resource=",
    );
    expect(decodeURIComponent(action.value.split("=")[1])).toBe(
      JSON.stringify({
        server_remote: [`${subscription}, tag=Flacier`],
      }),
    );
  });

  it("copies the original URL for clients without a stable import scheme", () => {
    expect(buildClientAction("sing-box", subscription, "Flacier")).toEqual({
      kind: "copy",
      value: "https://example.com/sub?id=1&token=a%20b",
    });
  });

  it("rejects non-HTTP subscription URLs", () => {
    expect(() => buildClientAction("mihomo", "file:///tmp/sub", "Flacier")).toThrow(
      "订阅地址需要使用 HTTP 或 HTTPS",
    );
  });
});
