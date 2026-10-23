import { type FormEvent, useRef, useState } from "react";
import type { RuleSelection } from "../config/rule-templates";

import { AppHeader } from "./components/AppHeader";
import { AsciiField } from "./components/AsciiField";
import { ConverterWorkspace } from "./components/ConverterWorkspace";
import { NetworkChecks } from "./components/NetworkChecks";
import { RouteMap } from "./components/RouteMap";
import { RouteOverview } from "./components/RouteOverview";
import { RouteTester } from "./components/RouteTester";
import { SubscriptionImport } from "./components/SubscriptionImport";
import { SiteVersion } from "./components/BuildDetails";
import type { BuildInfo } from "../config/build-info";
import type { StationMatch } from "./lib/route-stations";

declare const __BUILD_INFO__: BuildInfo;

// Inputs to try, not claims about routing: the result always comes from the loaded rules.
const tryHosts = ["claude.ai", "chatgpt.com", "www.bilibili.com", "swcdn.apple.com"];

export function App() {
  const [ruleSelection, setRuleSelection] = useState<RuleSelection>({ preset: "flacier", url: "" });
  const [testRequest, setTestRequest] = useState<{ host: string; id: number } | null>(null);
  const [match, setMatch] = useState<StationMatch | null>(null);
  const [focus, setFocus] = useState<{ position: number; id: number } | null>(null);
  const [heroInput, setHeroInput] = useState("");
  const [heroTest, setHeroTest] = useState<number | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  function testFromHero(host: string) {
    if (!host.trim()) return;
    const id = Date.now();
    setHeroInput(host);
    setTestRequest({ host: host.trim(), id });
    setHeroTest(id);
  }

  return (
    <div className="app-shell" id="top">
      <AppHeader />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <AsciiField targetRef={rootRef} clearSelector=".hero-copy h1, .hero-copy p, .hero-try" pulse={heroTest} />
          <div className="hero-inner page-width">
            <div className="hero-copy">
              <h1 id="hero-title">把机场订阅转成分好流的配置</h1>
              <p>粘贴机场的订阅链接，生成 Clash Party、Shadowrocket 等客户端能直接导入的配置。国内网站直连，其余走代理；规则里没有的网站也走代理，不会悄悄直连。</p>
              <form className="hero-test" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); testFromHero(heroInput); }}>
                <span className="hero-prompt" aria-hidden="true">&gt;</span>
                <input
                  aria-label="要测试的网址"
                  value={heroInput}
                  onChange={event => setHeroInput(event.target.value)}
                  placeholder="输入网址，看它走哪条规则"
                  spellCheck="false"
                  autoComplete="off"
                />
                <button type="submit">测试</button>
              </form>
              <div className="hero-try">
                <span>试试</span>
                {tryHosts.map(host => <button type="button" key={host} onClick={() => testFromHero(host)}>{host}</button>)}
              </div>
              <a className="button button-primary hero-convert" href="#subscription">开始转换订阅</a>
            </div>
            <RouteOverview
              match={match}
              pending={heroTest}
              rootRef={rootRef}
              onOpenSection={position => setFocus({ position, id: Date.now() })}
            />
          </div>
        </section>
        <SubscriptionImport onRuleSelectionChange={setRuleSelection} />
        <NetworkChecks />
        <RouteTester
          selection={ruleSelection}
          request={testRequest}
          onMatch={setMatch}
          onShowStation={position => setFocus({ position, id: Date.now() })}
        />
        <RouteMap
          match={match}
          focus={focus}
          onTest={host => {
            setTestRequest({ host, id: Date.now() });
            document.getElementById("tester")?.scrollIntoView({ block: "start" });
          }}
        />
        <ConverterWorkspace />
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
        <SiteVersion build={__BUILD_INFO__} />
      </footer>
    </div>
  );
}
