# personal-clash-rules

**Flacierの订阅转换** 是一套个人使用的 Mihomo 规则、Clash Party YAML
覆写和浏览器本地规则转换工具。页面可以生成 Clash Party 订阅导入链接，规则覆盖
AI、Steam、Discord、开发站点、流媒体和社交服务。

![Personal Clash Rules architecture](docs/architecture.svg)

## 项目边界

- 公开仓库只保存规则、覆写、页面源码和部署配置。
- 3x-ui 的节点、UUID、私钥、订阅 token 和真实订阅地址不能进入仓库。
- 页面中的订阅导入链接与规则转换都在浏览器本地生成。
- Cloudflare Worker 只负责静态文件、安全响应头和 `/health`，不代理第三方订阅。
- 当前规则不考虑中国大陆服务分流，也没有 GEOIP CN 兜底规则。

## 现有规则

| 分类 | 规则集 | 默认策略 | 备注 |
| --- | --- | --- | --- |
| AI | OpenAI、Anthropic、xAI、Google AI、AI Coding、General AI | `AI` | 包含 Codex 与 Claude 进程规则 |
| Steam | Steam、Steam Download | `STEAM`、`STEAM-DOWNLOAD` | 下载默认 `DIRECT`，避免占用 VPS 流量 |
| Discord | Discord | `DISCORD` | 应用、附件、媒体与语音域名 |
| Developer | Developer | `DEV` | GitHub、GitLab、npm、PyPI、Docker、Rust |
| Media | Media | `MEDIA` | YouTube、Netflix、Disney+、Spotify、Twitch |
| Social | Social | `SOCIAL` | X、Reddit、Instagram、Telegram、TikTok |
| Local | Private Domain、Private IP | `DIRECT` | 在进程规则之前匹配 |

所有 provider 都是 Mihomo `classical` + `text` 格式，索引见
[`public/rules/manifest.yaml`](public/rules/manifest.yaml)。

## 策略结构

```text
请求
  -> 私有域名和私有网段 -> DIRECT
  -> Codex 和 Claude 进程 -> AI
  -> 服务规则集 -> AI / STEAM / DISCORD / DEV / MEDIA / SOCIAL
  -> 地区组 -> US / JP / SG / HK / TW / KR / EU
  -> 个人节点
  -> 未匹配流量 -> DEFAULT
```

地区组按节点名称筛选，不是出口 IP 探测。建议在 3x-ui 订阅节点备注中保持这样的命名：

```text
US Los Angeles 01
JP Tokyo 01
SG Singapore 01
HK Hong Kong 01
```

每个地区组使用 `empty-fallback: DIRECT`。如果某个国家没有匹配节点，Mihomo
会明确回退直连，而不会让 `AUTO` 混进国家节点列表。`AI` 默认选择 `GLOBAL`，需要固定
国家时再手动切换 US、JP、SG 等地区。

`PROCESS-NAME-REGEX` 会把 Codex 或 Claude 进程发出的全部流量送进 `AI`。
私有网络规则放在它前面，避免本地开发地址被送进代理。如果你不想按进程分流，可从
[`public/overrides/clash-party.yaml`](public/overrides/clash-party.yaml) 删除两条
`PROCESS-NAME-REGEX`。

## 在 Clash Party 中使用

正式覆写地址：

```text
https://rules.flacier.com/overrides/clash-party.yaml
```

