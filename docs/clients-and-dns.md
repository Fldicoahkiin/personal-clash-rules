# 客户端与 DNS

| 客户端 | 网站输出 | 导入 |
| --- | --- | --- |
| Clash Verge / Rev | 完整配置 | `clash://install-config` |
| FlClash | 完整配置 | `flclash://install-config` |
| Shadowrocket | 节点订阅与流量 | 复制链接，在订阅中添加；规则和 DNS 在「配置」中设置 |

## DNS

- **保留原订阅 DNS**：继承单个 Clash 订阅的 DNS 和 IPv6 设置。不适用于纯节点链接、多机场合并或客户端直读备用。
- **代理解析 · 加密 DoH**：普通查询通过选定代理访问 DoH；节点域名、直连域名通过直连 DoH 解析。不会添加系统明文 DNS 备用。
- **使用系统 DNS**：由系统解析，不作为防泄漏模式。

完整配置已经包含 DNS，无需再导入一份 DNS 覆写。客户端的 DNS 覆写、全局脚本可能替换订阅设置，检查「运行配置」才能确定最终生效内容。

防泄漏还需要设备端配合：

1. Clash Verge / FlClash 开启 TUN / VPN，确认 DNS 劫持生效。系统代理本身不接管所有 DNS。
2. 浏览器安全 DNS、Android 私人 DNS、iCloud Private Relay 都有自己的解析或转发路径，测试时一并核对。
3. 连接目标节点后运行 [BrowserLeaks DNS](https://browserleaks.com/dns)、[WebRTC](https://browserleaks.com/webrtc) 和 [IPv6 测试](https://test-ipv6.com/)。切换 Wi-Fi / 移动网络后重新测。

DNS 服务器所在国家不一定等于出口国家。检查是否出现本地运营商或非预期解析器，不能只按“国外 IP”判断是否泄漏。节点域名的直连解析属于连接代理之前的引导解析。

## 出口与连接检查

AI 登录会话需要稳定出口时，在 `AI` 策略组中选择固定节点；自动测速组会随测速结果换节点。规则负责选策略组，策略组再选出口。延迟测试成功只表示测试地址可达，不代表每个网站都能访问。

只有另有落地代理、确实需要两跳时才配置 `dialer-proxy`：设备 → 机场节点 → 落地代理 → 目标。第一跳组不能包含落地节点本身，否则会形成循环。当前页面合并节点不会自动创建代理链；Shadowrocket 的节点订阅也不携带 Mihomo 的链式配置。

命令行程序不一定读取系统代理。Claude Code 支持 `HTTP_PROXY` / `HTTPS_PROXY`，不支持直接设置 SOCKS 代理；使用本机客户端提供的 HTTP / mixed 端口。不要为排查连接失败关闭证书校验，也不要把带账号密码的订阅或代理 URL 提交到公开仓库。

参考：[Mihomo dialer-proxy](https://wiki.metacubex.one/config/proxies/dialer-proxy/)、[Claude Code 网络配置](https://code.claude.com/docs/en/network-config)。

## 后端与用量

CF 和本地版使用同一套转换器。流量来自上游 `Subscription-Userinfo` 响应头：上传、下载、总额相加，到期取最早的有效日期；单独节点不附带机场额度。缺失来源不会被算成零额度。

机场拒绝 Cloudflare 请求时，CF 不能读取其节点和用量。客户端直读备用能生成 `proxy-providers`，但外层订阅拿不到客户端稍后读取的流量头。需要用量时换本地后端，或保留原机场订阅并在客户端追加规则。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start:local
```

打开 `http://127.0.0.1:25500`。本地链接只在这台电脑可用，服务停止后不能刷新；手机不能把 `127.0.0.1` 当作电脑地址。订阅存于 `.local/subscriptions`，不提交到 Git。

网站“自定义后端”使用本项目的 `/api/subscriptions`，不是传统 Subconverter 的 `/sub`。不内置第三方公共转换服务。

## 规则模板

Flacier 分流、ACL4SSR 默认、多国分组、无自动测速，以及自定义 HTTPS INI。远程模板在订阅刷新时读取；目前支持 `ruleset`、`custom_proxy_group`、`enable_rule_generator=true`、`overwrite_original_rules=true`。不支持的指令会报错，不会被忽略。

“全局代理 / 直连”由客户端运行模式控制。旧链接仍兼容，新规则列表不再把它们列为分流模板。

参考：[Mihomo DNS](https://wiki.metacubex.one/config/dns/)、[Clash Verge 响应头](https://www.clashverge.dev/guide/url_schemes.html)、[Clash Verge 覆写优先级](https://www.clashverge.dev/guide/extend.html)、[ACL4SSR 配置](https://github.com/ACL4SSR/ACL4SSR/tree/master/Clash/config)。
