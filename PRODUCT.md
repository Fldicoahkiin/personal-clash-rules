# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user manages a personal proxy subscription and uses Mihomo or another subscription client across desktop and mobile devices.

## Product Purpose

Flacier Rules publishes personal routing rules and gives the user browser tools to inspect, convert, and import subscription-related data. Success means the user can see what a URL will match and move a subscription into the client they use without reading YAML first.

## Positioning

The same public site serves the rule files and tests those published files, so the result shown by the URL tester comes from the rules the client can download.

## Operating Context

- Public source and automated updates live on GitHub.
- Cloudflare Workers serves the site and rule files from `rules.flacier.com`.
- Private nodes and subscriptions come from a separate 3x-ui installation.
- Users may use Mihomo, Clash-compatible clients, sing-box, Surge, Stash, Shadowrocket, Loon, or Quantumult X.

## Capabilities and Constraints

- Published rules cover AI, Steam, Discord, developer tools, media, social services, Bilibili, AniGamer, and local networks.
- Rule text conversion runs in the browser.
- URL testing must report the matching rule, rule set, policy, and default selection.
- Subscription URLs stay in the browser when generating client import links.
- A client import link is not the same as converting a node subscription into another configuration format. Real cross-format conversion requires a conversion backend; that backend is not present in this repository yet.
- The repository is public and must not contain node credentials, subscription tokens, or private configuration.

## Brand Commitments

- Product name: Flacier Rules.
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
- Keep subscription data in the browser unless the user explicitly chooses a backend.
- Name actions after outcomes, not protocols.
- Use the published rule files as the source for tests and explanations.
