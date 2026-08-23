# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user manages a personal proxy subscription and uses Mihomo or another subscription client across desktop and mobile devices.

## Product Purpose

订阅转换 combines remote subscriptions and individual node URIs, converts them for supported clients, and publishes revocable links whose addresses do not change after refresh. The public page also tests the rules served by the same Worker.

## Positioning

The same public site serves the rule files and tests those published files, so the result shown by the URL tester comes from the rules the client can download.

## Operating Context

- Public source and automated updates live on GitHub.
- Cloudflare Workers serves the public site and rule files from `rules.flacier.com`.
- The management page is `/manage`; `sub.flacier.com` is the intended management domain.
- D1 stores profiles, encrypted sources, generated outputs, refresh runs, and share links.
- Sub-Store runs as a separate conversion dependency on the personal VPS.
- Private nodes and subscriptions come from a separate 3x-ui installation.
- Users may use Mihomo, Clash-compatible clients, sing-box, Surge, Stash, Shadowrocket, Loon, or Quantumult X.

## Capabilities and Constraints

- Published rules cover AI, Apple, Steam, Discord, developer tools, media, social services, Bilibili, AniGamer, and local networks.
- Remote subscriptions and node URIs can be combined into 13 output formats.
- Saved sources can be renamed, replaced, enabled, disabled, or removed without changing published links.
- Source values and active share tokens are encrypted before D1 storage.
- Fixed subscription links can be refreshed without changing their addresses and can be revoked.
- Each fixed link includes a universal endpoint that selects a node format from the client User-Agent, while explicit target URLs remain available.
- The management page shows the latest eight refresh runs and their conversion results.
- The management API accepts Cloudflare Access identity or the control token used by automation.
- Rule text conversion runs in the browser and remains separate from subscription conversion.
- URL testing reports the matched rule, policy group, and final `DIRECT` or proxy route.
- Country groups filter subscription nodes by their names; the site does not report the client's current exit node.
- The repository is public and must not contain node credentials, subscription tokens, or private configuration.

## Brand Commitments

- Product name: 订阅转换.
- Public domain: `rules.flacier.com` under `flacier.com`.
- Interface copy is concise and factual.
- Orange is not used.
- Source is public under the MIT License.

## Evidence on Hand

- Published rules: `public/rules/`
- Clash/Mihomo override: `public/overrides/clash-party.yaml`
- Rule manifest: `public/rules/manifest.yaml`
- Browser rule converter: `src/app/lib/convert-rules.ts`
- Automated media rule sync: `.github/workflows/update-rules.yml`

No client usage metrics, testimonials, conversion benchmarks, or commercial claims are available and none should be invented.

## Product Principles

- Show the route decision before exposing configuration detail.
- Encrypt subscription data at the Worker boundary and never return stored source values.
- Name actions after outcomes, not protocols.
- Use the published rule files as the source for tests and explanations.
