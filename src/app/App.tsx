import { ArrowUpRight } from "@phosphor-icons/react";

import { AppHeader } from "./components/AppHeader";
import { ConverterWorkspace } from "./components/ConverterWorkspace";
import { PolicyMap } from "./components/PolicyMap";
import { RouteTester } from "./components/RouteTester";
import { RulesCatalog } from "./components/RulesCatalog";
import { SubscriptionImport } from "./components/SubscriptionImport";

export function App() {
  return (
    <div className="app-shell" id="top">
      <AppHeader />
      <main>
        <SubscriptionImport />
        <RouteTester />
        <RulesCatalog />
        <ConverterWorkspace />
        <PolicyMap />

        <section className="use-panel page-width" aria-labelledby="use-title">
          <div>
            <h2 id="use-title">规则文件</h2>
            <p>YAML · manifest</p>
          </div>
          <div className="use-actions">
            <a
              className="button button-primary"
              href="/overrides/clash-party.yaml"
              download="flacier-clash-party.yaml"
            >
              Mihomo 覆写
              <ArrowUpRight aria-hidden="true" />
            </a>
            <a
              className="button button-secondary"
              href="/rules/manifest.yaml"
              target="_blank"
              rel="noreferrer"
            >
              规则目录
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer page-width">
        <p>Flacierの订阅转换 · AGPL-3.0</p>
        <a
          href="https://github.com/Fldicoahkiin/personal-clash-rules"
          target="_blank"
          rel="noreferrer"
        >
          <img src="/brand/github-mark.svg" alt="" width="16" height="16" />
          GitHub
        </a>
      </footer>
    </div>
  );
}
