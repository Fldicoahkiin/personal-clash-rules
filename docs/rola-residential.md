# Rola 住宅出口：本地准备与验收

本次接入的是 Rola **动态住宅 IP**，不是固定、独享的静态家宽。官方会话参数只承诺尽量保持，时间范围 1–120 分钟；重新连接、资源失效或会话到期仍可能换 IP。如果购买目的是让登录账户长期使用同一个出口，购买前另行确认静态/独享产品、实际地区、协议、IP 更换条件及服务用途限制。这里不代购、不重置密钥、不修改白名单，也不调用刷新 IP 或购买接口。

## 两条路径不要混淆

```text
配置：原机场完整配置 + 本地 Rola 设置 → 本地候选 YAML → 手动检查/导入客户端
流量：设备 → 指定的机场节点 → Rola 住宅出口 → 选定网站
```

Cloudflare 和本地转换器只生成配置，不承担第二条路径的转发。无需自建 VPS，也无需把 Rola 密码/API Token 交给 CF。当前网页没有“Rola 账户绑定”功能；把两种节点粘贴进去合并也不等于代理链。

HTTP/SOCKS5 是官方文档明确的接入方式，本工具不推断 TLS 网关或 UDP 支持。第一跳机场应提供加密；普通 HTTP/SOCKS5 在**机场到 Rola**这一段仍没有代理协议自身的加密，网关认证与目标地址可能被该段观察者看到。目标网站的 HTTPS 是另一层保护，不能把它说成整条链路都加密。不关闭证书校验；是否有可用的 TLS 网关要由 Rola 明确提供。

## 本地准备

```bash
pnpm rola init
```

生成 `.local/rola/settings.json`，权限 `0600`，目录 `0700`，已被 Git 忽略。再次初始化不会覆盖。用本地编辑器填写，不把密码放在命令行、截图、Git、在线页面或聊天中。

| 字段 | 填什么 |
| --- | --- |
| `protocol` | `socks5` 或 `http`，与控制台选项一致 |
| `server` / `port` | 控制台实际网关及对应端口；不猜端口 |
| `account` / `password` | 动态住宅基础账号及代理密码；`account` 不含地区/会话后缀 |
| `country` | 官方支持的两字母国家代码；初始示例 `us`，不保证该地区当时有资源 |
| `sessionId` | 固定的字母数字标识，1–32 位；默认 `main`，生成文件时不自动换会话 |
| `sessionMinutes` | 1–120，初始为 120；不是固定 IP 保证 |
| `upstreamNode` | 原完整配置 `proxies` 中一个具体机场节点的完整名称，不填 `AUTO`、国家组或 `DIRECT` |
| `rules` | 两列的 `DOMAIN,主机` 或 `DOMAIN-SUFFIX,域名`；初始复用仓库 Claude/OpenAI 域名表并附 GitHub，按使用习惯编辑 |
| `dns` | 为这些域名使用的 IP 地址 HTTPS DoH；通过 Rola 连接，不接受带自定义路由参数的 URL |
| `apiToken` | 可留空；只在明确执行 `usage` 时使用，和代理密码不同 |

用户名按官方格式组合为 `基础账号_会话-country-国家-sessiontime-分钟`。此入口不提供 `-f-1` 逐请求轮换、州/城市筛选或静态产品参数，避免把不同产品格式混用。需要这些能力时先核对实际套餐。

导出一份**已经可以使用的完整 Mihomo 配置**，不要直接拿空的 `proxy-providers` 外壳来生成：

```bash
pnpm rola prepare --base /本地路径/原配置.yaml
```

每次生成独立的 `.local/rola/candidate-*/mihomo.yaml` 与脱敏 `summary.json`，不会覆盖原文件，不会打开客户端、切换订阅、启动 TUN 或发出代理请求。候选文件包含密码，只能保留在本地私有位置；不是可以公开托管的规则模板。原机场节点更新后要从新的完整配置重新生成，不能指望这一份本地快照自动更新节点、Rola 密码或额度。

生成器会：

- 固定第一跳节点，用 `dialer-proxy` 建立到 Rola 的连接；拒绝已存在的前置代理链、未加密的第一跳、跳过证书校验或空节点。
- 为选定域名优先加上 `ROLA` 规则。该组仅包含 Rola，没有 `DIRECT` 或其他出口备用；失效时让这些访问失败，不悄悄换出口。
- 将 Rola 排除出原 `include-all` 自动测速/国家/通用组，避免普通流量或周期测速消耗住宅额度。客户端手动“测试全部节点”仍可能测试它。
- 明确拒绝选定域名的 UDP，Rola 节点与组均禁用 UDP。网页可能改用 TCP；纯 UDP 的语音/游戏会不可用，不能承诺无差异。
- 仅为选定域名添加代理 DoH 策略，并关闭候选配置的 IPv6。原默认解析器、引导解析、TUN、嗅探、其他规则、注释和未知字段保留。已有 DNS 策略冲突会报错，不替你覆盖。

第一跳和 Rola 网关的引导 DNS 必须独立于 Rola，防止“连接代理需要 DNS、DNS 又需要这个代理”的循环。当前支持已有 `proxy-server-nameserver` 中的 `system`、IP 或 IP 地址 DoH；系统引导可能仍访问本地 DNS，不能称作所有解析都离开中国。候选配置也不能阻止浏览器/操作系统绕过客户端自行解析；DNS 覆写或全局脚本可能再次替换它。

