# 客户端与 DNS

| 客户端 | 网站输出 | 导入 |
| --- | --- | --- |
| Clash Party | 完整配置 | `mihomo://install-config` |
| Clash Verge / Rev | 完整配置 | `clash://install-config` |
| FlClash | 完整配置 | `flclash://install-config` |
| Shadowrocket | 配套节点订阅与原生 `.conf`；也可只输出节点 | 先「添加节点订阅」，再「添加配置」；两者使用同一组来源与节点名称 |

### iOS Shadowrocket

固定 IP 合并订阅提供两个手机入口：`/r/订阅ID/Flacier-Mobile-Nodes.txt` 用于首页节点，`/r/订阅ID/Flacier-Mobile.conf` 用于配置页分流与 DNS。可读文件名会在重新导入时保留，原短链接及 `target` 参数继续兼容。首页节点和配置文件分别更新，不能用更新节点代替更新规则。

选择「完整配置 → Shadowrocket · 配套配置」会生成两个资源。节点订阅带真实 `Subscription-Userinfo`；`.conf` 负责规则和 DNS，不重复写节点密码，也不创建 Clash 式策略组。代理规则使用内置 `PROXY`，跟随首页选中的节点；国内白名单继续使用 `DIRECT`。节点改名或新增时无需在配置中同步节点名称；修改分流规则或 DNS 后，需要重新下载配套配置。客户端自动更新是否开启，要在手机上另行确认。

此输出共用 Flacier 规则，但不是把 Mihomo YAML 或 DNS 覆写直接复制进 iOS。它省略桌面进程规则，未匹配流量使用 `FINAL,PROXY`；既有国内服务的默认直连和显式拦截规则保留。不启用 MITM，不安装证书，不自动切换客户端配置。配置与节点 URI 通过生成测试，不等于已在你的 iPhone 上完成连通性或 DNS 检测。

原生导入分别使用 `shadowrocket://add/…` 和 `shadowrocket://config/add/…`。电脑本地链接不能在手机访问；页面会隐藏这类链接的一键导入，只提供下载。传入手机的离线文件不能自动刷新节点或用量。不要为了手机访问而把带凭据的本地转换服务直接开放到公网。

