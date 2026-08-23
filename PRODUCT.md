# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user manages a personal proxy subscription and uses Mihomo or another subscription client across desktop and mobile devices.

## Product Purpose

订阅转换 combines remote subscriptions and individual node URIs, encrypts their configuration into a fixed link, and converts them for supported clients when that link is refreshed. The public page also tests the rules served by the same Worker.

## Positioning

The same public site serves the rule files and tests those published files, so the result shown by the URL tester comes from the rules the client can download.

## Operating Context

- Public source and automated updates live on GitHub.
- Cloudflare Workers serves the public site and rule files from `rules.flacier.com`.
- One Worker serves the site, link creation API, rule files, and subscription links.
- Subscription sources and node settings are encrypted into each link; no database stores them.
- Private nodes and subscriptions come from a separate 3x-ui installation.
- Users may use Mihomo, Clash-compatible clients, sing-box, Surge, Stash, Shadowrocket, Loon, or Quantumult X.

## Capabilities and Constraints

- Published rules cover AI, Apple, Steam, Discord, developer tools, media, social services, Bilibili, AniGamer, and local networks.
- Remote subscriptions and node URIs can be combined into 20 output targets.
- Node names can be filtered, renamed, and sorted before a link is generated.
- The Worker reads upstream subscriptions on each client refresh and does not persist normalized nodes.
- Upstream node changes and repository rule updates do not change an existing link.
- Changing the source list or processing settings creates a new link.
- Each fixed link includes a universal endpoint that selects a node format from the client User-Agent, while explicit target URLs remain available.
- Rule text conversion runs in the browser and remains separate from subscription conversion.
- URL testing reports the matched rule, policy group, and final `DIRECT` or proxy route.
- Country groups filter subscription nodes by their names; the site does not report the client's current exit node.
- The repository is public and must not contain node credentials, subscription tokens, or private configuration.

## Brand Commitments

- Product name: 订阅转换.
- Public domain: `rules.flacier.com` under `flacier.com`.
- Interface copy is concise and factual.
- Orange is not used.
- Source is public under the AGPL-3.0 License.

## Evidence on Hand

- Published rules: `public/rules/`
- Clash/Mihomo override: `public/overrides/clash-party.yaml`
- Rule manifest: `public/rules/manifest.yaml`
- Browser rule converter: `src/app/lib/convert-rules.ts`
- Automated media rule sync: `.github/workflows/update-rules.yml`

No client usage metrics, testimonials, conversion benchmarks, or commercial claims are available and none should be invented.

## Product Principles

- Put subscription conversion before secondary rule tools.
- Encrypt subscription data into opaque links and do not persist it.
- Name actions after outcomes, not protocols.
- Use the published rule files as the source for tests and explanations.
