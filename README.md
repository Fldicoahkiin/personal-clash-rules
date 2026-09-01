<h1><img src="public/brand/flacier-mark.svg" alt="" width="32" height="32" /> Flacierの订阅转换</h1>

个人订阅转换、分流规则和网址测试。

[在线页面](https://rules.flacier.com/) · [Mihomo 覆写](https://rules.flacier.com/overrides/clash-party.yaml) · [规则目录](public/rules/manifest.yaml)

![部署结构](docs/architecture.svg)

## 功能

- 合并多个订阅和单节点，生成 KV 短链接
- 客户端刷新时读取上游并转换，链接不用重新生成
- Clash Party、Mihomo 等客户端；完整配置与节点资源共 21 种输出
- 节点筛选、多重改名、国旗、类型、UDP、XUDP 与排序
- 单机场订阅透传流量与到期信息
- 默认 Worker 转换；可选 Clash Party / Mihomo 客户端直读备用
- Mihomo / Clash Party 的 DoH 或系统 DNS 模板
- BrowserLeaks、IPv6、Cloudflare 网络检测入口
- AI、Apple、Steam、Discord、Bilibili、AniGamer 等分流规则
- 网址规则测试与规则格式转换

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

## License

[AGPL-3.0](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
