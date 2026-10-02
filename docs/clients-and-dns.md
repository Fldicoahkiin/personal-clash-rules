# 客户端与 DNS

| 客户端 | 网站输出 | 导入 |
| --- | --- | --- |
| Clash Party | 完整配置 | `mihomo://install-config` |
| Clash Verge / Rev | 完整配置 | `clash://install-config` |
| FlClash | 完整配置 | `flclash://install-config` |
| Shadowrocket | 节点订阅与流量 | 复制链接，在订阅中添加；规则和 DNS 在「配置」中设置 |

## DNS

- **保留原订阅 DNS**：继承单个 Clash 订阅的独立 DNS 设置及 hosts。不适用于纯节点链接、多机场合并或客户端直读备用。若 DNS 依赖上游策略组、接口或规则集，转换会报错，避免在替换分流后留下失效引用。
- **代理解析 · 加密 DoH**：网站查询通过独立的 `DNS-PROXY` 组选定节点访问 DoH；即使网站被手动设为直连，其 DNS 也不会自动退回系统解析。节点源为空时拒绝查询，不使用 `COMPATIBLE` 直连兜底。
- **使用系统 DNS**：由系统解析，不作为防泄漏模式。

代理 DoH 分成两条路径，避免“连代理前需要 DNS，而 DNS 又必须经过代理”的循环：

| 用途 | 设置 | 注意 |
| --- | --- | --- |
| 建立代理前解析节点和 DNS 服务域名 | 默认系统 DNS；可继承机场独立引导配置，或自定义 IP 地址 DoH | 系统 DNS 可能由本地运营商提供。如果指回 Mihomo，应改用已确认本地可达的引导 DNS。自定义引导必须使用 IP 地址，不能再依赖自身解析域名。 |
| 普通网站域名查询 | 可编辑 HTTPS DoH 地址，默认 Cloudflare 和 Google，经 `DNS-PROXY` | 不添加系统或直连解析备用；代理不可用时查询可能失败，需要修复代理或引导路径。 |

“允许 IPv6”默认关闭，同时写入 Mihomo 顶层与 DNS 设置，包括继承机场 DNS 时。不修改操作系统 IPv6、TUN 或嗅探设置。旧链接没有保存这些字段时使用新默认值；需要固定引导策略的链接，应重新生成并保存选择。

完整配置已经包含 DNS，无需再导入一份 DNS 覆写。客户端的 DNS 覆写、全局脚本可能替换订阅设置，检查「运行配置」才能确定最终生效内容。

防泄漏还需要设备端验证。先保留当前可用配置和回退方法，一次只改一项；出现所有节点超时时立即恢复，不继续叠加覆写：

1. 核对 Clash Party / Clash Verge / FlClash 的 TUN / VPN 与 DNS 劫持是否生效。系统代理本身不接管所有 DNS；不要为了测试直接覆盖当前可用配置。
2. 浏览器安全 DNS、Android 私人 DNS、iCloud Private Relay 都有自己的解析或转发路径，测试时一并核对。
3. 连接目标节点后运行 [BrowserLeaks DNS](https://browserleaks.com/dns)、[WebRTC](https://browserleaks.com/webrtc) 和 [IPv6 测试](https://test-ipv6.com/)。切换 Wi-Fi / 移动网络后重新测。

DNS 服务器所在国家不一定等于出口国家。检查是否出现本地运营商或非预期解析器，不能只按“国外 IP”判断是否泄漏。节点域名的直连解析属于连接代理之前的引导解析。Worker 能检查配置结构，不能证明你的本地网络能访问某个引导 DoH，也不能代替设备上的冷启动、断线恢复和 DNS 泄漏测试。

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

Flacier 默认把 Apple、Steam、Bilibili 等业务流量及未命中流量交给代理；只保留本地网络直连，`DIRECT` 仍可手动选择。Mihomo 策略组为空时使用 `REJECT`，不悄悄直连。ACL4SSR 和自定义模板保留其明确写出的直连规则，不把第三方方案改写成 Flacier 的策略。

“全局代理 / 直连”由客户端运行模式控制，新规则列表不再把它们列为分流模板。旧“全局直连”链接与“代理 DoH”冲突时会明确报错；应选择系统或上游 DNS，不能同时要求没有代理节点且 DNS 必须经过代理。

规则测试与转换共用模板编译器，可以选择上述方案，也会跟随转换区的方案选择。网页按加载的规则快照顺序模拟：需要 IP 或进程名时提示补充；遇到 GEOIP、GEOSITE、未知进程正则等无法计算的前置规则，显示“无法确定”，不略过后宣称命中或默认代理。测试结果是配置默认策略，不是客户端当前选中的节点，也不代表连接可用。

## 页面版本信息

页脚分别显示前端构建时间、提交 hash 和 Cloudflare Worker 版本创建时间。版本创建时间不等于流量切换完成时间，也不会用构建时间冒充。版本接口遇到网络错误、超时、429 或 5xx 时最多尝试 3 次；恢复联网后重新读取，失败时保留已读到的版本并提示重试。

参考：[Mihomo DNS](https://wiki.metacubex.one/config/dns/)、[Clash Verge 响应头](https://www.clashverge.dev/guide/url_schemes.html)、[Clash Verge 覆写优先级](https://www.clashverge.dev/guide/extend.html)、[ACL4SSR 配置](https://github.com/ACL4SSR/ACL4SSR/tree/master/Clash/config)。