格式参考：[Shadowrocket 社区手册作者的配置说明](https://github.com/LOWERTOP/Shadowrocket/wiki)、[Sub-Store URI 输出实现](https://github.com/sub-store-org/Sub-Store/blob/master/backend/src/core/proxy-utils/producers/uri.js)。

## DNS

- **保留原订阅 DNS**：继承单个 Clash 订阅的独立 DNS 设置及 hosts。不适用于纯节点链接或多机场合并。若 DNS 依赖上游策略组、接口或规则集，转换会报错，避免在替换分流后留下失效引用。
- **代理解析 · 加密 DoH**：网站查询通过独立的 `DNS-PROXY` 组选定节点访问 DoH；已判定直连的连接改用阿里、腾讯的加密 DoH 直接解析（见下表），不退回系统解析。节点源为空时拒绝查询，不使用 `COMPATIBLE` 直连兜底。
- **使用系统 DNS**：由系统解析，不作为防泄漏模式。

代理 DoH 分成以下几条路径。引导解析独立，避免“连代理前需要 DNS，而 DNS 又必须经过代理”的循环：

| 用途 | 设置 | 注意 |
| --- | --- | --- |
| 建立代理前解析节点和 DNS 服务域名 | 默认系统 DNS；可继承机场独立引导配置，或自定义 IP 地址 DoH | 系统 DNS 可能由本地运营商提供。如果指回 Mihomo，应改用已确认本地可达的引导 DNS。自定义引导必须使用 IP 地址，不能再依赖自身解析域名。 |
| 普通网站域名查询 | 可编辑 HTTPS DoH 地址，默认 Cloudflare 和 Google，经 `DNS-PROXY` | 不添加系统或直连解析备用；代理不可用时查询可能失败，需要修复代理或引导路径。 |
| 直连连接的目标地址 | 固定阿里 `223.5.5.5`、腾讯 `1.12.12.12` 的 HTTPS DoH，不经代理（`direct-nameserver`） | 只用于规则已判定 DIRECT 的连接，包括 `GEOIP,CN` 兜底和手动切到 DIRECT 的组，让国内 CDN 返回国内地址。分流判断和代理流量仍用上一行。这些解析器能看到直连的域名；运营商本来也能从 TLS 的 SNI 看到它们。 |
| 微信、QQ 媒体域名 | `qq.com`、`qpic.cn`、`qlogo.cn`、`gtimg.cn`、`gtimg.com`、`wechat.com` 写入 `fake-ip-filter`，经 `nameserver-policy` 用同一组国内 DoH | 微信按拿到的地址直接取图，假 IP 或海外 CDN 地址会让图片一直转圈。这些域名本来就按腾讯规则直连。 |

“允许 IPv6”默认关闭，同时写入 Mihomo 顶层与 DNS 设置，包括继承机场 DNS 时。不修改操作系统 IPv6、TUN 或嗅探设置。旧链接没有保存这些字段时使用新默认值；需要固定引导策略的链接，应重新生成并保存选择。

完整配置已经包含 DNS，无需再导入一份 DNS 覆写。客户端的 DNS 覆写、全局脚本可能替换订阅设置，检查「运行配置」才能确定最终生效内容。

Shadowrocket 的代理 DoH 使用 `#proxy`，经过**首页选中的节点**，不是 Mihomo 的 `DNS-PROXY` 组。节点域名另用 `proxy-dns-server` 引导解析；业务和备用解析保持代理 DoH，不留空后退回系统 DNS。直连规则匹配的域名由 `direct-dns-server` 交给阿里、腾讯 DoH 直接解析，失败时回退到代理 DoH。iOS 不支持继承本项目的 Mihomo 上游 DNS；需要系统或自定义引导。代理不能建立时，这套设置可能无法解析网站，不能在失联后自动改为直连来宣称可用。

防泄漏还需要设备端验证。先保留当前可用配置和回退方法，一次只改一项；出现所有节点超时时立即恢复，不继续叠加覆写：

1. 核对 Clash Party / Clash Verge / FlClash 的 TUN / VPN 与 DNS 劫持是否生效。系统代理本身不接管所有 DNS；不要为了测试直接覆盖当前可用配置。
2. 浏览器安全 DNS、Android 私人 DNS、iCloud Private Relay 都有自己的解析或转发路径，测试时一并核对。
3. 连接目标节点后运行 [BrowserLeaks DNS](https://browserleaks.com/dns)、[WebRTC](https://browserleaks.com/webrtc) 和 [IPv6 测试](https://test-ipv6.com/)。切换 Wi-Fi / 移动网络后重新测。

DNS 服务器所在国家不一定等于出口国家。检查是否出现本地运营商或非预期解析器，不能只按“国外 IP”判断是否泄漏。节点域名的直连解析属于连接代理之前的引导解析。Worker 能检查配置结构，不能证明你的本地网络能访问某个引导 DoH，也不能代替设备上的冷启动、断线恢复和 DNS 泄漏测试。

检测页面的“中国出口”“Cloudflare 出口”和“Claude 出口”可能分别请求不同服务，按分流规则出现不同 IP 不等于 DNS 泄漏。DNS 检测列表显示的是递归解析服务器，不要求与代理出口 IP 相同；列表中的 IPv6 地址也不能单独证明设备通过 IPv6 直连。反过来，仅有“未检测到泄漏”或所有结果都在国外，也不足以证明所有应用、断线和重连场景都不会绕过预期路径。

指纹浏览器使用远端带认证的 HTTPS 代理时，设备到代理的连接受 TLS 保护，代理服务端负责解析收到的目标域名。它不依赖另一台电脑的本机转发端口，但仍须确认浏览器没有另设安全 DNS、绕过列表或代理回退。代理入口、证书有效性、认证失败是否拒绝、真实出口和 DNS 路径需要分别验证；不把面板管理端口当作代理端口。

## 出口与连接检查

购买节点即可使用，不要求自建 VPS。机场订阅和单独节点链接都沿用现有导入流程；没有额度响应头的单独节点不会凭空生成用量。

AI 登录会话需要稳定出口时，可以把 `AI` 设为 `US`，再在 `US` 中手动选择具体节点；或通过 `GLOBAL` 选择具体节点。不要把这条路径留在 `AUTO`，自动测速会随结果换节点。使用代理 DoH 时，可在 `DNS-PROXY` 中选择同一个节点。规则负责选策略组，策略组再选出口。延迟测试成功只表示测试地址可达，不代表每个网站都能访问。

节点名称固定不代表公网出口 IP 固定。购买前确认是否共用出口、出口 IP 是否会变化、目标服务是否可访问，以及服务商允许哪些协议和用途。分流和 DNS 可以在本地管理；服务商节点的出口、防火墙和 IP 信誉不由转换器控制，也无法替服务商添加服务器端 `GEOIP,CN,REJECT`。

只有另有落地代理、确实需要两跳时才配置 `dialer-proxy`：设备 → 机场节点 → 落地代理 → 目标。第一跳组不能包含落地节点本身，否则会形成循环。当前页面合并节点不会自动创建代理链；Shadowrocket 的节点订阅也不携带 Mihomo 的链式配置。

Rola 住宅出口在网站的[「Rola 家宽出口」](rola-residential.md)中由云端生成，按完整配置中的具体机场节点创建两跳配置。它不激活客户端、不调用 Rola 的换 IP/购买接口；动态会话不能当作静态独享 IP。住宅与机场的串联额度单独看，不合并成一个总量。

家宽服务需要提供协议、主机、端口及认证方式，单独一个公网 IP 不足以建立代理。输入支持 `socks5://用户:密码@主机:端口#名称` 和带账号密码的 `http://` / `https://` 根路径节点；用户名、密码中的 `@`、`:` 等字符要做 URL 编码。HTTPS 默认端口是 443，HTTP 是 80。HTTP/SOCKS5 本身不加密设备到代理这一段，不能只因出口是家宽就认定链路安全。先验证新节点，再将所需业务手动指向它，不自动替换当前可用出口。

命令行程序不一定读取系统代理。Claude Code 支持 `HTTP_PROXY` / `HTTPS_PROXY`，不支持直接设置 SOCKS 代理；使用本机客户端提供的 HTTP / mixed 端口。不要为排查连接失败关闭证书校验，也不要把带账号密码的订阅或代理 URL 提交到公开仓库。

参考：[Mihomo dialer-proxy](https://wiki.metacubex.one/config/proxies/dialer-proxy/)、[Claude Code 网络配置](https://code.claude.com/docs/en/network-config)。

### Claude 规则范围

Claude 使用单独的 `🧠 Claude` 组，Codex／OpenAI、Gemini、Grok 和其他 AI 仍使用 `🤖 AI`。Claude 默认跟随 AI 的现有选择，也可以独立选择家宽、国家组或具体节点；不会自动切换当前设备出口。Claude 域名规则排在 Codex 进程规则之前，避免 Codex 启动的工具请求被进程规则抢先接管。旧的 Flacier 基础快照在叠加家宽时补入该组，并将 Claude 的保护域名和对应 DoH 一起交给 Claude；显式选择“只走家宽”的规则仍保持专用家宽策略。

2026-10-10 核对官方网络文档后，规则覆盖 Claude 主域名及内容域名，包括认证、下载、浏览器桥接和 MCP 内容。补充用户提供的精确 CDN / 认证 / 内容地址，并加入官方列出的两个可选 Datadog 上报地址。Datadog 和 Fathom 地址属于共享服务；同一地址上的其他应用请求也会使用 Claude 组，规则无法区分 HTTPS 请求中的租户。

不使用 `sentry.io`、`intercom.io`、`intercomcdn.com`、`statsigapi.net` 的整站规则，也不使用 `datadog` / `sift` 关键词。未命中的配套请求仍经 `DEFAULT` 默认代理，不会因此直连；可以按实际连接日志再补具体地址。当前官方 CLI 网络列表没有列出 Statsig，不把旧示例当作当前必需依赖。

API IP 兜底独立发布为 `ai-anthropic-ip`，放在域名策略后、默认规则前；Mihomo / Surge 使用 `no-resolve`，不为了检查这条规则额外解析未知域名。使用官方入站范围 `160.79.104.0/23` 和 `2607:6bc0::/48`，不是示例中 Anthropic 对外请求的 `/21`，也不扩成整个 IPv6 `/32`。不启用 `IP-ASN,399358`，避免引入 ASN 数据库依赖以及不同客户端支持差异。Mihomo 的 IPv6 保持默认关闭，包含 IPv6 规则不代表启用 IPv6。

这些变更适用于 Flacier 分流及对应覆写，不改写 ACL4SSR 或自定义模板。Shadowrocket 的「仅节点」输出不包含这些规则；配套 `.conf` 才包含分流。不会导入示例的 `CLAUDE0409 = direct` 或 `FINAL,DIRECT`，也不会操作设备上的 DNS 覆写或代理开关。

来源：[Claude Code 网络要求](https://code.claude.com/docs/en/network-config)、[Anthropic API IP 地址](https://platform.claude.com/docs/en/api/ip-addresses)。

## 后端与用量

CF 和本地版使用同一套转换器。流量来自上游 `Subscription-Userinfo` 响应头：上传、下载、总额相加，到期取最早的有效日期；单独节点不附带机场额度。缺失来源不会被算成零额度。

相同订阅 URL 重复输入只计一次；不同 URL 是否属于同一个账户，转换器不能推断，需避免手动重复添加同一账户的不同格式链接。上游明确返回 `expire=0` 才显示长期有效；空 `expire=` 代表未返回到期，不能伪造成 0。订阅文件未改变但用量改变时，也会更新响应的 ETag。

某条机场读取路径返回拒绝或验证页时，不代表该机场接口整体不可用。可以在本地成功读取后用「同步到我的 CF」发布节点和用量，手机仍使用固定云端链接；它们更新依赖本机服务运行，详见[同步与刷新保护](subscription-refresh.md)。也可保留原机场订阅并在客户端追加规则。

上游超时、403 或其他错误会让刷新明确失败，不返回 HTTP 200 的空节点配置。客户端直读备用（`proxy-providers` 外壳）已移除：新建请求返回 `client_direct_removed`，仍保存该模式的旧链接刷新时返回 `stored_subscription_invalid`，需要重新生成。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start:local
```

打开 `http://127.0.0.1:25500`。本地链接只在这台电脑可用，服务停止后不能刷新；手机不能把 `127.0.0.1` 当作电脑地址。订阅存于 `.local/subscriptions`，不提交到 Git。

若当前网络需要通过已运行的代理软件访问机场，在启动命令后加 `--proxy http://127.0.0.1:实际混合端口`。该参数仅接受本机 HTTP/mixed 端口，只影响本地转换进程的请求，不设置全局代理变量，不启动或切换代理软件。原客户端不可用时，本地刷新也可能失败；这不是独立的公网高可用服务。Cloudflare 返回 403 时，发布前端或重试刷新并不能证明机场限制已解决。

网站“自定义后端”使用本项目的 `/api/subscriptions`，不是传统 Subconverter 的 `/sub`。不内置第三方公共转换服务。

## 规则模板

Flacier 分流、ACL4SSR 默认、多国分组、无自动测速，以及自定义 HTTPS INI。远程模板在订阅刷新时读取；目前支持 `ruleset`、`custom_proxy_group`、`enable_rule_generator=true`、`overwrite_original_rules=true`。不支持的指令会报错，不会被忽略。

Flacier 默认把 AI、开发、Apple、Steam 等业务流量及未知流量交给对应代理组；QQ／微信、网易云音乐和国内服务域名直连，Bilibili 组默认直连但仍能手动换出口。国内域名集合位于显式业务规则之后，随后用 `GEOIP,CN,DIRECT` 覆盖国内 IP 连接，最后仍是 `MATCH,DEFAULT` 代理。CN IP 依赖客户端自己的 GeoIP 数据；未命中前置域名规则时允许解析目标 IP，以便判断国内地址，解析仍遵循所配置的 DNS 路径。详见 [国内白名单来源及客户端边界](rola-residential.md#国内应用直连白名单)。Mihomo 策略组为空时使用 `REJECT`，不悄悄直连。所选出口不支持 UDP 时，Mihomo 会跳过对应规则，规则用完后默认直连，QUIC 和 WebRTC 会因此从本机地址发出；Flacier 和全局代理方案在 `MATCH` 之后加了一条只有这类 UDP 才会走到的拒绝规则，不再回落直连，也不预留直连例外。网页随之退回 TCP 走代理；语音、游戏和系统时间同步（UDP 123）等需要 UDP 的流量，要给对应分组选支持 UDP 的节点，确实连不上时再单独加规则。Shadowrocket 用 `udp-policy-not-supported-behaviour = REJECT` 达到同样效果。ACL4SSR 和自定义模板保留其明确写出的规则，不改成 Flacier 的策略。

Apple 分成六组。「🍎 Apple」（账号与 App Store）、「☁️ iCloud」、「🎵 Apple 媒体」、「✨ Apple 智能」（Siri、搜索、地图与 Apple 智能）默认跟随 GLOBAL；「📥 Apple 下载」（App Store 与系统更新的下载地址）和「⚙️ Apple 系统」（激活、推送、证书校验、时间与 iCloud 专用代理接入）默认直连，下载走 Apple 国内节点。下载地址包含在商店和 iCloud 的域名后缀里，所以下载列表排在最前。Shadowrocket 配套配置没有策略组：下载与系统直连，其余跟随首页节点。

手机 Shadowrocket 需要更新并选中配套 `.conf`，全局路由选择「配置」；只刷新首页节点订阅或处于全局「代理」模式，不会应用国内直连规则。首页直接选择家宽或机场，代理规则与代理 DoH 都跟随该节点；无需再选国家、AI 或家宽策略组。

“全局代理 / 直连”由客户端运行模式控制，新规则列表不再把它们列为分流模板。旧“全局直连”链接与“代理 DoH”冲突时会明确报错；应选择系统或上游 DNS，不能同时要求没有代理节点且 DNS 必须经过代理。

规则测试与转换共用模板编译器，可以选择上述方案，也会跟随转换区的方案选择。网页按加载的规则快照顺序模拟：需要 IP 或进程名时提示补充；遇到 GEOIP、GEOSITE、未知进程正则等无法计算的前置规则，显示“无法确定”，不略过后宣称命中或默认代理。测试结果是配置默认策略，不是客户端当前选中的节点，也不代表连接可用。

### 社交应用的独立策略

桌面 Flacier 分流只使用一个 `GLOBAL`：位于“手动选择”之后，接替原来的“🌐 全局”，候选节点和默认跟随关系不变。显式配置内置名称后，Mihomo 不再追加第二个全局组。旧 Flacier 家宽订阅刷新时同步迁移组名及引用；其他模板不做这项旧配置迁移。客户端的全局运行模式与规则模式仍是独立开关，合并显示不等于切到全局代理。

Telegram、X / Twitter、Reddit、Instagram / Threads、Facebook、LinkedIn、TikTok 分别有独立策略组，默认跟随全局代理；Discord 保持原独立组。每组均可选择手动、自动、国家、机场节点、已合并的家宽和 DIRECT，不会把整个社交类别改为直连。QQ／微信继续命中前置直连白名单，国内抖音走国内服务规则，与 TikTok 分开。

这次把已有 `social.list` 的域名逐一分配到对应应用，保留汇总文件和 SOCIAL 组兼容旧链接；独立应用规则排在汇总之前。它不是所有应用端点的完整清单，新增遗漏需要根据实际请求补充。`cdninstagram.com` 与 `threads.net` 跟随 Instagram，`fbcdn.net` 统一归 Facebook；域名规则不能区分同一共享 CDN 的调用应用，如果需要 Meta 应用出口一致，请让 Facebook 和 Instagram 选择相同出口。

Mihomo 订阅、Clash Party 覆写、Shadowrocket 配套配置、Egern / sing-box 规则文件和网页规则测试来自同一规则注册表；手机需刷新并启用配套配置，单独刷新节点列表不会更新策略组。

## 页面版本信息

页脚分别显示前端构建时间、提交 hash 和 Cloudflare Worker 版本创建时间。版本创建时间不等于流量切换完成时间，也不会用构建时间冒充。版本接口遇到网络错误、超时、429 或 5xx 时最多尝试 3 次；恢复联网后重新读取，失败时保留已读到的版本并提示重试。

参考：[Mihomo DNS](https://wiki.metacubex.one/config/dns/)、[Clash Verge 响应头](https://www.clashverge.dev/guide/url_schemes.html)、[Clash Verge 覆写优先级](https://www.clashverge.dev/guide/extend.html)、[ACL4SSR 配置](https://github.com/ACL4SSR/ACL4SSR/tree/master/Clash/config)。