[`GitHub Raw`](https://raw.githubusercontent.com/Fldicoahkiin/personal-clash-rules/main/public/overrides/clash-party.yaml)
可以用于核对源码或手工下载，但不是 Cloudflare 整体故障时的完整回退：正式覆写中的
rule provider 统一使用 `rules.flacier.com`。

1. 打开 Clash Party 左侧的「覆写」。
2. 使用上面的链接导入 YAML 覆写。
3. 打开「订阅管理」，编辑你的 3x-ui 订阅。
4. 在「覆写」字段选择刚导入的文件并保存。
5. 使用规则模式，在 `AI`、`DISCORD` 等策略组中选择需要的地区。

Clash Party 会深度合并对象；`+rules` 和 `+proxy-groups` 会把数组插入原配置前面。
本项目的覆写最后包含 `MATCH,DEFAULT`，所以原订阅后面的规则不会继续执行。这是有意的，
用于让这套个人规则成为最终路由入口。

参考：

- [Clash Party 覆写说明](https://clashparty.org/docs/guide/override)
- [Clash Party YAML 合并规则](https://clashparty.org/docs/guide/override/yaml)
- [Clash Party URL Scheme](https://clashparty.org/docs/guide/urlscheme)

## 规则转换页面

页面支持四种输入：

- V2Fly `domain-list-community` 数据
- Mihomo classical 文本
- Mihomo domain 文本
- 带 `payload` 的 YAML

输出支持 classical 文本、classical YAML、domain 文本和可粘贴进配置的 provider
片段。V2Fly 的 `include:` 不能在浏览器里展开，带 `@ads` 等属性的行也不会静默导入，
页面会列出跳过原因。

本地启动：

```bash
pnpm install
pnpm dev
```

校验：

```bash
pnpm check
```

## 通过 GitHub 连接 Cloudflare Workers

不需要在本机执行 `wrangler login` 或 `wrangler deploy`。仓库已经提供
[`wrangler.jsonc`](wrangler.jsonc)，Cloudflare Workers Builds 会读取它。

1. 先在 GitHub 创建公开仓库 `Fldicoahkiin/personal-clash-rules` 并推送 `main`。
2. 在 Cloudflare 控制台进入 **Workers & Pages**。
3. 选择 **Create application**，在 **Import a repository** 旁选择开始。
4. 连接 GitHub，并选择 `personal-clash-rules`。
5. Worker 名称填写 `personal-clash-rules`，必须和 `wrangler.jsonc` 的 `name` 一致。
6. Production branch 选择 `main`。
7. Build command 填写 `pnpm build`。
8. Deploy command 保持 `npx wrangler deploy`。
9. Root directory 保持 `/`。
10. 保存并部署，先用分配的 `workers.dev` 地址检查页面、规则文件和 `/health`。

Cloudflare 当前会在每次推送后先构建，再执行部署命令；非生产分支默认上传预览版本。
参见 [Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
和 [GitHub 连接步骤](https://developers.cloudflare.com/workers/ci-cd/builds/)。

### 绑定自己的域名

初次部署通过后，在 Worker 中进入：

```text
Settings -> Domains & Routes -> Add -> Custom Domain
```

本项目使用 `rules.flacier.com`。Cloudflare 会创建 DNS 记录并签发证书，
不需要在仓库写入 zone id 或 API token。域名不能已经存在同名 CNAME。参见
[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

当前公开地址：

```text
https://rules.flacier.com/
https://rules.flacier.com/overrides/clash-party.yaml
https://rules.flacier.com/rules/ai/openai.list
https://rules.flacier.com/health
```

Cloudflare Workers Builds 已连接 `Fldicoahkiin/personal-clash-rules`，推送 `main` 后会自动
执行 `pnpm run build` 和 `npx wrangler deploy`。

## 目录

```text
public/rules/             Mihomo rule providers
public/overrides/         Clash Party YAML merge override
src/app/                  React 页面和本地转换器
src/worker.ts             Cloudflare Worker 入口
docs/architecture.svg     README 架构图
tests/                    转换、规则和覆写校验
wrangler.jsonc            Workers 与静态资源配置
```

## 来源与许可

代码与本仓库整理后的内容使用 [MIT License](LICENSE)。部分域名条目参考或改写自
MIT 许可的 [`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community)，
归属说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

没有复制 GPL 规则仓库的数据文件。新增来源时要先确认许可兼容性，并在第三方说明中记录。
