<h1><img src="public/brand/flacier-mark.svg" alt="" width="32" height="32" /> Flacierの订阅转换</h1>

个人订阅转换、分流规则和网址测试。

[在线页面](https://rules.flacier.com/) · [Mihomo 覆写](https://rules.flacier.com/overrides/clash-party.yaml) · [规则目录](public/rules/manifest.yaml)

![部署结构](docs/architecture.svg)

## 功能

- 合并多个订阅和单节点，生成 KV 短链接
- 客户端刷新时读取上游并转换，链接不用重新生成
- Clash Verge、FlClash、Clash Party、Mihomo 等完整配置；Shadowrocket 配套的节点订阅与原生 `.conf`
- 节点筛选、多重改名、国旗、类型、UDP、XUDP 与排序
- 透传、合并上游流量与到期信息
- 默认 Worker 转换；可选 Clash Party / Mihomo 客户端直读备用
- 继承独立的原订阅 DNS，或配置节点引导 DNS 与代理 DoH；Mihomo IPv6 默认关闭
- CF、本地及自定义 Flacier 后端；ACL4SSR 和自定义远程规则模板
- BrowserLeaks、IPv6、Cloudflare 网络检测入口
- AI、Apple、Steam、Discord、Bilibili、AniGamer 等分流规则
- 按 Flacier、ACL4SSR 或自定义模板测试规则；缺少 IP、进程或地理规则数据时明确提示无法确定
- 规则格式转换；页脚构建时间、版本时间与提交 hash

规则文件位于 [`public/rules`](public/rules)，Mihomo 覆写单独导入：

```text
https://rules.flacier.com/overrides/clash-party.yaml
```

## 开发

```bash
pnpm install
pnpm dev
pnpm check
```

部署使用 Cloudflare Git 集成，见 [Cloudflare 配置](docs/cloudflare-setup.md)。

本地转换：`pnpm build && pnpm start:local`，打开 `http://127.0.0.1:25500`。如需通过已运行的代理客户端下载上游，可给本地服务传入 `--proxy http://127.0.0.1:混合端口`；只影响该进程，不修改系统代理。用量、DNS 与手机端说明见 [客户端配置](docs/clients-and-dns.md)。

Rola 住宅出口：网页订阅转换选择「机场 → Rola · 仅本地」，读取机场节点、保存/选择出口、编辑域名分流与 DoH。支持现成 HTTP/SOCKS5 原样账号和动态住宅会话。可生成本机订阅，或选择「云端机场基础订阅 + Clash Party 本地私密覆写」；家宽凭据不写 CF/KV、不回显、不切换客户端。另提供默认关闭的独立限时回退工具。CLI 的 `pnpm rola init` / `prepare` 仍可离线使用，套餐用量不与机场相加。见 [Rola 接入与验收](docs/rola-residential.md)。

## License

[AGPL-3.0](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