HTTP/SOCKS5 还可能把目标域名交给 Rola 服务端解析。本地 DoH 策略不能决定服务端使用哪家解析器，住宅出口的国家也不能保证 DNS 解析器属于同一国家。这部分要购买后按实际节点测试，不能仅凭配置文件承诺 BrowserLeaks 没有中国结果。

## Shadowrocket / FlClash

- Clash Party、Clash Verge 和 FlClash 使用同一 Mihomo 候选 YAML，但各客户端的全局覆写仍需检查；不替换当前可用订阅。
- Shadowrocket **不能直接导入这个 YAML**。先按 Rola 官方 iOS 教程导入 HTTP/SOCKS5 节点，在节点详情「代理通过」选择已验证的机场节点。裸节点 URI 不包含这一步。
- 本网站配套 `.conf` 仍可提供 iOS 分流基础，但 Rola 的专用域名规则、选中节点和 DNS 路径要在 iPhone 上另行确认。这里没有生成或声称已经验证 iOS 的 Rola 代理链；不要因为 Mac 配置检查通过就立即接管手机流量。

## 额度：查账户，不伪造订阅头

```bash
pnpm rola usage --proxy http://127.0.0.1:实际混合端口
```

这是单次、只读的账户查询：固定访问 `https://api2.rola-ip.co/api/users/traffic/packages/current`，使用 `Api-Token` 请求头，10 秒超时，不跟随重定向，不重试拒绝，不调用购买、续费或刷新 IP。API Token 只来自本地文件，不写进候选 YAML、订阅 URL 或输出。

必须指定当前代理软件的本机 HTTP/mixed 端口；只影响本次命令，不修改系统代理或全局环境变量。该客户端不可用就查询失败，不自动直连 Rola API。也不会为了查询用量而自动选择 Rola 作为管理请求出口。

返回的 `total_traffic` / `cost_traffic` 单位为 byte，分别显示套餐、已用、剩余；缺失字段为未知而不是 0，空套餐明确为空。文档的 `expire_time` 示例没有可靠时区，因此保留供应商原文，不伪造 Unix 到期时间或“长期有效”。实际账户响应需在获得套餐和密钥后核对。

机场与 Rola 是串联资源，同一流量经过两者，**不能把两份额度相加作为一个 `Subscription-Userinfo`**。机场原用量继续来自自己的订阅头，Rola 用量来自这次 API 查询；此工具不改变原订阅卡片。多个独立机场订阅的合并额度是另一个场景。

## 购买后验收顺序

1. 保留当前可用配置，确认实际套餐、网关协议/端口和国家；先核对一个目标网站，不同时修改 DNS/TUN/嗅探/PAC。
2. 用独立目录运行 Mihomo `-t -f 候选文件 -d 检查目录` 做语法检查；`-t` 不启动流量代理，但远程规则资源有可能需要下载。配置通过不等于节点可连接。
3. 手动导入候选配置，不立即覆盖旧配置。核对运行配置中的第一跳、Rola、域名规则和 DNS 是否被客户端覆写改变。
4. 少量请求验证出口 IP/ASN/地区、HTTPS 连通性以及会话重连后的出口变化；每个请求都可能消耗 Rola 流量。BrowserLeaks 的测试域名未必属于保护列表，要核对实际请求路由；检测一次不能证明其他应用没有绕行。
5. 再做冷启动、断网恢复、Rola 不可用时拒绝访问、客户端退出时是否漏直连、Wi-Fi/移动网络切换检查。未完成这些步骤前不将其作为账户常驻出口。

若启用 Rola IP 白名单，代理链访问 Rola 时它看到的是**机场出口**，不是 CF，也不一定是你家宽地址。第一跳换出口可能使白名单失效；不要为此自动扩大白名单或关闭认证。

## 本次验证范围

2026-10-12：本地测试 161 项、Worker 测试 47 项通过，类型检查与构建通过。新增 29 项覆盖会话格式、代理链、UDP 拒绝、DNS 依赖、原字段/注释保留、私有文件权限、不覆盖原文件以及只读用量接口。Worker 测试退出码为 0，同时有一条管道关闭诊断，未把测试运行等同于生产网络验收。

另外用本机 Clash Party 内置 Mihomo 对**仅含虚构节点**的独立候选配置运行 `-t`，语法检查通过；没有启动代理、读取客户端当前配置、请求 Rola 节点或调用实际账户 API。真实套餐额度、出口质量、DNS 行为与 iPhone 上的代理链尚未验收。

## 依据

核对日期：2026-10-12。

- [Rola 动态住宅](https://doc.rola-ip.co/zh/guide/proxy-networks/residential.html) 与 [会话/国家参数](https://doc.rola-ip.co/zh/guide/proxy-networks/parameters.html)
- [Rola 控制台 API 文档](https://console.rola-ip.co/zh/tool/api-document)：`Api-Token`、`GET /api/users/traffic/packages/current`；需登录查看
- [Rola iOS 接入](https://doc.rola-ip.co/zh/guide/platform/ios.html)
- [Mihomo dialer-proxy](https://wiki.metacubex.one/config/proxies/dialer-proxy/)、[DNS](https://wiki.metacubex.one/config/dns/)、[代理组](https://wiki.metacubex.one/config/proxy-groups/)
