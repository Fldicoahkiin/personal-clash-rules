import { ArrowUpRight, GithubLogo } from "@phosphor-icons/react";

import { AppHeader } from "./components/AppHeader";
import { ConverterWorkspace } from "./components/ConverterWorkspace";
import { PolicyMap } from "./components/PolicyMap";
import { RulesCatalog } from "./components/RulesCatalog";
import { SubscriptionImport } from "./components/SubscriptionImport";

export function App() {
  return (
    <div className="app-shell" id="top">
      <AppHeader />
      <main>
        <section className="hero page-width" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">PERSONAL MIHOMO TOOLKIT</p>
            <h1 id="page-title">
              Flacier<span>の</span>订阅转换
            </h1>
            <p className="hero-summary">
              为个人节点准备的规则工作台。整理 AI、Steam、Discord
              等常用流量，生成 Clash Party 覆写，并在浏览器里完成规则格式转换。
            </p>
          </div>
          <dl className="hero-facts" aria-label="项目摘要">
            <div>
              <dt>14</dt>
              <dd>规则集</dd>
            </div>
            <div>
              <dt>7</dt>
              <dd>地区组</dd>
            </div>
            <div>
              <dt>0</dt>
              <dd>上传内容</dd>
            </div>
          </dl>
        </section>

        <SubscriptionImport />
        <ConverterWorkspace />
        <PolicyMap />
        <RulesCatalog />

        <section className="use-panel page-width" aria-labelledby="use-title">
          <div>
            <p className="section-kicker">CLASH PARTY</p>
            <h2 id="use-title">把规则放进现有订阅</h2>
            <p>
              先在 Clash Party 的覆写页面用链接导入 YAML，再到订阅编辑页为目标订阅选择该覆写。
              规则更新后不需要重复修改原订阅。
            </p>
          </div>
          <div className="use-actions">
            <a
              className="button button-primary"
              href="/overrides/clash-party.yaml"
              download="flacier-clash-party.yaml"
            >
              下载覆写
              <ArrowUpRight aria-hidden="true" />
            </a>
            <a
              className="button button-secondary"
              href="https://clashparty.org/docs/guide/override"
              target="_blank"
              rel="noreferrer"
            >
              查看官方步骤
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer page-width">
        <p>MIT Licensed · 规则来源和修改边界记录在仓库中</p>
        <a
          href="https://github.com/Fldicoahkiin/personal-clash-rules"
          target="_blank"
          rel="noreferrer"
        >
          <GithubLogo aria-hidden="true" />
          GitHub
        </a>
      </footer>
    </div>
  );
}
