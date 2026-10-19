# Third-party notices

## Domain rules

Some domain entries in `public/rules/` are adapted from [`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community), distributed under the MIT License.

Copyright (c) 2018-2019 V2Ray

Entries marked with `@ads` are not imported. Routing attributes such as `@cn` are removed when entries are converted to Mihomo classical format.

The domestic dataset `public/rules/direct/china-domains.list` and its Egern/sing-box format derivatives adapt [`MetaCubeX/meta-rules-dat`](https://github.com/MetaCubeX/meta-rules-dat), distributed under GPL-3.0, with MIT-licensed v2fly app-domain supplements. These data artifacts are distributed under GPL-3.0; this does not replace the repository code license or relicense upstream data as MIT. The unchanged upstream license texts are included in [`public/rules/licenses/MetaCubeX-GPL-3.0.txt`](public/rules/licenses/MetaCubeX-GPL-3.0.txt) and [`public/rules/licenses/v2fly-MIT.txt`](public/rules/licenses/v2fly-MIT.txt).

Flacier's modifications (2026-10-12): keep compiled `geolocation-cn` DOMAIN/DOMAIN-SUFFIX entries, omit regex with an explicit list in the artifact header, supplement Xiaohongshu/Amap excluding overseas/ad attributes, and select domestic app dependencies from ByteDance/Alibaba/JD without importing company-wide includes. Source URLs and SHA-256 content hashes are recorded in the artifact header. Synchronization and format-conversion source is in `scripts/sync-rules.mjs` and `scripts/build-rule-formats.mjs`; the published domain text remains the editable source for the derived formats. No warranty is provided by these rule datasets.

## Subscription converter

The parsers, target serializers and remote source reader in `src/worker/sub-store/` are adapted from [`realchendahuang/sub-store-cloudflare`](https://github.com/realchendahuang/sub-store-cloudflare), distributed under AGPL-3.0. This repository is distributed under the same license.

## Client icons

The icons in `public/client-icons/` identify their respective products and remain the property of their owners.

- Apple App Store artwork: [Stash](https://apps.apple.com/us/app/stash-rule-based-proxy/id1596063349), [Surge 5](https://apps.apple.com/us/app/surge-5/id1442620678), [Loon](https://apps.apple.com/us/app/loon/id1373567447), [Quantumult X](https://apps.apple.com/us/app/quantumult-x/id1443988620), [Shadowrocket](https://apps.apple.com/us/app/shadowrocket/id932747118), and [Egern](https://apps.apple.com/us/app/egern/id1616105820)
- Clash Party: `build/icon.png` from [`mihomo-party-org/clash-party`](https://github.com/mihomo-party-org/clash-party)
- Clash Verge: `src-tauri/icons/icon.png` from [`clash-verge-rev/clash-verge-rev`](https://github.com/clash-verge-rev/clash-verge-rev)
- FlClash: `assets/images/icon.png` from [`chen08209/FlClash`](https://github.com/chen08209/FlClash)
- Mihomo: `docs/logo.png` from [`MetaCubeX/mihomo`](https://github.com/MetaCubeX/mihomo)
- sing-box: `resources/icons/512x512.png` from [`SagerNet/sing-box-for-desktop`](https://github.com/SagerNet/sing-box-for-desktop)
- Surfboard: product logo from the [official website](https://getsurfboard.com/)

Source attribution is listed above.
