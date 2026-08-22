# Third-party notices

Some domain entries in `public/rules/` are adapted from
[`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community),
which is distributed under the MIT License.

Copyright (c) 2018-2019 V2Ray

The source repository and its license remain the reference for those entries.
Entries marked with `@ads` are not imported. Routing attributes such as `@cn`
are removed when converting entries to Mihomo classical format. The lists are
grouped for this repository and may differ from the upstream data over time.

## Client icons

The client icons in `public/client-icons/` are used only to identify their
respective products. They are not covered by this repository's MIT License and
remain the property of their owners.

- Apple App Store artwork: [Stash](https://apps.apple.com/us/app/stash-rule-based-proxy/id1596063349),
  [Surge 5](https://apps.apple.com/us/app/surge-5/id1442620678),
  [Loon](https://apps.apple.com/us/app/loon/id1373567447),
  [Quantumult X](https://apps.apple.com/us/app/quantumult-x/id1443988620),
  [Shadowrocket](https://apps.apple.com/us/app/shadowrocket/id932747118), and
  [Egern](https://apps.apple.com/us/app/egern/id1616105820).
- Mihomo: `docs/logo.png` from the `Meta` branch of
  [`MetaCubeX/mihomo`](https://github.com/MetaCubeX/mihomo).
- sing-box: `resources/icons/512x512.png` from
  [`SagerNet/sing-box-for-desktop`](https://github.com/SagerNet/sing-box-for-desktop).
- Surfboard: product logo from the
  [official Surfboard website](https://getsurfboard.com/).

The source URL and usage note are also embedded in each PNG's XMP metadata.

## Sub-Store runtime

[`deploy/sub-store/Dockerfile`](deploy/sub-store/Dockerfile) downloads the
unmodified `sub-store.bundle.js` asset from the official Sub-Store `2.36.39`
release and verifies its published SHA-256 digest while building the VPS image.
Sub-Store is licensed under AGPL-3.0; this repository's MIT License does not
apply to that runtime.

- Source: [sub-store-org/Sub-Store](https://github.com/sub-store-org/Sub-Store)
- Release: [2.36.39](https://github.com/sub-store-org/Sub-Store/releases/tag/2.36.39)
- License: [AGPL-3.0](https://github.com/sub-store-org/Sub-Store/blob/master/LICENSE)
